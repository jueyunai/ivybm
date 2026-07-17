import packageJson from '../../package.json'
import { describe, expect, it } from 'vitest'

import { DEFAULT_LOCALE, getHealth } from '@/lib/health'

describe('application foundation', () => {
  it('uses the IVYBM project identity', () => {
    expect(packageJson.name).toBe('ivybm')
  })

  it('defaults public content to English', () => {
    expect(DEFAULT_LOCALE).toBe('en')
  })

  it('reports a healthy application with its version', () => {
    expect(getHealth()).toEqual({
      name: 'ivybm',
      status: 'ok',
      version: packageJson.version,
    })
  })
})
