import { randomUUID } from 'node:crypto'

import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import { POST as runSimulation } from '@/app/api/platforms/simulations/route'
import config from '@/payload.config'
import type { User } from '@/payload-types'

let payload: Payload
let admin: User
let operator: User
let adminAuthorization: string
let operatorAuthorization: string
const createdUserIDs: number[] = []

const request = (body: string, authorization?: string, contentType = 'application/json') =>
  new NextRequest('http://localhost/api/platforms/simulations', {
    body,
    headers: {
      ...(authorization ? { authorization } : {}),
      'content-type': contentType,
    },
    method: 'POST',
  })

describe.sequential('platform simulation route', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for platform simulation integration tests')
    }
    payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'platform-simulation-route-integration-tests',
    })
    const suffix = randomUUID()
    admin = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `platform-simulation-admin-${suffix}@example.invalid`,
        password: 'platform-simulation-admin-password',
        role: 'admin',
      },
      overrideAccess: true,
    })
    operator = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `platform-simulation-operator-${suffix}@example.invalid`,
        password: 'platform-simulation-operator-password',
        role: 'operator',
      },
      overrideAccess: true,
    })
    createdUserIDs.push(Number(admin.id), Number(operator.id))
    const adminLogin = await payload.login({
      collection: 'users',
      data: { email: admin.email, password: 'platform-simulation-admin-password' },
    })
    const operatorLogin = await payload.login({
      collection: 'users',
      data: { email: operator.email, password: 'platform-simulation-operator-password' },
    })
    adminAuthorization = `JWT ${adminLogin.token}`
    operatorAuthorization = `JWT ${operatorLogin.token}`
  })

  afterAll(async () => {
    if (!payload) return
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
    await payload.destroy()
  })

  it('requires an administrator and rejects malformed inputs before execution', async () => {
    await expect(
      runSimulation(request('{"scenarioId":"facebook-publishing"}')),
    ).resolves.toMatchObject({
      status: 401,
    })
    await expect(
      runSimulation(request('{"scenarioId":"facebook-publishing"}', operatorAuthorization)),
    ).resolves.toMatchObject({ status: 403 })
    await expect(runSimulation(request('{', adminAuthorization))).resolves.toMatchObject({
      status: 400,
    })
    await expect(
      runSimulation(request('{"scenarioId":"real-platform-call"}', adminAuthorization)),
    ).resolves.toMatchObject({ status: 400 })
    await expect(
      runSimulation(request('{}', adminAuthorization, 'text/plain')),
    ).resolves.toMatchObject({ status: 415 })
    await expect(
      runSimulation(request('{}', adminAuthorization, 'application/json-patch+json')),
    ).resolves.toMatchObject({ status: 415 })
    await expect(
      runSimulation(
        request(
          JSON.stringify({ scenarioId: 'facebook-publishing', padding: 'x'.repeat(5_000) }),
          adminAuthorization,
        ),
      ),
    ).resolves.toMatchObject({ status: 413 })
    await expect(
      runSimulation(
        request(
          JSON.stringify({ scenarioId: 'facebook-publishing', padding: '界'.repeat(1_400) }),
          adminAuthorization,
          'application/json; charset=utf-8',
        ),
      ),
    ).resolves.toMatchObject({ status: 413 })
  })

  it('runs every credential-free scenario without leaking sensitive material', async () => {
    for (const scenarioId of [
      'meta-inbound-normalization',
      'meta-conversation-outbound',
      'facebook-publishing',
      'instagram-publishing',
      'linkedin-publishing',
      'tiktok-signature',
      'no-account-degradation',
      'unknown-outcome-recovery',
    ]) {
      const response = await runSimulation(
        request(JSON.stringify({ scenarioId }), adminAuthorization),
      )
      const body = await response.text()
      expect(response.status).toBe(200)
      expect(JSON.parse(body)).toMatchObject({ result: { id: scenarioId } })
      expect(body).not.toMatch(/access[_ -]?token|authorization: bearer|local-fixture-secret/i)
      expect(body).not.toContain('signature=fixture-secret')
    }
  })
})
