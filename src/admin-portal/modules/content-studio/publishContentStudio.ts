import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import type { Payload, PayloadRequest } from 'payload'

import { contentStudioInternalWriteContext } from '@/access/contentStudio'
import { getRoleUser } from '@/access/roles'
import { getSiteOrigin } from '@/lib/seo'
import { PayloadJobQueue } from '@/modules/jobs/claim'
import {
  mediaBytesMatchMimeType,
  publicationAssetPath,
  resolveManagedMediaPath,
  updatePortalMedia,
} from '@/modules/media'
import type { PublicationAsset, PublishingPlatform } from '@/modules/publishing/contracts'
import {
  planMultiPlatformPublication,
  type MultiPlatformPublishTarget,
} from '@/modules/platforms/multiPlatformPublishing'
import { enqueuePublicationExecution } from '@/modules/platforms/publicationJobs'
import { PayloadPublishingAccountResolver } from '@/modules/platforms/publishingAccountResolver'
import type { ResolvedPublishingAccount } from '@/modules/platforms/publishingAccountResolver'
import type { GeneratedContent, PublishJob } from '@/payload-types'

import { ContentStudioCommandError } from './contentStudioCommands'

const internalContext = { ...contentStudioInternalWriteContext }
const IMAGE_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png'])
const META_IMAGE_TYPES = new Set(['image/jpeg', 'image/png'])
const PUBLICATION_REQUIRES_RECONCILIATION = [
  'scheduled',
  'accepted',
  'publishing',
  'published',
  'delivery_unknown',
] as const

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

const publicationTransactionDatabase = async (payload: Payload, req: PayloadRequest) => {
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
  return database
}

