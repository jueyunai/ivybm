import { NextRequest } from 'next/server'

import { executePortalRouteCommand } from '@/admin-portal/core/commands/portalCommandReceipts'
import {
  adoptContentStudioImage,
  deleteContentStudioDraft,
  reviewContentStudioDraft,
  scheduleContentStudioPublication,
  submitContentStudioReview,
  updateContentStudioDraft,
} from '@/admin-portal/modules/content-studio/contentStudioCommands'
import { publishContentStudioNow } from '@/admin-portal/modules/content-studio/publishContentStudio'
import {
  authorizeContentStudioRequest,
  contentStudioErrorResponse,
  contentStudioJSON,
  readContentStudioJSON,
  requireContentStudioID,
} from '@/admin-portal/modules/content-studio/contentStudioRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Context): Promise<Response> {
  try {
    const { payload, req } = await authorizeContentStudioRequest(request)
    const id = requireContentStudioID((await params).id)
    const input = await readContentStudioJSON(request)
    return contentStudioJSON({
      content: await executePortalRouteCommand({
        fingerprintInput: { id, input },
        operation: (transactionReq) =>
          updateContentStudioDraft({ id, input, payload, req: transactionReq }),
        payload,
        req,
        request,
        scope: `portal.content-studio:update:${id}`,
        target: { collection: 'generated-contents', id },
      }),
    })
  } catch (error) {
    return contentStudioErrorResponse(error)
  }
}

export async function DELETE(request: NextRequest, { params }: Context): Promise<Response> {
  try {
    const { payload, req } = await authorizeContentStudioRequest(request)
    const id = requireContentStudioID((await params).id)
    const input = await readContentStudioJSON(request)
    return contentStudioJSON(
      await executePortalRouteCommand({
        fingerprintInput: { id, input },
        operation: (transactionReq) =>
          deleteContentStudioDraft({ id, input, payload, req: transactionReq }),
        payload,
        req,
        request,
        scope: `portal.content-studio:delete:${id}`,
        target: { collection: 'generated-contents', id },
      }),
    )
  } catch (error) {
    return contentStudioErrorResponse(error)
  }
}

export async function POST(request: NextRequest, { params }: Context): Promise<Response> {
  try {
    const input = await readContentStudioJSON(request)
    const { payload, req } = await authorizeContentStudioRequest(request)
    const id = requireContentStudioID((await params).id)
    const command = <T>(operation: (transactionReq: typeof req) => Promise<T>) =>
      executePortalRouteCommand({
        fingerprintInput: { id, input },
        operation,
        payload,
        req,
        request,
        scope: `portal.content-studio:${String(input.action)}:${id}`,
        target: { collection: 'generated-contents', id },
      })
    if (input.action === 'submit-review')
      return contentStudioJSON({
        content: await command((transactionReq) =>
          submitContentStudioReview({ id, input, payload, req: transactionReq }),
        ),
      })
    if (input.action === 'adopt-image')
      return contentStudioJSON({
        content: await command((transactionReq) =>
          adoptContentStudioImage({ id, input, payload, req: transactionReq }),
        ),
      })
    if (input.action === 'review')
      return contentStudioJSON({
        content: await command((transactionReq) =>
          reviewContentStudioDraft({ id, input, payload, req: transactionReq }),
        ),
      })
    if (input.action === 'schedule')
      return contentStudioJSON(
        {
          publication: await command((transactionReq) =>
            scheduleContentStudioPublication({ id, input, payload, req: transactionReq }),
          ),
        },
        { status: 201 },
      )
    if (input.action === 'publish-now')
      return contentStudioJSON(
        {
          publication: await command((transactionReq) =>
            publishContentStudioNow({ id, input, payload, req: transactionReq }),
          ),
        },
        { status: 202 },
      )
    return contentStudioJSON(
      { error: { code: 'content-studio-invalid-action', message: 'Unsupported content action' } },
      { status: 400 },
    )
  } catch (error) {
    return contentStudioErrorResponse(error)
  }
}
