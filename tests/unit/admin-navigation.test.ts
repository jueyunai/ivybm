import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { ADMIN_COPY, TASK_NAV_ITEMS } from '@/admin/i18n'
import config from '@/payload.config'

describe('task-oriented Admin navigation', () => {
  it('registers the Operations Dashboard and stable task links without replacing Payload Nav', async () => {
    const payloadConfig = await config
    const components = payloadConfig.admin?.components

    expect(components?.Nav).toBeUndefined()
    expect(components?.beforeNavLinks).toEqual(['/admin/components/TaskNavLinks'])
    expect(components?.views?.dashboard).toMatchObject({
      Component: '/admin/views/OperationsDashboard',
    })
  })

  it('keeps every task navigation item bilingual and rooted in the existing Admin routes', () => {
    expect(TASK_NAV_ITEMS).toHaveLength(3)

    for (const item of TASK_NAV_ITEMS) {
      expect(item.href.startsWith('/admin')).toBe(true)
      expect(ADMIN_COPY.zh[item.labelKey]).toEqual(expect.any(String))
      expect(ADMIN_COPY.en[item.labelKey]).toEqual(expect.any(String))
    }
  })

  it('defines semantic tokens and avoids direct Payload Nav DOM styling', () => {
    const tokenStyles = readFileSync(
      path.join(process.cwd(), 'src/admin/styles/tokens.css'),
      'utf8',
    )
    const shellStyles = readFileSync(
      path.join(process.cwd(), 'src/admin/styles/admin-shell.css'),
      'utf8',
    )

    expect(tokenStyles).toContain('--ops-accent')
    expect(tokenStyles).toContain('html[data-theme="dark"]')
    expect(shellStyles).toContain('.ops-task-nav')
    expect(shellStyles).toContain('inline-size: 100%')
    expect(shellStyles).toContain('position: sticky')
    expect(shellStyles).not.toMatch(/\.nav__|\.nav-group|\.nav-toggler/)
  })
})
