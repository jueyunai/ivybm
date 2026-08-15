// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { readMediaUpload } from '@/admin-portal/modules/media/mediaRoute'
import { MediaCommandError } from '@/modules/media'

describe('Portal media upload request boundary', () => {
  it('parses a bounded multipart upload after reading the request stream', async () => {
    const boundary = 'portal-bounded-upload'
    const body = Buffer.from(
      [
        `--${boundary}\r\nContent-Disposition: form-data; name="alt"\r\n\r\nPortal asset\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="source"\r\n\r\nInternal test\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="isPublic"\r\n\r\ntrue\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="asset.png"\r\nContent-Type: image/png\r\n\r\nbounded\r\n`,
        `--${boundary}--\r\n`,
      ].join(''),
    )
    const result = await readMediaUpload(
      new Request('http://localhost/api/portal/media', {
        body,
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        method: 'POST',
      }),
    )

    expect(result.input).toEqual({
      alt: 'Portal asset',
      isPublic: 'true',
      source: 'Internal test',
    })
    expect(result.file).toMatchObject({
      mimetype: 'image/png',
      name: 'asset.png',
      size: 7,
    })
    expect(result.file.data.toString('utf8')).toBe('bounded')
  })

  it('rejects an oversized streamed body without trusting Content-Length', async () => {
    const chunk = new Uint8Array(11 * 1024 * 1024)
    let emitted = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk)
        emitted += 1
        if (emitted === 2) controller.close()
      },
    })
    const request = new Request('http://localhost/api/portal/media', {
      body,
      headers: { 'content-type': 'multipart/form-data; boundary=bounded-test' },
      method: 'POST',
      // Node requires this for streamed Request bodies; browsers supply the request stream themselves.
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })

    await expect(readMediaUpload(request)).rejects.toMatchObject({
      code: 'media-request-too-large',
      status: 413,
    } satisfies Partial<MediaCommandError>)
  })
})
