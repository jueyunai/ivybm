import { unlink } from 'node:fs/promises'
import type { Payload } from 'payload'

import {
  LEAD_ATTACHMENT_RETENTION_MS,
  LEAD_ATTACHMENT_STAGING_TTL_MS,
  resolveManagedLeadAttachmentPath,
} from './files'

export type CleanupLeadAttachmentsOptions = {
  dryRun?: boolean
  now?: Date | number | string
  payload: Payload
  retentionMs?: number
  stagingTtlMs?: number
}

export type AttachmentCleanupCandidate = {
  byteSize: number
  createdAt: string
  expiresAt: string
  filename: string
  id: number | string
  leadId: null | number | string
  reason: 'associated_retention_expired' | 'staged_ttl_expired'
  status: string
}

export type CleanupResult = {
  associatedDeletedCount: number
  candidates: AttachmentCleanupCandidate[]
  deletedCount: number
  deletedIds: (number | string)[]
  dryRun: boolean
  errorsCount: number
  freedBytes: number
  stagedDeletedCount: number
  summary: string
}

export const cleanupLeadAttachments = async ({
  dryRun = true,
  now: explicitNow,
  payload,
  retentionMs = LEAD_ATTACHMENT_RETENTION_MS,
  stagingTtlMs = LEAD_ATTACHMENT_STAGING_TTL_MS,
}: CleanupLeadAttachmentsOptions): Promise<CleanupResult> => {
  const nowTime = explicitNow ? new Date(explicitNow).getTime() : Date.now()
  const nowDate = new Date(nowTime)
  const stagingCutoff = new Date(nowTime - stagingTtlMs).toISOString()
  const retentionCutoff = new Date(nowTime - retentionMs).toISOString()

  // Find staged (pending) attachments older than staging TTL or expired
  const stagedResult = await payload.find({
    collection: 'lead-attachments',
    depth: 0,
    limit: 500,
    overrideAccess: true,
    pagination: false,
    where: {
      and: [
        { status: { in: ['pending', 'missing'] } },
        {
          or: [
            { expiresAt: { less_than_equal: nowDate.toISOString() } },
            { createdAt: { less_than_equal: stagingCutoff } },
          ],
        },
      ],
    },
  })

  // Find associated attachments older than retention period or expired
  const associatedResult = await payload.find({
    collection: 'lead-attachments',
    depth: 0,
    limit: 500,
    overrideAccess: true,
    pagination: false,
    where: {
      and: [
        { status: { in: ['associated', 'expired'] } },
        {
          or: [
            { expiresAt: { less_than_equal: nowDate.toISOString() } },
            { associatedAt: { less_than_equal: retentionCutoff } },
          ],
        },
      ],
    },
  })

  const candidates: AttachmentCleanupCandidate[] = []

  for (const doc of stagedResult.docs) {
    candidates.push({
      byteSize: typeof doc.byteSize === 'number' ? doc.byteSize : 0,
      createdAt: String(doc.createdAt || ''),
      expiresAt: String(doc.expiresAt || ''),
      filename: String(doc.filename || ''),
      id: doc.id,
      leadId: doc.lead
        ? typeof doc.lead === 'object'
          ? (doc.lead as { id: string | number }).id
          : doc.lead
        : null,
      reason: 'staged_ttl_expired',
      status: String(doc.status),
    })
  }

  for (const doc of associatedResult.docs) {
    if (!candidates.some((c) => String(c.id) === String(doc.id))) {
      candidates.push({
        byteSize: typeof doc.byteSize === 'number' ? doc.byteSize : 0,
        createdAt: String(doc.createdAt || ''),
        expiresAt: String(doc.expiresAt || ''),
        filename: String(doc.filename || ''),
        id: doc.id,
        leadId: doc.lead
          ? typeof doc.lead === 'object'
            ? (doc.lead as { id: string | number }).id
            : doc.lead
          : null,
        reason: 'associated_retention_expired',
        status: String(doc.status),
      })
    }
  }

  let deletedCount = 0
  let stagedDeletedCount = 0
  let associatedDeletedCount = 0
  let freedBytes = 0
  let errorsCount = 0
  const deletedIds: (number | string)[] = []

  if (!dryRun) {
    for (const candidate of candidates) {
      try {
        if (candidate.filename) {
          try {
            const filePath = await resolveManagedLeadAttachmentPath(candidate.filename)
            await unlink(filePath)
          } catch (fileError) {
            if ((fileError as { code?: string })?.code !== 'ENOENT') {
              payload.logger.warn(
                `Could not remove file ${candidate.filename}: ${String(fileError)}`,
              )
            }
          }
        }

        await payload.delete({
          collection: 'lead-attachments',
          id: candidate.id,
          overrideAccess: true,
        })

        try {
          await payload.create({
            collection: 'audit-logs',
            data: {
              action: 'delete',
              documentId: String(candidate.id),
              resource: 'lead-attachments',
            },
            overrideAccess: true,
          })
        } catch {
          // Non-blocking audit log creation
        }

        deletedCount += 1
        freedBytes += candidate.byteSize
        deletedIds.push(candidate.id)
        if (candidate.reason === 'staged_ttl_expired') {
          stagedDeletedCount += 1
        } else {
          associatedDeletedCount += 1
        }
      } catch (error) {
        errorsCount += 1
        payload.logger.error(
          `Failed to clean lead attachment ${candidate.id}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  const summary = dryRun
    ? `[DRY-RUN] Found ${candidates.length} candidate attachment(s) for cleanup: ${candidates.filter((c) => c.reason === 'staged_ttl_expired').length} staged (>24h), ${candidates.filter((c) => c.reason === 'associated_retention_expired').length} associated (>180d). Total potential space: ${candidates.reduce((sum, c) => sum + c.byteSize, 0)} bytes.`
    : `[EXECUTE] Cleaned ${deletedCount} attachment(s) (${stagedDeletedCount} staged, ${associatedDeletedCount} associated). Freed ${freedBytes} bytes. Errors: ${errorsCount}.`

  return {
    associatedDeletedCount: dryRun
      ? candidates.filter((c) => c.reason === 'associated_retention_expired').length
      : associatedDeletedCount,
    candidates,
    deletedCount: dryRun ? candidates.length : deletedCount,
    deletedIds,
    dryRun,
    errorsCount,
    freedBytes: dryRun ? candidates.reduce((sum, c) => sum + c.byteSize, 0) : freedBytes,
    stagedDeletedCount: dryRun
      ? candidates.filter((c) => c.reason === 'staged_ttl_expired').length
      : stagedDeletedCount,
    summary,
  }
}
