import type { AdminViewServerProps } from 'payload'
import { Gutter } from '@payloadcms/ui'

import { getRoleUser } from '@/access/roles'

import { PlatformOperationsClient } from './PlatformOperationsClient'

export default function PlatformOperations({ initPageResult }: AdminViewServerProps) {
  const user = getRoleUser(initPageResult.req.user)
  const language = initPageResult.req.i18n.language === 'en' ? 'en' : 'zh'

  if (!user || user.role !== 'admin') {
    return (
      <Gutter>
        <section className="platform-ops-access" role="alert">
          <h1>{language === 'en' ? 'Platform operations' : '平台联调中心'}</h1>
          <p>
            {language === 'en' ? 'Administrator access is required.' : '此页面仅允许管理员访问。'}
          </p>
        </section>
      </Gutter>
    )
  }

  return (
    <Gutter>
      <PlatformOperationsClient language={language} />
    </Gutter>
  )
}
