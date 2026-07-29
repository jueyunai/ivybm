import type { ReactNode } from 'react'
import { headers } from 'next/headers'

import { getPortalRequestPath } from '@/admin-portal/core/auth/portalRequestPath'
import { requirePortalUser } from '@/admin-portal/core/auth/requirePortalUser'
import { resolvePortalAvailability } from '@/admin-portal/core/modules/resolvePortalAvailability'
import { PortalShell } from '@/admin-portal/core/navigation/PortalShell'

export default async function ProtectedPortalLayout({ children }: { children: ReactNode }) {
  const user = await requirePortalUser({ returnTo: getPortalRequestPath(await headers()) })
  const availability = resolvePortalAvailability({ env: process.env, role: user.role })

  return (
    <PortalShell
      availability={availability}
      environment={process.env.NODE_ENV === 'production' ? 'production' : 'local'}
      user={user}
    >
      {children}
    </PortalShell>
  )
}
