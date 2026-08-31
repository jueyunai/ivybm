import { afterEach, describe, expect, it, vi } from "vitest"

import {
  WEBSITE_KNOWLEDGE_DEMO_POSTS,
  seedWebsiteKnowledgeDemo,
} from "@/seed/websiteKnowledgeDemo"

describe("Website Knowledge DEMO seed", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("defines explicit, bilingual demo articles with contentType=knowledge and demo notices", () => {
    expect(WEBSITE_KNOWLEDGE_DEMO_POSTS).toHaveLength(3)
    const validCategories = new Set([
      "material-comparison",
      "technical-guide",
      "quality-logistics",
      "procurement",
    ])

    for (const post of WEBSITE_KNOWLEDGE_DEMO_POSTS) {
      expect(post.contentType).toBe("knowledge")
      expect(post.slug).toMatch(/^demo-/)
      expect(validCategories.has(post.category)).toBe(true)
      expect(Date.parse(post.publishedAt)).not.toBeNaN()

      // English content
      expect(post.en.title).toMatch(/^\[DEMO\]/)
      expect(post.en.excerpt).toContain("DEMO ONLY")
      expect(post.en.content).toContain("DEMO ONLY")
      expect(post.en.content).toContain("not a customer-approved fact")
      expect(post.en.seo.title).toMatch(/^\[DEMO\]/)
      expect(post.en.seo.description.length).toBeGreaterThan(10)

      // Arabic content
      expect(post.ar.title).toMatch(/^\[عرض تجريبي\]/)
      expect(post.ar.excerpt).toContain("بيانات تجريبية فقط")
      expect(post.ar.content).toContain("بيانات تجريبية فقط")
      expect(post.ar.seo.title).toMatch(/^\[عرض تجريبي\]/)
      expect(post.ar.seo.description.length).toBeGreaterThan(10)
    }
  })

  it("fails before touching Payload when production attempts to enable it", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const payload = {
      create: () => Promise.reject(new Error("must not be called")),
      find: () => Promise.reject(new Error("must not be called")),
      logger: { info: () => undefined },
      update: () => Promise.reject(new Error("must not be called")),
    }

    await expect(seedWebsiteKnowledgeDemo(payload as never)).rejects.toThrow(
      "Website Knowledge DEMO seed is forbidden in production",
    )
  })

  it("creates new demo posts with published status and bilingual content", async () => {
    const create = vi.fn().mockImplementation(({ data, locale }) =>
      Promise.resolve({ id: 101, ...data, locale }),
    )
    const update = vi.fn().mockResolvedValue({ id: 101 })
    const find = vi.fn().mockResolvedValue({ docs: [], totalDocs: 0 })

    const payload = {
      create,
      find,
      logger: { info: vi.fn() },
      update,
    }

    await seedWebsiteKnowledgeDemo(payload as never)

    expect(find).toHaveBeenCalledTimes(WEBSITE_KNOWLEDGE_DEMO_POSTS.length)
    expect(create).toHaveBeenCalledTimes(WEBSITE_KNOWLEDGE_DEMO_POSTS.length)
    expect(update).toHaveBeenCalledTimes(WEBSITE_KNOWLEDGE_DEMO_POSTS.length)

    for (const [args] of create.mock.calls) {
      expect(args).toMatchObject({
        collection: "posts",
        data: expect.objectContaining({
          _status: "published",
          contentType: "knowledge",
        }),
        draft: false,
        fallbackLocale: false,
        locale: "en",
        overrideAccess: true,
      })
    }

    for (const [args] of update.mock.calls) {
      expect(args).toMatchObject({
        collection: "posts",
        draft: false,
        fallbackLocale: false,
        id: 101,
        locale: "ar",
        overrideAccess: true,
      })
    }
  })

  it("updates existing demo posts idempotently without creating duplicates", async () => {
    const update = vi.fn().mockResolvedValue({ id: 201 })
    const create = vi.fn().mockResolvedValue({ id: 201 })
    const find = vi.fn().mockResolvedValue({
      docs: [{ id: 201, slug: "demo-facade-material-selection-guide", title: "Existing Demo" }],
      totalDocs: 1,
    })

    const payload = {
      create,
      find,
      logger: { info: vi.fn() },
      update,
    }

    await seedWebsiteKnowledgeDemo(payload as never)

    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(WEBSITE_KNOWLEDGE_DEMO_POSTS.length * 2)
  })
})
