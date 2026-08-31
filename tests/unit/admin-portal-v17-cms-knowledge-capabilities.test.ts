import { describe, expect, it, vi } from 'vitest'

import type { PayloadRequest } from 'payload'

import {
  createPortalContent,
  getPortalContentEditor,
  parseCapabilities,
  parseContentMutation,
  parseFaq,
  parseResourceMatrix,
  parseRoleCards,
  parseWorkflow,
} from '@/admin-portal/modules/website-content/contentCommands'
import {
  getContentSummary,
  parseContentQuery,
} from '@/admin-portal/modules/website-content/getContentSummary'

const req = {
  user: { collection: 'users', email: 'operator@example.invalid', id: 2, role: 'operator' },
} as unknown as PayloadRequest

describe('Capabilities & Workflow structured fields parsing', () => {
  it('parses multi-line capability strings into structured objects', () => {
    const raw = `
      Design & Engineering | 3D parametric modeling and structural calculations | BIM Level 3 | Tolerance ±0.5mm
      Complex Fabrication | High-precision curved forming and seamless welding | Core Process | 5-Axis CNC
    `
    const parsed = parseCapabilities(raw)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toEqual({
      badge: 'BIM Level 3',
      description: '3D parametric modeling and structural calculations',
      metrics: 'Tolerance ±0.5mm',
      title: 'Design & Engineering',
    })
    expect(parsed[1]).toEqual({
      badge: 'Core Process',
      description: 'High-precision curved forming and seamless welding',
      metrics: '5-Axis CNC',
      title: 'Complex Fabrication',
    })
  })

  it('parses multi-line 4-step engineering workflow into numbered steps', () => {
    const raw = `
      1 | Design & Engineering | 3D parametric modeling and shop drawings
      2 | Complex Fabrication | High-precision CNC roll-bending
      3 | Mock-up & QC | 1:1 physical sample and QA verification
      4 | Global Delivery | Protected crate packaging and shipping
    `
    const parsed = parseWorkflow(raw)
    expect(parsed).toHaveLength(4)
    expect(parsed[0]).toEqual({
      description: '3D parametric modeling and shop drawings',
      stepNumber: 1,
      title: 'Design & Engineering',
    })
    expect(parsed[3]).toEqual({
      description: 'Protected crate packaging and shipping',
      stepNumber: 4,
      title: 'Global Delivery',
    })
  })

  it('parses professional role cards, FAQs, and resource matrix', () => {
    const roleRaw = `
      architects | Architects & Designers | Realize freeform envelope designs | 3D parametric models
      facade-contractors | Façade Contractors | Reliable precision fabrication | Shop drawings & assembly guides
    `
    const roles = parseRoleCards(roleRaw)
    expect(roles).toHaveLength(2)
    expect(roles[0]).toEqual({
      deliverables: '3D parametric models',
      description: 'Realize freeform envelope designs',
      roleKey: 'architects',
      title: 'Architects & Designers',
    })
    expect(roles[1]).toEqual({
      deliverables: 'Shop drawings & assembly guides',
      description: 'Reliable precision fabrication',
      roleKey: 'facade-contractors',
      title: 'Façade Contractors',
    })

    const faqRaw = `
      How is on-site joint precision guaranteed? | We provide factory 1:1 trial assembly and laser 3D scanning.
      What certifications are available? | ASTM and EN test reports can be provided on request.
    `
    const faqs = parseFaq(faqRaw)
    expect(faqs).toHaveLength(2)
    expect(faqs[0]).toEqual({
      answer: 'We provide factory 1:1 trial assembly and laser 3D scanning.',
      question: 'How is on-site joint precision guaranteed?',
    })

    const matrixRaw = `
      Curtain Wall Detail Library | CAD Drawings | Standard curtain wall junction and flashing details
      Facade Material Comparison Guide | Whitepaper | Aluminum solid panel vs honeycomb vs ACM comparison
    `
    const matrix = parseResourceMatrix(matrixRaw)
    expect(matrix).toHaveLength(2)
    expect(matrix[0]).toEqual({
      category: 'CAD Drawings',
      description: 'Standard curtain wall junction and flashing details',
      title: 'Curtain Wall Detail Library',
    })
  })
})

