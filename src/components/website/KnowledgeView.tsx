import Link from 'next/link'
import React from 'react'

import { KnowledgeCard } from '@/components/website/Cards'
import { PageHero } from '@/components/website/PageHero'
import { SectionHeader } from '@/components/website/SectionHeader'
import { localePath, type Locale } from '@/lib/i18n'
import { getWebsiteV17Copy } from '@/lib/website-i18n'
import type { Post } from '@/payload-types'

export function KnowledgeView({
  locale,
  posts,
}: {
  locale: Locale
  posts: Post[]
}) {
  const copy = getWebsiteV17Copy(locale)

  return (
    <>
      <PageHero
        image={posts[0]?.featuredImage}
        subtitle={copy.pages.knowledgeSubtitle}
        title={copy.navigation.knowledge}
      />

      <section className="section">
        <div className="container">
          <div className="tabs">
            <span className="tab static-active">{copy.knowledge.allCategories}</span>
            <span className="tab">{copy.knowledge.categories.materialComparison}</span>
            <span className="tab">{copy.knowledge.categories.technicalGuide}</span>
            <span className="tab">{copy.knowledge.categories.procurement}</span>
            <span className="tab">{copy.knowledge.categories.qualityLogistics}</span>
          </div>

          {posts.length > 0 ? (
            <div className="knowledge-grid">
              {posts.map((post) => (
                <KnowledgeCard key={post.id} locale={locale} post={post} />
              ))}
            </div>
          ) : (
            <p className="muted">{copy.knowledge.noArticles}</p>
          )}
        </div>
      </section>

      <section className="section feature-band">
        <div className="container">
          <SectionHeader
            action={
              <Link className="button" href={localePath(locale, '/contact')}>
                {copy.knowledge.consultButton}
              </Link>
            }
            description={copy.knowledge.consultSubtitle}
            kicker={copy.knowledge.kicker}
            title={copy.knowledge.consultTitle}
          />
        </div>
      </section>
    </>
  )
}
