import './require-mutation-launch'
import { expect, test, type Page } from '@playwright/test'

import { selectUiOption } from './support/uiSelect'

const adminUsername = process.env.E2E_ADMIN_USERNAME ?? process.env.SEED_ADMIN_USERNAME
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD
let cleanupMemberUsername: string | null = null

const loginAs = async (page: Page, username: string, pass: string) => {
  await page.goto('/dashboard/login?returnTo=%2Fdashboard%2Fsettings')
  await page.getByRole('textbox', { name: '账号' }).fill(username)
  await page.getByRole('textbox', { name: '密码' }).fill(pass)
  await page.getByRole('button', { name: '登录后台' }).click()
  await expect(page).toHaveURL(/\/dashboard\/settings$/)
}

test.afterEach(async ({ page }) => {
  const username = cleanupMemberUsername
  cleanupMemberUsername = null
  if (!username) return

  await page.goto('/dashboard/settings')
  const cleanupResult = await page.evaluate(async (memberUsername) => {
    const listResponse = await fetch('/api/portal/settings/users', {
      cache: 'no-store',
      credentials: 'same-origin',
    })
    if (!listResponse.ok) return { ok: false, status: listResponse.status }
    const list = (await listResponse.json()) as {
      members?: Array<{ id: number | string; updatedAt: string; username: string }>
    }
    const member = list.members?.find((candidate) => candidate.username === memberUsername)
    if (!member) return { ok: true, status: 204 }

    const deleteResponse = await fetch(`/api/portal/settings/users/${member.id}`, {
      body: JSON.stringify({ confirmUsername: member.username, updatedAt: member.updatedAt }),
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': `e2e-cleanup-${Date.now()}`,
      },
      method: 'DELETE',
    })
    return { ok: deleteResponse.ok, status: deleteResponse.status }
  }, username)

  expect(cleanupResult.ok, `cleanup failed with HTTP ${cleanupResult.status}`).toBe(true)
})

test('admin manages team member lifecycle and personal password change in Portal settings', async ({
  browser,
  page,
}, testInfo) => {
  test.skip(
    !adminUsername || !adminPassword,
    'Requires dedicated non-production E2E or local seed administrator credentials.',
  )
  if (!adminUsername || !adminPassword) return

  await page.setViewportSize({ height: 960, width: 1440 })
  await loginAs(page, adminUsername, adminPassword)

  const suffix = `${Date.now()}-${testInfo.workerIndex}`
  const memberUsername = `e2e-sales-${suffix}`
  const initialPassword = 'InitialSalesPass123!'
  const changedPassword = 'ChangedSalesPass123!'

  await expect(page.getByRole('heading', { level: 2, name: '基础设置' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '团队成员管理' })).toBeVisible()

  // 1. Admin creates a new sales member
  await page.getByRole('button', { name: '新增成员' }).click()
  const addModal = page.locator('.portal-modal')
  await expect(addModal.getByRole('heading', { name: '新增团队成员' })).toBeVisible()
  await selectUiOption(addModal.getByLabel('分配角色'), 'sales')
  await addModal.getByLabel('登录用户名').fill(memberUsername)
  await addModal.getByLabel('初始密码', { exact: true }).fill(initialPassword)
  await addModal.getByRole('button', { name: '保存' }).click()

  // Verify created member appears in the list
  const memberRow = page.locator('.portal-team-members__item').filter({ hasText: memberUsername })
  await expect(memberRow).toBeVisible()
  cleanupMemberUsername = memberUsername
  await expect(memberRow).toContainText('业务员')
  await expect(memberRow).toContainText('正常')

  // 2. New member logs in in a separate browser context (no forced change password prompt)
  const memberContext = await browser.newContext()
  const memberPage = await memberContext.newPage()
  try {
    await loginAs(memberPage, memberUsername, initialPassword)
    await expect(memberPage.getByRole('heading', { level: 2, name: '基础设置' })).toBeVisible()
    // Non-admin does not see team members management
    await expect(memberPage.getByRole('heading', { name: '团队成员管理' })).toHaveCount(0)

    // 3. Member changes their password
    await memberPage.getByRole('button', { name: '修改密码' }).click()
    const changePassForm = memberPage.locator('.portal-change-password__form')
    await changePassForm.getByLabel('当前密码').fill(initialPassword)
    await changePassForm.getByLabel('新密码', { exact: true }).fill(changedPassword)
    await changePassForm.getByLabel('确认新密码', { exact: true }).fill(changedPassword)
    await changePassForm.getByRole('button', { name: '确认修改密码' }).click()

    // After success, session is revoked and page redirects to login
    await expect(memberPage).toHaveURL(/\/dashboard\/login/, { timeout: 10000 })

    // Old password fails to login
    await memberPage.getByRole('textbox', { name: '账号' }).fill(memberUsername)
    await memberPage.getByRole('textbox', { name: '密码' }).fill(initialPassword)
    await memberPage.getByRole('button', { name: '登录后台' }).click()
    await expect(memberPage.locator('.portal-login-form__error')).toBeVisible()

    // New password succeeds
    await loginAs(memberPage, memberUsername, changedPassword)
    await expect(memberPage.getByRole('heading', { level: 2, name: '基础设置' })).toBeVisible()
  } finally {
    await memberContext.close()
  }

  // 4. The member's password change advanced updatedAt. Refresh the admin view before the
  // destructive action so the optimistic concurrency token represents the current user record.
  await page.reload()
  await expect(page.getByRole('heading', { name: '团队成员管理' })).toBeVisible()
  const refreshedMemberRow = page
    .locator('.portal-team-members__item')
    .filter({ hasText: memberUsername })
  await refreshedMemberRow.getByRole('button', { name: '删除' }).click()
  const deleteModal = page.locator('.portal-modal')
  await expect(deleteModal.getByRole('heading', { name: '删除成员' })).toBeVisible()
  const confirmBtn = deleteModal.getByRole('button', { name: '确认删除' })
  expect(await confirmBtn.isDisabled()).toBe(true)

  await deleteModal.getByLabel('登录用户名').fill(memberUsername)
  expect(await confirmBtn.isDisabled()).toBe(false)
  const deleteResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      /\/api\/portal\/settings\/users\/[^/]+$/u.test(new URL(response.url()).pathname),
  )
  await confirmBtn.click()
  const deleteResponse = await deleteResponsePromise
  const deleteResponseBody = await deleteResponse.text()
  expect(
    deleteResponse.ok(),
    `delete member failed with HTTP ${deleteResponse.status()}: ${deleteResponseBody}`,
  ).toBe(true)

  // Verify the API and rendered list both reflect the committed deletion.
  const deletedMemberStillExists = await page.evaluate(async (username) => {
    const response = await fetch('/api/portal/settings/users', {
      cache: 'no-store',
      credentials: 'same-origin',
    })
    if (!response.ok) throw new Error(`member verification failed with HTTP ${response.status}`)
    const result = (await response.json()) as { members?: Array<{ username: string }> }
    return result.members?.some((member) => member.username === username) ?? false
  }, memberUsername)
  expect(deletedMemberStillExists).toBe(false)
  await expect(
    page.locator('.portal-team-members__item').filter({ hasText: memberUsername }),
  ).toHaveCount(0)
  cleanupMemberUsername = null
})
