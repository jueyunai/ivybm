import { describe, expect, it, vi } from 'vitest'

import { cleanupLeadAttachments } from '@/modules/lead-attachments/cleanup'
import { runCli } from '@/../scripts/lead-attachments-cleanup'

describe('Lead attachments manual cleanup module and CLI', () => {
  it('identifies unassociated (>24h) and associated (>180d) expired attachments in dry-run mode without deleting', async () => {
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
    const fileUnlink = vi.fn()
    const mockPayload = { create, delete: del, find, logger: { error: vi.fn(), warn: vi.fn() } } as unknown as never

    const result = await cleanupLeadAttachments({
      dryRun: true,
      fileUnlink,
      now: '2026-08-31T12:00:00.000Z',
      payload: mockPayload,
    })

    expect(result.dryRun).toBe(true)
    expect(result.deletedCount).toBe(2)
    expect(result.stagedDeletedCount).toBe(1)
    expect(result.associatedDeletedCount).toBe(1)
    expect(result.freedBytes).toBe(6291456)
    expect(result.candidates).toHaveLength(2)

    // Dry-run MUST NOT delete any records, unlink files, or create audit-logs
    expect(del).not.toHaveBeenCalled()
    expect(fileUnlink).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('performs DB deletion first, then physical file unlink, and writes audit logs in live execution mode', async () => {
    const callOrder: string[] = []

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

    const del = vi.fn().mockImplementation(() => {
      callOrder.push('db_delete')
      return Promise.resolve({ id: 10 })
    })
    const fileUnlink = vi.fn().mockImplementation(() => {
      callOrder.push('file_unlink')
      return Promise.resolve()
    })
    const create = vi.fn().mockImplementation(() => {
      callOrder.push('audit_create')
      return Promise.resolve({ id: 1 })
    })
    const mockPayload = { create, delete: del, find, logger: { error: vi.fn(), warn: vi.fn() } } as unknown as never

    const result = await cleanupLeadAttachments({
      dryRun: false,
      fileUnlink,
      now: '2026-08-31T12:00:00.000Z',
      payload: mockPayload,
    })

    expect(result.dryRun).toBe(false)
    expect(result.deletedCount).toBe(1)
    expect(result.deletedIds).toEqual([10])
    expect(result.errorsCount).toBe(0)

    // Verify ordering: DB deletion MUST precede physical file unlink
    expect(callOrder).toEqual(['db_delete', 'file_unlink', 'audit_create'])

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

  it('does not unlink physical file when database deletion fails and records error', async () => {
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

    const del = vi.fn().mockRejectedValue(new Error('Postgres foreign key constraint lock error'))
    const fileUnlink = vi.fn()
    const errorLogger = vi.fn()
    const mockPayload = {
      create: vi.fn(),
      delete: del,
      find,
      logger: { error: errorLogger, warn: vi.fn() },
    } as unknown as never

    const result = await cleanupLeadAttachments({
      dryRun: false,
      fileUnlink,
      now: '2026-08-31T12:00:00.000Z',
      payload: mockPayload,
    })

    expect(result.deletedCount).toBe(0)
    expect(result.deletedIds).toEqual([])
    expect(result.freedBytes).toBe(0)
    expect(result.errorsCount).toBe(1)

    // Physical file unlink MUST NOT be attempted when DB deletion fails
    expect(fileUnlink).not.toHaveBeenCalled()
    expect(errorLogger).toHaveBeenCalledWith(expect.stringContaining('Failed to clean lead attachment 10'))
  })

  it('does not count as cleanup success when physical file unlink fails with non-ENOENT error', async () => {
    const find = vi.fn().mockImplementation(({ where }) => {
      const statusCondition = JSON.stringify(where)
      if (statusCondition.includes('pending')) {
        return Promise.resolve({
          docs: [
            {
              byteSize: 1048576,
              createdAt: '2026-08-28T00:00:00.000Z',
              expiresAt: '2026-08-29T00:00:00.000Z',
              filename: 'locked-file.dwg',
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
    const epermError = new Error('EPERM: operation not permitted')
    Object.assign(epermError, { code: 'EPERM' })
    const fileUnlink = vi.fn().mockRejectedValue(epermError)
    const errorLogger = vi.fn()
    const mockPayload = {
      create: vi.fn(),
      delete: del,
      find,
      logger: { error: errorLogger, warn: vi.fn() },
    } as unknown as never

    const result = await cleanupLeadAttachments({
      dryRun: false,
      fileUnlink,
      now: '2026-08-31T12:00:00.000Z',
      payload: mockPayload,
    })

    // Physical file deletion failed: MUST NOT count as success
    expect(result.deletedCount).toBe(0)
    expect(result.deletedIds).toEqual([])
    expect(result.freedBytes).toBe(0)
    expect(result.errorsCount).toBe(1)
    expect(errorLogger).toHaveBeenCalledWith(expect.stringContaining('Failed to remove physical file locked-file.dwg'))
  })

  it('tolerates ENOENT when physical file is already missing on disk and counts cleanup as success', async () => {
    const find = vi.fn().mockImplementation(({ where }) => {
      const statusCondition = JSON.stringify(where)
      if (statusCondition.includes('pending')) {
        return Promise.resolve({
          docs: [
            {
              byteSize: 2048,
              createdAt: '2026-08-28T00:00:00.000Z',
              expiresAt: '2026-08-29T00:00:00.000Z',
              filename: 'already-missing.dwg',
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
    const enoentError = new Error('ENOENT: no such file or directory')
    Object.assign(enoentError, { code: 'ENOENT' })
    const fileUnlink = vi.fn().mockRejectedValue(enoentError)
    const mockPayload = {
      create: vi.fn().mockResolvedValue({ id: 1 }),
      delete: del,
      find,
      logger: { error: vi.fn(), warn: vi.fn() },
    } as unknown as never

    const result = await cleanupLeadAttachments({
      dryRun: false,
      fileUnlink,
      now: '2026-08-31T12:00:00.000Z',
      payload: mockPayload,
    })

    // ENOENT is tolerable: file does not exist, target state is satisfied
    expect(result.deletedCount).toBe(1)
    expect(result.deletedIds).toEqual([10])
    expect(result.freedBytes).toBe(2048)
    expect(result.errorsCount).toBe(0)
  })

  it('prints help message when --help flag is passed to CLI', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitCode = await runCli(['--help'])
    expect(exitCode).toBe(0)
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'))
  })
})
