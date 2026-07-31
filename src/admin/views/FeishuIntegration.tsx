import Link from 'next/link'

import type { AdminViewServerProps } from 'payload'
import { Gutter } from '@payloadcms/ui'

import { getRoleUser } from '@/access/roles'
import { canDecryptFeishuCredential } from '@/modules/feishu/credentials'

export default async function FeishuIntegration({ initPageResult }: AdminViewServerProps) {
  const { req } = initPageResult
  const user = getRoleUser(req.user)
  if (user?.role !== 'admin') {
    return (
      <Gutter>
        <h1>飞书 CRM</h1>
        <p>只有管理员可以管理飞书连接。</p>
      </Gutter>
    )
  }

  const connections = await req.payload.find({
    collection: 'feishu-connections',
    depth: 0,
    overrideAccess: true,
    pagination: false,
    sort: '-updatedAt',
  })
  const connection = connections.docs[0]
  const usable = connection
    ? canDecryptFeishuCredential(connection.accessTokenEncrypted) &&
      canDecryptFeishuCredential(connection.refreshTokenEncrypted)
    : false

  return (
    <Gutter>
      <div className="ops-dashboard">
        <header className="ops-dashboard__header">
          <div>
            <p className="ops-dashboard__eyebrow">免费飞书租户可用</p>
            <h1>飞书 CRM</h1>
            <p>管理员授权一次，系统会自动创建客户多维表格并开始同步线索。</p>
          </div>
        </header>

        <section className="ops-dashboard__section">
          <h2>连接状态</h2>
          {connection ? (
            <div>
              <p>
                {connection.name}：{connection.status}
                {usable ? '（凭据可用）' : '（需要重新授权）'}
              </p>
              {connection.baseURL ? (
                <p>
                  <a href={connection.baseURL} rel="noreferrer" target="_blank">
                    打开飞书客户表
                  </a>
                </p>
              ) : null}
            </div>
          ) : (
            <p>尚未连接飞书。</p>
          )}
          <p>
            <Link href="/api/integrations/feishu/connect" prefetch={false}>
              {connection ? '重新连接飞书' : '连接飞书'}
            </Link>
          </p>
          <p>不会启用仅企业版支持的行列级高级权限；手动 App ID/Secret 模式保留为运维兜底。</p>
        </section>
      </div>
    </Gutter>
  )
}
