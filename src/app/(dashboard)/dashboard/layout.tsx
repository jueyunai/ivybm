import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import '@/admin-portal/core/styles/portal.css'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: { default: 'IVYBM 运营后台', template: '%s · IVYBM 运营后台' },
}

export default function DashboardRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="portal-body">
        <div className="portal-shell">{children}</div>
      </body>
    </html>
  )
}
