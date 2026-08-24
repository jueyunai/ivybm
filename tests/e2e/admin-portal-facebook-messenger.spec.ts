import './require-mutation-launch'
import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { E2E_META_PAGE_ID } from './admin-portal-facebook.constants'
import { createSignedFacebookMessage, FacebookE2EHarness } from './admin-portal-facebook.support'

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD

test.describe.serial('FB-IN-01 Facebook Messenger durable closure', () => {
  let harness: FacebookE2EHarness | undefined

  test.beforeEach(async () => {
    harness = await FacebookE2EHarness.create()
    await harness.createFacebookAccount()
  })

  test.afterEach(async () => {
    await harness?.cleanup()
    harness = undefined
  })

  test('signed webhook reaches the authoritative conversation and fake Meta exactly once', async ({
    request,
  }) => {
    if (!harness) throw new Error('Facebook E2E harness is unavailable')
    const suffix = randomUUID().replaceAll('-', '')
    const messageId = `mid-${suffix}`
    const senderExternalId = `987${suffix.replace(/\D/gu, '').padEnd(20, '4').slice(0, 12)}`
    harness.trackMessage({ messageId, senderExternalId })
    const signed = createSignedFacebookMessage({
      messageId,
      senderExternalId,
      text: 'Please share the available facade finishes.',
    })

    const response = await request.post('/api/webhooks/meta', {
      data: signed.body,
      headers: signed.headers,
    })
    expect(response.status()).toBe(200)
    await expect(response.json()).resolves.toEqual({ accepted: 1, duplicates: 0, total: 1 })

    await expect(harness.runUntilIdle()).resolves.toEqual(['succeeded', 'succeeded', 'idle'])
    const state = await harness.readConversation(senderExternalId)
    expect(state.conversation).toMatchObject({
      externalAccountId: E2E_META_PAGE_ID,
      externalSenderId: senderExternalId,
      handoffStatus: 'ai_active',
    })
    expect(state.messages).toEqual([
      expect.objectContaining({
        author: 'visitor',
        content: 'Please share the available facade finishes.',
        externalMessageId: messageId,
        status: 'sent',
      }),
      expect.objectContaining({
        author: 'ai',
        content: 'E2E deterministic response. Which country is the project located in?',
        status: 'sent',
      }),
    ])
    expect(state.deliveryIntent).toMatchObject({
      accountExternalId: E2E_META_PAGE_ID,
      platform: 'facebook-messenger',
      recipientExternalId: senderExternalId,
      status: 'accepted',
    })
    expect(state.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'succeeded', type: 'platform.event.dispatch' }),
        expect.objectContaining({ status: 'succeeded', type: 'platform.conversation.deliver' }),
      ]),
    )
    expect(state.jobs).toHaveLength(2)
    expect(
      harness.outbound.getAcceptedRequest({
        accountExternalId: E2E_META_PAGE_ID,
        deliveryKey: state.deliveryIntent.deliveryKey,
        platform: 'facebook-messenger',
      }),
    ).toMatchObject({
      accountExternalId: E2E_META_PAGE_ID,
      recipientExternalId: senderExternalId,
      text: 'E2E deterministic response. Which country is the project located in?',
    })
  })

  test('cleanup preserves jobs and audits whose numeric IDs belong to another resource', async () => {
    if (!harness) throw new Error('Facebook E2E harness is unavailable')
    const sentinels = await harness.createCleanupCollisionSentinels()

    const preserved = await harness.cleanup()
    harness = undefined

    expect(preserved).toEqual(sentinels)
  })

  test('second signed message closes Lead, Feishu, takeover, human reply, and resolve', async ({
    page,
    request,
  }) => {
    if (!harness) throw new Error('Facebook E2E harness is unavailable')
    test.skip(
      !adminEmail || !adminPassword,
      'Requires local non-production administrator credentials.',
    )
    if (!adminEmail || !adminPassword) return
    await harness.createFeishuMapping()
    const suffix = randomUUID().replaceAll('-', '')
    const senderExternalId = `876${suffix.replace(/\D/gu, '').padEnd(20, '5').slice(0, 12)}`
    const firstMessageId = `mid-first-${suffix}`
    harness.trackMessage({ messageId: firstMessageId, senderExternalId })
    const first = createSignedFacebookMessage({
      messageId: firstMessageId,
      senderExternalId,
      text: 'We need aluminum facade panels for a new project.',
    })
    const firstResponse = await request.post('/api/webhooks/meta', {
      data: first.body,
      headers: first.headers,
    })
    expect(firstResponse.status()).toBe(200)
    await expect(harness.runUntilIdle()).resolves.toEqual(['succeeded', 'succeeded', 'idle'])

    const secondMessageId = `mid-qualified-${suffix}`
    harness.trackMessage({ messageId: secondMessageId, senderExternalId })
    const second = createSignedFacebookMessage({
      messageId: secondMessageId,
      senderExternalId,
      text: `I am from UAE. My company is E2E Facade LLC. We have a tender for 3,200 sqm aluminum facade panels within 3 months. Drawings are ready. Our budget is USD 450000 and the purchase plan is within 3 months. Contact e2e-${suffix}@example.invalid or +971 50 000 0000.`,
    })
    const secondResponse = await request.post('/api/webhooks/meta', {
      data: second.body,
      headers: second.headers,
    })
    expect(secondResponse.status()).toBe(200)
    await expect(secondResponse.json()).resolves.toEqual({ accepted: 1, duplicates: 0, total: 1 })
    await expect(harness.runNext()).resolves.toBe('succeeded')
    await expect(harness.relayFeishuJobs()).resolves.toMatchObject({
      enabled: true,
      handoffs: { created: 1 },
    })
    await expect(harness.runUntilIdle()).resolves.toEqual(['succeeded', 'succeeded', 'idle'])

    const state = await harness.readHighIntentState(senderExternalId)
    expect(state.conversation.handoffStatus).toBe('handoff_requested')
    expect(state.messages.filter(({ author }) => author === 'ai')).toHaveLength(1)
    expect(state.leads).toEqual([
      expect.objectContaining({
        company: 'E2E Facade LLC',
        email: `e2e-${suffix}@example.invalid`,
        intentLevel: 'a',
        projectStage: 'tender',
        quantitySquareMeters: 3200,
      }),
    ])
    expect(state.handoffs).toEqual([
      expect.objectContaining({ source: 'ai_policy', status: 'requested' }),
    ])
    expect(harness.feishuUpserts).toHaveLength(1)
    expect(harness.feishuUpserts[0]).toMatchObject({
      fields: expect.objectContaining({ Customer: 'E2E Facade LLC', Intent: 'A' }),
      localLeadId: String(state.leads[0]?.id),
    })
    expect(harness.feishuMessages).toHaveLength(3)
    expect(harness.feishuMessages.map(({ text }) => text)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('新客户线索'),
        expect.stringContaining('高意向客户'),
        expect.stringContaining('人工接管'),
      ]),
    )

    await page.goto(
      `/dashboard/login?returnTo=${encodeURIComponent(`/dashboard/conversations?conversation=${state.conversation.publicId}`)}`,
    )
    await page.getByRole('textbox', { name: '邮箱' }).fill(adminEmail)
    await page.getByRole('textbox', { name: '密码' }).fill(adminPassword)
    await page.getByRole('button', { name: '登录后台' }).click()
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/conversations\\?conversation=${state.conversation.publicId}$`),
    )
    await expect(
      page.getByRole('heading', {
        name: `Facebook客户 #${state.conversation.publicId.slice(-6)}`,
      }),
    ).toBeVisible()
    await page.getByRole('button', { name: '接管会话' }).click()
    await expect(page.getByRole('button', { name: '发送回复' })).toBeVisible()
    const operatorReply = 'E2E operator has taken over and will follow up with the quotation.'
    await page.getByPlaceholder('输入给客户的回复…').fill(operatorReply)
    await page.getByRole('button', { name: '发送回复' }).click()
    await expect(page.getByText(operatorReply)).toBeVisible()
    const activeHarness = harness
    await expect
      .poll(async () => (await activeHarness.readDeliveryIntents(senderExternalId)).length)
      .toBe(2)
    await expect(harness.runUntilIdle()).resolves.toEqual(['succeeded', 'idle'])

    const deliveryIntents = await harness.readDeliveryIntents(senderExternalId)
    expect(deliveryIntents).toHaveLength(2)
    const operatorIntent = deliveryIntents.find(({ text }) => text === operatorReply)
    expect(operatorIntent).toMatchObject({
      accountExternalId: E2E_META_PAGE_ID,
      platform: 'facebook-messenger',
      recipientExternalId: senderExternalId,
      status: 'accepted',
    })
    if (!operatorIntent) throw new Error('Expected operator delivery intent')
    expect(
      harness.outbound.getAcceptedRequest({
        accountExternalId: E2E_META_PAGE_ID,
        deliveryKey: operatorIntent.deliveryKey,
        platform: 'facebook-messenger',
      }),
    ).toMatchObject({ recipientExternalId: senderExternalId, text: operatorReply })

    await page.getByRole('button', { name: '解决会话' }).click()
    await expect.poll(() => activeHarness.readConversationStatus(senderExternalId)).toBe('resolved')
    await expect(page.getByRole('button', { name: '发送回复' })).toHaveCount(0)
  })
})
