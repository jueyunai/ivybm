import { timingSafeEqual } from 'node:crypto'

import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@/payload.config'

type Environment = Record<string, string | undefined>
type DatabaseProbe = () => Promise<string>

const equalToken = (provided: string, expected: string): boolean => {
  const providedBuffer = Buffer.from(provided)
  const expectedBuffer = Buffer.from(expected)
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  )
}

const probeDatabase: DatabaseProbe = async () => {
  const payload = await getPayload({ config, disableOnInit: true, key: 'e2e-db-attestation' })
  try {
    const database = payload.db as unknown as PostgresAdapter
    const result = await database.pool.query<{ database: string }>(
      'SELECT current_database() AS database',
    )
    return result.rows[0]?.database ?? ''
  } finally {
    await payload.destroy()
  }
}

export const createE2EAttestationHandler = ({
  environment = process.env,
  probe = probeDatabase,
}: {
  environment?: Environment
  probe?: DatabaseProbe
} = {}) =>
  async function e2eAttestation(request: Request): Promise<NextResponse> {
    const expectedToken = environment.IVYBM_E2E_LAUNCH_TOKEN?.trim()
    const mode = environment.IVYBM_E2E_MODE
    const providedToken = request.headers.get('x-ivybm-e2e-launch-token') ?? ''
    if (!expectedToken || mode !== 'mutation' || !equalToken(providedToken, expectedToken)) {
      return new NextResponse(null, { status: 404 })
    }

    try {
      const database = await probe()
      return NextResponse.json({
        commitSHA: environment.IVYBM_E2E_COMMIT_SHA,
        database,
        planDigest: environment.IVYBM_E2E_PLAN_DIGEST,
        runId: environment.IVYBM_E2E_RUN_ID,
        status: 'ready',
      })
    } catch {
      return new NextResponse(null, { status: 503 })
    }
  }
