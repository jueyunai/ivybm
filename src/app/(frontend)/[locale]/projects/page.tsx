import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'

import { ProjectCard } from '@/components/website/Cards'
import { PageHero } from '@/components/website/PageHero'
import { getWebsiteCopy, isPublicLocale, type Locale } from '@/lib/i18n'
import { buildPageMetadata } from '@/lib/seo'
import { getProjects, getSiteSettings } from '@/lib/website-data'

// Keep public project indexes at the edge while CMS hooks invalidate them on publish.
export const dynamic = 'force-static'
export const revalidate = 60

const loadProjects = async (locale: Locale) => {
  const [projects, settings] = await Promise.all([getProjects(locale), getSiteSettings(locale)])
  return { projects, settings }
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: value } = await params
  if (!isPublicLocale(value)) return {}
  const { projects, settings } = await loadProjects(value)
  const copy = getWebsiteCopy(value)
  return buildPageMetadata({ description: copy.pages.projectsSubtitle, locale: value, media: projects[0]?.coverImage, path: '/projects', seo: settings.defaultSeo, siteName: settings.siteName, title: copy.navigation.projects })
}

export default async function ProjectsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: value } = await params
  if (!isPublicLocale(value)) notFound()
  const { projects } = await loadProjects(value)
  const copy = getWebsiteCopy(value)
  return (
    <>
      <PageHero image={projects[0]?.coverImage} subtitle={copy.pages.projectsSubtitle} title={copy.navigation.projects} />
      <section className="section"><div className="container"><div className="tabs"><span className="tab static-active">{copy.tabs.allProjects}</span></div><div className="grid cols-3">{projects.map((project) => <ProjectCard key={project.id} locale={value} project={project} />)}</div></div></section>
    </>
  )
}
