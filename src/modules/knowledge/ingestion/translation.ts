import type { Payload } from 'payload'

import { AI_USAGE_KEYS } from '@/modules/ai/registry'
import type { AiGateway } from '@/modules/ai/gateway'

export const KNOWLEDGE_TRANSLATION_MAX_CHUNK_CHARACTERS = 6_000
export const KNOWLEDGE_TRANSLATION_MAX_CHUNKS = 200

export const KNOWLEDGE_RISK_TOPICS = [
  'price',
  'discount',
  'payment',
  'lead-time',
  'warranty',
  'lifespan',
  'certification',
  'structural-performance',
  'fire-performance',
  'customs',
  'freight',
  'insurance',
  'liability',
] as const

export type KnowledgeRiskTopic = (typeof KNOWLEDGE_RISK_TOPICS)[number]
export type KnowledgeTranslationLocale = 'ar' | 'en'

export type TranslationPrompt = {
  id: number | string
  key: string
  locale: 'all' | KnowledgeTranslationLocale
  model: string | null
  template: string
  version: number
}

export class KnowledgeTranslationError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'KnowledgeTranslationError'
    this.code = code
  }
}

type TranslationPayload = Pick<Payload, 'find'>

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const safeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** Resolve one active, immutable translation prompt. Missing/ambiguous config fails closed. */
export const resolveKnowledgeTranslationPrompt = async ({
  locale,
  payload,
}: {
  locale: KnowledgeTranslationLocale
  payload: TranslationPayload
}): Promise<TranslationPrompt> => {
  const result = await payload.find({
    collection: 'prompt-templates',
    depth: 0,
    limit: 100,
    overrideAccess: true,
    pagination: false,
    where: {
      and: [
        { purpose: { equals: 'translation' } },
        { status: { equals: 'active' } },
        { locale: { in: ['all', locale] } },
      ],
    },
    sort: '-version',
  })
  const prompts = result.docs
    .map((value) => asRecord(value))
    .filter((value) => safeString(value.template))
    .map((value): TranslationPrompt => ({
      id: (value.id as number | string) ?? '',
      key: safeString(value.key) || 'knowledge-translation',
      locale: value.locale === 'ar' || value.locale === 'en' ? value.locale : 'all',
      model: safeString(value.model) || null,
      template: safeString(value.template),
      version:
        typeof value.version === 'number' && Number.isSafeInteger(value.version)
          ? value.version
          : 0,
    }))
    .filter((value) => value.version > 0)
  const exact = prompts.filter((prompt) => prompt.locale === locale)
  const candidates = exact.length ? exact : prompts.filter((prompt) => prompt.locale === 'all')
  if (candidates.length === 0) {
    throw new KnowledgeTranslationError(
      'translation-prompt-unavailable',
      'No active translation prompt is configured',
    )
  }
  const highestVersion = Math.max(...candidates.map((prompt) => prompt.version))
  const latest = candidates.filter((prompt) => prompt.version === highestVersion)
  if (latest.length !== 1) {
    throw new KnowledgeTranslationError(
      'translation-prompt-ambiguous',
      'The active translation prompt is ambiguous',
    )
  }
  return latest[0]
}

const splitAtBoundary = (value: string, maximum: number): string[] => {
  const result: string[] = []
  let remaining = value.trim()
  while (remaining.length > maximum) {
    const candidate = remaining.slice(0, maximum + 1)
    const boundary = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf(' '))
    const splitAt = boundary > Math.floor(maximum * 0.5) ? boundary : maximum
    result.push(remaining.slice(0, splitAt).trim())
    remaining = remaining.slice(splitAt).trim()
  }
  if (remaining) result.push(remaining)
  return result
}

