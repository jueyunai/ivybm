import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const runSmokeTest = async (
  baseUrl: string,
  environment: Partial<NodeJS.ProcessEnv> = {},
): Promise<{ code: number | null; stderr: string; stdout: string }> =>
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('bash', ['scripts/smoke-test.sh', baseUrl], {
      cwd: projectRoot,
      env: {
        ...process.env,
        SMOKE_MAX_ATTEMPTS: '1',
        SMOKE_RETRY_DELAY_SECONDS: '0',
        ...environment,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', rejectPromise)
    child.on('close', (code) => {
      resolvePromise({ code, stderr, stdout })
    })
  })

describe('smoke-test script', () => {
  const servers: ReturnType<typeof createServer>[] = []

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        async (server) =>
          await new Promise<void>((resolvePromise, rejectPromise) => {
            server.close((error) => (error ? rejectPromise(error) : resolvePromise()))
          }),
      ),
    )
  })

  it('requires healthy live, ready, and locale routes', async () => {
    const server = createServer((request, response) => {
      const bodyByPath: Record<string, string> = {
        '/api/health/live': '{"status":"ok"}',
        '/api/health/ready': '{"status":"ready"}',
      }
      const body = bodyByPath[request.url ?? ''] ?? '<html></html>'

      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(body)
    })
    servers.push(server)
    await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
    const address = server.address()

    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP test server address')
    }

    const result = await runSmokeTest(`http://127.0.0.1:${address.port}`)

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('/api/health/live')
    expect(result.stdout).toContain('/api/health/ready')
  })

  it('fails when readiness does not report ready', async () => {
    const server = createServer((request, response) => {
      const isReadyRoute = request.url === '/api/health/ready'

      response.writeHead(isReadyRoute ? 503 : 200, { 'content-type': 'application/json' })
      response.end(isReadyRoute ? '{"status":"unavailable"}' : '{"status":"ok"}')
    })
    servers.push(server)
    await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
    const address = server.address()

    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP test server address')
    }

    const result = await runSmokeTest(`http://127.0.0.1:${address.port}`)

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('/api/health/ready')
  })

  it('retries a transient not-ready response before succeeding', async () => {
    let readinessAttempts = 0
    const server = createServer((request, response) => {
      if (request.url === '/api/health/ready') {
        readinessAttempts += 1
        const isReady = readinessAttempts > 1
        response.writeHead(isReady ? 200 : 503, { 'content-type': 'application/json' })
        response.end(isReady ? '{"status":"ready"}' : '{"status":"unavailable"}')
        return
      }

      const body = request.url === '/api/health/live' ? '{"status":"ok"}' : '<html></html>'
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(body)
    })
    servers.push(server)
    await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
    const address = server.address()

    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP test server address')
    }

    const result = await runSmokeTest(`http://127.0.0.1:${address.port}`, {
      SMOKE_MAX_ATTEMPTS: '2',
    })

    expect(result.code).toBe(0)
    expect(readinessAttempts).toBe(2)
  })

  it('rejects redirects instead of accepting a non-200 locale page', async () => {
    const server = createServer((request, response) => {
      if (request.url === '/en') {
        response.writeHead(302, { location: '/ar' })
        response.end()
        return
      }

      const bodyByPath: Record<string, string> = {
        '/api/health/live': '{"status":"ok"}',
        '/api/health/ready': '{"status":"ready"}',
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(bodyByPath[request.url ?? ''] ?? '<html></html>')
    })
    servers.push(server)
    await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
    const address = server.address()

    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP test server address')
    }

    const result = await runSmokeTest(`http://127.0.0.1:${address.port}`)

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('/en did not return HTTP 200')
    expect(result.stderr).toContain('302')
  })
})
