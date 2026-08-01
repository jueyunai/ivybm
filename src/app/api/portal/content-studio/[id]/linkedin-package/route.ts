import { NextRequest } from 'next/server'

import { createContentStudioLinkedInPackage } from '@/admin-portal/modules/content-studio/linkedinPackage'
import { authorizeContentStudioRequest, contentStudioErrorResponse, requireContentStudioID } from '@/admin-portal/modules/content-studio/contentStudioRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { payload, req } = await authorizeContentStudioRequest(request)
    const artifact = await createContentStudioLinkedInPackage({ id: requireContentStudioID((await params).id), payload, req })
    return new Response(artifact.bytes, { headers: { 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${artifact.fileName}"`, 'Content-Type': artifact.mimeType } })
  } catch (error) { return contentStudioErrorResponse(error) }
}
