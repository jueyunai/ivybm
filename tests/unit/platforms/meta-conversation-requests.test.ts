import { describe, expect, it, vi } from 'vitest'

import {
  buildMetaConversationReplyRequest,
  type MetaConversationReplyInput,
  parseMetaConversationReplyResponse,
} from '../../../src/modules/platforms/meta/conversationRequests'

const input = (
  overrides: Partial<MetaConversationReplyInput> = {},
): MetaConversationReplyInput => ({
  platform: 'facebook-messenger',
  recipientExternalId: '9876543210987654',
  text: 'Thank you. Which finish and approximate quantity do you need?',
  ...overrides,
})

describe('meta conversation reply request builder', () => {
  it.each(['facebook-messenger', 'instagram'] as const)(
    'builds the exact Send API request for %s',
    (platform) => {
      const request = buildMetaConversationReplyRequest(input({ platform }))

      expect(request).toEqual({
        body: {
          message: { text: 'Thank you. Which finish and approximate quantity do you need?' },
          messaging_type: 'RESPONSE',
          recipient: { id: '9876543210987654' },
        },
        method: 'POST',
        path: '/me/messages',
      })
    },
  )

  it('trims the reply text before building the body', () => {
    const request = buildMetaConversationReplyRequest(input({ text: '  Hello there.  ' }))
    expect(request.body.message.text).toBe('Hello there.')
  })

  it('contains no credentials, tokens, deliveryKey or externalThreadId', () => {
    const request = buildMetaConversationReplyRequest(input())
    const serialized = JSON.stringify(request)

    expect(Object.keys(request).sort()).toEqual(['body', 'method', 'path'])
    expect(serialized).not.toMatch(/authorization/i)
    expect(serialized).not.toContain('access_token')
    expect(serialized).not.toContain('deliveryKey')
    expect(serialized).not.toContain('externalThreadId')
  })

  it.each(['tiktok', 'facebook', '', ' facebook-messenger'])(
    'rejects an unsupported platform %j',
    (platform) => {
      expect(() =>
        buildMetaConversationReplyRequest(
          input({ platform: platform as MetaConversationReplyInput['platform'] }),
        ),
      ).toThrow(/platform must be facebook-messenger or instagram/)
    },
  )

  it.each(['../../etc', '9876/5432', 'SENDER_FIXTURE_1', '', '   ', '9'.repeat(65)])(
    'rejects an invalid or traversal recipient external ID %j',
    (recipientExternalId) => {
      expect(() => buildMetaConversationReplyRequest(input({ recipientExternalId }))).toThrow(
        /recipient external ID must be a decimal identifier/,
      )
    },
  )

  it.each(['', '   ', '\n\t  '])('rejects empty text %j', (text) => {
    expect(() => buildMetaConversationReplyRequest(input({ text }))).toThrow(
      /text must be non-empty/,
    )
  })

  it('accepts Messenger text at 2000 characters and rejects 2001', () => {
    expect(
      buildMetaConversationReplyRequest(input({ text: ` ${'a'.repeat(2_000)} ` })).body.message
        .text,
    ).toHaveLength(2_000)
    expect(() => buildMetaConversationReplyRequest(input({ text: 'a'.repeat(2_001) }))).toThrow(
      /at most 2000 characters for facebook-messenger/,
    )
    expect(
      buildMetaConversationReplyRequest(input({ text: '😀'.repeat(2_000) })).body.message.text,
    ).toBe('😀'.repeat(2_000))
    expect(() => buildMetaConversationReplyRequest(input({ text: '😀'.repeat(2_001) }))).toThrow(
      /at most 2000 characters for facebook-messenger/,
    )
  })

  it('enforces the Instagram 1000 UTF-8 byte limit, including multibyte text', () => {
    expect(
      buildMetaConversationReplyRequest(input({ platform: 'instagram', text: 'a'.repeat(1_000) }))
        .body.message.text,
    ).toHaveLength(1_000)
    expect(() =>
      buildMetaConversationReplyRequest(input({ platform: 'instagram', text: 'a'.repeat(1_001) })),
    ).toThrow(/at most 1000 UTF-8 bytes for instagram/)

    expect(() =>
      buildMetaConversationReplyRequest(input({ platform: 'instagram', text: '你'.repeat(334) })),
    ).toThrow(/at most 1000 UTF-8 bytes for instagram/)
    expect(
      buildMetaConversationReplyRequest(input({ platform: 'instagram', text: '😀'.repeat(250) }))
        .body.message.text,
    ).toBe('😀'.repeat(250))
  })

  it('never touches fetch', () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('network access is forbidden in the pure builder')
    })
    vi.stubGlobal('fetch', fetchSpy)

    try {
      buildMetaConversationReplyRequest(input())
      buildMetaConversationReplyRequest(input({ platform: 'instagram' }))
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('meta conversation reply response parser', () => {
  it('normalizes a success body into recipientExternalId and messageId', () => {
    expect(
      parseMetaConversationReplyResponse({
        message_id: 'm_1f8opaque.PROVIDER_ID==',
        recipient_id: '9876543210987654',
      }),
    ).toEqual({
      messageId: 'm_1f8opaque.PROVIDER_ID==',
      recipientExternalId: '9876543210987654',
    })
  })

  it.each([null, undefined, 42, 'recipient_id', [], [1, 2]])(
    'rejects a malformed response %j',
    (value) => {
      expect(() => parseMetaConversationReplyResponse(value)).toThrow(/response must be an object/)
    },
  )

  it.each([
    { recipient_id: '9876543210987654' },
    { message_id: 42, recipient_id: '9876543210987654' },
  ])('rejects a response with a missing or mistyped message_id %j', (value) => {
    expect(() => parseMetaConversationReplyResponse(value)).toThrow(/message_id must be a string/)
  })

  it('rejects a response with a missing recipient_id', () => {
    expect(() => parseMetaConversationReplyResponse({ message_id: 'm_opaque' })).toThrow(
      /recipient_id must be a decimal identifier/,
    )
  })

  it.each(['SENDER_FIXTURE_1', '', '   ', '1'.repeat(65), '../1'])(
    'rejects a non-decimal recipient_id %j',
    (recipientId) => {
      expect(() =>
        parseMetaConversationReplyResponse({ message_id: 'm_opaque', recipient_id: recipientId }),
      ).toThrow(/recipient_id must be a decimal identifier/)
    },
  )

  it.each([
    '',
    '   ',
    'm_'.padEnd(513, 'x'),
    'm_with\nnewline',
    'm_with\ttab',
    'm_with space',
    ' m_leading',
    'm_trailing ',
    'm_with\u0000nul',
    'm_with\u0085nel',
  ])('rejects an invalid message_id %j', (messageId) => {
    expect(() =>
      parseMetaConversationReplyResponse({
        message_id: messageId,
        recipient_id: '9876543210987654',
      }),
    ).toThrow(/message_id/)
  })

  it('fails closed on a provider error body without echoing it', () => {
    const providerErrorBody = {
      error: {
        code: 190,
        error_subcode: 2_018_010,
        fbtrace_id: 'TRACE_FIXTURE_SECRET',
        message: 'Invalid OAuth access token TRACE_FIXTURE_SECRET',
        type: 'OAuthException',
      },
    }

    let thrown: unknown
    try {
      parseMetaConversationReplyResponse(providerErrorBody)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    const message = (thrown as Error).message
    expect(message).toMatch(/recipient_id/)
    expect(message).not.toContain('TRACE_FIXTURE_SECRET')
    expect(message).not.toContain('OAuthException')
    expect(message).not.toContain('Invalid OAuth access token')
    expect(message).not.toContain('190')
  })

  it('never touches fetch', () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('network access is forbidden in the pure parser')
    })
    vi.stubGlobal('fetch', fetchSpy)

    try {
      parseMetaConversationReplyResponse({
        message_id: 'm_opaque',
        recipient_id: '9876543210987654',
      })
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
