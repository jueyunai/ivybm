import { NextRequest } from 'next/server'

import { retryPortalJob } from '@/admin-portal/modules/operations/operationsCommands'
import {
  authorizeOperationsRequest,
  operationsErrorResponse,
  operationsJSON,
  readOperationsJSON,
  requireOperationsJobID,
} from '@/admin-portal/modules/operations/operationsRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const id = requireOperationsJobID((await params).id)
    const { payload, req, user } = await authorizeOperationsRequest(request)
    return operationsJSON({
      result: await retryPortalJob({
        id,
        input: await readOperationsJSON(request),
        payload,
        req,
        user,
      }),
    })
  } catch (error) {
    return operationsErrorResponse(error)
  }
}
