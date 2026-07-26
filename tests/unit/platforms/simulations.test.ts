import { describe, expect, it, vi } from 'vitest'

import {
  isPlatformSimulationId,
  PLATFORM_SIMULATION_IDS,
} from '@/modules/platforms/simulationCatalog'
import { runPlatformSimulation } from '@/modules/platforms/simulations'

describe('credential-free platform simulations', () => {
  it('runs every catalog scenario without network access or sensitive output', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('Network access is forbidden in platform simulations')
    })
    vi.stubGlobal('fetch', fetchSpy)

    try {
      const results = await Promise.all(PLATFORM_SIMULATION_IDS.map(runPlatformSimulation))

      expect(results.map(({ id }) => id)).toEqual(PLATFORM_SIMULATION_IDS)
      expect(results.every(({ steps, summary }) => steps.length > 0 && summary.zh.length > 0)).toBe(
        true,
      )
      expect(results.find(({ id }) => id === 'tiktok-signature')).toMatchObject({
        status: 'blocked',
        steps: expect.arrayContaining([expect.objectContaining({ status: 'blocked' })]),
      })
      expect(results.find(({ id }) => id === 'unknown-outcome-recovery')).toMatchObject({
        status: 'passed',
        steps: expect.arrayContaining([
          expect.objectContaining({
            detail: { en: 'delivery_unknown', zh: 'delivery_unknown' },
          }),
        ]),
      })

      const serialized = JSON.stringify(results)
      expect(serialized).not.toMatch(/access[_ -]?token|authorization: bearer|fixture-secret/i)
      expect(serialized).not.toContain('local-fixture-secret')
      expect(serialized).not.toContain('signature=fixture-secret')
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('accepts only the frozen simulation identifiers', () => {
    for (const id of PLATFORM_SIMULATION_IDS) expect(isPlatformSimulationId(id)).toBe(true)
    for (const value of [null, '', 'real-platform-call', 'tiktok-dm-fixture', 13, {}]) {
      expect(isPlatformSimulationId(value)).toBe(false)
    }
  })
})
