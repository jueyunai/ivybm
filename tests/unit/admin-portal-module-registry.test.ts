import { describe, expect, it } from 'vitest'

import { definePortalModule } from '@/admin-portal/core/modules/definePortalModule'
import { getPortalFeatureState } from '@/admin-portal/core/modules/getPortalFeatureState'
import { getVisiblePortalModules } from '@/admin-portal/core/modules/getVisiblePortalModules'
import { PORTAL_MODULES, validatePortalModuleRegistry } from '@/admin-portal/core/modules/registry'

describe('Portal module registry', () => {
  it('keeps ids and hrefs unique and validates the static contract', () => {
    expect(() => validatePortalModuleRegistry(PORTAL_MODULES)).not.toThrow()
    expect(Object.isFrozen(PORTAL_MODULES)).toBe(true)
    expect(PORTAL_MODULES.every((portalModule) => Object.isFrozen(portalModule))).toBe(true)
    expect(new Set(PORTAL_MODULES.map((module) => module.id)).size).toBe(PORTAL_MODULES.length)
    expect(new Set(PORTAL_MODULES.map((module) => module.href)).size).toBe(PORTAL_MODULES.length)

    expect(() =>
      validatePortalModuleRegistry([...PORTAL_MODULES, { ...PORTAL_MODULES[0] }]),
    ).toThrow(/duplicate module id/i)

    expect(() =>
      definePortalModule({
        id: 'example',
        owner: 'jueyunai',
        navGroup: 'workspace',
        href: '/dashboard/example',
        labelKey: 'example',
        allowedRoles: ['admin'],
        availability: 'available',
        featureFlag: 'ADMIN_PORTAL_EXAMPLE_ENABLED',
        commands: ['conversations:reply'],
        maintenance: { responsibleOwner: 'jueyunai', nextStepKey: 'example' },
      }),
    ).toThrow(/owned by another module/i)
  })

  it('uses explicit ownership, availability, flags, and maintenance metadata', () => {
    const owners = new Set(['jueyunai', 'xuemusi'])
    const availability = new Set(['available', 'dependency-gated', 'blocked', 'admin-only'])

    for (const portalModule of PORTAL_MODULES) {
      expect(owners.has(portalModule.owner)).toBe(true)
      expect(availability.has(portalModule.availability)).toBe(true)
      expect(portalModule.featureFlag).toMatch(/^ADMIN_PORTAL_[A-Z0-9_]+_ENABLED$/)
      expect(portalModule.maintenance.responsibleOwner).toBe(portalModule.owner)
      expect(portalModule.maintenance.nextStepKey.trim()).not.toBe('')

      if (new Set<string>(['dependency-gated', 'blocked']).has(portalModule.availability)) {
        expect(portalModule.commands).toEqual([])
      }

      if (portalModule.availability === 'admin-only') {
        expect(portalModule.allowedRoles).toEqual(['admin'])
      }
    }
  })

  it('filters modules by role without exposing unavailable commands', () => {
    const flags = Object.fromEntries(
      PORTAL_MODULES.flatMap((module) =>
        module.featureFlag ? [[module.featureFlag, 'true']] : [],
      ),
    )

    const adminModules = getVisiblePortalModules({
      env: { ADMIN_PORTAL_ENABLED: 'true', ...flags },
      role: 'admin',
    })
    const salesModules = getVisiblePortalModules({
      env: { ADMIN_PORTAL_ENABLED: 'true', ...flags },
      role: 'sales',
    })

    expect(adminModules.map((module) => module.id)).toContain('platforms')
    expect(salesModules.map((module) => module.id)).not.toContain('platforms')
    expect(salesModules.map((module) => module.id)).not.toContain('knowledge')
    expect(
      adminModules
        .filter(
          (module) =>
            module.availability === 'dependency-gated' || module.availability === 'blocked',
        )
        .every((module) => module.commands.length === 0),
    ).toBe(true)
  })

  it('fails closed when the Portal or module flag is missing', () => {
    const globalDisabled = getPortalFeatureState({
      env: { ADMIN_PORTAL_OVERVIEW_ENABLED: 'true' },
      module: PORTAL_MODULES.find((module) => module.id === 'overview')!,
    })
    const moduleDisabled = getPortalFeatureState({
      env: { ADMIN_PORTAL_ENABLED: 'true' },
      module: PORTAL_MODULES.find((module) => module.id === 'overview')!,
    })

    expect(globalDisabled).toMatchObject({ enabled: false, reason: 'portal-disabled' })
    expect(moduleDisabled).toMatchObject({ enabled: false, reason: 'module-disabled' })

    const explicitlyDisabled = getPortalFeatureState({
      env: { ADMIN_PORTAL_ENABLED: 'true', ADMIN_PORTAL_OVERVIEW_ENABLED: 'false' },
      module: PORTAL_MODULES.find((module) => module.id === 'overview')!,
    })
    expect(explicitlyDisabled).toMatchObject({ enabled: false, reason: 'module-disabled' })

    for (const value of ['TRUE', '1', ' true ']) {
      expect(
        getPortalFeatureState({
          env: { ADMIN_PORTAL_ENABLED: 'true', ADMIN_PORTAL_OVERVIEW_ENABLED: value },
          module: PORTAL_MODULES.find((portalModule) => portalModule.id === 'overview')!,
        }),
      ).toMatchObject({ enabled: false, reason: 'module-disabled' })
    }
  })

  it('keeps all ten Portal modules inside Portal state handling', () => {
    const flags = Object.fromEntries(
      PORTAL_MODULES.flatMap((module) =>
        module.featureFlag ? [[module.featureFlag, 'true']] : [],
      ),
    )
    const modules = getVisiblePortalModules({
      env: { ADMIN_PORTAL_ENABLED: 'true', ...flags },
      role: 'admin',
    })

    expect(modules.every((module) => module.href.startsWith('/dashboard'))).toBe(true)
    expect(JSON.stringify(modules)).not.toContain('/admin')
    expect(modules).toHaveLength(10)
    expect(modules.find((module) => module.id === 'content-studio')).toMatchObject({
      availability: 'available',
      commands: expect.arrayContaining(['content-studio:create', 'content-studio:schedule']),
      owner: 'jueyunai',
    })
    expect(modules.find((module) => module.id === 'platforms')).toMatchObject({
      canNavigate: true,
      owner: 'xuemusi',
    })
    expect(modules.find((module) => module.id === 'operations')).toMatchObject({
      commands: ['operations:retry'],
      owner: 'jueyunai',
    })

    const disabledModules = getVisiblePortalModules({
      env: { ADMIN_PORTAL_ENABLED: 'true' },
      role: 'admin',
    })
    expect(disabledModules.find((module) => module.id === 'overview')).toMatchObject({
      canNavigate: false,
      commands: [],
      featureState: { enabled: false, reason: 'module-disabled' },
    })

    const globalDisabledModules = getVisiblePortalModules({ env: {}, role: 'admin' })
    expect(
      globalDisabledModules.every(
        (portalModule) =>
          !portalModule.canNavigate &&
          portalModule.commands.length === 0 &&
          portalModule.featureState.reason === 'portal-disabled',
      ),
    ).toBe(true)

    const blockedModule = definePortalModule({
      id: 'blocked-example',
      owner: 'xuemusi',
      navGroup: 'intelligence',
      href: '/dashboard/blocked-example',
      labelKey: 'blocked-example',
      allowedRoles: ['admin'],
      availability: 'blocked',
      featureFlag: 'ADMIN_PORTAL_BLOCKED_EXAMPLE_ENABLED',
      commands: [],
      maintenance: { responsibleOwner: 'xuemusi', nextStepKey: 'blocked-example' },
    })
    expect(
      getPortalFeatureState({
        env: {
          ADMIN_PORTAL_ENABLED: 'true',
          ADMIN_PORTAL_BLOCKED_EXAMPLE_ENABLED: 'true',
        },
        module: blockedModule,
      }),
    ).toEqual({ enabled: false, reason: 'blocked' })
  })
})
