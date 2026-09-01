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
                badge: { ar: 'AR Precision', en: 'Precision' },
                description: { ar: 'AR 5-Axis CNC curving', en: '5-Axis CNC curving' },
                metrics: { ar: 'AR 0.5mm', en: '0.5mm' },
                title: { ar: 'AR Double-Curved Forming', en: 'Double-Curved Forming' },
              },
            ],
            workflow: [
              {
                description: { ar: 'AR 3D Parametric modeling', en: '3D Parametric modeling' },
                stepNumber: 1,
                title: { ar: 'AR Design', en: 'Design' },
              },
            ],
          },
          heroImage: 91,
          id: 10,
          professionalSection: {
            faq: [
              {
                answer: { ar: 'AR Yes, we provide mockups.', en: 'Yes, we provide mockups.' },
                question: { ar: 'AR Are mockups provided?', en: 'Are mockups provided?' },
              },
            ],
            resourceMatrix: [
              {
                category: { ar: 'AR Specs', en: 'Specs' },
                description: { ar: 'AR Standards', en: 'Standards' },
                title: { ar: 'AR Product Guide', en: 'Product Guide' },
              },
            ],
            roleCards: [
              {
                deliverables: { ar: 'AR Shop drawings', en: 'Shop drawings' },
                description: { ar: 'AR Parametric curves', en: 'Parametric curves' },
                roleKey: 'architects',
                title: { ar: 'AR Architects', en: 'Architects' },
              },
            ],
          },
          seo: {
            description: { ar: 'AR Description', en: 'Description' },
            title: { ar: 'AR Title', en: 'Title' },
          },
          slug: 'capabilities',
          summary: { ar: 'AR Capabilities summary', en: 'Capabilities summary' },
          title: { ar: 'AR Capabilities', en: 'Capabilities' },
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
      'Double-Curved Forming | 5-Axis CNC curving | Precision | 0.5mm',
    )
    expect(editor.data.workflowText).toBe('1 | Design | 3D Parametric modeling')
    expect(editor.data.roleCardsText).toBe('architects | Architects | Parametric curves | Shop drawings')
    expect(editor.data.faqText).toBe('Are mockups provided? | Yes, we provide mockups.')
    expect(editor.data.resourceMatrixText).toBe('Product Guide | Specs | Standards')
    expect(JSON.stringify(editor.data)).not.toContain('[object Object]')

    const parsed = parseContentMutation('pages', {
      ...editor.data,
      action: 'save-draft',
      locale: 'en',
    })
    expect(parsed.data.capabilities).toMatchObject({
      items: [
        {
          badge: 'Precision',
          description: '5-Axis CNC curving',
          metrics: '0.5mm',
          title: 'Double-Curved Forming',
        },
      ],
    })

    const arabicEditor = await getPortalContentEditor({
      id: 10,
      locale: 'ar',
      payload: { find },
      req,
      type: 'pages',
    })
    expect(arabicEditor.data.capabilitiesText).toBe(
      'AR Double-Curved Forming | AR 5-Axis CNC curving | AR Precision | AR 0.5mm',
    )
    expect(arabicEditor.data.roleCardsText).toBe(
      'architects | AR Architects | AR Parametric curves | AR Shop drawings',
    )
    expect(JSON.stringify(arabicEditor.data)).not.toContain('[object Object]')
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

