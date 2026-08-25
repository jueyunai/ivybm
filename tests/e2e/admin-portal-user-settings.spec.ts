import './require-mutation-launch'
import { expect, test, type Page } from '@playwright/test'

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD

const loginAs = async (page: Page, email: string, pass: string) => {
  await page.goto('/dashboard/login?returnTo=%2Fdashboard%2Fsettings')
  await page.getByRole('textbox', { name: '邮箱' }).fill(email)
  await page.getByRole('textbox', { name: '密码' }).fill(pass)
  await page.getByRole('button', { name: '登录后台' }).click()
  await expect(page).toHaveURL(/\/dashboard\/settings$/)
}

test('admin manages team member lifecycle and personal password change in Portal settings', async ({
  browser,
  page,
}, testInfo) => {
  test.skip(
    !adminEmail || !adminPassword,
    'Requires dedicated non-production E2E or local seed administrator credentials.',
  )
  if (!adminEmail || !adminPassword) return

  await page.setViewportSize({ height: 960, width: 1440 })
  await loginAs(page, adminEmail, adminPassword)

  const suffix = `${Date.now()}-${testInfo.workerIndex}`
  const memberEmail = `e2e-sales-${suffix}@example.invalid`
  const initialPassword = 'InitialSalesPass123!'
  const changedPassword = 'ChangedSalesPass123!'

  await expect(page.getByRole('heading', { level: 2, name: '基础设置' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '团队成员管理' })).toBeVisible()

  // 1. Admin creates a new sales member
  await page.getByRole('button', { name: '新增成员' }).click()
  const addModal = page.locator('.portal-modal')
  await expect(addModal.getByRole('heading', { name: '新增团队成员' })).toBeVisible()
  await addModal.getByLabel('登录邮箱').fill(memberEmail)
  await addModal.getByLabel('分配角色').selectOption('sales')
  await addModal.getByLabel('初始密码').fill(initialPassword)
  await addModal.getByLabel('确认初始密码').fill(initialPassword)
  await addModal.getByRole('button', { name: '保存' }).click()

  // Verify created member appears in the list
  const memberRow = page.locator('.portal-team-members__item').filter({ hasText: memberEmail })
  await expect(memberRow).toBeVisible()
  await expect(memberRow).toContainText('业务员')
  await expect(memberRow).toContainText('正常')

  // 2. New member logs in in a separate browser context (no forced change password prompt)
  const memberContext = await browser.newContext()
  const memberPage = await memberContext.newPage()
  try {
    await loginAs(memberPage, memberEmail, initialPassword)
    await expect(memberPage.getByRole('heading', { level: 2, name: '基础设置' })).toBeVisible()
    // Non-admin does not see team members management
    await expect(memberPage.getByRole('heading', { name: '团队成员管理' })).toHaveCount(0)

    // 3. Member changes their password
    await memberPage.getByRole('button', { name: '修改密码' }).click()
    const changePassForm = memberPage.locator('.portal-change-password__form')
    await changePassForm.getByLabel('当前密码').fill(initialPassword)
    await changePassForm.getByLabel('新密码').fill(changedPassword)
    await changePassForm.getByLabel('确认新密码').fill(changedPassword)
    await changePassForm.getByRole('button', { name: '确认修改密码' }).click()

    // After success, session is revoked and page redirects to login
    await expect(memberPage).toHaveURL(/\/dashboard\/login/, { timeout: 10000 })

    // Old password fails to login
    await memberPage.getByRole('textbox', { name: '邮箱' }).fill(memberEmail)
    await memberPage.getByRole('textbox', { name: '密码' }).fill(initialPassword)
    await memberPage.getByRole('button', { name: '登录后台' }).click()
    await expect(memberPage.locator('.portal-login-form__error')).toBeVisible()

    // New password succeeds
    await loginAs(memberPage, memberEmail, changedPassword)
    await expect(memberPage.getByRole('heading', { level: 2, name: '基础设置' })).toBeVisible()
  } finally {
    await memberContext.close()
  }

  // 4. Admin deletes the test member
  await memberRow.getByRole('button', { name: '删除' }).click()
  const deleteModal = page.locator('.portal-modal')
  await expect(deleteModal.getByRole('heading', { name: '删除成员' })).toBeVisible()
  const confirmBtn = deleteModal.getByRole('button', { name: '确认删除' })
  expect(await confirmBtn.isDisabled()).toBe(true)

  await deleteModal.getByLabel('登录邮箱').fill(memberEmail)
  expect(await confirmBtn.isDisabled()).toBe(false)
  await confirmBtn.click()

  // Verify deleted member disappears from the list
  await expect(page.locator('.portal-team-members__item').filter({ hasText: memberEmail })).toHaveCount(0)
})
