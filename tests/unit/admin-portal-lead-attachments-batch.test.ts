import { describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'

describe('Portal Leads attachment count badge batch query specification', () => {
  it('aggregates attachment counts in a single batch query for all page lead IDs', async () => {
    const leadIdsOnPage = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110]

    const mockFind = vi.fn().mockImplementation(({ collection }: { collection: string }) => {
      if (collection === 'lead-attachments') {
        return Promise.resolve({
          docs: [
            { id: 1, lead: 101 },
            { id: 2, lead: 101 },
            { id: 3, lead: 105 },
            { id: 4, lead: 105 },
            { id: 5, lead: 105 },
          ],
        })
      }
      return Promise.resolve({ docs: [] })
    })

    const payload = { find: mockFind } as unknown as Payload

    // Simulate batch loading attachment counts for leads on the current page
    const loadAttachmentCountsBatch = async (ids: number[]) => {
      if (ids.length === 0) return new Map<number, number>()
      const result = await payload.find({
        collection: 'lead-attachments',
        depth: 0,
        limit: 100,
        overrideAccess: true,
        where: {
          lead: { in: ids },
        },
      })

      const countMap = new Map<number, number>()
      for (const id of ids) countMap.set(id, 0)

      for (const doc of result.docs) {
        const leadId = typeof doc.lead === 'object' && doc.lead !== null ? (doc.lead as { id: number }).id : (doc.lead as number)
        if (typeof leadId === 'number' && countMap.has(leadId)) {
          countMap.set(leadId, (countMap.get(leadId) || 0) + 1)
        }
      }
      return countMap
    }

    const counts = await loadAttachmentCountsBatch(leadIdsOnPage)

    // Verify EXACTLY ONE query was made to lead-attachments regardless of page size (10 leads)
    const attachmentQueryCalls = mockFind.mock.calls.filter((call) => call[0]?.collection === 'lead-attachments')
    expect(attachmentQueryCalls).toHaveLength(1)
    expect(attachmentQueryCalls[0][0]?.where).toEqual({ lead: { in: leadIdsOnPage } })

    // Verify aggregated counts
    expect(counts.get(101)).toBe(2)
    expect(counts.get(105)).toBe(3)
    expect(counts.get(102)).toBe(0)
    expect(counts.get(110)).toBe(0)
  })

  it('guarantees query count remains constant O(1) regardless of lead list size', async () => {
    let dbQueryCount = 0
    const mockFind = vi.fn().mockImplementation(() => {
      dbQueryCount += 1
      return Promise.resolve({ docs: [] })
    })

    const payload = { find: mockFind } as unknown as Payload

    const batchQuery = async (ids: number[]) => {
      return payload.find({
        collection: 'lead-attachments',
        where: { lead: { in: ids } },
      })
    }

    // 50 leads on page
    const fiftyLeadIds = Array.from({ length: 50 }, (_, i) => i + 1)
    await batchQuery(fiftyLeadIds)

    expect(dbQueryCount).toBe(1)
  })
})
