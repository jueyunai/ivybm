import 'dotenv/config'

import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'

import {
  assertBootstrapDatabaseURL,
  createE2EDatabase,
  createE2EDatabaseName,
  databaseURLForName,
  dropE2EDatabase,
} from './database-lifecycle.mjs'
import {
  assertE2EEnvironmentDoesNotExposeProviderCredentials,
  createE2EEnvironment,
} from './environment.mjs'
import { fullMutationSuiteNames, resolveE2ESuitePlan } from './suite-manifest.mjs'

const allocatePort = async () => {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Failed to allocate an E2E loopback port')
  const port = address.port
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  return port
}

let activeChild
let interruptedBy

const terminateActiveChild = (signal) => {
  if (!activeChild || activeChild.exitCode !== null) return
  if (process.platform === 'win32' || !activeChild.pid) activeChild.kill(signal)
  else {
    try {
      process.kill(-activeChild.pid, signal)
    } catch {
      activeChild.kill(signal)
    }
  }
}

const handleSignal = (signal) => {
  interruptedBy = signal
  terminateActiveChild(signal)
}

process.once('SIGINT', () => handleSignal('SIGINT'))
process.once('SIGTERM', () => handleSignal('SIGTERM'))

const runCommand = (command, args, environment) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: process.platform !== 'win32',
      env: environment,
      stdio: 'inherit',
    })
    activeChild = child
    if (interruptedBy) terminateActiveChild(interruptedBy)
    const finish = (callback) => {
      if (activeChild === child) activeChild = undefined
      callback()
    }
    child.once('error', (error) => finish(() => reject(error)))
    child.once('exit', (code, signal) =>
      finish(() => {
        if (signal) reject(new Error(`${command} ${args.join(' ')} terminated by ${signal}`))
        else if (code !== 0) reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))
        else resolve()
      }),
    )
  })

const commitSHA = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const requestedSuites = process.argv.slice(2)
if (requestedSuites[0] === '--') requestedSuites.shift()

const isFullRequest =
  requestedSuites.length === 0 || (requestedSuites.length === 1 && requestedSuites[0] === 'full')

// A full mutation run must not share a database or global Jobs queue between
// suites. The outer launcher is only an orchestrator; each child invocation
// owns its own database, server, AI stub, and cleanup lifecycle.
if (isFullRequest && !process.env.BASE_URL?.trim()) {
  for (const suite of fullMutationSuiteNames) {
    console.log(`\n=== E2E suite: ${suite} (isolated launcher) ===`)
    await runCommand('corepack', ['pnpm', 'test:e2e', '--', suite], process.env)
  }
  process.exit(0)
}

const plan = resolveE2ESuitePlan(requestedSuites)
const publishingOptIn = requestedSuites.includes('facebook-publishing')
if (publishingOptIn) {
  if (process.env.CI) {
    throw new Error('facebook-publishing is a local-only E2E checkpoint and cannot run in CI')
  }
  if (process.env.ADMIN_PORTAL_PUBLISHING_ENABLED !== 'true') {
    throw new Error(
      'facebook-publishing requires ADMIN_PORTAL_PUBLISHING_ENABLED=true in the local environment',
    )
  }
}
const externalBaseURL = process.env.BASE_URL?.trim()
if (plan.mode === 'mutation' && externalBaseURL) {
  throw new Error('Mutation E2E suites cannot use BASE_URL; use the launcher-owned server')
}
if (plan.mode === 'readonly-external' && !externalBaseURL) {
  throw new Error('readonly-visual requires BASE_URL when using the external read-only entrypoint')
}

const runID = randomBytes(12).toString('hex')
const launchToken = randomBytes(32).toString('hex')
const bootstrapURL = externalBaseURL
  ? null
  : assertBootstrapDatabaseURL(process.env.DATABASE_URL ?? '')
const databaseName = bootstrapURL ? createE2EDatabaseName() : ''
const databaseURL = bootstrapURL ? databaseURLForName(bootstrapURL, databaseName) : ''
const port = bootstrapURL ? await allocatePort() : null
const aiProviderPort = bootstrapURL ? await allocatePort() : null
const baseURL = externalBaseURL || (port ? `http://localhost:${port}` : '')
const mode = externalBaseURL ? 'readonly-external' : plan.mode
const environment = createE2EEnvironment({
  aiProviderPort,
  baseURL,
  commitSHA,
  databaseName,
  databaseURL,
  launchToken,
  mode,
  planDigest: plan.planDigest,
  requestedSuites: plan.requestedSuites,
  runID,
  specPaths: plan.specs,
  port,
})
assertE2EEnvironmentDoesNotExposeProviderCredentials(environment)
environment.NODE_OPTIONS = '--no-deprecation --import=tsx/esm'
environment.NODE_ENV = process.env.NODE_ENV || (process.env.CI ? 'production' : 'development')

let databaseCreated = false
let primaryError
try {
  if (bootstrapURL) {
    await createE2EDatabase(bootstrapURL.toString(), databaseName)
    databaseCreated = true
    await runCommand('corepack', ['pnpm', 'db:reset:test'], environment)
    await runCommand('corepack', ['pnpm', 'db:seed'], environment)
    await runCommand('corepack', ['pnpm', 'db:seed'], environment)
  }

  await runCommand(
    'corepack',
    ['pnpm', 'exec', 'playwright', 'test', '--config=playwright.config.ts'],
    {
      ...environment,
      ...(plan.specs.length > 0 ? { IVYBM_E2E_SPEC_PATHS_JSON: JSON.stringify(plan.specs) } : {}),
    },
  )
} catch (error) {
  primaryError = error
} finally {
  if (databaseCreated) {
    try {
      await dropE2EDatabase(bootstrapURL.toString(), databaseName)
    } catch (cleanupError) {
      if (!primaryError) primaryError = cleanupError
      else
        primaryError = new Error(
          `${primaryError.message}; E2E database cleanup also failed: ${cleanupError.message}`,
        )
    }
  }
}

process.removeAllListeners('SIGINT')
process.removeAllListeners('SIGTERM')
if (interruptedBy && !primaryError) {
  primaryError = new Error(`E2E launcher interrupted by ${interruptedBy}`)
}
if (primaryError) throw primaryError