/** Split deterministically so a retry sends exactly the same bounded requests. */
export const splitKnowledgeTranslationText = (
  text: string,
  maximum = KNOWLEDGE_TRANSLATION_MAX_CHUNK_CHARACTERS,
): string[] => {
  if (!Number.isInteger(maximum) || maximum < 10)
    throw new RangeError('translation chunk budget is invalid')
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  if (!normalized)
    throw new KnowledgeTranslationError(
      'empty-source-text',
      'No source text is available for translation',
    )
  const chunks = normalized
    .split(/\n{2,}/)
    .flatMap((paragraph) => splitAtBoundary(paragraph, maximum))
    .filter(Boolean)
  if (chunks.length > KNOWLEDGE_TRANSLATION_MAX_CHUNKS) {
    throw new KnowledgeTranslationError(
      'translation-too-large',
      'The source is too large to translate safely',
    )
  }
  return chunks
}

const renderInstructions = (
  template: string,
  sourceLocale: string,
  targetLocale: KnowledgeTranslationLocale,
): string => {
  const substitutions: Record<string, string> = {
    sourceLanguage: sourceLocale,
    sourceLocale,
    targetLanguage: targetLocale === 'ar' ? 'Arabic' : 'English',
    targetLocale,
  }
  const rendered = template.replace(
    /\{\{?([a-zA-Z][a-zA-Z0-9_]*)\}?\}/g,
    (match, key: string) => substitutions[key] ?? match,
  )
  return `${rendered}\n\nTranslate faithfully into ${targetLocale === 'ar' ? 'Arabic' : 'English'}. Preserve every [[knowledge-token-N]] placeholder and table delimiter exactly. Do not add facts, prices, delivery promises, warranties, or other commitments. Return only the translated text.`
}

const requiredFidelityTokens = (value: string): string[] => {
  const patterns = [
    /\[\[source-image-[0-9]+\]\]/g,
    /(?<![A-Za-z])[0-9]+(?:[.,][0-9]+)*(?:\s*(?:%|°C|°F|mm|cm|m²|m³|m|μm|um|kg|g|kN|N|MPa|GPa|Pa))?(?![A-Za-z])/g,
    /\b(?=[A-Za-z0-9._/-]*[A-Za-z])(?=[A-Za-z0-9._/-]*[0-9])[A-Za-z0-9][A-Za-z0-9._/-]{1,}\b/g,
  ]
  const tokens = [...new Set(patterns.flatMap((pattern) => value.match(pattern) ?? []))].sort(
    (left, right) => right.length - left.length,
  )
  return tokens.filter(
    (token, index) => !tokens.slice(0, index).some((longer) => longer.includes(token)),
  )
}

const escapeRegularExpression = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const shieldFidelityTokens = (
  value: string,
): { markers: Array<[string, string]>; text: string } => {
  const tokens = requiredFidelityTokens(value).sort((left, right) => right.length - left.length)
  const markers = tokens.map((token, index): [string, string] => {
    const marker = `[[knowledge-token-${index + 1}]]`
    if (value.includes(marker)) {
      throw new KnowledgeTranslationError(
        'translation-fidelity',
        'The source contains a reserved translation placeholder',
      )
    }
    return [marker, token]
  })
  const markerByToken = new Map(markers.map(([marker, token]) => [token, marker]))
  const tokenPattern = tokens.length
    ? new RegExp(tokens.map(escapeRegularExpression).join('|'), 'g')
    : null
  const text = tokenPattern
    ? value.replace(tokenPattern, (token) => markerByToken.get(token) ?? token)
    : value
  return { markers, text }
}

export type TranslationResult = {
  locale: KnowledgeTranslationLocale
  model: string
  promptVersion: number
  text: string
}

