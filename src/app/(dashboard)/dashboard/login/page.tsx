import { redirect } from 'next/navigation'

import { PortalLoginShowcase } from '@/admin-portal/core/auth/PortalLoginShowcase'
import { getPortalSession } from '@/admin-portal/core/auth/getPortalSession'
import { safePortalReturnTo } from '@/admin-portal/core/auth/safeReturnTo'

type LoginPageProps = {
  searchParams: Promise<{ returnTo?: string | string[] }>
}

export default async function PortalLoginPage({ searchParams }: LoginPageProps) {
  const { returnTo: rawReturnTo } = await searchParams
  const returnTo = safePortalReturnTo(Array.isArray(rawReturnTo) ? rawReturnTo[0] : rawReturnTo)
  const user = await getPortalSession()
  if (user) {
    redirect(returnTo)
  }

  return (
    <main className="portal-login-root" style={{ minHeight: '100vh', width: '100%' }}>
      <PortalLoginShowcase returnTo={returnTo} />
    </main>
  )
}
