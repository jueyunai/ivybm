import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'

import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import type { Payload, PayloadRequest } from 'payload'

import { contentStudioInternalWriteContext } from '@/access/contentStudio'
import { getSiteOrigin } from '@/lib/seo'
import { PayloadJobQueue } from '@/modules/jobs/claim'
import type { PublicationAsset, PublishingPlatform } from '@/modules/publishing/contracts'
import {
  planMultiPlatformPublication,
  type MultiPlatformPublishTarget,
} from '@/modules/platforms/multiPlatformPublishing'
import { enqueuePublicationExecution } from '@/modules/platforms/publicationJobs'
import { PayloadPublishingAccountResolver } from '@/modules/platforms/publishingAccountResolver'
import type { ResolvedPublishingAccount } from '@/modules/platforms/publishingAccountResolver'
import type { GeneratedContent, Media, PublishJob } from '@/payload-types'

import { ContentStudioCommandError } from './contentStudioCommands'

const internalContext = { ...contentStudioInternalWriteContext }
const IMAGE_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png'])
const META_IMAGE_TYPES = new Set(['image/jpeg', 'image/png'])

const positiveID = (value: unknown, field: string): number => {
  const id = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new ContentStudioCommandError(
      'content-studio-invalid-input',
      `${field} must be a positive ID`,
      400,
    )
  }
  return id
}

const relationIDs = (value: unknown): number[] => {
  const values = Array.isArray(value) ? value : value == null ? [] : [value]
  return values.map((item) =>
    positiveID(item && typeof item === 'object' && 'id' in item ? item.id : item, 'asset'),
  )
}

const commandKey = (value: unknown): string => {
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > 200) {
    throw new ContentStudioCommandError(
      'content-studio-invalid-idempotency-key',
      'A valid idempotency key is required',
      400,
    )
  }
  return value
}

const requestedAccounts = (value: unknown): number[] => {
  if (!Array.isArray(value) || !value.length || value.length > 3) {
    throw new ContentStudioCommandError(
      'content-studio-invalid-input',
      'Select between one and three platform accounts',
      400,
    )
  }
  const ids = value.map((entry) => positiveID(entry, 'targetAccountIds'))
  if (new Set(ids).size !== ids.length) {
    throw new ContentStudioCommandError(
      'content-studio-invalid-input',
      'Platform account selections must be unique',
      400,
    )
  }
  return ids
}

const lockPublicationCommand = async (
  payload: Payload,
  req: PayloadRequest,
  idempotencyKey: string,
): Promise<void> => {
  const transactionID = await req.transactionID
  const adapter = payload.db as unknown as PostgresAdapter
  const database = transactionID ? adapter.sessions[transactionID]?.db : undefined
  if (!database) {
    throw new ContentStudioCommandError(
      'content-studio-transaction-required',
      'Immediate publication requires an active database transaction',
      409,
    )
  }
  // Different content rows may receive the same malformed/replayed UI command key.
  // Fail a concurrent edge closed; a later replay will load or conflict deterministically.
  const locked = await database.execute<{ acquired: boolean }>(sql`
    SELECT pg_try_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0)) AS acquired
  `)
  if (locked.rows[0]?.acquired !== true) {
    throw new ContentStudioCommandError(
      'content-studio-publication-processing',
      'This publication command is already processing',
      409,
    )
  }
}

const mediaPath = async (media: Media): Promise<string> => {
  const filename = typeof media.filename === 'string' ? media.filename : ''
  if (!filename || path.basename(filename) !== filename) {
    throw new ContentStudioCommandError(
      'content-studio-publication-assets-invalid',
      'A selected media file is unavailable',
      409,
    )
  }
  const mediaRoot = await realpath(path.resolve(process.cwd(), 'media'))
  const resolved = await realpath(path.resolve(mediaRoot, filename))
  const relative = path.relative(mediaRoot, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ContentStudioCommandError(
      'content-studio-publication-assets-invalid',
      'A selected media file is outside managed storage',
      409,
    )
  }
  return resolved
}

