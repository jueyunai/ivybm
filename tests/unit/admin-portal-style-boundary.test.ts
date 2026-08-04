import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const projectRoot = process.cwd()
const readProjectFile = (path: string): string => readFileSync(resolve(projectRoot, path), 'utf8')

describe('Portal style boundary', () => {
  it('uses Tailwind utilities without importing Preflight or a global reset', () => {
    const portalStyles = readProjectFile('src/admin-portal/core/styles/portal.css')

    expect(portalStyles).toMatch(/@import ['"]tailwindcss\/theme\.css['"]/)
    expect(portalStyles).toMatch(/@import ['"]tailwindcss\/utilities\.css['"]/)
    expect(portalStyles).toContain('prefix(portal)')
    expect(portalStyles).not.toMatch(/tailwindcss(?:\/|\")preflight/)
    expect(portalStyles).not.toContain('@import "tailwindcss";')
  })

  it('keeps project variables and component styles under the Portal scope', () => {
    const tokenStyles = readProjectFile('src/admin-portal/core/styles/tokens.css')
    const portalStyles = readProjectFile('src/admin-portal/core/styles/portal.css')

    expect(tokenStyles.trimStart().startsWith('.portal-shell {')).toBe(true)
    expect(tokenStyles).not.toMatch(/(^|\n)\s*:root\s*\{/)
    expect(portalStyles).not.toMatch(/(^|\n)\s*(html|body|\*)\s*\{/)
    expect(portalStyles).toContain('.portal-shell')
  })

  it('does not import Portal or Tailwind styles into Payload or website CSS', () => {
    const payloadStyles = readProjectFile('src/app/(payload)/custom.scss')
    const websiteStyles = readProjectFile('src/app/(frontend)/website.css')

    for (const source of [payloadStyles, websiteStyles]) {
      expect(source).not.toMatch(/admin-portal|tailwindcss|portal\.css|tokens\.css/)
    }
  })

  it('configures shadcn source generation for the prefixed Portal directory', () => {
    const components = JSON.parse(readProjectFile('components.json')) as {
      aliases: { ui: string }
      iconLibrary: string
      tailwind: { css: string; prefix: string }
    }

    expect(components.tailwind).toMatchObject({
      css: 'src/admin-portal/core/styles/portal.css',
      prefix: 'portal-',
    })
    expect(components.aliases.ui).toBe('@/admin-portal/core/ui')
    expect(components.iconLibrary).toBe('tabler')
    expect(readProjectFile('postcss.config.mjs')).toContain("'@tailwindcss/postcss': {}")
  })

  it('keeps one accessible focus indicator on website content editor controls', () => {
    const portalStyles = readProjectFile('src/admin-portal/core/styles/portal.css')

    expect(portalStyles).toContain('.portal-shell :focus-visible')
    expect(portalStyles).not.toContain('.portal-content-editor__field input:focus')
  })

  it('keeps one focus indicator on composite login fields', () => {
    const portalStyles = readProjectFile('src/admin-portal/core/styles/portal.css')

    expect(portalStyles).toMatch(/\.portal-field__control:focus-within\s*\{[^}]*box-shadow:/)
    expect(portalStyles).toMatch(
      /\.portal-field__control input:focus-visible\s*\{[^}]*outline: none;[^}]*\}/,
    )
  })
})
