import { afterEach, describe, expect, it, vi } from 'vitest'

import { KNOWLEDGE_DEMO_DOCUMENTS, seedKnowledgeDemo } from '@/seed/knowledgeDemo'

describe('knowledge DEMO seed', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('keeps every synthetic document explicit and free from production approval claims', () => {
    expect(KNOWLEDGE_DEMO_DOCUMENTS).toHaveLength(6)
    for (const document of KNOWLEDGE_DEMO_DOCUMENTS) {
      expect(document.sourceTitle).toMatch(/^\[DEMO\]/)
      expect(document.content).toContain('DEMO ONLY')
      expect(document.content).toContain('not a customer-approved fact')
    }
  })

  it('fails before touching Payload when production attempts to enable it', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const payload = {
      create: () => Promise.reject(new Error('must not be called')),
      find: () => Promise.reject(new Error('must not be called')),
      logger: { info: () => undefined },
      update: () => Promise.reject(new Error('must not be called')),
    }

    await expect(seedKnowledgeDemo(payload as never)).rejects.toThrow(
      'Knowledge DEMO seed is forbidden in production',
    )
  })

  it('does not reset an existing document index when the DEMO seed is repeated', async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    const payload = {
      create: vi.fn().mockResolvedValue(undefined),
      find: vi.fn().mockImplementation(({ collection }) =>
        collection === 'knowledge-documents'
          ? Promise.resolve({ docs: [{ id: 1 }], totalDocs: 1 })
          : Promise.resolve({ docs: [{ id: 1 }], totalDocs: 1 }),
      ),
      logger: { info: vi.fn() },
      update,
    }

    await seedKnowledgeDemo(payload as never)

    expect(payload.create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(KNOWLEDGE_DEMO_DOCUMENTS.length * 2)
    for (const [request] of update.mock.calls) {
      expect(request.data).not.toHaveProperty('indexStatus')
    }
  })
})