const loadAssets = async (
  content: GeneratedContent,
  payload: Payload,
  req: PayloadRequest,
): Promise<Array<PublicationAsset & { byteLength: number }>> => {
  const ids = relationIDs(content.assets)
  return Promise.all(
    ids.map(async (id) => {
      const media = await payload.findByID({
        collection: 'media',
        depth: 0,
        id,
        overrideAccess: false,
        req,
      })
      if (media.isPublic !== true || !media.url || !media.mimeType || !media.filename) {
        throw new ContentStudioCommandError(
          'content-studio-publication-assets-invalid',
          'Publishing requires public media with a stable URL and MIME type',
          409,
        )
      }
      const bytes = await readFile(await mediaPath(media))
      if (media.filesize && bytes.byteLength !== media.filesize) {
        throw new ContentStudioCommandError(
          'content-studio-publication-assets-invalid',
          'The selected media file changed after review',
          409,
        )
      }
      return {
        byteLength: bytes.byteLength,
        fileName: media.filename,
        id: String(media.id),
        mimeType: media.mimeType,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        sourceUrl: new URL(media.url, getSiteOrigin()).toString(),
      }
    }),
  )
}

const targetForAccount = ({
  account,
  assets,
  text,
}: {
  account: ResolvedPublishingAccount
  assets: Array<PublicationAsset & { byteLength: number }>
  text: string
}): MultiPlatformPublishTarget => {
  if (account.platform === 'facebook' || account.platform === 'instagram') {
    if (assets.length !== 1 || !META_IMAGE_TYPES.has(assets[0]!.mimeType)) {
      throw new ContentStudioCommandError(
        'content-studio-publication-assets-invalid',
        `${account.platform} publishing requires exactly one public JPEG or PNG`,
        409,
      )
    }
  } else if (assets.length > 1 || (assets[0] && !IMAGE_TYPES.has(assets[0].mimeType))) {
    throw new ContentStudioCommandError(
      'content-studio-publication-assets-invalid',
      'LinkedIn publishing supports text-only or exactly one JPEG, PNG, or GIF',
      409,
    )
  }
  return {
    assets: assets.map(({ byteLength: _byteLength, ...asset }) => asset),
    platform: account.platform,
    platformAccountId: account.platformAccountId,
    text,
  }
}

const routeFor = (target: MultiPlatformPublishTarget) => {
  if (target.platform === 'facebook') return 'facebook-photo-single' as const
  if (target.platform === 'instagram') return 'instagram-image-staged' as const
  return target.assets.length
    ? ('linkedin-image-staged' as const)
    : ('linkedin-text-single' as const)
}

const linkedInAuthor = (account: ResolvedPublishingAccount) =>
  account.accountKind === 'linkedin-member'
    ? { kind: 'person' as const, personId: account.externalAccountId }
    : { kind: 'organization' as const, organizationId: account.externalAccountId }

const checkpointFor = ({
  account,
  asset,
  route,
  text,
}: {
  account: ResolvedPublishingAccount
  asset: (PublicationAsset & { byteLength: number }) | undefined
  route: ReturnType<typeof routeFor>
  text: string
}) => {
  if (route === 'instagram-image-staged' && asset?.sourceUrl) {
    return {
      accountExternalId: account.externalAccountId,
      authorizationRevision: account.authorizationRevision,
      caption: text,
      imageUrl: asset.sourceUrl,
      stage: 'scheduled',
    }
  }
  if (route === 'linkedin-image-staged' && asset?.sha256) {
    return {
      asset: {
        byteLength: asset.byteLength,
        contentType: asset.mimeType,
        id: asset.id,
        sha256: asset.sha256,
      },
      checkpoint: {
        altText: asset.fileName,
        author: linkedInAuthor(account),
        authorizationRevision: account.authorizationRevision,
        commentary: text,
        stage: 'scheduled',
      },
    }
  }
  return undefined
}

const safeJob = (job: PublishJob) => ({
  id: job.id,
  platform: job.platform,
  status: job.status,
})

