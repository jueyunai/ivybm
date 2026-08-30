import { createHash } from 'node:crypto'

import { createMetaConnector } from './connector'

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const fingerprint = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 16)

const isValidTimestamp = (value: unknown): value is number => {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) return false
  const milliseconds = Number(value) < 100_000_000_000 ? Number(value) * 1_000 : Number(value)
  return !Number.isNaN(new Date(milliseconds).getTime())
}

const forbiddenKey = (key: string): boolean =>
  /(access[_-]?token|authorization|cookie|secret|signature)/iu.test(key)

const safeEnumValues: Record<string, ReadonlySet<string>> = {
  action: new Set(['react', 'unreact']),
  field: new Set([
    'comments',
    'live_comments',
    'mentions',
    'message_edit',
    'message_reactions',
    'messages',
    'messaging_handover',
    'messaging_postbacks',
    'messaging_referral',
    'messaging_seen',
    'standby',
    'story_insights',
  ]),
  object: new Set(['instagram', 'page']),
  reaction: new Set(['angry', 'laugh', 'like', 'love', 'other', 'sad', 'wow']),
  type: new Set(['audio', 'file', 'image', 'ig_reel', 'reel', 'share', 'story_mention', 'video']),
}

const sanitize = (value: unknown, path: string[] = []): unknown => {
  if (Array.isArray(value)) return value.map((item, index) => sanitize(item, [...path, String(index)]))
  if (!isRecord(value)) {
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
    return typeof value === 'string' ? '[REDACTED]' : null
  }

  const output: UnknownRecord = {}
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKey(key)) continue
    const parent = path.at(-1)
    if (key === 'id' && (typeof child === 'string' || typeof child === 'number')) {
      const identifier = String(child)
      if (parent === 'sender' || parent === 'from') {
        output[key] = `SENDER_REDACTED_${fingerprint(identifier)}`
      } else if (parent === 'recipient' || path.at(-2) === 'entry') {
        output[key] = `ACCOUNT_REDACTED_${fingerprint(identifier)}`
      } else {
        output[key] = `ID_REDACTED_${fingerprint(identifier)}`
      }
      continue
    }
    if (key === 'mid' && (typeof child === 'string' || typeof child === 'number')) {
      output[key] = `m_replay_${fingerprint(String(child))}`
      continue
    }
    if (key === 'url') {
      output[key] = 'https://example.invalid/redacted'
      continue
    }
    if (key === 'text' || key === 'title' || key === 'ref') {
      output[key] = '[REDACTED]'
      continue
    }
    if (typeof child === 'string' && safeEnumValues[key]) {
      output[key] = safeEnumValues[key].has(child) ? child : '[REDACTED]'
      continue
    }
    if (key === 'timestamp' || key === 'time') {
      output[key] = isValidTimestamp(child)
        ? child
        : isRecord(child) || Array.isArray(child)
          ? sanitize(child, [...path, key])
          : '[REDACTED]'
      continue
    }
    output[key] = sanitize(child, [...path, key])
  }
  return output
}

export const sanitizeMetaWebhookReplayFixture = (payload: unknown): unknown => sanitize(payload)

export type SanitizedMetaWebhookReplaySummary = {
  accountExternalIds: string[]
  eventCount: number
  platforms: string[]
}

export const replaySanitizedMetaWebhookFixture = (
  fixture: unknown,
): SanitizedMetaWebhookReplaySummary => {
  const events = createMetaConnector().normalize(fixture)
  return {
    accountExternalIds: [...new Set(events.map((event) => event.accountExternalId))].sort(),
    eventCount: events.length,
    platforms: [...new Set(events.map((event) => event.platform))].sort(),
  }
}
