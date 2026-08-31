import { describe, expect, it, vi } from 'vitest'

import { cleanupLeadAttachments } from '@/modules/lead-attachments/cleanup'
import { runCli } from '@/../scripts/lead-attachments-cleanup'

describe('Lead attachments manual cleanup module and CLI', () => {
  it('identifies unassociated (>24h) and associated (>180d) expired attachments in dry-run mode without deleting', async () => {
    const find = vi.fn().mockImplementation(({ where }) => {
      // Return 1 staged candidate and 1 associated candidate
      const statusCondition = JSON.stringify(where)
      if (statusCondition.includes('pending')) {
        return Promise.resolve({
          docs: [
            {
              byteSize: 1048576,
              createdAt: '2026-08-28T00:00:00.000Z',
              expiresAt: '2026-08-29T00:00:00.000Z',
              filename: 'staged-abandoned.dwg',
              id: 10,
              lead: null,
              status: 'pending',
            },
          ],
        })
      }
      if (statusCondition.includes('associated')) {
        return Promise.resolve({
          docs: [
            {
              associatedAt: '2026-01-01T00:00:00.000Z',
              byteSize: 5242880,
              createdAt: '2026-01-01T00:00:00.000Z',
              expiresAt: '2026-06-30T00:00:00.000Z',
              filename: 'old-associated-drawing.pdf',
              id: 20,
              lead: 5,
              status: 'associated',
            },
          ],
        })
      }
      return Promise.resolve({ docs: [] })
    })

    const del = vi.fn()
    const create = vi.fn()
    const mockPayload = { create, delete: del, find, logger: { error: vi.fn(), warn: vi.fn() } } as unknown as never

    const result = await cleanupLeadAttachments({
      dryRun: true,
      now: '2026-08-31T12:00:00.000Z',
      payload: mockPayload,
    })

    expect(result.dryRun).toBe(true)
    expect(result.deletedCount).toBe(2)
    expect(result.stagedDeletedCount).toBe(1)
    expect(result.associatedDeletedCount).toBe(1)
    expect(result.freedBytes).toBe(6291456)
    expect(result.candidates).toHaveLength(2)

    // Dry-run MUST NOT delete any records or call create on audit-logs
    expect(del).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('performs actual deletion of records and writes audit logs in live execution mode', async () => {
    const find = vi.fn().mockImplementation(({ where }) => {
      const statusCondition = JSON.stringify(where)
      if (statusCondition.includes('pending')) {
        return Promise.resolve({
          docs: [
            {
              byteSize: 1048576,
              createdAt: '2026-08-28T00:00:00.000Z',
              expiresAt: '2026-08-29T00:00:00.000Z',
              filename: 'staged-abandoned.dwg',
              id: 10,
              lead: null,
              status: 'pending',
            },
          ],
        })
      }
      return Promise.resolve({ docs: [] })
    })

    const del = vi.fn().mockResolvedValue({ id: 10 })
    const create = vi.fn().mockResolvedValue({ id: 1 })
    const mockPayload = { create, delete: del, find, logger: { error: vi.fn(), warn: vi.fn() } } as unknown as never

    const result = await cleanupLeadAttachments({
      dryRun: false,
      now: '2026-08-31T12:00:00.000Z',
      payload: mockPayload,
    })

    expect(result.dryRun).toBe(false)
    expect(result.deletedCount).toBe(1)
    expect(result.deletedIds).toEqual([10])
    expect(result.errorsCount).toBe(0)

    expect(del).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'lead-attachments',
        id: 10,
      }),
    )

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'audit-logs',
        data: expect.objectContaining({
          action: 'delete',
          documentId: '10',
          resource: 'lead-attachments',
        }),
      }),
    )
  })

  it('prints help message when --help flag is passed to CLI', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitCode = await runCli(['--help'])
    expect(exitCode).toBe(0)
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'))
  })
})
