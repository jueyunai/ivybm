import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import { createInquiryHandler } from '@/lib/inquiries/handler'
import type { User } from '@/payload-types'
import config from '@/payload.config'

let payload: Payload
let admin: User
let operator: User
let assignedSales: User
let otherSales: User

const testRunID = randomUUID()
const createdUserIDs: Array<number | string> = []

const baseInput = (idempotencyKey = randomUUID()) => ({
  company: 'Acme Facades',
  country: 'United Arab Emirates',
  email: `task7-${testRunID}-buyer-${randomUUID()}@example.invalid`,
  idempotencyKey,
  interest: 'Double-Curved Aluminum Panel',
  locale: 'en',
  message: 'Please quote 1,200 square metres for a Dubai facade project.',
  name: 'Buyer Name',
  phone: '+971501234567',
  sourceURL: 'https://ivybm.example/en/contact?utm_source=google',
  utmCampaign: 'facade-launch',
  utmMedium: 'cpc',
  utmSource: 'google',
  website: '',
})

const jsonRequest = (data: unknown, ip = '198.51.100.8') =>
  new Request('http://localhost/api/inquiries', {
    body: JSON.stringify(data),
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    method: 'POST',
  })

const allowAllLimiter = {
  consume: () => ({ allowed: true as const, remaining: 4 }),
}

