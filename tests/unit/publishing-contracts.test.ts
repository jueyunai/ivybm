import { describe, expect, it } from 'vitest'

import {
  MAX_PUBLICATION_IDEMPOTENCY_KEY_BYTES,
  normalizePlatformPublishRequest,
  normalizePublicationSourceURL,
} from '@/modules/publishing/contracts'

const request = (overrides: Record<string, unknown> = {}) => ({
  assets: [],
  idempotencyKey: 'fixture-1',
  platform: 'facebook',
  platformAccountId: 101,
  text: 'Fixture post',
  ...overrides,
})

describe('publishing public contract validation', () => {
  it('normalizes safe asset URLs while preserving signed query data for transport', () => {
    expect(
      normalizePublicationSourceURL(
        ' https://EXAMPLE.invalid:443/media/%E9%9D%A2%E6%9D%BF.jpg?token=secret#preview ',
      ),
    ).toBe('https://example.invalid/media/%E9%9D%A2%E6%9D%BF.jpg?token=secret')
    expect(() => normalizePublicationSourceURL('http://example.invalid/panel.jpg')).toThrow(
      'Publication asset source URL must be HTTPS',
    )
    expect(() => normalizePublicationSourceURL('https://user:secret@example.invalid/panel.jpg'))
      .toThrow('Publication asset source URL must be HTTPS')
  })

  it('counts idempotency keys by UTF-8 bytes and rejects non-canonical whitespace', () => {
    const atLimit = '界'.repeat(Math.floor(MAX_PUBLICATION_IDEMPOTENCY_KEY_BYTES / 3))
    const overLimit = `${atLimit}界`
    expect(normalizePlatformPublishRequest(request({ idempotencyKey: atLimit }))).toMatchObject({
      idempotencyKey: atLimit,
    })
    expect(() => normalizePlatformPublishRequest(request({ idempotencyKey: overLimit }))).toThrow(
      'Publishing idempotency key is invalid or too long',
    )
    expect(() => normalizePlatformPublishRequest(request({ idempotencyKey: ' spaced ' }))).toThrow(
      'Publishing idempotency key is invalid or too long',
    )
  })

  it('normalizes reviewed text, MIME type, asset identity and schedule before fingerprinting', () => {
    expect(
      normalizePlatformPublishRequest(
        request({
          assets: [
            {
              fileName: ' panel.jpg ',
              id: ' e\u0301 ',
              mimeType: ' IMAGE/JPEG ',
              sourceUrl: 'https://example.invalid/panel.jpg?token=secret',
            },
          ],
          scheduledFor: '2026-08-01T08:00:00+08:00',
          text: '  First line\r\nSecond line  ',
        }),
      ),
    ).toEqual({
      assets: [
        {
          fileName: 'panel.jpg',
          id: 'é',
          mimeType: 'image/jpeg',
          sourceUrl: 'https://example.invalid/panel.jpg?token=secret',
        },
      ],
      idempotencyKey: 'fixture-1',
      platform: 'facebook',
      platformAccountId: 101,
      scheduledFor: '2026-08-01T00:00:00.000Z',
      text: 'First line\nSecond line',
    })
  })
})
