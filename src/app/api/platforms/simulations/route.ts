import { NextRequest, NextResponse } from 'next/server'
import { getPayload, type Payload } from 'payload'

import { isPlatformSimulationId } from '@/modules/platforms/simulationCatalog'
import { runPlatformSimulation } from '@/modules/platforms/simulations'
import config from '@/payload.config'
import type { User } from '@/payload-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BODY_BYTES = 4 * 1024
const noStore = { 'cache-control': 'no-store' }

type SimulationFailurePhase = 'authenticating' | 'executing' | 'initializing' | 'parsing'

const errorResponse = (status: number, code: string): Response =>
  NextResponse.json({ error: { code } }, { headers: noStore, status })

const readBoundedBody = async (
  request: NextRequest,
): Promise<{ text: string; tooLarge: false } | { tooLarge: true }> => {
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { tooLarge: true }
  }
  if (!request.body) return { text: '', tooLarge: false }

  const chunks: Buffer[] = []
  const reader = request.body.getReader()
  let bytesRead = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytesRead += value.byteLength
    if (bytesRead > MAX_BODY_BYTES) {
      await reader.cancel()
      return { tooLarge: true }
    }
    chunks.push(Buffer.from(value))
  }
  return { text: Buffer.concat(chunks).toString('utf8'), tooLarge: false }
}

const logSimulationFailure = (
  payload: Payload | undefined,
  phase: SimulationFailurePhase,
): void => {
  const message = `Platform simulation endpoint unavailable during ${phase}`
  if (payload) {
    payload.logger.error(message)
    return
  }
  process.stderr.write(`${message}\n`)
}

export async function POST(request: NextRequest): Promise<Response> {
  let payload: Payload | undefined
  let phase: SimulationFailurePhase = 'initializing'
  try {
    payload = await getPayload({ config })
    phase = 'authenticating'
    const authenticated = await payload.auth({ headers: request.headers })
    if (!authenticated.user || authenticated.user.collection !== 'users') {
      return errorResponse(401, 'authentication_required')
    }
    const actor = authenticated.user as User
    if (actor.role !== 'admin') return errorResponse(403, 'forbidden')

    phase = 'parsing'
    const mediaType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
    if (mediaType !== 'application/json') {
      return errorResponse(415, 'json_required')
    }
    const bodyRead = await readBoundedBody(request)
    if (bodyRead.tooLarge) return errorResponse(413, 'request_too_large')
    let body: unknown
    try {
      body = JSON.parse(bodyRead.text)
    } catch {
      return errorResponse(400, 'invalid_json')
    }
    const scenarioId =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>).scenarioId
        : undefined
    if (!isPlatformSimulationId(scenarioId)) {
      return errorResponse(400, 'unsupported_scenario')
    }

    phase = 'executing'
    const result = await runPlatformSimulation(scenarioId)
    return NextResponse.json({ result }, { headers: noStore, status: 200 })
  } catch {
    logSimulationFailure(payload, phase)
    return errorResponse(503, 'platform_simulation_unavailable')
  }
}