describe('Products & Projects v1.7 CMS structured fields', () => {
  it('mutates and parses Products engineeringWorkflow and disclaimer', async () => {
    const mutation = parseContentMutation('products', {
      action: 'save-draft',
      bodyText: 'Product description',
      categoryId: '5',
      coverImageId: '91',
      disclaimer: 'Parameters are reference values. Final specifications are governed by shop drawings.',
      engineeringWorkflowText: '1 | 3D Design | Parametric modeling\n2 | Roll-Bending | CNC fabrication',
      locale: 'en',
      seoDescription: 'SEO desc',
      seoTitle: 'SEO title',
      shortDescription: 'Short desc',
      slug: 'double-curved-panel',
      specifications: [{ label: 'Thickness', value: '3.0 mm' }],
      title: 'Double Curved Panel',
    })

    expect(mutation.data).toMatchObject({
      disclaimer: 'Parameters are reference values. Final specifications are governed by shop drawings.',
      engineeringWorkflow: [
        { description: 'Parametric modeling', stepNumber: 1, title: '3D Design' },
        { description: 'CNC fabrication', stepNumber: 2, title: 'Roll-Bending' },
      ],
      slug: 'double-curved-panel',
      title: 'Double Curved Panel',
    })

    const find = vi.fn().mockResolvedValue({
      docs: [
        {
          _status: 'draft',
          category: 5,
          coverImage: 91,
          disclaimer: { ar: 'AR Parameters', en: 'Parameters are reference values.' },
          engineeringWorkflow: [
            {
              description: { ar: 'AR Parametric modeling', en: 'Parametric modeling' },
              stepNumber: 1,
              title: { ar: 'AR 3D Design', en: '3D Design' },
            },
          ],
          id: 20,
          seo: {
            description: { ar: 'AR Desc', en: 'Desc' },
            title: { ar: 'AR Title', en: 'Title' },
          },
          shortDescription: { ar: 'AR Short', en: 'Short' },
          slug: 'double-curved-panel',
          specifications: [
            {
              label: { ar: 'AR Thickness', en: 'Thickness' },
              value: { ar: 'AR 3mm', en: '3mm' },
            },
          ],
          title: { ar: 'AR Double Curved Panel', en: 'Double Curved Panel' },
          updatedAt: '2026-08-31T10:00:00.000Z',
        },
      ],
    })

    const editor = await getPortalContentEditor({
      id: 20,
      locale: 'en',
      payload: { find },
      req,
      type: 'products',
    })

    expect(editor.data.disclaimer).toBe('Parameters are reference values.')
    expect(editor.data.engineeringWorkflowText).toBe('1 | 3D Design | Parametric modeling')
    expect(editor.data.specifications).toEqual([{ label: 'Thickness', value: '3mm' }])
    expect(JSON.stringify(editor.data)).not.toContain('[object Object]')

    const parsedEditor = parseContentMutation('products', {
      ...editor.data,
      action: 'save-draft',
      locale: 'en',
    })
    expect(parsedEditor.data.engineeringWorkflow).toEqual([
      { description: 'Parametric modeling', stepNumber: 1, title: '3D Design' },
    ])

    const arabicEditor = await getPortalContentEditor({
      id: 20,
      locale: 'ar',
      payload: { find },
      req,
      type: 'products',
    })
    expect(arabicEditor.data.disclaimer).toBe('AR Parameters')
    expect(arabicEditor.data.engineeringWorkflowText).toBe(
      '1 | AR 3D Design | AR Parametric modeling',
    )
    expect(arabicEditor.data.specifications).toEqual([
      { label: 'AR Thickness', value: 'AR 3mm' },
    ])
    expect(JSON.stringify(arabicEditor.data)).not.toContain('[object Object]')
  })

  it('mutates and parses Projects 4-dimensional case study fields', async () => {
    const mutation = parseContentMutation('projects', {
      action: 'save-draft',
      application: 'Commercial facade',
      bodyText: 'Project description',
      coverImageId: '91',
      locale: 'en',
      location: 'Dubai, UAE',
      observedFocus: 'Curved facade joints and tight tolerances',
      projectSnapshot: '50,000 sqm landmark development',
      qualityVerification: '1:1 trial assembly and laser 3D scanning',
      seoDescription: 'Case study SEO',
      seoTitle: 'Case study',
      slug: 'dubai-tower',
      solutionFramework: 'Parametric unitized panel engineering',
      summary: 'Project summary',
      title: 'Dubai Tower',
    })

    expect(mutation.data).toMatchObject({
      observedFocus: 'Curved facade joints and tight tolerances',
      projectSnapshot: '50,000 sqm landmark development',
      qualityVerification: '1:1 trial assembly and laser 3D scanning',
      solutionFramework: 'Parametric unitized panel engineering',
      slug: 'dubai-tower',
      title: 'Dubai Tower',
    })

    const find = vi.fn().mockResolvedValue({
      docs: [
        {
          _status: 'draft',
          application: 'Commercial facade',
          coverImage: 91,
          id: 30,
          location: 'Dubai, UAE',
          observedFocus: 'Curved facade joints',
          projectSnapshot: '50,000 sqm landmark',
          qualityVerification: '1:1 trial assembly',
          seo: { description: 'Desc', title: 'Title' },
          slug: 'dubai-tower',
          solutionFramework: 'Parametric panel engineering',
          summary: 'Summary',
          title: 'Dubai Tower',
          updatedAt: '2026-08-31T10:00:00.000Z',
        },
      ],
    })

    const editor = await getPortalContentEditor({
      id: 30,
      locale: 'en',
      payload: { find },
      req,
      type: 'projects',
    })

    expect(editor.data.projectSnapshot).toBe('50,000 sqm landmark')
    expect(editor.data.observedFocus).toBe('Curved facade joints')
    expect(editor.data.solutionFramework).toBe('Parametric panel engineering')
    expect(editor.data.qualityVerification).toBe('1:1 trial assembly')
  })

  it('registers the v1.7 CMS structures migration in the migration index', async () => {
    const { migrations } = await import('@/migrations')
    const v17Migration = migrations.find((m) => m.name === '20260831_092856_v17_cms_structures')
    expect(v17Migration).toBeDefined()
    expect(typeof v17Migration?.up).toBe('function')
    expect(typeof v17Migration?.down).toBe('function')
  })
})