describe('Pages mutation with structured v1.7 CMS fields', () => {
  it('maps structured capability and professional fields during page mutation', () => {
    const mutation = parseContentMutation('pages', {
      action: 'save-draft',
      bodyText: 'Overview body',
      capabilitiesText: 'Complex Forming | Advanced CNC forming | Core | ±0.5mm',
      faqText: 'Do you provide CAD files? | Yes, upon project qualification.',
      locale: 'en',
      resourceMatrixText: 'Sample Specification | Spec Sheet | Technical guide',
      roleCardsText: 'architects | Architect Support | Design translation | 3D models',
      seoDescription: 'Capabilities overview',
      seoTitle: 'Capabilities',
      slug: 'capabilities',
      summary: 'Engineering and fabrication capabilities',
      title: 'Capabilities',
      workflowText: '1 | Engineering | 3D shop drawings\n2 | Fabrication | CNC forming',
    })

    expect(mutation.data).toMatchObject({
      capabilities: {
        items: [
          {
            badge: 'Core',
            description: 'Advanced CNC forming',
            metrics: '±0.5mm',
            title: 'Complex Forming',
          },
        ],
        workflow: [
          { description: '3D shop drawings', stepNumber: 1, title: 'Engineering' },
          { description: 'CNC forming', stepNumber: 2, title: 'Fabrication' },
        ],
      },
      professionalSection: {
        faq: [{ answer: 'Yes, upon project qualification.', question: 'Do you provide CAD files?' }],
        resourceMatrix: [
          {
            category: 'Spec Sheet',
            description: 'Technical guide',
            title: 'Sample Specification',
          },
        ],
        roleCards: [
          {
            deliverables: '3D models',
            description: 'Design translation',
            roleKey: 'architects',
            title: 'Architect Support',
          },
        ],
      },
      slug: 'capabilities',
      title: 'Capabilities',
    })
  })

  it('formats structured capability and professional fields back to text in editorDataFor', async () => {
    const find = vi.fn().mockResolvedValue({
      docs: [
        {
          _status: 'draft',
          capabilities: {
            items: [
              {
                badge: 'Precision',
                description: '5-Axis CNC curving',
                metrics: '±0.5mm',
                title: 'Double-Curved Forming',
              },
            ],
            workflow: [
              { description: '3D Parametric modeling', stepNumber: 1, title: 'Design' },
            ],
          },
          heroImage: 91,
          id: 10,
          professionalSection: {
            faq: [{ answer: 'Yes, we provide 1:1 mockups.', question: 'Are mockups provided?' }],
            resourceMatrix: [
              { category: 'Specs', description: 'ASTM standards', title: 'Product Guide' },
            ],
            roleCards: [
              {
                deliverables: 'Shop drawings',
                description: 'Parametric curves',
                roleKey: 'architects',
                title: 'Architects',
              },
            ],
          },
          seo: { description: 'Description', title: 'Title' },
          slug: 'capabilities',
          summary: 'Capabilities summary',
          title: 'Capabilities',
          updatedAt: '2026-08-31T10:00:00.000Z',
        },
      ],
    })

    const editor = await getPortalContentEditor({
      id: 10,
      locale: 'en',
      payload: { find },
      req,
      type: 'pages',
    })

    expect(editor.data.capabilitiesText).toBe(
      'Double-Curved Forming | 5-Axis CNC curving | Precision | ±0.5mm',
    )
    expect(editor.data.workflowText).toBe('1 | Design | 3D Parametric modeling')
    expect(editor.data.roleCardsText).toBe('architects | Architects | Parametric curves | Shop drawings')
    expect(editor.data.faqText).toBe('Are mockups provided? | Yes, we provide 1:1 mockups.')
    expect(editor.data.resourceMatrixText).toBe('Product Guide | Specs | ASTM standards')
  })
})

