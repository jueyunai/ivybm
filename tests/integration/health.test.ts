import packageJson from '../../package.json'
import { afterAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import { GET as getLiveHealth } from '@/app/api/health/live/route'
import { GET as getReadyHealth } from '@/app/api/health/ready/route'
import { createReadyHandler } from '@/lib/readiness'
import config from '@/payload.config'

let healthPayload: Payload | undefined

describe('health routes', () => {
  afterAll(async () => {
    await healthPayload?.destroy()
  })

  it('reports process liveness without depending on PostgreSQL', async () => {
    const response = await getLiveHealth()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    await expect(response.json()).resolves.toEqual({
      name: 'ivybm',
      status: 'ok',
      version: process.env.APP_VERSION || packageJson.version,
    })
  })

  it('reports readiness when PostgreSQL responds', async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for health integration tests')
    }

    const response = await getReadyHealth()
    healthPayload = await getPayload({
      config,
      disableOnInit: true,
      key: 'health-readiness',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ready' })
  })

  it('returns a redacted 503 response when PostgreSQL is unavailable', async () => {
    const secretError = new Error(
      `password=super-secret DATABASE_URL=${process.env.DATABASE_URL ?? 'missing'}`,
    )
    const unavailableHandler = createReadyHandler(async () => {
      throw secretError
    })

    const response = await unavailableHandler()
    const body = await response.text()

    expect(response.status).toBe(503)
    expect(JSON.parse(body)).toEqual({ status: 'unavailable' })
    expect(body).not.toContain('super-secret')
    expect(body).not.toContain(process.env.DATABASE_URL ?? 'missing')
    expect(body).not.toContain(secretError.message)
  })
})