export const translateKnowledgeText = async ({
  gateway,
  prompt,
  signal,
  sourceLocale,
  targetLocale,
  text,
}: {
  gateway: AiGateway
  prompt: TranslationPrompt
  signal?: AbortSignal
  sourceLocale: string
  targetLocale: KnowledgeTranslationLocale
  text: string
}): Promise<TranslationResult> => {
  const chunks = splitKnowledgeTranslationText(text)
  const translated: string[] = []
  let model = prompt.model ?? ''
  for (const chunk of chunks) {
    if (signal?.aborted)
      throw signal.reason instanceof Error ? signal.reason : new Error('Translation aborted')
    const shielded = shieldFidelityTokens(chunk)
    const result = await gateway.generateText({
      input: shielded.text,
      instructions: renderInstructions(prompt.template, sourceLocale, targetLocale),
      maxOutputTokens: Math.min(8_192, Math.max(512, Math.ceil(chunk.length * 2))),
      onDispatch: () => undefined,
    })
    if (!result.text.trim())
      throw new KnowledgeTranslationError(
        'translation-empty',
        'The translation provider returned empty text',
      )
    if (shielded.markers.some(([marker]) => !result.text.includes(marker))) {
      throw new KnowledgeTranslationError(
        'translation-fidelity',
        'The translation provider changed a required number or image placeholder',
      )
    }
    const restored = shielded.markers.reduce(
      (text, [marker, token]) => text.split(marker).join(token),
      result.text.trim(),
    )
    if (requiredFidelityTokens(chunk).some((token) => !restored.includes(token))) {
      throw new KnowledgeTranslationError(
        'translation-fidelity',
        'The translation provider changed a required number or image placeholder',
      )
    }
    translated.push(restored)
    model = result.model
  }
  if (!model)
    throw new KnowledgeTranslationError(
      'translation-model-unavailable',
      'The translation model is unavailable',
    )
  return {
    locale: targetLocale,
    model,
    promptVersion: prompt.version,
    text: translated.join('\n\n'),
  }
}

const topicPatterns: Record<KnowledgeRiskTopic, RegExp> = {
  price:
    /(?:\bprice\b|\bpricing\b|\bquote\b|\bquotation\b|报价|价格|价钱|报盘|سعر|أسعار|عرض سعر|عرض أسعار|تسعيرة|التسعير)/i,
  discount: /(?:\bdiscount\b|折扣|打折|优惠|خصم|الخصم)/i,
  payment: /(?:\bpayment\b|\bpay(?:ment)? terms?\b|付款|支付|付款方式|دفعة|الدفع|شروط الدفع)/i,
  'lead-time':
    /(?:\blead[- ]?time\b|\bdelivery(?: time| date)?\b|\bshipping time\b|交期|交货期|交付|工期|交货时间|مدة التسليم|مدة التوريد|موعد التسليم|وقت التسليم)/i,
  warranty: /(?:\bwarranty\b|\bguarantee\b|质保|保修|保固|ضمان|الضمان)/i,
  lifespan:
    /(?:\blifespan\b|\bservice life\b|\blife expectancy\b|寿命|使用年限|使用寿命|العمر الافتراضي|العمر المتوقع)/i,
  certification:
    /(?:\bcertification\b|\bcertificate\b|\bcertified\b|认证|证书|合规|شهادة|اعتماد|معتمد)/i,
  'structural-performance':
    /(?:\bstructur(?:al|e)\b|\bload[- ]?bearing\b|结构|结构性能|承重|إنشائي|هيكلي|تحمل الأحمال)/i,
  'fire-performance':
    /(?:\bfire[- ]?(?:rating|resistance|performance)\b|防火|耐火|防火性能|مقاومة الحريق|أداء الحريق)/i,
  customs:
    /(?:\bcustoms\b|\btariff\b|\bcustoms duty\b|关税|海关|清关|الجمارك|التعرفة|الرسوم الجمركية)/i,
  freight: /(?:\bfreight\b|\bshipping\b|\btransport(?:ation)?\b|运费|运输|货运|الشحن|النقل)/i,
  insurance: /(?:\binsurance\b|保险|التأمين)/i,
  liability:
    /(?:\bliability\b|\bresponsibility\b|\bindemnity\b|责任|赔偿|责任归属|المسؤولية|تعويض|التعويض)/i,
}

export const detectKnowledgeRiskTopics = (text: string): KnowledgeRiskTopic[] =>
  KNOWLEDGE_RISK_TOPICS.filter((topic) => topicPatterns[topic].test(text))

export const knowledgeTranslationUsageKey = AI_USAGE_KEYS.knowledgeTranslation
