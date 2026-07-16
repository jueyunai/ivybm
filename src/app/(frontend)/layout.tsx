import React from 'react'

import { DEFAULT_LOCALE } from '@/lib/health'

import './styles.css'

export const metadata = {
  description: 'IVYBM building materials export website and AI lead generation platform.',
  title: 'IVYBM',
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang={DEFAULT_LOCALE}>
      <body>
        <main>{children}</main>
      </body>
    </html>
  )
}
