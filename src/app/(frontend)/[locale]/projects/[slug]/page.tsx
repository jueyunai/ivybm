import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'

import { PageHero } from '@/components/website/PageHero'
import { RichText } from '@/components/website/RichText'
import { WebsiteImage } from '@/components/website/WebsiteImage'
import { isPublicLocale } from '@/lib/i18n'
import { buildPageMetadata } from '@/lib/seo'
import { getProjectBySlug, getSiteSettings } from '@/lib/website-data'

const loadProject = async (locale: 'ar' | 'en', slug: string) => {
  const [project, settings] = await Promise.all([getProjectBySlug(locale, slug), getSiteSettings(locale)])
  return { project, settings }
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params
  if (!isPublicLocale(locale)) return {}
  const { project, settings } = await loadProject(locale, slug)
  if (!project) notFound()
  return buildPageMetadata({ description: project.summary, locale, media: project.coverImage, path: `/projects/${slug}`, seo: project.seo, siteName: settings.siteName, title: project.title })
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params
  if (!isPublicLocale(locale)) notFound()
  const { project } = await loadProject(locale, slug)
  if (!project) notFound()
  return <><PageHero image={project.coverImage} subtitle={project.summary} title={project.title} /><section className="section"><div className="container detail-grid"><WebsiteImage className="detail-image" media={project.coverImage} sizes="(max-width: 920px) 100vw, 50vw" type="large" /><div><h2>{project.title}</h2><p className="muted pre-line">{[project.location, project.application].filter(Boolean).join('\n')}</p><RichText data={project.description} /></div></div></section></>
}
