import { createMetaWebhookHandlers } from '@/modules/platforms/meta/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const handlers = createMetaWebhookHandlers()

export const GET = handlers.GET
export const POST = handlers.POST
