import { NextRequest } from 'next/server'

import {
  deletePortalContent,
  getPortalContentEditor,
  getPortalContentOptions,
  parseContentType,
  updatePortalContent,
} from '@/admin-portal/modules/website-content/contentCommands'
import {
  authorizeContentRequest,
  contentErrorResponse,
  contentJSON,
  readContentJSON,
  requireContentID,
} from '@/admin-portal/modules/website-content/contentRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const parameters = async (params: Promise<{ id: string; type: string }>) => {
  const values = await params
  return { id: requireContentID(values.id), type: parseContentType(values.type) }
}

const localeFrom = (request: NextRequest): 'ar' | 'en' =>
  request.nextUrl.searchParams.get('locale') === 'ar' ? 'ar' : 'en'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; type: string }> },
): Promise<Response> {
  try {
    const { id, type } = await parameters(params)
    const { payload, req } = await authorizeContentRequest(request)
    const [record, options] = await Promise.all([
      getPortalContentEditor({ id, locale: localeFrom(request), payload, req, type }),
      getPortalContentOptions({ payload, req }),
    ])
    return contentJSON({ options, record })
  } catch (error) {
    return contentErrorResponse(error)
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; type: string }> },
): Promise<Response> {
  try {
    const { id, type } = await parameters(params)
    const { payload, req } = await authorizeContentRequest(request)
    const input = await readContentJSON(request)
    return contentJSON({ result: await updatePortalContent({ id, input, payload, req, type }) })
  } catch (error) {
    return contentErrorResponse(error)
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; type: string }> },
): Promise<Response> {
  try {
    const { id, type } = await parameters(params)
    const { payload, req } = await authorizeContentRequest(request)
    const input = await readContentJSON(request)
    const updatedAt = typeof input.updatedAt === 'string' ? input.updatedAt : ''
    const locale = input.locale === 'ar' ? 'ar' : input.locale === 'en' ? 'en' : null
    if (!locale) return contentJSON({ error: { code: 'content-invalid-locale', message: 'locale must be en or ar' } }, { status: 400 })
    return contentJSON({ result: await deletePortalContent({ id, locale, payload, req, type, updatedAt }) })
  } catch (error) {
    return contentErrorResponse(error)
  }
}