const lockPublicationCommand = async (
  payload: Payload,
  req: PayloadRequest,
  idempotencyKey: string,
): Promise<void> => {
  const database = await publicationTransactionDatabase(payload, req)
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

const lockPublicationContent = async (
  payload: Payload,
  req: PayloadRequest,
  contentID: number,
): Promise<void> => {
  const database = await publicationTransactionDatabase(payload, req)
  // Serialize all immediate publication decisions for one reviewed content row.
  // This closes the check-then-insert race even when concurrent clicks use different keys.
  await database.execute(sql`
    SELECT id FROM generated_contents WHERE id = ${contentID} FOR UPDATE
  `)
}

const lockPublicationMedia = async (
  mediaID: number,
  payload: Payload,
  req: PayloadRequest,
): Promise<void> => {
  const database = await publicationTransactionDatabase(payload, req)
  await database.execute(sql`SELECT id FROM media WHERE id = ${mediaID} FOR UPDATE`)
}

const generatedImageSHA256 = async (
  mediaID: number,
  payload: Payload,
  req: PayloadRequest,
): Promise<string | null> => {
  const actorID = typeof req.user?.id === 'number' ? req.user.id : Number(req.user?.id)
  if (!Number.isSafeInteger(actorID) || actorID < 1) return null
  const database = await publicationTransactionDatabase(payload, req)
  const result = await database.execute<{ sha256: string }>(sql`
    SELECT result #>> '{sha256}' AS sha256
    FROM portal_command_receipts
    WHERE actor_id = ${actorID}
      AND scope = 'portal.content-studio:generate-image'
      AND status = 'completed'
      AND result #>> '{media,id}' = ${String(mediaID)}
      AND result #>> '{sha256}' ~ '^[a-f0-9]{64}$'
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `)
  return result.rows[0]?.sha256 ?? null
}

const loadAssets = async (
  content: GeneratedContent,
  payload: Payload,
  req: PayloadRequest,
): Promise<Array<PublicationAsset & { byteLength: number }>> => {
  const ids = relationIDs(content.assets)
  for (const id of [...ids].sort((left, right) => left - right)) {
    await lockPublicationMedia(id, payload, req)
  }
  return Promise.all(
    ids.map(async (id) => {
      let media = await payload.findByID({
        collection: 'media',
        depth: 0,
        id,
        overrideAccess: false,
        req,
      })
      const filename = typeof media.filename === 'string' ? media.filename : ''
      const mimeType = typeof media.mimeType === 'string' ? media.mimeType : ''
      if (!filename || !mimeType || !media.url) {
        throw new ContentStudioCommandError(
          'content-studio-publication-assets-invalid',
          'This asset has no stable delivery URL. Re-upload it through Media and reload before publishing.',
          409,
        )
      }
      let bytes: Buffer
      try {
        bytes = await readFile(await resolveManagedMediaPath(filename))
      } catch {
        throw new ContentStudioCommandError(
          'content-studio-publication-assets-invalid',
          'A selected media file is unavailable',
          409,
        )
      }
      if (
        (media.filesize && bytes.byteLength !== media.filesize) ||
        !mediaBytesMatchMimeType(bytes, mimeType)
      ) {
        throw new ContentStudioCommandError(
          'content-studio-publication-assets-invalid',
          'The selected media file changed after review',
          409,
        )
      }
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      if (media.isPublic !== true) {
        if ((await generatedImageSHA256(id, payload, req)) !== sha256) {
          throw new ContentStudioCommandError(
            'content-studio-publication-asset-private',
            'This private generated asset no longer matches its generation receipt. Generate and review it again before publishing.',
            409,
          )
        }
        await updatePortalMedia({
          id,
          input: {
            alt: typeof media.alt === 'string' ? media.alt : 'AI generated image',
            isPublic: true,
            source: typeof media.source === 'string' ? media.source : 'AI generated image',
            updatedAt: typeof media.updatedAt === 'string' ? media.updatedAt : '',
          },
          payload,
          req,
        })
        media = await payload.findByID({
          collection: 'media',
          depth: 0,
          id,
          overrideAccess: false,
          req,
        })
      }
      if (media.isPublic !== true) {
        throw new ContentStudioCommandError(
          'content-studio-publication-asset-private',
          'This asset is still private. Reload the approved content before publishing.',
          409,
        )
      }
      return {
        byteLength: bytes.byteLength,
        fileName: filename,
        id: String(media.id),
        mimeType,
        sha256,
        sourceUrl: new URL(publicationAssetPath(media.id, sha256), getSiteOrigin()).toString(),
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
        'content-studio-publication-format-unsupported',
        `${account.platform} publishing requires exactly one public JPEG or PNG`,
        409,
      )
    }
  } else if (assets.length > 1 || (assets[0] && !IMAGE_TYPES.has(assets[0].mimeType))) {
    throw new ContentStudioCommandError(
      'content-studio-publication-format-unsupported',
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
  environment = process.env,
  id,
  input,
  now = () => new Date(),
  payload,
  req,
}: {
  environment?: Readonly<Record<string, string | undefined>>
  id: number
  input: Record<string, unknown>
  now?: () => Date
  payload: Payload
  req: PayloadRequest
}) => {
  if (environment.ADMIN_PORTAL_PUBLISHING_ENABLED !== 'true') {
    throw new ContentStudioCommandError(
      'content-studio-publishing-disabled',
      'Immediate platform publishing is disabled in this environment',
      503,
    )
  }
  const actor = getRoleUser(req.user)
  if (!actor || (actor.role !== 'admin' && actor.role !== 'operator')) {
    throw new ContentStudioCommandError(
      'content-studio-forbidden',
      'Content Studio access denied',
      403,
    )
  }
  const baseKey = commandKey(input.idempotencyKey)
  await lockPublicationCommand(payload, req, baseKey)
  await lockPublicationContent(payload, req, id)
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
  const actorId = positiveID(actor.id, 'actor')
  const accountResolver = new PayloadPublishingAccountResolver({ payload })
  const resolutions = await Promise.all(
    requestedAccounts(input.targetAccountIds).map(async (platformAccountId) => {
      const account = await payload.findByID({
        collection: 'platform-accounts',
        depth: 0,
        id: platformAccountId,
        overrideAccess: true,
        req,
        select: {
          accountKind: true,
          authorizationRevision: true,
        },
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
    const priorPublication = await payload.find({
      collection: 'publish-jobs',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
      sort: '-createdAt',
      where: {
        and: [
          { content: { equals: id } },
          {
            platformAccount: {
              equals: positiveID(command.snapshot.platformAccountId, 'platformAccountId'),
            },
          },
          { status: { in: [...PUBLICATION_REQUIRES_RECONCILIATION] } },
        ],
      },
    })
    if (priorPublication.docs[0]) {
      throw new ContentStudioCommandError(
        'content-studio-publication-already-exists',
        'This content already has a publication for the selected account. Review its current result before sending again.',
        409,
      )
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
