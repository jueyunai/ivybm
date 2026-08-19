import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  e2eSpecPaths,
  manifestSpecCoverage,
  resolveE2ESuitePlan,
} from '../../scripts/e2e/suite-manifest.mjs'

const projectRoot = resolve(import.meta.dirname, '../..')

describe('E2E suite manifest', () => {
  it('classifies every spec exactly once at the safety boundary', () => {
    const actualSpecs = readdirSync(resolve(projectRoot, 'tests/e2e'))
      .filter((file) => file.endsWith('.spec.ts'))
      .map((file) => `tests/e2e/${file}`)
      .sort()

    expect([...e2eSpecPaths].sort()).toEqual(actualSpecs)
    expect(manifestSpecCoverage()).toEqual({ duplicate: [], extra: [], missing: [] })
  })

  it('requires every mutation spec to import the launcher guard', () => {
    for (const spec of e2eSpecPaths.filter((path) => !path.endsWith('website-visual.spec.ts'))) {
      expect(readFileSync(resolve(projectRoot, spec), 'utf8')).toContain(
        "import './require-mutation-launch'",
      )
    }
  })

  it('resolves explicit suite IDs without accepting Playwright selectors', () => {
    const plan = resolveE2ESuitePlan(['website', 'chat'])
    expect(plan.mode).toBe('mutation')
    expect(plan.specs).toEqual([
      'tests/e2e/website.spec.ts',
      'tests/e2e/chat-handoff.spec.ts',
      'tests/e2e/website-chat-real.spec.ts',
    ])
    expect(plan.planDigest).toMatch(/^[a-f0-9]{64}$/u)

    expect(() => resolveE2ESuitePlan(['--output', 'readonly-visual'])).toThrow('suite IDs only')
    expect(() => resolveE2ESuitePlan(['tests/e2e/website.spec.ts'])).toThrow('Unknown E2E suite ID')
    expect(() => resolveE2ESuitePlan(['.*|/website-visual.spec.ts'])).toThrow(
      'Unknown E2E suite ID',
    )
  })

  it('keeps the external visual suite isolated and makes full mode mutation-safe', () => {
    expect(resolveE2ESuitePlan(['readonly-visual'])).toMatchObject({
      mode: 'readonly-external',
      specs: ['tests/e2e/website-visual.spec.ts'],
    })
    expect(() => resolveE2ESuitePlan(['readonly-visual', 'website'])).toThrow('cannot be mixed')

    const full = resolveE2ESuitePlan([])
    expect(full.mode).toBe('mutation')
    expect(full.specs).toHaveLength(e2eSpecPaths.length)
  })
})
