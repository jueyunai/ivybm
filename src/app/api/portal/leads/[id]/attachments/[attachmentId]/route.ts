import { readFile } from 'node:fs/promises'
import { NextRequest } from 'next/server'

import {
  authorizeLeadRequest,
  leadErrorResponse,
  requireLeadID,
} from '@/admin-portal/modules/leads/leadRoute'
import { resolveManagedLeadAttachmentPath } from '@/modules/lead-attachments/files'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export type LeadAttachmentDownloadDependencies = {
  fileReader?: (filePath: string) => Promise<Buffer | Uint8Array>
}

export const createLeadAttachmentDownloadHandler = ({
  fileReader = readFile,
}: LeadAttachmentDownloadDependencies = {}) =>
  async function leadAttachmentDownloadHandler(
    request: NextRequest,
    { params }: { params: Promise<{ attachmentId: string; id: string }> },
  ): Promise<Response> {
    try {
      const { attachmentId: attachmentIdStr, id: leadIdStr } = await params
      const leadId = requireLeadID(leadIdStr)
      const attachmentId = Number.parseInt(attachmentIdStr, 10)
      if (!Number.isSafeInteger(attachmentId) || attachmentId <= 0) {
        return new Response('Not found', { status: 404 })
      }

      const { payload, req } = await authorizeLeadRequest(request)

      // Verify user has access to this lead (e.g. sales user assigned to lead, or operator/admin)
      const lead = await payload.findByID({
        collection: 'leads',
        depth: 0,
        id: leadId,
        overrideAccess: false,
        req,
      })

      if (!lead) {
        return new Response('Not found', { status: 404 })
      }

      const attachment = await payload.findByID({
        collection: 'lead-attachments',
        depth: 0,
        id: attachmentId,
        overrideAccess: true,
      })

      if (!attachment || typeof attachment.filename !== 'string') {
        return new Response('Not found', { status: 404 })
      }

      const associatedLeadId =
        typeof attachment.lead === 'object' && attachment.lead !== null
          ? (attachment.lead as { id: number | string }).id
          : attachment.lead

      if (Number(associatedLeadId) !== leadId) {
        return new Response('Not found', { status: 404 })
      }

      if (attachment.status !== 'associated') {
        return new Response('Attachment unavailable', { status: 404 })
      }

      try {
        const filePath = await resolveManagedLeadAttachmentPath(attachment.filename)
        const data = await fileReader(filePath)

        return new Response(data, {
          headers: {
            'Cache-Control': 'private, no-store',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
            'Content-Type': attachment.mimeType || 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff',
          },
        })
      } catch {
        // Mark as missing if file not found on disk
        try {
          await payload.update({
            collection: 'lead-attachments',
            id: attachmentId,
            data: { status: 'missing' },
            overrideAccess: true,
          })
        } catch {
          // Ignore update failure
        }
        return new Response('Not found', { status: 404 })
      }
    } catch (error) {
      if ((error as { status?: unknown })?.status === 404) {
        return new Response('Not found', { status: 404 })
      }
      return leadErrorResponse(error)
    }
  }

export const GET = createLeadAttachmentDownloadHandler()
