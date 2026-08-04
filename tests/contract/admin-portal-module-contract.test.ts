import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { definePortalModule, resolvePortalModule } from '@/admin-portal/core/modules'
import { ExampleModule } from '@/admin-portal/modules/example/ExampleModule'
import { EXAMPLE_MODULE } from '@/admin-portal/modules/example/manifest'

const projectRoot = process.cwd()

const sourceFilesUnder = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry)
    if (statSync(path).isDirectory()) return sourceFilesUnder(path)
    return /\.[cm]?[jt]sx?$/.test(entry) ? [path] : []
  })

describe('Portal collaborator module contract', () => {
  it('resolves role and feature state before exposing navigation or commands', () => {
    expect(Object.isFrozen(EXAMPLE_MODULE)).toBe(true)
    expect(EXAMPLE_MODULE.commands).toEqual(['example:refresh'])

    expect(
      resolvePortalModule({
        env: { ADMIN_PORTAL_ENABLED: 'true' },
        module: EXAMPLE_MODULE,
        role: 'operator',
      }),
    ).toMatchObject({
      canNavigate: false,
      commands: [],
      featureState: { enabled: false, reason: 'module-disabled' },
    })

    expect(
      resolvePortalModule({
        env: {
          ADMIN_PORTAL_ENABLED: 'true',
          ADMIN_PORTAL_EXAMPLE_ENABLED: 'true',
        },
        module: EXAMPLE_MODULE,
        role: 'operator',
      }),
    ).toMatchObject({
      canNavigate: true,
      commands: ['example:refresh'],
      featureState: { enabled: true, reason: 'available' },
    })

    expect(
      resolvePortalModule({
        env: {
          ADMIN_PORTAL_ENABLED: 'true',
          ADMIN_PORTAL_EXAMPLE_ENABLED: 'true',
        },
        module: EXAMPLE_MODULE,
        role: 'sales',
      }),
    ).toBeNull()
  })

  it('rejects side-effect commands on unavailable manifests', () => {
    expect(() =>
      definePortalModule({
        allowedRoles: ['admin'],
        availability: 'dependency-gated',
        commands: ['unsafe:run'],
        featureFlag: 'ADMIN_PORTAL_UNSAFE_ENABLED',
        href: '/dashboard/unsafe',
        id: 'unsafe',
        labelKey: 'unsafe',
        maintenance: { nextStepKey: 'unsafe', responsibleOwner: 'jueyunai' },
        navGroup: 'system',
        owner: 'jueyunai',
      }),
    ).toThrow(/cannot register commands/i)
  })

  it('renders a data-free example with explicit available and blocked states', () => {
    const available = renderToStaticMarkup(
      React.createElement(ExampleModule, { state: 'available' }),
    )
    const blocked = renderToStaticMarkup(
      React.createElement(ExampleModule, { state: 'dependency-gated' }),
    )

    expect(available).toContain('Example module')
    expect(available).toContain('Portal Core public primitives')
    expect(blocked).toContain('Dependency not ready')
    expect(`${available}${blocked}`).not.toContain('/admin')
  })

  it('keeps business modules from importing another module private implementation', () => {
    const modulesRoot = resolve(projectRoot, 'src/admin-portal/modules')
    const violations = sourceFilesUnder(modulesRoot).flatMap((file) => {
      const ownModule = file.slice(modulesRoot.length + 1).split('/')[0]
      const imports = [
        ...readFileSync(file, 'utf8').matchAll(
          /from\s+['"]@\/admin-portal\/modules\/([^/'"]+)(?:\/[^'"]*)?['"]/g,
        ),
      ]
      return imports
        .filter((match) => match[1] !== ownModule)
        .map((match) => `${file.slice(projectRoot.length + 1)} -> ${match[1]}`)
    })

    expect(violations).toEqual([])
  })

  it('documents the required integration, security, and verification boundaries', () => {
    const guide = readFileSync(
      resolve(projectRoot, 'docs/development/admin-portal-module-guide.md'),
      'utf8',
    )

    for (const requirement of [
      'overrideAccess: false',
      'feature flag',
      'idempotency',
      'dependency-gated',
      'structured log',
      'contract test',
      'never import another business module',
      '/admin',
    ]) {
      expect(guide.toLowerCase()).toContain(requirement.toLowerCase())
    }
  })
})
