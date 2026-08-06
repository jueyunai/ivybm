import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  LEGAL_PATHS,
  getLegalDocument,
  type LegalDocumentType,
} from '@/lib/legal'

const source = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), 'utf8')

describe('public legal pages', () => {
  it('provides reviewed English and Arabic documents for every stable Meta URL', () => {
    expect(LEGAL_PATHS).toEqual(['/privacy', '/terms', '/data-deletion'])

    for (const type of ['privacy', 'terms', 'data-deletion'] as LegalDocumentType[]) {
      const english = getLegalDocument('en', type)
      const arabic = getLegalDocument('ar', type)
      expect(english.title).not.toBe(arabic.title)
      expect(english.description.length).toBeGreaterThan(40)
      expect(arabic.description.length).toBeGreaterThan(30)
      expect(english.sections.length).toBeGreaterThanOrEqual(4)
      expect(arabic.sections).toHaveLength(english.sections.length)
      expect(english.effectiveDate).toBe('2026-07-31')
      expect(arabic.effectiveDate).toBe('2026-07-31')
    }
  })

  it('documents social data, deletion requests, retention, and a safe contact path', () => {
    const privacy = JSON.stringify(getLegalDocument('en', 'privacy'))
    const deletion = JSON.stringify(getLegalDocument('en', 'data-deletion'))

    expect(privacy).toContain('Facebook')
    expect(privacy).toContain('Instagram')
    expect(privacy.toLowerCase()).toContain('retention')
    expect(deletion).toContain('Social Data Deletion Request')
    expect(deletion).toContain('password')
    expect(deletion).toContain('access token')
  })

  it('keeps stable root URLs, localized footer links, and sitemap entries', () => {
    for (const [route, target] of [
      ['privacy', '/en/privacy'],
      ['terms', '/en/terms'],
      ['data-deletion', '/en/data-deletion'],
    ]) {
      expect(source(`src/app/(frontend-root)/${route}/page.tsx`)).toContain(
        `permanentRedirect('${target}')`,
      )
    }

    const footer = source('src/components/website/SiteFooter.tsx')
    expect(footer).toContain("['privacy', '/privacy']")
    expect(footer).toContain("['terms', '/terms']")
    expect(footer).toContain("['dataDeletion', '/data-deletion']")
    expect(source('src/app/sitemap.ts')).toContain('LEGAL_PATHS')
  })
})
