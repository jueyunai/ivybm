import { getPayload } from 'payload'

import { readPublicationAsset } from '@/modules/media/publicationAssets'
import config from '@/payload.config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; sha256: string }> },
): Promise<Response> {
  const { id: rawID, sha256 } = await params
  const id = /^[1-9]\d*$/u.test(rawID) ? Number(rawID) : Number.NaN
  const payload = await getPayload({ config })
  const asset = await readPublicationAsset({ id, payload, sha256 })
  if (!asset) return new Response('Not found', { status: 404 })
  return new Response(Buffer.from(asset.bytes), {
    headers: {
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Content-Type': asset.mimeType,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
