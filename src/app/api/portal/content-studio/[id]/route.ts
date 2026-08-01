import { NextRequest } from 'next/server'

import {
  deleteContentStudioDraft,
  reviewContentStudioDraft,
  scheduleContentStudioPublication,
  submitContentStudioReview,
  updateContentStudioDraft,
} from '@/admin-portal/modules/content-studio/contentStudioCommands'
import { authorizeContentStudioRequest, contentStudioErrorResponse, contentStudioJSON, readContentStudioJSON, requireContentStudioID } from '@/admin-portal/modules/content-studio/contentStudioRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Context): Promise<Response> {
  try {
    const { payload, req } = await authorizeContentStudioRequest(request)
    return contentStudioJSON({ content: await updateContentStudioDraft({ id: requireContentStudioID((await params).id), input: await readContentStudioJSON(request), payload, req }) })
  } catch (error) { return contentStudioErrorResponse(error) }
}

export async function DELETE(request: NextRequest, { params }: Context): Promise<Response> {
  try {
    const { payload, req } = await authorizeContentStudioRequest(request)
    return contentStudioJSON(await deleteContentStudioDraft({ id: requireContentStudioID((await params).id), input: await readContentStudioJSON(request), payload, req }))
  } catch (error) { return contentStudioErrorResponse(error) }
}

export async function POST(request: NextRequest, { params }: Context): Promise<Response> {
  try {
    const input = await readContentStudioJSON(request)
    const { payload, req } = await authorizeContentStudioRequest(request)
    const id = requireContentStudioID((await params).id)
    if (input.action === 'submit-review') return contentStudioJSON({ content: await submitContentStudioReview({ id, input, payload, req }) })
    if (input.action === 'review') return contentStudioJSON({ content: await reviewContentStudioDraft({ id, input, payload, req }) })
    if (input.action === 'schedule') return contentStudioJSON({ publication: await scheduleContentStudioPublication({ id, input, payload, req }) }, { status: 201 })
    return contentStudioJSON({ error: { code: 'content-studio-invalid-action', message: 'Unsupported content action' } }, { status: 400 })
  } catch (error) { return contentStudioErrorResponse(error) }
}
