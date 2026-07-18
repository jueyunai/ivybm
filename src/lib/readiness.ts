import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@/payload.config'

export type ReadinessProbe = () => Promise<void>

const probeDatabase: ReadinessProbe = async () => {
  const payload = await getPayload({
    config,
    disableOnInit: true,
    key: 'health-readiness',
  })
  const database = payload.db as unknown as PostgresAdapter

  await database.pool.query('SELECT 1')
}

export const createReadyHandler = (probe: ReadinessProbe = probeDatabase) =>
  async function readyHandler(): Promise<NextResponse> {
    try {
      await probe()

      return NextResponse.json({ status: 'ready' })
    } catch {
      return NextResponse.json({ status: 'unavailable' }, { status: 503 })
    }
  }
