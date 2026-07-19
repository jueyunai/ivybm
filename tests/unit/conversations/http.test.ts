import { describe, expect, it } from 'vitest'

import { ChatServiceError } from '@/modules/conversations/contracts'
import { chatErrorResponse, chatJSONResponse, readChatJSON } from '@/modules/conversations/http'

describe('chat HTTP boundary', () => {
  it('rejects a streaming request body before retaining more than the configured limit', async () => {
    const request = new Request('http://localhost/api/chat/sessions', {
      body: JSON.stringify({ text: 'x'.repeat(32 * 1024) }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })

    await expect(readChatJSON(request)).rejects.toMatchObject(
      { code: 'invalid_request' } satisfies Partial<ChatServiceError>,
    )
  })

  it('marks successful and error chat responses as private no-store', () => {
    expect(chatJSONResponse({ ok: true }).headers.get('cache-control')).toBe('private, no-store')
    expect(chatErrorResponse(new ChatServiceError('forbidden', 'forbidden'))
      .headers.get('cache-control')).toBe('private, no-store')
  })
})
