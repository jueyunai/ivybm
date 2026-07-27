import { describe, expect, it } from 'vitest'

import {
  MAX_PLATFORM_EVENT_IDEMPOTENCY_KEY_LENGTH,
  platformEventKey,
  platformEventKeyV2,
} from '@/modules/platforms/types'

describe('platform event identities', () => {
  it('keeps the legacy event key readable while deriving a bounded account-scoped key for new events', () => {
    expect(platformEventKey('facebook-messenger', 'legacy-message')).toBe(
      'facebook-messenger:legacy-message',
    )

    const first = platformEventKeyV2('facebook-messenger', 'page-a', 'shared-message')
    const duplicate = platformEventKeyV2('facebook-messenger', 'page-a', 'shared-message')
    const differentAccount = platformEventKeyV2('facebook-messenger', 'page-b', 'shared-message')

    expect(first).toBe(duplicate)
    expect(first).not.toBe(differentAccount)
    expect(first).toMatch(/^platform-event:v2:facebook-messenger:[a-f0-9]{64}$/)
    expect(first.length).toBeLessThanOrEqual(MAX_PLATFORM_EVENT_IDEMPOTENCY_KEY_LENGTH)
  })

  it('cannot alias account and event identifiers that contain delimiters', () => {
    expect(platformEventKeyV2('facebook-messenger', 'account:a', 'message')).not.toBe(
      platformEventKeyV2('facebook-messenger', 'account', 'a:message'),
    )
    expect(
      platformEventKeyV2('facebook-messenger', 'a'.repeat(240), 'm'.repeat(180)).length,
    ).toBeLessThanOrEqual(MAX_PLATFORM_EVENT_IDEMPOTENCY_KEY_LENGTH)
  })

  it('rejects non-canonical whitespace instead of silently merging two account identities', () => {
    expect(() => platformEventKeyV2('facebook-messenger', ' page-a ', 'message')).toThrow(
      'Platform event identity must not contain surrounding whitespace',
    )
    expect(() => platformEventKeyV2('facebook-messenger', 'page-a', ' message ')).toThrow(
      'Platform event identity must not contain surrounding whitespace',
    )
  })
})
