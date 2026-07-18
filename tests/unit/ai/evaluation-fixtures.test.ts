import { describe, expect, it } from 'vitest'

import {
  createCoverageReport,
  createEvaluationCsv,
  readEvaluationFixtures,
  validateEvaluationFixtures,
} from '../../../scripts/ai-eval/lib.mjs'

type EvaluationCase = {
  case_id: string
  required_sources: string[]
  risk_level: string
  scenario: string
}

type KnowledgeSource = {
  language: string
  status: string
}

describe('AI evaluation fixtures', () => {
  const fixtures = readEvaluationFixtures() as {
    cases: EvaluationCase[]
    sources: KnowledgeSource[]
  }

  it('passes the structural and P0 safety gate', () => {
    expect(validateEvaluationFixtures(fixtures.cases, fixtures.sources)).toEqual([])
    expect(fixtures.cases).toHaveLength(60)
    expect(fixtures.sources).toHaveLength(10)
    expect(fixtures.cases.filter((item) => item.risk_level === 'P0')).toHaveLength(42)
    expect(fixtures.sources.every((source) => source.status === 'mocked')).toBe(true)
  })

  it('rejects duplicate case IDs and unknown knowledge sources', () => {
    const cases = structuredClone(fixtures.cases)
    const sources = structuredClone(fixtures.sources)
    cases[1].case_id = cases[0].case_id
    cases[1].required_sources = ['missing_source']
    sources[0].language = 'fr'

    expect(validateEvaluationFixtures(cases, sources)).toEqual(
      expect.arrayContaining([
        `${cases[0].case_id} is duplicated`,
        `${cases[1].case_id} references unknown required_source missing_source`,
        'after_sales_policy_v1 has unsupported language fr',
      ]),
    )
  })

  it('rejects removal of a required P0 scenario', () => {
    const cases = fixtures.cases.filter((item) => item.scenario !== 'certificate_claim')

    expect(validateEvaluationFixtures(cases, fixtures.sources)).toContain(
      'missing required P0 scenario certificate_claim',
    )
  })

  it('reports the recommended-set coverage gap without treating it as a validation failure', () => {
    const report = createCoverageReport(fixtures.cases, fixtures.sources)

    expect(report).toContain('样例总数：60')
    expect(report).toContain('P0 样例：42')
    expect(report).not.toContain('低于一期最小建议 60 条')
    expect(report).toContain('距离推荐完整测评集 150-200 条仍有差距')
    expect(report).toContain('| mocked | 10 | covered |')
  })

  it('exports one CSV row per case with escaped array values', () => {
    const csv = createEvaluationCsv(fixtures.cases)
    const lines = csv.split('\n')

    expect(lines).toHaveLength(61)
    expect(lines[0]).toContain('"case_id"')
    expect(lines[1]).toContain('price depends on thickness, size')
    expect(lines[1]).toContain(' | ')
  })
})
