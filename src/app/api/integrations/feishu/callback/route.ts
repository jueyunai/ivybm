import { NextRequest, NextResponse } from 'next/server'
import {
  commitTransaction,
  createLocalReq,
  getPayload,
  initTransaction,
  killTransaction,
  type Payload,
} from 'payload'

import {
  decryptFeishuCredential,
  encryptFeishuCredential,
  readFeishuCredentialEncryptionKey,
} from '@/modules/feishu/credentials'
import { exchangeFeishuOAuthCode, getFeishuOAuthUser, hashOAuthState } from '@/modules/feishu/oauth'
import { DEFAULT_FEISHU_FIELD_MAPPINGS, provisionFeishuCRM } from '@/modules/feishu/provision'
import config from '@/payload.config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const adminURL = (request: NextRequest, result: string): URL => {
  const url = new URL('/admin/feishu', request.url)
  url.searchParams.set('result', result)
  return url
}

const redirect = (request: NextRequest, result: string): Response =>
  NextResponse.redirect(adminURL(request, result), {
    headers: { 'cache-control': 'no-store' },
    status: 302,
  })

const consumeOAuthState = async ({ payload, state }: { payload: Payload; state: string }) => {
  const req = await createLocalReq({}, payload)
  await initTransaction(req)
  try {
    const result = await payload.find({
      collection: 'feishu-oauth-states',
      depth: 0,
      limit: 2,
      overrideAccess: true,
      req,
      where: { stateHash: { equals: hashOAuthState(state) } },
    })
    const oauthState = result.docs[0]
    if (
      result.totalDocs !== 1 ||
      oauthState.usedAt ||
      Date.parse(oauthState.expiresAt) <= Date.now()
    ) {
      throw new Error('invalid_oauth_state')
    }
    const consumed = await payload.update({
      collection: 'feishu-oauth-states',
      data: { usedAt: new Date().toISOString() },
      id: oauthState.id,
      overrideAccess: true,
      req,
    })
    const verifier = decryptFeishuCredential(
      consumed.verifierEncrypted,
      readFeishuCredentialEncryptionKey(),
    )
    await commitTransaction(req)
    return verifier
  } catch (error) {
    await killTransaction(req).catch(() => undefined)
    throw error
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  const state = request.nextUrl.searchParams.get('state')?.trim()
  if (!state) return redirect(request, 'invalid_state')
  if (request.nextUrl.searchParams.get('error')) return redirect(request, 'denied')
  const code = request.nextUrl.searchParams.get('code')?.trim()
  if (!code) return redirect(request, 'missing_code')

  try {
    const payload = await getPayload({ config })
    const verifier = await consumeOAuthState({ payload, state })
    const appId = process.env.FEISHU_APP_ID?.trim()
    const appSecret = process.env.FEISHU_APP_SECRET?.trim()
    const redirectURI = process.env.FEISHU_OAUTH_REDIRECT_URI?.trim()
    if (!appId || !appSecret || !redirectURI) throw new Error('oauth_not_configured')

    const token = await exchangeFeishuOAuthCode({
      appId,
      appSecret,
      code,
      codeVerifier: verifier,
      redirectURI,
    })
    const user = await getFeishuOAuthUser({ accessToken: token.accessToken })
    const existingConnections = await payload.find({
      collection: 'feishu-connections',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { tenantKey: { equals: user.tenantKey } },
    })
    const existingConnection = existingConnections.docs[0]
    const provisioned =
      existingConnection?.appToken && existingConnection.tableId && existingConnection.baseURL
        ? {
            appToken: existingConnection.appToken,
            baseURL: existingConnection.baseURL,
            tableId: existingConnection.tableId,
          }
        : await provisionFeishuCRM({ accessToken: token.accessToken })
    const key = readFeishuCredentialEncryptionKey()
    const connectionData = {
      accessTokenEncrypted: encryptFeishuCredential(token.accessToken, key),
      accessTokenExpiresAt: token.expiresAt,
      appToken: provisioned.appToken,
      authMode: 'store_oauth' as const,
      baseURL: provisioned.baseURL,
      installerOpenId: user.openId,
      lastConnectedAt: new Date().toISOString(),
      lastErrorCode: null,
      name: user.name ? `${user.name} 的飞书` : `飞书租户 ${user.tenantKey}`,
      refreshTokenEncrypted: encryptFeishuCredential(token.refreshToken, key),
      refreshTokenExpiresAt: token.refreshTokenExpiresAt ?? null,
      scopes: token.scopes.map((scope) => ({ scope })),
      status: 'connected' as const,
      tableId: provisioned.tableId,
      tenantKey: user.tenantKey,
    }
    const connection = existingConnection
      ? await payload.update({
          collection: 'feishu-connections',
          data: connectionData,
          id: existingConnection.id,
          overrideAccess: true,
        })
      : await payload.create({
          collection: 'feishu-connections',
          data: connectionData,
          overrideAccess: true,
        })

    const mappings = await payload.find({
      collection: 'feishu-mappings',
      depth: 0,
      limit: 2,
      overrideAccess: true,
      where: {
        or: [{ key: { equals: 'primary-leads' } }, { status: { equals: 'active' } }],
      },
    })
    const mappingData = {
      appToken: provisioned.appToken,
      connection: connection.id,
      fieldMappings: DEFAULT_FEISHU_FIELD_MAPPINGS.map((field) => ({ ...field })),
      name: '飞书 CRM 主客户表',
      notificationRecipients: [
        {
          enabled: true,
          label: user.name ?? '飞书安装管理员',
          receiveId: user.openId,
          receiveIdType: 'open_id' as const,
        },
      ],
      status: 'active' as const,
      tableId: provisioned.tableId,
    }
    const targetMapping =
      mappings.docs.find((mapping) => mapping.key === 'primary-leads') ?? mappings.docs[0]
    for (const mapping of mappings.docs) {
      if (mapping.id !== targetMapping?.id && mapping.status === 'active') {
        await payload.update({
          collection: 'feishu-mappings',
          data: { status: 'disabled' },
          id: mapping.id,
          overrideAccess: true,
        })
      }
    }
    if (targetMapping) {
      await payload.update({
        collection: 'feishu-mappings',
        data: mappingData,
        id: targetMapping.id,
        overrideAccess: true,
      })
    } else {
      await payload.create({
        collection: 'feishu-mappings',
        data: { ...mappingData, key: 'primary-leads' },
        overrideAccess: true,
      })
    }
    return redirect(request, 'connected')
  } catch {
    return redirect(request, 'failed')
  }
}
