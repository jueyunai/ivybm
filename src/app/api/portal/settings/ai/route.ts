import { NextRequest } from 'next/server'

import {
  aiSettingsErrorResponse,
  aiSettingsJSON,
  authorizeAiSettingsRequest,
} from '@/admin-portal/modules/settings/aiSettingsRoute'
import { getPortalAiSettings } from '@/admin-portal/modules/settings/getPortalAiSettings'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const { payload, req } = await authorizeAiSettingsRequest(request)
    return aiSettingsJSON(await getPortalAiSettings({ payload, req }))
  } catch (error) {
    return aiSettingsErrorResponse(error)
  }
}
