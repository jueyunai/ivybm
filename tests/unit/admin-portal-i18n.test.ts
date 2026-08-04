import { describe, expect, it } from 'vitest'

import { PORTAL_EN } from '@/admin-portal/core/i18n/en'
import { PORTAL_ZH } from '@/admin-portal/core/i18n/zh'
import { PORTAL_MODULES } from '@/admin-portal/core/modules/registry'

describe('Portal i18n contract', () => {
  it('keeps English and Chinese key shapes identical', () => {
    expect(Object.keys(PORTAL_EN.modules).sort()).toEqual(Object.keys(PORTAL_ZH.modules).sort())
    expect(Object.keys(PORTAL_EN.navGroups).sort()).toEqual(
      Object.keys(PORTAL_ZH.navGroups).sort(),
    )
    expect(Object.keys(PORTAL_EN.states).sort()).toEqual(Object.keys(PORTAL_ZH.states).sort())
    expect(Object.keys(PORTAL_EN.nextSteps).sort()).toEqual(
      Object.keys(PORTAL_ZH.nextSteps).sort(),
    )

    for (const dictionary of [PORTAL_EN, PORTAL_ZH]) {
      for (const group of [
        dictionary.modules,
        dictionary.navGroups,
        dictionary.states,
        dictionary.nextSteps,
      ]) {
        expect(Object.values(group).every((value) => value.trim() !== '')).toBe(true)
      }
    }
  })

  it('provides a non-empty label for every registered module', () => {
    for (const portalModule of PORTAL_MODULES) {
      expect(PORTAL_ZH.modules[portalModule.labelKey]).toEqual(expect.any(String))
      expect(PORTAL_EN.modules[portalModule.labelKey]).toEqual(expect.any(String))
      expect(PORTAL_ZH.modules[portalModule.labelKey].trim()).not.toBe('')
      expect(PORTAL_EN.modules[portalModule.labelKey].trim()).not.toBe('')
      expect(PORTAL_ZH.nextSteps[portalModule.maintenance.nextStepKey].trim()).not.toBe('')
      expect(PORTAL_EN.nextSteps[portalModule.maintenance.nextStepKey].trim()).not.toBe('')
    }
  })
})
