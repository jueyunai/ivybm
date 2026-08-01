import { NextRequest } from 'next/server'

import { generateContentStudioDraft } from '@/admin-portal/modules/content-studio/contentStudioCommands'
import {
  authorizeContentStudioRequest,
  contentStudioErrorResponse,
  contentStudioJSON,
  readContentStudioJSON,
} from '@/admin-portal/modules/content-studio/contentStudioRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const { payload, req } = await authorizeContentStudioRequest(request)
    const result = await generateContentStudioDraft({
      input: await readContentStudioJSON(request),
      payload,
      req,
    })
    return contentStudioJSON(result, { status: result.duplicate ? 200 : 201 })
  } catch (error) {
    return contentStudioErrorResponse(error)
  }
}
