import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

type PencilVariable = { type: 'color' | 'number' | 'string'; value: number | string }

const projectRoot = process.cwd()
const design = JSON.parse(
  readFileSync(resolve(projectRoot, 'designs/ivybm-admin-portal-digital-lattice.pen'), 'utf8'),
) as { variables: Record<string, PencilVariable> }
const tokenStyles = readFileSync(
  resolve(projectRoot, 'src/admin-portal/core/styles/tokens.css'),
  'utf8',
)

describe('Portal design tokens', () => {
  it('maps the canonical Digital Lattice palette and typography exactly', () => {
    const expectedTokens = [
      'canvas',
      'surface',
      'surface-subtle',
      'ink',
      'ink-2',
      'muted',
      'border',
      'accent',
      'accent-soft',
      'success',
      'success-soft',
      'warning',
      'warning-soft',
      'danger',
      'danger-soft',
      'info',
      'info-soft',
      'sidebar',
      'sidebar-2',
      'sidebar-text',
    ]

    for (const token of expectedTokens) {
      expect(tokenStyles).toContain(`--portal-${token}: ${design.variables[token].value};`)
    }

    expect(tokenStyles).toContain(
      `--portal-font-ui: '${design.variables['font-ui'].value}', 'Noto Sans SC', sans-serif;`,
    )
    expect(tokenStyles).toContain(
      `--portal-font-data: '${design.variables['font-data'].value}', monospace;`,
    )
  })

  it('keeps the measured radius and spacing scale stable', () => {
    for (const token of ['radius-control', 'radius-card', 'space-1', 'space-2', 'space-3', 'space-4', 'space-6']) {
      expect(tokenStyles).toContain(`--portal-${token}: ${design.variables[token].value}px;`)
    }
  })
})
