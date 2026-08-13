import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PayloadRequest } from 'payload'

import {
  adoptContentStudioImage,
  ContentStudioCommandError,
  createContentStudioDraft,
  deleteContentStudioDraft,
  generateContentStudioDraft,
  generateContentStudioImage,
  scheduleContentStudioPublication,
  submitContentStudioReview,
  updateContentStudioDraft,
} from '@/admin-portal/modules/content-studio/contentStudioCommands'

const readFileMock = vi.hoisted(() => vi.fn())

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, default: { ...actual, readFile: readFileMock }, readFile: readFileMock }
})

const req = {
  user: { collection: 'users', email: 'operator@example.invalid', id: 2, role: 'operator' },
} as unknown as PayloadRequest

const input = {
  assets: [4],
  body: 'A reviewed facade systems post.',
  contentLocale: 'en',
  contentType: 'post',
  idempotencyKey: 'portal-content-studio:create-1',
  knowledgeSources: [9],
  platform: 'linkedin',
  sourceReferences: [
    { claim: 'Material finish is anodized aluminum.', source: 'Product specification 4.2' },
  ],
  title: 'Anodized aluminum facade systems',
}

describe('Portal Content Studio draft commands', () => {
  afterEach(() => {
    readFileMock.mockReset()
    vi.unstubAllEnvs()
  })

  it('creates one draft for an idempotent create request and returns it on retry', async () => {
    let stored: Record<string, unknown> | null = null
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      stored = {
        ...data,
        id: 71,
        updatedAt: '2026-07-30T12:00:00.000Z',
      }
      return stored
    })
    const find = vi.fn(async () => ({ docs: stored ? [stored] : [] }))
    const payload = { create, find } as any

    await expect(createContentStudioDraft({ input, payload, req })).resolves.toEqual({
      content: {
        id: 71,
        status: 'draft',
        title: input.title,
        updatedAt: '2026-07-30T12:00:00.000Z',
      },
      duplicate: false,
    })
    await expect(createContentStudioDraft({ input, payload, req })).resolves.toEqual({
      content: {
        id: 71,
        status: 'draft',
        title: input.title,
        updatedAt: '2026-07-30T12:00:00.000Z',
      },
      duplicate: true,
    })

    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'generated-contents',
        data: expect.objectContaining({
          createdBy: 2,
          creationFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
          idempotencyKey: input.idempotencyKey,
          status: 'draft',
        }),
        overrideAccess: false,
        req,
      }),
    )
  })

  it('rejects a reused create key when the intended draft is different', async () => {
    const payload = {
      find: vi.fn().mockResolvedValue({
        docs: [
          {
            createdBy: 2,
            creationFingerprint: 'a'.repeat(64),
            id: 71,
            status: 'draft',
            title: input.title,
            updatedAt: '2026-07-30T12:00:00.000Z',
          },
        ],
      }),
    } as any

    await expect(createContentStudioDraft({ input, payload, req })).rejects.toMatchObject({
      code: 'content-studio-idempotency-conflict',
      status: 409,
    } satisfies Partial<ContentStudioCommandError>)
  })

  it('requires a canonical create idempotency key', async () => {
    await expect(
      createContentStudioDraft({
        input: { ...input, idempotencyKey: ' has surrounding whitespace ' },
        payload: { find: vi.fn() } as any,
        req,
      }),
    ).rejects.toMatchObject({
      code: 'content-studio-invalid-idempotency-key',
      status: 400,
    })
  })

  it('creates traceable AI drafts idempotently and rejects a reused key for another brief', async () => {
    let stored: Record<string, unknown> | null = null
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      stored = { ...data, id: 72, updatedAt: '2026-07-30T12:30:00.000Z' }
      return stored
    })
    const find = vi.fn(async ({ collection }: { collection: string }) => {
      if (collection === 'knowledge-documents') {
        return {
          docs: [
            {
              content: 'Anodized aluminum is available for exterior facade systems.',
              id: 9,
              indexStatus: 'ready',
              reviewStatus: 'reviewed',
              sourceTitle: 'Product specification',
              sourceURL: 'https://example.invalid/specification',
              sourceVersion: '4.2',
            },
          ],
        }
      }
      return { docs: stored ? [stored] : [] }
    })
    const generateText = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        body: 'Specify anodized aluminum facade systems with the selected finish.',
        sourceReferences: [
          {
            claim: 'The selected finish is anodized aluminum.',
            source: 'https://example.invalid/specification',
          },
        ],
        title: 'Anodized aluminum facade systems',
      }),
    })
    const resolveGateway = vi.fn().mockResolvedValue({ generateText })
    const generationInput = {
      assets: [4],
      brief: 'Introduce the anodized finish for a commercial facade project.',
      contentLocale: 'en',
      contentType: 'post',
      idempotencyKey: 'portal-content-studio:generate-1',
      knowledgeSources: [9],
      platform: 'linkedin',
    }
    const payload = { create, find } as any

    await expect(
      generateContentStudioDraft({
        input: generationInput,
        payload,
        req,
        resolveGateway: resolveGateway as any,
      }),
    ).resolves.toMatchObject({ content: { id: 72, status: 'draft' }, duplicate: false })
    await expect(
      generateContentStudioDraft({
        input: generationInput,
        payload,
        req,
        resolveGateway: resolveGateway as any,
      }),
    ).resolves.toMatchObject({ content: { id: 72 }, duplicate: true })
    await expect(
      generateContentStudioDraft({
        input: { ...generationInput, brief: 'Write a different brief with the same key.' },
        payload,
        req,
        resolveGateway: resolveGateway as any,
      }),
    ).rejects.toMatchObject({ code: 'content-studio-idempotency-conflict', status: 409 })

    expect(create).toHaveBeenCalledTimes(1)
    expect(generateText).toHaveBeenCalledTimes(1)
  })

  it('generates an image through the image route and saves it as private Portal Media', async () => {
    const create = vi.fn(async ({ collection, data, file }) => {
      if (collection === 'media') {
        expect(data).toMatchObject({ isPublic: false })
        expect(file).toMatchObject({ mimetype: 'image/png', size: 68 })
        return {
          ...data,
          filename: file.name,
          id: 81,
          mimeType: file.mimetype,
          sizes: { card: { url: '/media/generated-card.png' } },
          updatedAt: '2026-08-12T10:00:00.000Z',
          url: '/media/generated.png',
        }
      }
      return { id: 901 }
    })
    const generateImage = vi.fn().mockResolvedValue({
      image: {
        data: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Wl9sAAAAASUVORK5CYII=',
          'base64',
        ),
        mimeType: 'image/png',
      },
      model: 'image-model',
      provider: 'configured-provider',
      revisedPrompt: 'Refined facade image',
    })
    const resolveGateway = vi.fn().mockResolvedValue({ generateImage })
    const onProviderDispatch = vi.fn()

    await expect(
      generateContentStudioImage({
        input: {
          prompt: 'Create a premium aluminium facade product image',
          referenceMediaId: null,
          size: '1024x1024',
        },
        onProviderDispatch,
        payload: { create, findByID: vi.fn() } as any,
        req,
        resolveGateway: resolveGateway as any,
      }),
    ).resolves.toMatchObject({
      media: {
        id: 81,
        isPublic: false,
        mimeType: 'image/png',
        previewUrl: '/media/generated-card.png',
      },
      model: 'image-model',
      provider: 'configured-provider',
      revisedPrompt: 'Refined facade image',
    })

    expect(resolveGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        allowEnvironmentFallback: false,
        routes: [{ operation: 'image', usageKey: 'content.image-generation' }],
      }),
    )
    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        onDispatch: onProviderDispatch,
        prompt: 'Create a premium aluminium facade product image',
        size: '1024x1024',
      }),
    )
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('loads only an authorized image Media reference and rejects an unsafe file path', async () => {
    const resolveGateway = vi.fn()
    const payload = {
      create: vi.fn(),
      findByID: vi.fn().mockResolvedValue({
        filename: '../outside.png',
        id: 44,
        mimeType: 'image/png',
      }),
    } as any

    await expect(
      generateContentStudioImage({
        input: {
          prompt: 'Polish the product reference image',
          referenceMediaId: 44,
          size: '1024x1024',
        },
        payload,
        req,
        resolveGateway: resolveGateway as any,
      }),
    ).rejects.toMatchObject({ code: 'content-studio-reference-unavailable', status: 409 })

    expect(payload.findByID).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'media', id: 44, overrideAccess: false, req }),
    )
    expect(resolveGateway).not.toHaveBeenCalled()
    expect(payload.create).not.toHaveBeenCalled()
  })

  it.each([
    {
      bytes: Buffer.from('not a png image'),
      label: 'declared PNG content with invalid bytes',
    },
    {
      bytes: Buffer.alloc(8 * 1024 * 1024 + 1),
      label: 'reference content larger than 8 MiB after reading',
    },
  ])('rejects $label before resolving or dispatching the provider', async ({ bytes }) => {
    readFileMock.mockResolvedValue(bytes)
    const generateImage = vi.fn()
    const resolveGateway = vi.fn().mockResolvedValue({ generateImage })
    const onProviderDispatch = vi.fn()
    const create = vi.fn()
    const payload = {
      create,
      findByID: vi.fn().mockResolvedValue({
        filename: 'reference.png',
        id: 44,
        mimeType: 'image/png',
      }),
    } as any

    await expect(
      generateContentStudioImage({
        input: {
          prompt: 'Polish the product reference image',
          referenceMediaId: 44,
          size: '1024x1024',
        },
        onProviderDispatch,
        payload,
        req,
        resolveGateway: resolveGateway as any,
      }),
    ).rejects.toMatchObject({ code: 'content-studio-reference-unavailable', status: 409 })

    expect(resolveGateway).not.toHaveBeenCalled()
    expect(generateImage).not.toHaveBeenCalled()
    expect(onProviderDispatch).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('adopts one readable image into a current draft without duplicating the relation', async () => {
    const draft = {
      assets: [4, { id: 5 }],
      id: 71,
      status: 'draft',
      title: input.title,
      updatedAt: '2026-08-12T10:00:00.000Z',
    }
    const update = vi.fn().mockResolvedValue({
      ...draft,
      assets: [4, 5, 81],
      updatedAt: '2026-08-12T10:01:00.000Z',
    })
    const findByID = vi.fn(async ({ collection }: { collection: string }) =>
      collection === 'generated-contents'
        ? draft
        : { id: 81, filename: 'generated.png', mimeType: 'image/png' },
    )

    await expect(adoptContentStudioImage({
      id: 71,
      input: { mediaId: 81, updatedAt: draft.updatedAt },
      payload: { findByID, update } as any,
      req,
    })).resolves.toMatchObject({ id: 71, status: 'draft', updatedAt: '2026-08-12T10:01:00.000Z' })

    expect(findByID).toHaveBeenNthCalledWith(2, expect.objectContaining({
      collection: 'media',
      id: 81,
      overrideAccess: false,
      req,
    }))
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      collection: 'generated-contents',
      data: { assets: [4, 5, 81] },
      id: 71,
      overrideAccess: false,
      req,
    }))

    findByID.mockClear()
    update.mockClear()
    await expect(adoptContentStudioImage({
      id: 71,
      input: { mediaId: 5, updatedAt: draft.updatedAt },
      payload: { findByID, update } as any,
      req,
    })).resolves.toMatchObject({ id: 71, updatedAt: draft.updatedAt })
    expect(findByID).toHaveBeenCalledTimes(2)
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects stale, non-draft, unreadable, and non-image adoption targets', async () => {
    const draft = { assets: [], id: 71, status: 'draft', updatedAt: 'current' }
    const run = (content: Record<string, unknown>, media: unknown, updatedAt = 'current') =>
      adoptContentStudioImage({
        id: 71,
        input: { mediaId: 81, updatedAt },
        payload: {
          findByID: vi.fn(async ({ collection }: { collection: string }) => {
            if (collection === 'generated-contents') return content
            if (media instanceof Error) throw media
            return media
          }),
          update: vi.fn(),
        } as any,
        req,
      })

    await expect(run(draft, { filename: 'image.png', mimeType: 'image/png' }, 'stale'))
      .rejects.toMatchObject({ code: 'content-studio-stale', status: 409 })
    await expect(run({ ...draft, status: 'review' }, { filename: 'image.png', mimeType: 'image/png' }))
      .rejects.toMatchObject({ code: 'content-studio-invalid-transition', status: 409 })
    await expect(run(draft, new Error('not readable')))
      .rejects.toMatchObject({ code: 'content-studio-image-unavailable', status: 409 })
    await expect(run(draft, { filename: 'document.pdf', mimeType: 'application/pdf' }))
      .rejects.toMatchObject({ code: 'content-studio-image-unavailable', status: 409 })
  })

  it('rejects past internal schedules before creating a publish job', async () => {
    const approved = {
      id: 71,
      platform: 'linkedin',
      status: 'approved',
      updatedAt: '2026-07-30T12:00:00.000Z',
    }
    const create = vi.fn()
    const payload = {
      create,
      find: vi.fn().mockResolvedValue({ docs: [] }),
      findByID: vi.fn().mockResolvedValue(approved),
    } as any

    await expect(
      scheduleContentStudioPublication({
        id: 71,
        input: {
          idempotencyKey: 'portal-content-studio:past-assisted-1',
          mode: 'assisted',
          platform: 'linkedin',
          scheduledFor: '2026-07-30T11:59:00.000Z',
          updatedAt: approved.updatedAt,
        },
        now: () => new Date('2026-07-30T12:00:00.000Z'),
        payload,
        req,
      }),
    ).rejects.toMatchObject({ code: 'content-studio-invalid-schedule', status: 400 })

    expect(create).not.toHaveBeenCalled()
  })

  it('keeps reviewed content immutable and prevents an automatic publication from being staged', async () => {
    const approved = {
      id: 71,
      platform: 'facebook',
      status: 'approved',
      updatedAt: '2026-07-30T12:00:00.000Z',
    }
    const payload = { findByID: vi.fn().mockResolvedValue(approved), update: vi.fn() } as any

    await expect(
      updateContentStudioDraft({
        id: 71,
        input: { ...input, updatedAt: approved.updatedAt },
        payload,
        req,
      }),
    ).rejects.toMatchObject({
      code: 'content-studio-invalid-transition',
      status: 409,
    } satisfies Partial<ContentStudioCommandError>)

    vi.stubEnv('ADMIN_PORTAL_PUBLISHING_ENABLED', 'false')
    await expect(
      scheduleContentStudioPublication({
        id: 71,
        input: {
          idempotencyKey: 'portal-content-studio:automatic-1',
          mode: 'automatic',
          platform: 'facebook',
          scheduledFor: '2026-08-01T10:30:00.000Z',
          updatedAt: approved.updatedAt,
        },
        payload: { findByID: vi.fn().mockResolvedValue(approved) } as any,
        req,
      }),
    ).rejects.toMatchObject({
      code: 'content-studio-publishing-disabled',
      status: 503,
    } satisfies Partial<ContentStudioCommandError>)
  })

  it('only submits drafts whose fact references resolve to selected reviewed knowledge', async () => {
    const content = {
      id: 71,
      knowledgeSources: [9],
      sourceReferences: [
        { claim: 'Finish is anodized aluminum.', source: 'https://example.invalid/specification' },
      ],
      status: 'draft',
      updatedAt: '2026-07-30T12:00:00.000Z',
    }
    const update = vi.fn().mockResolvedValue({ ...content, status: 'review' })
    const find = vi.fn().mockResolvedValue({
      docs: [
        {
          content: 'Approved facts',
          id: 9,
          indexStatus: 'ready',
          reviewStatus: 'reviewed',
          sourceTitle: 'Product specification',
          sourceURL: 'https://example.invalid/specification',
          sourceVersion: '4.2',
        },
      ],
    })

    await expect(
      submitContentStudioReview({
        id: 71,
        input: { updatedAt: content.updatedAt },
        payload: { find, findByID: vi.fn().mockResolvedValue(content), update } as any,
        req,
      }),
    ).resolves.toMatchObject({ id: 71, status: 'review' })

    await expect(
      submitContentStudioReview({
        id: 71,
        input: { updatedAt: content.updatedAt },
        payload: {
          find,
          findByID: vi.fn().mockResolvedValue({
            ...content,
            sourceReferences: [{ claim: 'Invented fact', source: 'unreviewed-note' }],
          }),
          update,
        } as any,
        req,
      }),
    ).rejects.toMatchObject({
      code: 'content-studio-sources-unavailable',
      status: 409,
    })
  })

  it('preserves publication history instead of deleting a draft that has a job', async () => {
    const payload = {
      find: vi.fn().mockResolvedValue({ docs: [{ id: 14 }] }),
      findByID: vi.fn().mockResolvedValue({
        id: 71,
        status: 'draft',
        updatedAt: '2026-07-30T12:00:00.000Z',
      }),
    } as any

    await expect(
      deleteContentStudioDraft({
        id: 71,
        input: { updatedAt: '2026-07-30T12:00:00.000Z' },
        payload,
        req,
      }),
    ).rejects.toMatchObject({
      code: 'content-studio-delete-restricted',
      status: 409,
    } satisfies Partial<ContentStudioCommandError>)
  })
})
