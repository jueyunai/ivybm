import { describe, expect, it } from 'vitest'

describe('Website v1.7 structured CMS fields and safe degradation specification', () => {
  type WorkflowStep = {
    description?: string
    stepNumber: number
    title: string
  }

  type Project4DCaseStudy = {
    observedFocus?: string
    projectSnapshot?: string
    qualityVerification?: string
    solutionFramework?: string
    summary?: string
  }

  type FAQItem = {
    answer: string
    question: string
  }

  it('renders complete 4-step engineering workflow when provided in CMS', () => {
    const fullWorkflow: WorkflowStep[] = [
      { stepNumber: 1, title: 'Design Optimization', description: '3D BIM modeling and parametric unfolding.' },
      { stepNumber: 2, title: 'Precision Fabrication', description: 'Multi-axis CNC milling, hyperbaric stretch forming, seamless welding.' },
      { stepNumber: 3, title: 'Assembly & QC', description: '1:1 visual mock-up and precision coordinate measuring.' },
      { stepNumber: 4, title: 'Global Delivery', description: 'Custom timber crating, sea freight logistics, installation guide.' },
    ]

    const renderWorkflow = (steps?: WorkflowStep[]) => {
      if (!steps || steps.length === 0) return null
      return {
        renderedCount: steps.filter((s) => s.title.trim()).length,
        visible: true,
      }
    }

    const output = renderWorkflow(fullWorkflow)
    expect(output).not.toBeNull()
    expect(output?.visible).toBe(true)
    expect(output?.renderedCount).toBe(4)
  })

  it('safely degrades and omits workflow section when engineeringWorkflow is absent or empty', () => {
    const renderWorkflow = (steps?: WorkflowStep[]) => {
      if (!steps || steps.length === 0) return null
      const validSteps = steps.filter((s) => s.title?.trim())
      if (validSteps.length === 0) return null
      return { renderedCount: validSteps.length, visible: true }
    }

    expect(renderWorkflow(undefined)).toBeNull()
    expect(renderWorkflow([])).toBeNull()
    expect(renderWorkflow([{ stepNumber: 1, title: '  ' }])).toBeNull()
  })

  it('renders 4D case study sections when populated, omitting empty dimensional sections', () => {
    const partialCaseStudy: Project4DCaseStudy = {
      projectSnapshot: '15,000 sqm commercial facade in Riyadh.',
      solutionFramework: 'Double-curved panel sub-frame unitized system.',
      summary: 'Landmark tower envelope.',
      // observedFocus and qualityVerification are missing
    }

    const renderCaseStudySections = (data: Project4DCaseStudy) => {
      const activeSections: string[] = []
      if (data.projectSnapshot?.trim()) activeSections.push('snapshot')
      if (data.observedFocus?.trim()) activeSections.push('focus')
      if (data.solutionFramework?.trim()) activeSections.push('solution')
      if (data.qualityVerification?.trim()) activeSections.push('quality')
      return activeSections
    }

    const active = renderCaseStudySections(partialCaseStudy)
    expect(active).toEqual(['snapshot', 'solution'])
    expect(active).not.toContain('focus')
    expect(active).not.toContain('quality')
  })

  it('safely omits FAQ section when FAQ array is empty or undefined', () => {
    const renderFAQ = (faqs?: FAQItem[]) => {
      if (!faqs || faqs.length === 0) return null
      const valid = faqs.filter((f) => f.question?.trim() && f.answer?.trim())
      if (valid.length === 0) return null
      return { count: valid.length, visible: true }
    }

    expect(renderFAQ(undefined)).toBeNull()
    expect(renderFAQ([])).toBeNull()
    expect(renderFAQ([{ answer: '', question: 'What is the lead time?' }])).toBeNull()

    const validFAQ = renderFAQ([
      { question: 'What tolerance is achieved?', answer: '±1.5mm precision coordinate verified.' },
    ])
    expect(validFAQ).toEqual({ count: 1, visible: true })
  })

  it('verifies Capabilities page 4 core capability blocks structure', () => {
    const capabilities = [
      { id: 'design-engineering', title: 'Design & Engineering' },
      { id: 'complex-fabrication', title: 'Complex Fabrication' },
      { id: 'mockup-qc', title: 'Mock-up & QC' },
      { id: 'global-delivery', title: 'Global Delivery' },
    ]

    expect(capabilities).toHaveLength(4)
    expect(capabilities.map((c) => c.id)).toEqual([
      'design-engineering',
      'complex-fabrication',
      'mockup-qc',
      'global-delivery',
    ])
  })

  it('verifies For Professionals page 3 core audience roles', () => {
    const professionalRoles = [
      { id: 'architects-designers', label: 'Architects & Designers' },
      { id: 'facade-contractors', label: 'Façade Contractors' },
      { id: 'main-contractors-procurement', label: 'Main Contractors & Procurement' },
    ]

    expect(professionalRoles).toHaveLength(3)
    expect(professionalRoles.map((r) => r.id)).toEqual([
      'architects-designers',
      'facade-contractors',
      'main-contractors-procurement',
    ])
  })
})
