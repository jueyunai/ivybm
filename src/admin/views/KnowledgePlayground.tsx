import type { AdminViewServerProps } from 'payload'
import { Gutter } from '@payloadcms/ui'

import { getRoleUser } from '@/access/roles'

import KnowledgePlaygroundClient from '../components/KnowledgePlaygroundClient'
import { getAdminCopy } from '../i18n'

export default function KnowledgePlayground({ initPageResult }: AdminViewServerProps) {
  const user = getRoleUser(initPageResult.req.user)
  const copy = getAdminCopy(initPageResult.req.i18n.language).knowledge

  if (!user || (user.role !== 'admin' && user.role !== 'operator')) {
    return (
      <Gutter className="ops-knowledge-playground">
        <section className="ops-dashboard__access-denied" role="alert">
          <h1>{copy.playgroundTitle}</h1>
          <p>{copy.accessDenied}</p>
        </section>
      </Gutter>
    )
  }

  return (
    <Gutter>
      <main className="ops-knowledge-playground" data-testid="knowledge-playground">
        <header>
          <p className="ops-dashboard__eyebrow">{copy.playgroundEyebrow}</p>
          <h1>{copy.playgroundTitle}</h1>
          <p>{copy.playgroundDescription}</p>
        </header>
        <KnowledgePlaygroundClient />
      </main>
    </Gutter>
  )
}
