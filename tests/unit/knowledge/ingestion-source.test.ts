// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'

import {
  createKnowledgeSourceAndEnqueue,
  type KnowledgeIngestionPayload,
} from '@/modules/knowledge/ingestion/source'

type FindArgs = {
  collection: string
  page?: number
  pagination?: boolean
  where?: {
    and?: Array<Record<string, unknown>>
    ingestionSource?: { equals?: number | string }
  }
}

type UpdateArgs = {
  collection: string
  data: Record<string, unknown>
  id: number | string
  req?: unknown
}

describe('knowledge source historical invalidation', () => {
  it('walks every historical-source and generated-output page beyond the 100-item limit', async () => {
    const newSourceID = 10_000
    const historicalSources = Array.from({ length: 101 }, (_, index) => ({
      id: index + 1,
      sourceHash: `old-hash-${index + 1}`,
      sourceTitle: 'Panel manual',
      sourceType: 'product-manual',
      sourceVersion: `old-${index + 1}`,
    }))
    const outputsBySource = new Map<number, Record<string, unknown>[]>()
    for (const [index, source] of historicalSources.entries()) {
      const outputCount = index === 0 ? 101 : 1
      outputsBySource.set(
        Number(source.id),
        Array.from({ length: outputCount }, (_, outputIndex) => ({
          id: Number(source.id) * 1_000 + outputIndex + 1,
          customerVisible: true,
          indexStatus: 'ready',
          ingestionSource: source.id,
          reviewStatus: 'reviewed',
        })),
      )
    }

    const find = vi.fn(async (args: FindArgs) => {
      if (args.collection === 'knowledge-source-documents') {
        const clauses = args.where?.and ?? []
        if (clauses.some((clause) => 'sourceHash' in clause)) {
          return { docs: [], hasNextPage: false }
        }
        const page = args.pagination === true ? args.page ?? 1 : 1
        const docs = args.pagination === true
          ? historicalSources.slice((page - 1) * 100, page * 100)
          : historicalSources.slice(0, 100)
        return {
          docs,
          hasNextPage: args.pagination === true && page * 100 < historicalSources.length,
        }
      }

      const sourceID = Number(args.where?.ingestionSource?.equals)
      const allOutputs = outputsBySource.get(sourceID) ?? []
      const page = args.pagination === true ? args.page ?? 1 : 1
      const docs = args.pagination === true
        ? allOutputs.slice((page - 1) * 100, page * 100)
        : allOutputs.slice(0, 100)
      return {
        docs,
        hasNextPage: args.pagination === true && page * 100 < allOutputs.length,
      }
    })
    const create = vi.fn(async (args: { data?: Record<string, unknown>; req?: unknown }) => ({
      id: newSourceID,
      ...args.data,
    }))
    const update = vi.fn(async (args: UpdateArgs) => ({ id: args.id, ...args.data }))
    const jobRow = {
      attempts: 0,
      completed_at: null,
      created_at: '2026-08-09T00:00:00.000Z',
      dead_at: null,
      id: 20_000,
      idempotency_key: 'knowledge.ingest:10000:revision',
      last_error: null,
      lease_expires_at: null,
      manual_retry_count: 0,
      max_attempts: 5,
      next_run_at: '2026-08-09T00:00:00.000Z',
      owner_token: null,
      payload: {},
      status: 'pending',
      type: 'knowledge.ingest',
      updated_at: '2026-08-09T00:00:00.000Z',
    }
    const query = vi.fn(async () => ({
      rows: [{
        attempts: 0,
        completed_at: null,
        created_at: '2026-08-09T00:00:00.000Z',
        dead_at: null,
        id: 20_000,
        idempotency_key: 'knowledge.ingest:10000:revision',
        last_error: null,
        lease_expires_at: null,
        manual_retry_count: 0,
        max_attempts: 5,
        next_run_at: '2026-08-09T00:00:00.000Z',
        owner_token: null,
        payload: {},
        status: 'pending',
        type: 'knowledge.ingest',
        updated_at: '2026-08-09T00:00:00.000Z',
      }],
    }))
    const transactionQuery = vi.fn(async () => ({ rows: [jobRow] }))
    const payload = {
      create,
      db: {
        pool: { query },
        sessions: {
          'already-active-test-transaction': { db: { execute: transactionQuery } },
        },
      },
      find,
      update,
    } as unknown as KnowledgeIngestionPayload
    const req = {
      transactionID: 'already-active-test-transaction',
      user: { id: 7 },
    } as unknown as PayloadRequest
    const data = Buffer.from('%PDF-task8-pagination-fixture')

    await expect(createKnowledgeSourceAndEnqueue({
      file: { data, mimetype: 'application/pdf', name: 'fixture.pdf', size: data.length },
      metadata: {
        originalLanguage: 'en',
        sourceTitle: 'Panel manual',
        sourceType: 'product-manual',
        sourceVersion: 'new-version',
      },
      payload,
      req,
    })).resolves.toMatchObject({ source: { id: newSourceID }, state: 'created' })

    const expectedOutputIDs = [...outputsBySource.values()].flat().map((output) => output.id)
    const outputUpdates = update.mock.calls
      .map(([args]) => args)
      .filter((args) => args.collection === 'knowledge-documents')
    expect(outputUpdates).toHaveLength(expectedOutputIDs.length)
    expect(outputUpdates.map((args) => args.id).sort((left, right) => Number(left) - Number(right))).toEqual(
      expectedOutputIDs.sort((left, right) => Number(left) - Number(right)),
    )
    for (const updateArgs of outputUpdates) {
      expect(updateArgs.data).toMatchObject({
        customerVisible: false,
        indexStatus: 'pending',
        reviewStatus: 'draft',
      })
      expect(updateArgs.req).toBe(req)
    }

    const historicalFinds = find.mock.calls
      .map(([args]) => args)
      .filter((args) => args.collection === 'knowledge-source-documents' && !args.where?.and?.some((clause) => 'sourceHash' in clause))
    expect(historicalFinds.map((args) => args.page)).toEqual([1, 2])
    const firstSourceOutputFinds = find.mock.calls
      .map(([args]) => args)
      .filter((args) => args.collection === 'knowledge-documents' && Number(args.where?.ingestionSource?.equals) === 1)
    expect(firstSourceOutputFinds.map((args) => args.page)).toEqual([1, 2])
    expect(create.mock.calls[0][0].req).toBe(req)
    expect(update.mock.calls.at(-1)?.[0].req).toBe(req)
    expect(transactionQuery).toHaveBeenCalledTimes(1)
    expect(query).not.toHaveBeenCalled()
  })
})
