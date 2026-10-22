import type { CollectionBeforeChangeHook } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Posts } from '@/collections/Posts'
import { Products } from '@/collections/Products'
import { Projects } from '@/collections/Projects'
import { firstPublishedAtField, preserveFirstPublishedAt } from '@/fields/firstPublishedAt'

const now = '2026-10-22T10:00:00.000Z'
const firstPublication = '2026-08-17T00:31:00.000Z'
const applyHook = async (
  data: Record<string, unknown>,
  originalDoc?: Record<string, unknown>,
  context: Record<string, unknown> = {},
) =>
  preserveFirstPublishedAt({
    context,
    data,
    originalDoc,
  } as Parameters<CollectionBeforeChangeHook>[0])

describe('first publication timestamp', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(now))
  })

  afterEach(() => vi.useRealTimers())

  it('registers an indexed read-only date and the same hook for every public content collection', () => {
    expect(firstPublishedAtField).toMatchObject({
      admin: { readOnly: true },
      index: true,
      name: 'publishedAt',
      type: 'date',
    })
    for (const collection of [Products, Projects, Posts]) {
      expect(
        collection.fields.filter((field) => 'name' in field && field.name === 'publishedAt'),
      ).toEqual([firstPublishedAtField])
      expect(collection.hooks?.beforeChange).toContain(preserveFirstPublishedAt)
    }
  })

  it('keeps never-published drafts undated even if a client supplies a date', async () => {
    await expect(
      applyHook({ _status: 'draft', publishedAt: firstPublication }),
    ).resolves.toMatchObject({ publishedAt: null })
  })

  it('uses server time when creating published content or publishing an older draft', async () => {
    for (const originalDoc of [undefined, { _status: 'draft', createdAt: firstPublication }]) {
      await expect(
        applyHook({ _status: 'published', publishedAt: '2099-01-01T00:00:00.000Z' }, originalDoc),
      ).resolves.toMatchObject({ publishedAt: now })
    }
  })

  it.each([undefined, 'published', 'draft'])(
    'preserves the first date through editing, translation, unpublishing and republication (%s)',
    async (_status) => {
      await expect(
        applyHook({ _status, publishedAt: now }, { publishedAt: firstPublication }),
      ).resolves.toMatchObject({ publishedAt: firstPublication })
    },
  )

  it('allows trusted historical imports to initialize, but never replace, a publication date', async () => {
    const context = { importPublicationDate: true }
    await expect(
      applyHook({ _status: 'published', publishedAt: firstPublication }, undefined, context),
    ).resolves.toMatchObject({ publishedAt: firstPublication })
    await expect(
      applyHook(
        { _status: 'published', publishedAt: now },
        { publishedAt: firstPublication },
        context,
      ),
    ).resolves.toMatchObject({ publishedAt: firstPublication })
  })
})
