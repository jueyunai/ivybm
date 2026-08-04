import { describe, expect, it, vi } from 'vitest'
import type { Payload, PayloadRequest } from 'payload'

import { getJobCompensation } from '@/modules/jobs/compensation/contracts'
import {
  parseSafeJobQuery,
  toSafeJobSummary,
} from '@/admin-portal/modules/operations/getSafeJobPage'
import type { Job } from '@/payload-types'
import type { User } from '@/payload-types'
import { retryPortalJob } from '@/admin-portal/modules/operations/operationsCommands'

const job = (overrides: Partial<Job> = {}): Job => ({
  attempts: 5,
  completedAt: null,
  createdAt: '2026-07-30T00:00:00.000Z',
  deadAt: '2026-07-30T00:00:00.000Z',
  id: 17,
  idempotencyKey: 'safe-job-test',
  lastError: 'token=never-return-this',
  leaseExpiresAt: null,
  manualRetryCount: 0,
  maxAttempts: 5,
  nextRunAt: null,
  ownerToken: 'never-return-this',
  payload: { private: 'never-return-this' },
  status: 'dead',
  type: 'knowledge.index',
  updatedAt: '2026-07-30T00:00:00.000Z',
  ...overrides,
})

describe('Portal operations', () => {
  it('only registers compensation for a terminal knowledge index job', () => {
    expect(getJobCompensation({ status: 'dead', type: 'knowledge.index' })).toMatchObject({
      action: 'retry-knowledge-index',
    })
    expect(getJobCompensation({ status: 'processing', type: 'knowledge.index' })).toBeNull()
    expect(getJobCompensation({ status: 'dead', type: 'publish.external' })).toBeNull()
  })

  it('maps jobs to a DTO without payload, lease token, or raw error details', () => {
    const summary = toSafeJobSummary(job())
    const serialized = JSON.stringify(summary)

    expect(summary.lastErrorSummary).toContain('Failure recorded')
    expect(serialized).not.toContain('never-return-this')
    expect(serialized).not.toContain('ownerToken')
    expect(serialized).not.toContain('payload')
  })

  it('bounds operations query parameters', () => {
    expect(parseSafeJobQuery({ page: '3', status: 'dead' })).toEqual({ page: 3, status: 'dead' })
    expect(parseSafeJobQuery({ page: '-1', status: 'outside' })).toEqual({ page: 1, status: 'all' })
  })

  it('executes only the registered knowledge compensation with the authenticated admin', async () => {
    const retry = vi.fn().mockResolvedValue({
      job: { id: 29, status: 'pending' },
      state: 'created',
    })
    const req = { user: { id: 3, role: 'admin' } } as unknown as PayloadRequest
    const user = { collection: 'users', id: 3, role: 'admin' } as User
    const payload = {
      findByID: vi.fn().mockResolvedValue(
        job({
          payload: {
            documentId: 44,
            documentRevision: 'revision-44',
            embeddingConfigurationKey: 'embedding-config-44',
            requestedBy: 3,
          },
        }),
      ),
    } as unknown as Payload

    await expect(
      retryPortalJob({
        enqueueKnowledgeIndex: retry,
        id: 17,
        input: { updatedAt: '2026-07-30T00:00:00.000Z' },
        payload,
        req,
        user,
      }),
    ).resolves.toEqual({ action: 'retry-knowledge-index', jobId: 29, status: 'pending' })
    expect(retry).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 44,
        manualRetryActor: { id: 3, role: 'admin' },
        payload,
        requestedBy: 3,
      }),
    )
  })
})
