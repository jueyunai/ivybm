import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const readProjectSource = (relativePath: string) =>
  readFileSync(path.join(process.cwd(), relativePath), 'utf8')

describe('project page cache configuration', () => {
  it('uses ISR for the public project index and detail routes', () => {
    const indexPage = readProjectSource('src/app/(frontend)/[locale]/projects/page.tsx')
    const detailPage = readProjectSource('src/app/(frontend)/[locale]/projects/[slug]/page.tsx')
    const websiteLayout = readProjectSource('src/app/(frontend)/[locale]/layout.tsx')

    for (const source of [indexPage, detailPage]) {
      expect(source).toContain("export const dynamic = 'force-static'")
      expect(source).toContain('export const revalidate = 60')
    }

    expect(websiteLayout).not.toContain("export const dynamic = 'force-dynamic'")
  })

  it('sets the native ISR stale window used for shared-cache responses', () => {
    const config = readProjectSource('next.config.ts')

    expect(config).toContain('expireTime: 360')
  })

  it('describes project card image slots at every grid breakpoint', () => {
    const cards = readProjectSource('src/components/website/Cards.tsx')

    expect(cards).toContain('const projectCardImageSizes')
    expect(cards).toContain('(max-width: 640px) calc(100vw - 32px)')
    expect(cards).toContain('(max-width: 920px) calc(50vw - 27px)')
    expect(cards).toContain('sizes={projectCardImageSizes}')
  })
})
