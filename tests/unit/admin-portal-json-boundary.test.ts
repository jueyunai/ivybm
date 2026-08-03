// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { readLimitedJSONObject } from '@/admin-portal/core/http/readLimitedJSON'

class BoundaryError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

const streamedRequest = (chunks: Uint8Array[]) =>
  new Request('http://localhost/api/portal/test', {
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift()
        if (chunk) controller.enqueue(chunk)
        else controller.close()
      },
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })

describe('Portal JSON request boundary', () => {
  it('stops an unannounced chunked body at the raw byte limit', async () => {
    const request = streamedRequest([new Uint8Array(6), new Uint8Array(6)])

    await expect(
      readLimitedJSONObject(request, {
        invalid: () => new BoundaryError('invalid'),
        maximumBytes: 10,
        tooLarge: () => new BoundaryError('too-large'),
      }),
    ).rejects.toMatchObject({ code: 'too-large' })
  })

  it('counts UTF-8 bytes before decoding JSON', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ value: '中中' }))

    await expect(
      readLimitedJSONObject(streamedRequest([bytes]), {
        invalid: () => new BoundaryError('invalid'),
        maximumBytes: bytes.byteLength - 1,
        tooLarge: () => new BoundaryError('too-large'),
      }),
    ).rejects.toMatchObject({ code: 'too-large' })
  })
})