describe('Knowledge content in Portal CMS (Posts contentType contract)', () => {
  it('creates Knowledge content with contentType=knowledge in the posts collection', async () => {
    const create = vi.fn().mockResolvedValue({
      _status: 'draft',
      contentType: 'knowledge',
      id: 88,
      slug: 'double-curved-aluminum-guide',
      title: 'Double Curved Aluminum Technical Guide',
      updatedAt: '2026-08-31T12:00:00.000Z',
    })
    const find = vi.fn().mockResolvedValue({ docs: [] })

    const result = await createPortalContent({
      input: {
        action: 'save-draft',
        bodyText: 'Comprehensive technical guide for double-curved aluminum facade panels.',
        category: 'technical-guide',
        excerpt: 'Understanding double-curved fabrication tolerances and design rules.',
        locale: 'en',
        seoDescription: 'Technical guide for double-curved panels',
        seoTitle: 'Double Curved Panel Technical Guide',
        slug: 'double-curved-aluminum-guide',
        title: 'Double Curved Aluminum Technical Guide',
      },
      payload: { create, find },
      req,
      type: 'knowledge',
    })

    expect(result).toMatchObject({ id: 88, slug: 'double-curved-aluminum-guide', status: 'draft' })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'posts',
        data: expect.objectContaining({
          category: 'technical-guide',
          contentType: 'knowledge',
          slug: 'double-curved-aluminum-guide',
        }),
        draft: true,
      }),
    )
  })

  it('creates News content with contentType=news in the posts collection', async () => {
    const create = vi.fn().mockResolvedValue({
      _status: 'draft',
      contentType: 'news',
      id: 89,
      slug: 'dubai-exhibition-2026',
      title: 'IVYBM at Dubai Facade Expo 2026',
      updatedAt: '2026-08-31T12:00:00.000Z',
    })
    const find = vi.fn().mockResolvedValue({ docs: [] })

    const result = await createPortalContent({
      input: {
        action: 'save-draft',
        bodyText: 'IVYBM is participating in the upcoming Dubai Facade Expo.',
        category: 'company',
        excerpt: 'Meet IVYBM engineering team in Dubai.',
        locale: 'en',
        seoDescription: 'Dubai Facade Expo event details',
        seoTitle: 'Dubai Facade Expo 2026',
        slug: 'dubai-exhibition-2026',
        title: 'IVYBM at Dubai Facade Expo 2026',
      },
      payload: { create, find },
      req,
      type: 'posts',
    })

    expect(result).toMatchObject({ id: 89, slug: 'dubai-exhibition-2026', status: 'draft' })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'posts',
        data: expect.objectContaining({
          category: 'company',
          contentType: 'news',
          slug: 'dubai-exhibition-2026',
        }),
      }),
    )
  })

  it('rejects slug conflicts across both Knowledge and News within posts collection', async () => {
    const create = vi.fn()
    const find = vi.fn().mockResolvedValue({
      docs: [{ id: 70, slug: 'shared-slug', title: 'Existing Post' }],
    })

    await expect(
      createPortalContent({
        input: {
          action: 'save-draft',
          locale: 'en',
          slug: 'shared-slug',
          title: 'Knowledge with conflicting slug',
        },
        payload: { create, find },
        req,
        type: 'knowledge',
      }),
    ).rejects.toMatchObject({ code: 'content-slug-conflict', status: 409 })

    expect(create).not.toHaveBeenCalled()
  })

  it('generates correct preview links for Knowledge (/[locale]/knowledge/[slug]) vs News (/[locale]/news/[slug])', async () => {
    const find = vi.fn().mockImplementation(async (options: Record<string, unknown>) => {
      if (options.collection === 'media') return { docs: [], totalDocs: 0 }
      if (options.limit === 1 && options.where) return { docs: [], totalDocs: 1 }
      if (options.limit === 1) return { docs: [{ updatedAt: '2026-08-31T00:00:00.000Z' }], totalDocs: 1 }

      return {
        docs: [
          {
            _status: 'published',
            category: 'technical-guide',
            content: { root: { children: [{ text: 'Knowledge body' }] } },
            contentType: 'knowledge',
            excerpt: 'Excerpt',
            hasBeenPublished: true,
            id: 101,
            seo: { description: 'Desc', title: 'Title' },
            slug: 'facade-tolerance-guide',
            title: 'Facade Tolerance Guide',
            updatedAt: '2026-08-31T10:00:00.000Z',
          },
        ],
        page: 1,
        totalDocs: 1,
        totalPages: 1,
      }
    })

    const summary = await getContentSummary({
      payload: { count: vi.fn(), find } as never,
      query: parseContentQuery({ type: 'knowledge' }),
      req,
    })

    expect(summary.items[0]?.previewHrefs).toEqual({
      ar: '/ar/knowledge/facade-tolerance-guide',
      en: '/en/knowledge/facade-tolerance-guide',
    })
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'posts',
        where: expect.objectContaining({
          and: expect.arrayContaining([{ contentType: { equals: 'knowledge' } }]),
        }),
      }),
    )
  })
})
