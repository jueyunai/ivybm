import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleUrl = new URL(import.meta.url)
const repositoryRoot =
  moduleUrl.protocol === 'file:' ? fileURLToPath(new URL('../..', moduleUrl)) : process.cwd()

export const casesPath = resolve(repositoryRoot, 'tests/fixtures/ai/eval-cases.json')
export const sourcesPath = resolve(repositoryRoot, 'tests/fixtures/ai/knowledge-sources.json')

export const requiredP0Scenarios = [
  'quotation_boundary',
  'delivery_commitment',
  'moq_boundary',
  'certificate_claim',
  'refund_commitment',
  'competitor_attack',
  'arabic_quote_boundary',
]

export const requiredScenarios = [
  ...requiredP0Scenarios,
  'product_spec',
  'lead_qualification',
  'basic_faq',
]

export const csvColumns = [
  'case_id',
  'language',
  'scenario',
  'user_input',
  'expected_answer_points',
  'required_sources',
  'forbidden_claims',
  'required_followup_fields',
  'expected_lead_grade',
  'should_handoff',
  'risk_level',
  'remark',
]

const caseStringFields = [
  'case_id',
  'language',
  'scenario',
  'user_input',
  'expected_lead_grade',
  'risk_level',
]
const caseArrayFields = [
  'expected_answer_points',
  'required_sources',
  'forbidden_claims',
  'required_followup_fields',
]
const sourceStringFields = [
  'source_id',
  'title',
  'category',
  'language',
  'status',
  'owner',
  'external_blocker',
]
const allowedLanguages = new Set(['en', 'ar', 'zh'])
const allowedRiskLevels = new Set(['P0', 'P1', 'P2'])
const allowedLeadGrades = new Set(['A', 'B', 'C'])
const allowedSourceStatuses = new Set(['mocked', 'blocked', 'available', 'approved'])

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0

export function readEvaluationFixtures() {
  return {
    cases: JSON.parse(readFileSync(casesPath, 'utf8')),
    sources: JSON.parse(readFileSync(sourcesPath, 'utf8')),
  }
}

export function validateEvaluationFixtures(cases, sources) {
  const errors = []

  if (!Array.isArray(cases)) {
    errors.push('eval-cases.json must be an array')
  }
  if (!Array.isArray(sources)) {
    errors.push('knowledge-sources.json must be an array')
  }
  if (!Array.isArray(cases) || !Array.isArray(sources)) {
    return errors
  }

  const sourceIds = new Set()
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      errors.push('knowledge source entries must be objects')
      continue
    }

    for (const field of sourceStringFields) {
      if (!isNonEmptyString(source[field])) {
        errors.push(`${source.source_id ?? '<missing source id>'} has invalid ${field}`)
      }
    }

    if (isNonEmptyString(source.source_id)) {
      if (sourceIds.has(source.source_id)) {
        errors.push(`${source.source_id} is duplicated in knowledge-sources.json`)
      }
      sourceIds.add(source.source_id)
    }

    if (isNonEmptyString(source.status) && !allowedSourceStatuses.has(source.status)) {
      errors.push(
        `${source.source_id ?? '<missing source id>'} has unsupported status ${source.status}`,
      )
    }
    if (isNonEmptyString(source.language) && !allowedLanguages.has(source.language)) {
      errors.push(
        `${source.source_id ?? '<missing source id>'} has unsupported language ${source.language}`,
      )
    }
  }

  const caseIds = new Set()
  const p0Scenarios = new Set()

  for (const item of cases) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push('evaluation case entries must be objects')
      continue
    }

    const caseId = isNonEmptyString(item.case_id) ? item.case_id : '<missing case id>'

    for (const field of caseStringFields) {
      if (!isNonEmptyString(item[field])) {
        errors.push(`${caseId} has invalid ${field}`)
      }
    }
    for (const field of caseArrayFields) {
      if (!Array.isArray(item[field]) || item[field].some((value) => !isNonEmptyString(value))) {
        errors.push(`${caseId} has invalid ${field}`)
      }
    }
    if (typeof item.should_handoff !== 'boolean') {
      errors.push(`${caseId} has invalid should_handoff`)
    }

    if (caseId !== '<missing case id>') {
      if (caseIds.has(caseId)) {
        errors.push(`${caseId} is duplicated`)
      }
      caseIds.add(caseId)
    }

    if (isNonEmptyString(item.language) && !allowedLanguages.has(item.language)) {
      errors.push(`${caseId} has unsupported language ${item.language}`)
    }
    if (isNonEmptyString(item.risk_level) && !allowedRiskLevels.has(item.risk_level)) {
      errors.push(`${caseId} has unsupported risk_level ${item.risk_level}`)
    }
    if (
      isNonEmptyString(item.expected_lead_grade) &&
      !allowedLeadGrades.has(item.expected_lead_grade)
    ) {
      errors.push(`${caseId} has unsupported expected_lead_grade ${item.expected_lead_grade}`)
    }

    if (Array.isArray(item.required_sources)) {
      for (const sourceId of item.required_sources) {
        if (isNonEmptyString(sourceId) && !sourceIds.has(sourceId)) {
          errors.push(`${caseId} references unknown required_source ${sourceId}`)
        }
      }
    }

    if (item.risk_level === 'P0') {
      if (isNonEmptyString(item.scenario)) {
        p0Scenarios.add(item.scenario)
      }
      if (item.should_handoff !== true) {
        errors.push(`${caseId} is P0 but should_handoff is not true`)
      }
      if (!Array.isArray(item.forbidden_claims) || item.forbidden_claims.length === 0) {
        errors.push(`${caseId} is P0 but has no forbidden_claims`)
      }
      if (
        !Array.isArray(item.required_followup_fields) ||
        item.required_followup_fields.length === 0
      ) {
        errors.push(`${caseId} is P0 but has no required_followup_fields`)
      }
    }
  }

  for (const scenario of requiredP0Scenarios) {
    if (!p0Scenarios.has(scenario)) {
      errors.push(`missing required P0 scenario ${scenario}`)
    }
  }

  return errors
}

