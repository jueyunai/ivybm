import { IconArrowRight } from '@tabler/icons-react'
import Link from 'next/link'
import React from 'react'

import { getPostCategoryLabel, getWebsiteCopy, localePath, type Locale } from '@/lib/i18n'
import type { Post, Product, Project } from '@/payload-types'

import { WebsiteImage } from './WebsiteImage'

export function ProductCard({
  locale,
  product,
  showSpecs = false,
}: {
  locale: Locale
  product: Product
  showSpecs?: boolean
}) {
  const copy = getWebsiteCopy(locale)

  return (
    <article className="content-card product-card" data-testid="product-card">
      <Link href={localePath(locale, `/products/${product.slug}`)}>
        <WebsiteImage
          className="card-image product-card-image"
          media={product.coverImage}
          sizes="(max-width: 640px) 100vw, 33vw"
          type="card"
        />
      </Link>
      <div className="card-body">
        <h3>
          <Link href={localePath(locale, `/products/${product.slug}`)}>{product.title}</Link>
        </h3>
        {product.shortDescription ? <p className="muted">{product.shortDescription}</p> : null}
        {showSpecs && product.specifications?.length ? (
          <SpecificationTable rows={product.specifications} />
        ) : null}
        <Link className="text-link" href={localePath(locale, `/products/${product.slug}`)}>
          {copy.actions.learnMore}
          <IconArrowRight aria-hidden size={17} />
        </Link>
      </div>
    </article>
  )
}

export function SpecificationTable({
  caption,
  rows,
}: {
  caption?: string
  rows: { label: string; value: string }[]
}) {
  return (
    <table className="spec-table">
      {caption ? <caption>{caption}</caption> : null}
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.label || 'specification'}-${row.value || 'value'}-${index}`}>
            <th scope="row">{row.label}</th>
            <td>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function ComparisonTable({
  caption,
  headers,
  rows,
}: {
  caption: string
  headers: [string, string]
  rows: Array<[string, string]>
}) {
  return (
    <div className="comparison-table-wrap">
      <table className="spec-table comparison-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([first, second]) => (
            <tr key={`${first}-${second}`}>
              <td>{first}</td>
              <td>{second}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ProjectCard({ locale, project }: { locale: Locale; project: Project }) {
  const copy = getWebsiteCopy(locale)

  return (
    <article className="content-card">
      <Link href={localePath(locale, `/projects/${project.slug}`)}>
        <WebsiteImage
          className="card-image"
          media={project.coverImage}
          sizes="(max-width: 640px) 100vw, 33vw"
          type="card"
        />
      </Link>
      <div className="card-body">
        <h3>
          <Link href={localePath(locale, `/projects/${project.slug}`)}>{project.title}</Link>
        </h3>
        {project.location || project.application ? (
          <p className="muted pre-line">
            {[project.location, project.application].filter(Boolean).join('\n')}
          </p>
        ) : null}
        {project.summary ? <p className="muted">{project.summary}</p> : null}
        <Link className="text-link" href={localePath(locale, `/projects/${project.slug}`)}>
          {copy.actions.viewCase}
          <IconArrowRight aria-hidden size={17} />
        </Link>
      </div>
    </article>
  )
}

export function PostCard({ locale, post }: { locale: Locale; post: Post }) {
  const copy = getWebsiteCopy(locale)
  const categoryLabel = getPostCategoryLabel(locale, post.category)

  return (
    <article className="content-card">
      <Link href={localePath(locale, `/news/${post.slug}`)}>
        <WebsiteImage
          className="card-image"
          media={post.featuredImage}
          sizes="(max-width: 640px) 100vw, 33vw"
          type="card"
        />
      </Link>
      <div className="card-body">
        <p className="section-kicker">
          {categoryLabel}
          {post.publishedAt
            ? ` · ${new Intl.DateTimeFormat(locale).format(new Date(post.publishedAt))}`
            : ''}
        </p>
        <h3>
          <Link href={localePath(locale, `/news/${post.slug}`)}>{post.title}</Link>
        </h3>
        {post.excerpt ? <p className="muted">{post.excerpt}</p> : null}
        <Link className="text-link" href={localePath(locale, `/news/${post.slug}`)}>
          {copy.actions.readMore}
          <IconArrowRight aria-hidden size={17} />
        </Link>
      </div>
    </article>
  )
}
