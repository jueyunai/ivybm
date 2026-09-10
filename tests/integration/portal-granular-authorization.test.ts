import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import { PERMISSION_MODULE_IDS, PORTAL_PERMISSION_PRESETS } from '@/access/roles'
import { authorizePortalConversationRequest } from '@/admin-portal/modules/conversations/conversationRoute'
import { authorizeContentStudioRequest } from '@/admin-portal/modules/content-studio/contentStudioRoute'
import { authorizeContentRequest } from '@/admin-portal/modules/website-content/contentRoute'
import { authorizeKnowledgeRequest } from '@/admin-portal/modules/knowledge/knowledgeRoute'
import { authorizeLeadRequest } from '@/admin-portal/modules/leads/leadRoute'
import { authorizeMediaRequest } from '@/admin-portal/modules/media/mediaRoute'
import { authorizeOperationsRequest } from '@/admin-portal/modules/operations/operationsRoute'
import { loadPlatformAccountsPageData } from '@/admin-portal/modules/platforms/getPlatformReadiness'
import { authorizeSiteSettingsRequest } from '@/admin-portal/modules/settings/siteSettingsRoute'
import { authorizeUserSettingsRequest } from '@/admin-portal/modules/settings/userSettingsRoute'
import type { PortalPermissionUser } from '@/admin-portal/core/modules/types'
import type { User } from '@/payload-types'
import config from '@/payload.config'

let payload: Payload
let admin: User
let operator: User
let sales: User
let viewer: User
const createdUserIds: Array<number | string> = []

const moduleEnv = (moduleId: string): string => {
  switch (moduleId) {
    case 'content':
      return 'ADMIN_PORTAL_WEBSITE_CONTENT_ENABLED'
    case 'contentStudio':
      return 'ADMIN_PORTAL_CONTENT_STUDIO_ENABLED'
    default:
      return `ADMIN_PORTAL_${moduleId.toUpperCase()}_ENABLED`
  }
}

const requestFor = (token: string): Request =>
  new Request('http://localhost/api/portal/granular-authorization', {
    headers: { authorization: `JWT ${token}` },
  })

const loginToken = async (username: string): Promise<string> => {
  const { token } = await payload.login({
    collection: 'users',
    data: {
      password: 'PortalGranularAuthorizationPassword!',
      username,
    },
  })

  if (typeof token !== 'string') {
    throw new Error(`Payload did not return a token for ${username}`)
  }

  return token
}

const asPortalPermissionUser = (user: User): PortalPermissionUser => {
  if (
    typeof user.permissions !== 'object' ||
    user.permissions === null ||
    Array.isArray(user.permissions)
  ) {
    throw new Error(`User ${user.username} does not have a permission matrix`)
  }

  return user as unknown as PortalPermissionUser
}

const authorizeModule = (
  moduleId: (typeof PERMISSION_MODULE_IDS)[number],
  user: PortalPermissionUser,
  token: string,
  action: 'view' | 'edit',
): Promise<unknown> => {
  const request = requestFor(token)

  switch (moduleId) {
    case 'conversations':
      return authorizePortalConversationRequest(request, { action })
    case 'leads':
      return authorizeLeadRequest(request, { action })
    case 'content':
      return authorizeContentRequest(request, { action })
    case 'media':
      return authorizeMediaRequest(request, { action })
    case 'contentStudio':
      return authorizeContentStudioRequest(request, { action })
    case 'knowledge':
      return authorizeKnowledgeRequest(request, { action })
    case 'operations':
      return authorizeOperationsRequest(request, { action })
    case 'settings':
      return action === 'edit'
        ? authorizeSiteSettingsRequest(request)
        : authorizeUserSettingsRequest(request)
    case 'platforms':
      return loadPlatformAccountsPageData({
        env: {
          ADMIN_PORTAL_ENABLED: 'true',
          ADMIN_PORTAL_PLATFORMS_ENABLED: 'true',
        },
        payload,
        req: undefined,
        user,
      })
  }
}

describe.sequential('Portal granular authorization', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for Portal granular authorization tests')
    }

    for (const moduleId of PERMISSION_MODULE_IDS) {
      process.env[moduleEnv(moduleId)] = 'true'
    }
    process.env.ADMIN_PORTAL_ENABLED = 'true'

    payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'portal-granular-authorization-integration-tests',
    })

    const suffix = randomUUID()
    const password = 'PortalGranularAuthorizationPassword!'
    admin = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: { password, role: 'admin', username: `granular-admin-${suffix}` },
      draft: true,
      overrideAccess: true,
    })
    operator = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: { password, role: 'operator', username: `granular-operator-${suffix}` },
      draft: true,
      overrideAccess: true,
    })
    sales = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: { password, role: 'sales', username: `granular-sales-${suffix}` },
      draft: true,
      overrideAccess: true,
    })
    viewer = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        password,
        permissions: Object.fromEntries(
          PERMISSION_MODULE_IDS.map((moduleId) => [moduleId, { edit: false, view: true }]),
        ),
        role: 'operator',
        username: `granular-viewer-${suffix}`,
      },
      draft: true,
      overrideAccess: true,
    })
    createdUserIds.push(admin.id, operator.id, sales.id, viewer.id)
  })

  afterAll(async () => {
    if (!payload) return

    await payload.delete({
      collection: 'audit-logs',
      overrideAccess: true,
      where: { actor: { in: createdUserIds } },
    })
    await payload.delete({
      collection: 'users',
      context: { skipAudit: true },
      overrideAccess: true,
      where: { id: { in: createdUserIds } },
    })
    await payload.destroy()
  })

  it('allows each server module action only when the stored permission matrix grants it', async () => {
    const tokens = {
      [admin.id]: await loginToken(admin.username),
      [operator.id]: await loginToken(operator.username),
      [sales.id]: await loginToken(sales.username),
      [viewer.id]: await loginToken(viewer.username),
    }

    const roleUsers = [
      { expected: PORTAL_PERMISSION_PRESETS.admin, token: tokens[admin.id], user: admin },
      { expected: PORTAL_PERMISSION_PRESETS.operator, token: tokens[operator.id], user: operator },
      { expected: PORTAL_PERMISSION_PRESETS.sales, token: tokens[sales.id], user: sales },
      {
        expected: Object.fromEntries(
          PERMISSION_MODULE_IDS.map((moduleId) => [moduleId, { edit: false, view: true }]),
        ),
        token: tokens[viewer.id],
        user: viewer,
      },
    ]

    for (const moduleId of PERMISSION_MODULE_IDS) {
      for (const { expected, token, user } of roleUsers) {
        for (const action of ['view', 'edit'] as const) {
          const operation = () =>
            authorizeModule(moduleId, asPortalPermissionUser(user), token, action)

          if (moduleId === 'platforms' && action === 'edit') continue

          if (expected[moduleId][action]) {
            await operation()
          } else if (moduleId === 'platforms' && action === 'view') {
            const result = await operation()
            expect(result).toMatchObject({ state: 'forbidden' })
          } else {
            await expect(operation()).rejects.toMatchObject({
              code:
                moduleId === 'contentStudio'
                  ? 'content-studio-forbidden'
                  : moduleId === 'settings' && action === 'edit'
                    ? 'site-settings-forbidden'
                    : `${moduleId}-forbidden`,
            })
          }
        }
      }
    }
  })
})