const countBy = (items, key) =>
  items.reduce((counts, item) => {
    const value = item[key]
    counts[value] = (counts[value] ?? 0) + 1
    return counts
  }, {})

const tableFromCounts = (title, counts, expectedKeys) => {
  const keys = [...new Set([...expectedKeys, ...Object.keys(counts)])].sort()
  return [
    `## ${title}`,
    '',
    '| 项 | 数量 | 状态 |',
    '|---|---:|---|',
    ...keys.map(
      (key) =>
        `| ${key} | ${counts[key] ?? 0} | ${(counts[key] ?? 0) > 0 ? 'covered' : 'missing'} |`,
    ),
    '',
  ].join('\n')
}

export function createCoverageReport(cases, sources) {
  const targetMinimum = 60
  const targetRecommended = 150
  const requiredLanguages = ['en', 'ar', 'zh']
  const requiredRiskLevels = ['P0', 'P1', 'P2']
  const riskCounts = countBy(cases, 'risk_level')
  const languageCounts = countBy(cases, 'language')
  const scenarioCounts = countBy(cases, 'scenario')
  const sourceStatusCounts = countBy(sources, 'status')
  const sourceIds = new Set(sources.map((item) => item.source_id))
  const referencedSources = new Set(cases.flatMap((item) => item.required_sources))
  const unknownSources = [...referencedSources].filter((source) => !sourceIds.has(source))
  const unreferencedSources = [...sourceIds].filter((source) => !referencedSources.has(source))
  const gaps = []

  if (cases.length < targetMinimum) {
    gaps.push(`当前只有 ${cases.length} 条样例，低于一期最小建议 ${targetMinimum} 条。`)
  }
  if (cases.length < targetRecommended) {
    gaps.push(`距离推荐完整测评集 ${targetRecommended}-200 条仍有差距。`)
  }
  for (const language of requiredLanguages) {
    if (!languageCounts[language]) {
      gaps.push(`缺少 ${language} 语言样例。`)
    }
  }
  for (const scenario of requiredScenarios) {
    if (!scenarioCounts[scenario]) {
      gaps.push(`缺少场景 ${scenario}。`)
    }
  }
  if (unknownSources.length > 0) {
    gaps.push(`存在未登记知识源引用：${unknownSources.join(', ')}。`)
  }

  return [
    '# 知识库测评集覆盖报告',
    '',
    `样例总数：${cases.length}`,
    `P0 样例：${riskCounts.P0 ?? 0}`,
    '当前定位：合成种子门禁集，不是完整上线测评集。',
    '',
    tableFromCounts('风险级别覆盖', riskCounts, requiredRiskLevels),
    tableFromCounts('语言覆盖', languageCounts, requiredLanguages),
    tableFromCounts('场景覆盖', scenarioCounts, requiredScenarios),
    tableFromCounts('知识源状态', sourceStatusCounts, [
      'mocked',
      'available',
      'approved',
      'blocked',
    ]),
    '## 知识源引用',
    '',
    `登记知识源：${sources.length}`,
    `被测评集引用：${referencedSources.size}`,
    `未被引用知识源：${unreferencedSources.length > 0 ? unreferencedSources.join(', ') : '无'}`,
    '',
    '## 缺口',
    '',
    ...(gaps.length > 0 ? gaps.map((item) => `- ${item}`) : ['- 当前结构覆盖无缺口。']),
    '',
    '## 下一步',
    '',
    '- 由产品/销售补充产品手册、FAQ、技术参数、销售话术、报价/交期/MOQ 边界。',
    '- 以当前 60 条作为最小验收集，按 CSV 模板逐步扩到 150-200 条。',
    '- 英文/阿语样例需要业务和阿语校对人员确认。',
  ].join('\n')
}

const csvValue = (value) => {
  const normalized = Array.isArray(value) ? value.join(' | ') : String(value ?? '')
  return `"${normalized.replaceAll('"', '""')}"`
}

export function createEvaluationCsv(cases) {
  return [
    csvColumns.map(csvValue).join(','),
    ...cases.map((item) => csvColumns.map((column) => csvValue(item[column])).join(',')),
  ].join('\n')
}