describe.sequential('public inquiry integration', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for inquiry tests')

    payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'inquiry-integration-tests',
    })

    for (const [role, name] of [
      ['admin', 'admin'],
      ['operator', 'operator'],
      ['sales', 'assigned-sales'],
      ['sales', 'other-sales'],
    ] as const) {
      const user = await payload.create({
        collection: 'users',
        context: { skipAudit: true },
        data: {
          email: `task7-${testRunID}-${name}-${randomUUID()}@example.invalid`,
          password: `task7-${name}-integration-password`,
          role,
        },
        overrideAccess: true,
      })
      createdUserIDs.push(user.id)
      if (name === 'admin') admin = user
      if (name === 'operator') operator = user
      if (name === 'assigned-sales') assignedSales = user
      if (name === 'other-sales') otherSales = user
    }
  })

  afterAll(async () => {
    if (!payload) return

    await payload
      .delete({
        collection: 'leads',
        overrideAccess: true,
        where: { email: { contains: testRunID } },
      })
      .catch(() => undefined)
    if (createdUserIDs.length > 0) {
      await payload.delete({
        collection: 'audit-logs',
        overrideAccess: true,
        where: { actor: { in: createdUserIDs } },
      })
      await payload.delete({
        collection: 'users',
        context: { skipAudit: true },
        overrideAccess: true,
        where: { id: { in: createdUserIDs } },
      })
    }
    await payload.destroy()
  })

  it('persists a localized website inquiry with source and UTM data', async () => {
    const handler = createInquiryHandler({ limiter: allowAllLimiter, payloadProvider: async () => payload })
    const response = await handler(jsonRequest(baseInput()))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body).toMatchObject({ duplicate: false, ok: true })
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/)

    const leads = await payload.find({
      collection: 'leads',
      depth: 1,
      overrideAccess: true,
      where: { requestId: { equals: body.requestId } },
    })
    expect(leads.totalDocs).toBe(1)
    expect(leads.docs[0]).toMatchObject({
      country: 'United Arab Emirates',
      locale: 'en',
      status: 'new',
      utm: { campaign: 'facade-launch', medium: 'cpc', source: 'google' },
    })
    expect(leads.docs[0].source).toMatchObject({ key: 'website-contact' })
  })

  it('returns the original request ID for duplicate submissions', async () => {
    const handler = createInquiryHandler({ limiter: allowAllLimiter, payloadProvider: async () => payload })
    const input = baseInput()
    const first = await handler(jsonRequest(input))
    const firstBody = await first.json()
    const second = await handler(
      jsonRequest({
        ...input,
        idempotencyKey: input.idempotencyKey.toUpperCase(),
        message: 'A repeated browser retry.',
      }),
    )
    const secondBody = await second.json()

    expect(second.status).toBe(200)
    expect(secondBody).toEqual({ duplicate: true, ok: true, requestId: firstBody.requestId })

    const leads = await payload.find({
      collection: 'leads',
      overrideAccess: true,
      where: { idempotencyKey: { equals: input.idempotencyKey } },
    })
    expect(leads.totalDocs).toBe(1)
  })

  it('keeps concurrent retries idempotent at the database boundary', async () => {
    const handler = createInquiryHandler({ limiter: allowAllLimiter, payloadProvider: async () => payload })
    const input = baseInput()
    const [first, second] = await Promise.all([
      handler(jsonRequest(input, '198.51.100.21')),
      handler(jsonRequest(input, '198.51.100.22')),
    ])
    const [firstBody, secondBody] = await Promise.all([first.json(), second.json()])

    expect([first.status, second.status].sort()).toEqual([200, 201])
    expect(firstBody.requestId).toBe(secondBody.requestId)

    const leads = await payload.find({
      collection: 'leads',
      overrideAccess: true,
      where: { idempotencyKey: { equals: input.idempotencyKey } },
    })
    expect(leads.totalDocs).toBe(1)
  })

  it('does not persist invalid or honeypot submissions', async () => {
    const handler = createInquiryHandler({ limiter: allowAllLimiter, payloadProvider: async () => payload })
    const before = await payload.count({ collection: 'leads', overrideAccess: true })

    const invalid = await handler(jsonRequest({ ...baseInput(), email: 'invalid' }))
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ code: 'validation_failed', ok: false })

    const spam = await handler(jsonRequest({ ...baseInput(), website: 'https://spam.example' }))
    expect(spam.status).toBe(202)
    expect(await spam.json()).toMatchObject({ ok: true })

    const after = await payload.count({ collection: 'leads', overrideAccess: true })
    expect(after.totalDocs).toBe(before.totalDocs)
  })

  it('returns a stable rate-limit response without touching the database', async () => {
    const handler = createInquiryHandler({
      limiter: { consume: () => ({ allowed: false as const, remaining: 0, retryAfterSeconds: 45 }) },
      payloadProvider: async () => payload,
    })

    const response = await handler(jsonRequest(baseInput()))
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('45')
    expect(await response.json()).toMatchObject({ code: 'rate_limited', ok: false })
  })

  it('rejects an oversized streamed body without trusting Content-Length', async () => {
    const handler = createInquiryHandler({
      limiter: allowAllLimiter,
      payloadProvider: async () => payload,
      uuid: () => '10000000-0000-4000-8000-000000000001',
    })
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(32 * 1_024 + 1)))
        controller.close()
      },
    })
    const response = await handler(
      new Request('http://localhost/api/inquiries', {
        body: stream,
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        method: 'POST',
        duplex: 'half',
      } as RequestInit & { duplex: 'half' }),
    )

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({
      code: 'payload_too_large',
      ok: false,
      requestId: '10000000-0000-4000-8000-000000000001',
    })
  })

  it('keeps Arabic locale, error code and request ID for early no-JavaScript failures', async () => {
    const handler = createInquiryHandler({
      limiter: {
        consume: () => ({ allowed: false as const, remaining: 0, retryAfterSeconds: 45 }),
      },
      payloadProvider: async () => payload,
      uuid: () => '10000000-0000-4000-8000-000000000002',
    })
    const response = await handler(
      new Request('http://localhost/api/inquiries', {
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          referer: 'http://localhost/ar/contact',
        },
        method: 'POST',
      }),
    )
    const html = await response.text()

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('45')
    expect(html).toContain('<html lang="ar" dir="rtl">')
    expect(html).toContain('rate_limited')
    expect(html).toContain('10000000-0000-4000-8000-000000000002')
    expect(html).toContain('/ar/contact')
  })

  it('enforces operator and assigned-sales access to leads', async () => {
    const lead = await payload.create({
      collection: 'leads',
      data: {
        assignedTo: assignedSales.id,
        country: 'Qatar',
        email: `task7-${testRunID}-assigned-${randomUUID()}@example.invalid`,
        idempotencyKey: randomUUID(),
        intentLevel: 'unscored',
        locale: 'en',
        message: 'Assigned access test',
        name: 'Assigned Buyer',
        requestId: randomUUID(),
        source: (
          await payload.find({
            collection: 'lead-sources',
            limit: 1,
            overrideAccess: true,
            where: { key: { equals: 'website-contact' } },
          })
        ).docs[0].id,
        status: 'new',
      },
      overrideAccess: true,
    })

    const operatorView = await payload.find({
      collection: 'leads',
      overrideAccess: false,
      user: operator,
      where: { id: { equals: lead.id } },
    })
    const assignedView = await payload.find({
      collection: 'leads',
      overrideAccess: false,
      user: assignedSales,
      where: { id: { equals: lead.id } },
    })
    const otherView = await payload.find({
      collection: 'leads',
      overrideAccess: false,
      user: otherSales,
      where: { id: { equals: lead.id } },
    })
    expect(operatorView.totalDocs).toBe(1)
    expect(assignedView.totalDocs).toBe(1)
    expect(otherView.totalDocs).toBe(0)
    await expect(
      payload.find({
        collection: 'leads',
        overrideAccess: false,
        where: { id: { equals: lead.id } },
      }),
    ).rejects.toMatchObject({ status: 403 })

    const reassignmentAttempt = await payload.update({
      collection: 'leads',
      data: { assignedTo: otherSales.id },
      id: lead.id,
      overrideAccess: false,
      user: assignedSales,
    })
    expect(
      typeof reassignmentAttempt.assignedTo === 'object'
        ? reassignmentAttempt.assignedTo?.id
        : reassignmentAttempt.assignedTo,
    ).toBe(assignedSales.id)

    await payload.update({
      collection: 'leads',
      data: { status: 'contacted' },
      id: lead.id,
      overrideAccess: false,
      user: assignedSales,
    })
  })

  it('allows administrators to manage the shared lead contract', async () => {
    const sources = await payload.find({
      collection: 'lead-sources',
      overrideAccess: false,
      user: admin,
      where: { key: { equals: 'website-contact' } },
    })
    expect(sources.totalDocs).toBe(1)
  })
})
