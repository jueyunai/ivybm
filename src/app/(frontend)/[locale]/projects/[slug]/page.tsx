import {
  IconBuildingSkyscraper,
  IconCertificate,
  IconEye,
  IconTools,
} from '@tabler/icons-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'

import { PageHero } from '@/components/website/PageHero'
import { ProductGallery } from '@/components/website/ProductGallery'
import { RichText } from '@/components/website/RichText'
import { isPublicLocale } from '@/lib/i18n'
import { normalizeProductGallery } from '@/lib/product-gallery'
import { buildPageMetadata } from '@/lib/seo'
import { getProjectBySlug, getSiteSettings } from '@/lib/website-data'
import type { Project } from '@/payload-types'

// Project detail pages use the same ISR window as the public project index.
export const dynamic = 'force-static'
export const revalidate = 60

type ProjectV17Fields = Project & {
  observedFocus?: string | Record<string, unknown> | null
  projectSnapshot?: string | Record<string, unknown> | null
  qualityVerification?: string | Record<string, unknown> | null
  solutionFramework?: string | Record<string, unknown> | null
}

const loadProject = async (locale: 'ar' | 'en', slug: string) => {
  const [project, settings] = await Promise.all([
    getProjectBySlug(locale, slug),
    getSiteSettings(locale),
  ])
  return { project: project as ProjectV17Fields | null, settings }
}

function RenderContentField({ data }: { data: unknown }) {
  if (!data) return null
  if (typeof data === 'string' && data.trim()) {
    return <p className="muted pre-line">{data}</p>
  }
  if (typeof data === 'object' && 'root' in (data as Record<string, unknown>)) {
    return <RichText data={data as Record<string, unknown>} />
  }
  return null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}): Promise<Metadata> {
  const { locale, slug } = await params
  if (!isPublicLocale(locale)) return {}
  const { project, settings } = await loadProject(locale, slug)
  if (!project) notFound()

  return buildPageMetadata({
    description: project.summary,
    locale,
    media: project.coverImage,
    path: `/projects/${slug}`,
    seo: project.seo,
    siteName: settings.siteName,
    title: project.title,
  })
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale, slug } = await params
  if (!isPublicLocale(locale)) notFound()
  const { project } = await loadProject(locale, slug)
  if (!project) notFound()

  const gallery = normalizeProductGallery(project.coverImage, project.gallery)

  // 4D Case Study dimension checks
  const hasSnapshot = Boolean(project.projectSnapshot)
  const hasObservedFocus = Boolean(project.observedFocus)
  const hasSolution = Boolean(project.solutionFramework)
  const hasQuality = Boolean(project.qualityVerification)
  const has4DCaseStudy = hasSnapshot || hasObservedFocus || hasSolution || hasQuality

  const labels =
    locale === 'ar'
      ? {
          fourDimensionsTitle: 'دراسة حالة المشروع رباعية الأبعاد',
          observedFocus: 'تركيز التصميم والتحديات',
          projectSnapshot: 'نظرة عامة على المشروع والمواصفات',
          qualityVerification: 'الجودة وفحص التسليم',
          solutionFramework: 'حلول التصنيع والتعميق الهندسي',
        }
      : {
          fourDimensionsTitle: '4-Dimensional Project Case Study',
          observedFocus: 'Design Challenges & Observed Focus',
          projectSnapshot: 'Project Snapshot & Specifications',
          qualityVerification: 'Quality Verification & Inspection',
          solutionFramework: 'Fabrication Solutions & Deepening',
        }

  return (
    <>
      <PageHero image={project.coverImage} subtitle={project.summary} title={project.title} />
      <section className="section">
        <div className="container detail-grid">
          <div className="detail-media">
            <ProductGallery images={gallery} locale={locale} productTitle={project.title} />
          </div>
          <div>
            <h2>{project.title}</h2>
            <p className="muted pre-line">
              {[project.location, project.application].filter(Boolean).join('\n')}
            </p>
            {project.description ? <RichText data={project.description} /> : null}
          </div>
        </div>

        {/* 4D Case Study section (renders if any 4D fields are present) */}
        {has4DCaseStudy ? (
          <div className="container mt-12">
            <div className="section-kicker">Case Study</div>
            <h2>{labels.fourDimensionsTitle}</h2>
            <div className="case-study-4d">
              {hasSnapshot ? (
                <article className="case-dimension-card">
                  <div className="case-dimension-header">
                    <span className="case-dimension-badge">01</span>
                    <IconBuildingSkyscraper aria-hidden className="text-blue" size={24} />
                    <h3>{labels.projectSnapshot}</h3>
                  </div>
                  <RenderContentField data={project.projectSnapshot} />
                </article>
              ) : null}

              {hasObservedFocus ? (
                <article className="case-dimension-card">
                  <div className="case-dimension-header">
                    <span className="case-dimension-badge">02</span>
                    <IconEye aria-hidden className="text-blue" size={24} />
                    <h3>{labels.observedFocus}</h3>
                  </div>
                  <RenderContentField data={project.observedFocus} />
                </article>
              ) : null}

              {hasSolution ? (
                <article className="case-dimension-card">
                  <div className="case-dimension-header">
                    <span className="case-dimension-badge">03</span>
                    <IconTools aria-hidden className="text-blue" size={24} />
                    <h3>{labels.solutionFramework}</h3>
                  </div>
                  <RenderContentField data={project.solutionFramework} />
                </article>
              ) : null}

              {hasQuality ? (
                <article className="case-dimension-card">
                  <div className="case-dimension-header">
                    <span className="case-dimension-badge">04</span>
                    <IconCertificate aria-hidden className="text-blue" size={24} />
                    <h3>{labels.qualityVerification}</h3>
                  </div>
                  <RenderContentField data={project.qualityVerification} />
                </article>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </>
  )
}
