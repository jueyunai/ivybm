import { redirect } from 'next/navigation'

import { PortalLoginForm } from '@/admin-portal/core/auth/PortalLoginForm'
import { getPortalSession } from '@/admin-portal/core/auth/getPortalSession'
import { safePortalReturnTo } from '@/admin-portal/core/auth/safeReturnTo'
import { Surface } from '@/admin-portal/core/ui'

type LoginPageProps = {
  searchParams: Promise<{ returnTo?: string | string[] }>
}

export default async function PortalLoginPage({ searchParams }: LoginPageProps) {
  const { returnTo: rawReturnTo } = await searchParams
  const returnTo = safePortalReturnTo(Array.isArray(rawReturnTo) ? rawReturnTo[0] : rawReturnTo)
  const user = await getPortalSession()
  if (user) redirect(returnTo)

  return (
    <main className="portal-login">
      <Surface as="section" className="portal-login__card">
        <div className="portal-login__brand">
          <span aria-hidden="true" className="portal-login__mark">
            IV
          </span>
          <span>
            <strong className="portal-login__brand-name">IVYBM</strong>
            <span className="portal-login__brand-product">AI 获客运营后台</span>
          </span>
        </div>
        <h1 className="portal-login__title">登录后台</h1>
        <p className="portal-login__helper">仅受邀账号可登录，无公开注册入口。</p>
        <PortalLoginForm returnTo={returnTo} />
      </Surface>
    </main>
  )
}