export const publishContentStudioNow = async ({
  id,
  input,
  now = () => new Date(),
  payload,
  req,
}: {
  id: number
  input: Record<string, unknown>
  now?: () => Date
  payload: Payload
  req: PayloadRequest
}) => {
  const content = await payload.findByID({
    collection: 'generated-contents',
    depth: 0,
    id,
    overrideAccess: false,
    req,
  })
  if (content.status !== 'approved') {
    throw new ContentStudioCommandError(
      'content-studio-not-approved',
      'Only approved content can be published',
      409,
    )
  }
  if (input.updatedAt !== content.updatedAt) {
    throw new ContentStudioCommandError(
      'content-studio-stale',
      'This content changed. Reload before publishing',
      409,
    )
  }
  const baseKey = commandKey(input.idempotencyKey)
  await lockPublicationCommand(payload, req, baseKey)
  const actorId = positiveID(req.user?.id, 'actor')
  const accountResolver = new PayloadPublishingAccountResolver({ payload })
  const resolutions = await Promise.all(
    requestedAccounts(input.targetAccountIds).map(async (platformAccountId) => {
      const account = await payload.findByID({
        collection: 'platform-accounts',
        depth: 0,
        id: platformAccountId,
        overrideAccess: false,
        req,
      })
      const platform: PublishingPlatform | null =
        account.accountKind === 'facebook-page'
          ? 'facebook'
          : account.accountKind === 'instagram-professional'
            ? 'instagram'
            : account.accountKind === 'linkedin-member' ||
                account.accountKind === 'linkedin-organization'
              ? 'linkedin'
              : null
      if (!platform) {
        throw new ContentStudioCommandError(
          'content-studio-platform-account-unavailable',
          `Platform account ${platformAccountId} does not support publishing`,
          409,
        )
      }
      const resolved = await accountResolver.resolve({
        expectedAuthorizationRevision: account.authorizationRevision,
        platform,
        platformAccountId,
      })
      if (resolved.status === 'blocked') {
        throw new ContentStudioCommandError(
          'content-studio-platform-account-unavailable',
          `Platform account ${platformAccountId} is not ready: ${resolved.reason}`,
          409,
        )
      }
      return resolved.account
    }),
  )
  if (new Set(resolutions.map(({ platform }) => platform)).size !== resolutions.length) {
    throw new ContentStudioCommandError(
      'content-studio-invalid-input',
      'Select at most one account for each platform',
      400,
    )
  }
  const assets = await loadAssets(content, payload, req)
  const targets = resolutions.map((account) =>
    targetForAccount({ account, assets, text: content.body }),
  )
  const plan = planMultiPlatformPublication({
    idempotencyKey: baseKey,
    requestedAt: now().toISOString(),
    targets,
  })
  const queue = new PayloadJobQueue({ payload })
  const jobs: Array<{ duplicate: boolean; job: ReturnType<typeof safeJob> }> = []
  for (const command of plan.commands) {
    const target = targets.find(({ platform }) => platform === command.snapshot.platform)!
    const account = resolutions.find(({ platform }) => platform === command.snapshot.platform)!
    const existing = await payload.find({
      collection: 'publish-jobs',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
      where: { idempotencyKey: { equals: command.snapshot.idempotencyKey } },
    })
    if (existing.docs[0]) {
      const job = existing.docs[0]
      if (job.content !== id && (typeof job.content !== 'object' || job.content.id !== id)) {
        throw new ContentStudioCommandError(
          'content-studio-idempotency-conflict',
          'This publication key belongs to another content item',
          409,
        )
      }
      if (job.requestFingerprint !== command.requestFingerprint) {
        throw new ContentStudioCommandError(
          'content-studio-idempotency-conflict',
          'This publication key belongs to different content',
          409,
        )
      }
      jobs.push({ duplicate: true, job: safeJob(job) })
      continue
    }
    const executionRoute = routeFor(target)
    const created = await payload.create({
      collection: 'publish-jobs',
      context: internalContext,
      data: {
        authorizationRevision: account.authorizationRevision,
        content: id,
        createdBy: actorId,
        executionRevision: 0,
        executionRoute,
        fencingGeneration: 0,
        idempotencyKey: command.snapshot.idempotencyKey,
        mode: 'automatic',
        platform: command.snapshot.platform,
        platformAccount: positiveID(command.snapshot.platformAccountId, 'platformAccountId'),
        providerCheckpoint: checkpointFor({
          account,
          asset: assets[0],
          route: executionRoute,
          text: content.body,
        }),
        requestFingerprint: command.requestFingerprint,
        requestSnapshot: command.snapshot,
        // PublishJobs predates immediate API publication and keeps this required legacy field.
        // The provider request snapshot intentionally has no scheduledFor value.
        scheduledFor: command.requestedAt,
        status: 'scheduled',
      },
      overrideAccess: true,
      req,
    })
    await payload.create({
      collection: 'publish-logs',
      context: internalContext,
      data: {
        actor: actorId,
        event: 'created',
        publishJob: created.id,
        summary: 'User requested immediate official API publication.',
      },
      overrideAccess: true,
      req,
    })
    await enqueuePublicationExecution({ publishJobId: created.id, queue, req, revision: 0 })
    jobs.push({ duplicate: false, job: safeJob(created) })
  }
  return { jobs }
}
