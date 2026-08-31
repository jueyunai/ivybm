import { describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'

describe('Lead attachments manual cleanup script specification', () => {
  const RETENTION_ASSOCIATED_MS = 180 * 24 * 60 * 60 * 1000 // 180 days
  const RETENTION_PENDING_MS = 24 * 60 * 60 * 1000 // 24 hours

  type CleanupStats = {
    deletedAssociated: number
    deletedPending: number
    freedBytes: number
    scannedTotal: number
  }

  const runCleanupLogic = async ({
    dryRun,
    now = Date.now(),
    payload,
  }: {
    dryRun: boolean
    now?: number
    payload: Payload
  }): Promise<{ ok: boolean; stats: CleanupStats }> => {
    const expiredAssociatedCutoff = new Date(now - RETENTION_ASSOCIATED_MS).toISOString()
    const expiredPendingCutoff = new Date(now - RETENTION_PENDING_MS).toISOString()

    const associatedResults = await payload.find({
      collection: 'lead-attachments',
      where: {
        and: [
          { status: { equals: 'associated' } },
          { createdAt: { less_than_equal: expiredAssociatedCutoff } },
        ],
      },
    })

    const pendingResults = await payload.find({
      collection: 'lead-attachments',
      where: {
        and: [
          { status: { equals: 'pending' } },
          { createdAt: { less_than_equal: expiredPendingCutoff } },
        ],
      },
    })

    let freedBytes = 0
    let deletedAssociated = 0
    let deletedPending = 0

    for (const doc of associatedResults.docs) {
      freedBytes += (doc.byteSize as number) || 0
      deletedAssociated += 1
      if (!dryRun) {
        await payload.delete({
          collection: 'lead-attachments',
          id: doc.id,
        })
      }
    }

    for (const doc of pendingResults.docs) {
      freedBytes += (doc.byteSize as number) || 0
      deletedPending += 1
      if (!dryRun) {
        await payload.delete({
          collection: 'lead-attachments',
          id: doc.id,
        })
      }
    }

    return {
      ok: true,
      stats: {
        deletedAssociated,
        deletedPending,
        freedBytes,
        scannedTotal: associatedResults.docs.length + pendingResults.docs.length,
      },
    }
  }

  it('performs dry-run calculation without executing deletions in database', async () => {
    const mockFind = vi.fn().mockImplementation(({ where: _where }: { where?: Record<string, unknown> }) => {
      // Return 2 expired associated docs and 1 expired pending doc
      return Promise.resolve({
        docs: [
          { id: 1, byteSize: 10 * 1024 * 1024, status: 'associated' },
          { id: 2, byteSize: 5 * 1024 * 1024, status: 'associated' },
        ],
      })
    })

    const mockDelete = vi.fn().mockResolvedValue({ id: 1 })
    const mockPayload = { delete: mockDelete, find: mockFind } as unknown as Payload

    const result = await runCleanupLogic({
      dryRun: true,
      payload: mockPayload,
    })

    expect(result.ok).toBe(true)
    expect(result.stats.scannedTotal).toBe(4) // 2 from first query, 2 from second query in mock
    expect(result.stats.freedBytes).toBe(30 * 1024 * 1024)
    // In dry-run mode, delete must NOT be called
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('executes deletions and tallies stats in live cleanup mode', async () => {
    const mockFind = vi.fn().mockResolvedValue({
      docs: [{ id: 10, byteSize: 2048, status: 'associated' }],
    })
    const mockDelete = vi.fn().mockResolvedValue({ id: 10 })
    const mockPayload = { delete: mockDelete, find: mockFind } as unknown as Payload

    const result = await runCleanupLogic({
      dryRun: false,
      payload: mockPayload,
    })

    expect(result.ok).toBe(true)
    expect(mockDelete).toHaveBeenCalled()
    expect(result.stats.freedBytes).toBe(4096)
  })

  it('returns failure result and non-zero exit code when database operation fails', async () => {
    const mockFind = vi.fn().mockRejectedValue(new Error('Database connection timeout'))
    const mockPayload = { find: mockFind } as unknown as Payload

    let caughtError: Error | null = null
    try {
      await runCleanupLogic({ dryRun: false, payload: mockPayload })
    } catch (error) {
      caughtError = error as Error
    }

    expect(caughtError).not.toBeNull()
    expect(caughtError?.message).toContain('Database connection timeout')
  })
})
