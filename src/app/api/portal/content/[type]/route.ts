import { NextRequest } from 'next/server'

import {
  createPortalContent,
  getPortalContentOptions,
  parseContentType,
} from '@/admin-portal/modules/website-content/contentCommands'
import {
  authorizeContentRequest,
  contentErrorResponse,
  contentJSON,
  readContentJSON,
} from '@/admin-portal/modules/website-content/contentRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> },
): Promise<Response> {
  try {
    parseContentType((await params).type)
    const { payload, req } = await authorizeContentRequest(request)
    return contentJSON({ options: await getPortalContentOptions({ payload, req }) })
  } catch (error) {
    return contentErrorResponse(error)
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> },
): Promise<Response> {
  try {
    const type = parseContentType((await params).type)
    const { payload, req } = await authorizeContentRequest(request)
    const input = await readContentJSON(request)
    const result = await createPortalContent({ input, payload, req, type })
    return contentJSON({ result }, { status: 201 })
  } catch (error) {
    return contentErrorResponse(error)
  }
}
