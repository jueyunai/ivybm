import { createHash, timingSafeEqual } from 'node:crypto'

export type E2ELaunchMode = 'mutation' | 'readonly-external'

export type E2ELaunchContext = {
  baseURL: string
  commitSHA: string
  databaseName: string
  launchToken: string
  mode: E2ELaunchMode
  planDigest: string
  runID: string
  specPaths: string[]
}

type Environment = Record<string, string | undefined>

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1'])
const hex64 = /^[a-f0-9]{64}$/u
const hex24 = /^[a-f0-9]{24}$/u
const generatedDatabaseName = /^ivybm_e2e_[a-f0-9]{24}_(?:ci|test)$/u

const requireEnvironment = (environment: Environment, name: string): string => {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`E2E launcher context requires ${name}`)
  return value
}

const assertHTTPURL = (value: string, name: string): URL => {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${name} must use HTTP or HTTPS`)
  }
  if (parsed.username || parsed.password) throw new Error(`${name} must not contain credentials`)
  return parsed
}

const assertLocalURL = (value: string, name: string): void => {
  const parsed = assertHTTPURL(value, name)
  const hostname = parsed.hostname.replace(/^\[(.*)\]$/u, '$1')
  if (!loopbackHosts.has(hostname)) throw new Error(`${name} must use a loopback host`)
}

const assertToken = (value: string): void => {
  if (!hex64.test(value)) throw new Error('E2E launcher token must be 32 random bytes in hex')
}

export const readE2ELaunchContext = (environment: Environment = process.env): E2ELaunchContext => {
  const mode = environment.IVYBM_E2E_MODE
  if (mode !== 'mutation' && mode !== 'readonly-external') {
    throw new Error('E2E tests must be started by the suite launcher')
  }

  const runID = environment.IVYBM_E2E_RUN_ID?.trim() ?? ''
  if (!hex24.test(runID)) throw new Error('E2E launcher run ID is invalid')

  const launchToken = environment.IVYBM_E2E_LAUNCH_TOKEN?.trim() ?? ''
  assertToken(launchToken)

  const planDigest = environment.IVYBM_E2E_PLAN_DIGEST?.trim() ?? ''
  if (!hex64.test(planDigest)) throw new Error('E2E launcher plan digest is invalid')

  const commitSHA = requireEnvironment(environment, 'IVYBM_E2E_COMMIT_SHA')
  if (!/^[a-f0-9]{40}$/u.test(commitSHA)) throw new Error('E2E launcher commit SHA is invalid')
  const specPathsJSON = requireEnvironment(environment, 'IVYBM_E2E_SPEC_PATHS_JSON')
  let specPaths: string[]
  try {
    const parsed = JSON.parse(specPathsJSON)
    if (!Array.isArray(parsed) || parsed.some((path) => typeof path !== 'string')) throw new Error()
    specPaths = parsed
  } catch {
    throw new Error('E2E launcher spec plan is invalid')
  }
  if (specPaths.length === 0) throw new Error('E2E launcher spec plan cannot be empty')
  if (
    specPaths.some((path) => !/^tests\/e2e\/[a-z0-9-]+\.spec\.ts$/u.test(path)) ||
    new Set(specPaths).size !== specPaths.length
  ) {
    throw new Error('E2E launcher spec plan contains invalid or duplicate paths')
  }

  const requestedSuites = requireEnvironment(environment, 'IVYBM_E2E_REQUESTED_SUITES').split(',')
  const expectedPlanDigest = createHash('sha256')
    .update(JSON.stringify({ mode, requestedSuites, specs: specPaths }))
    .digest('hex')
  if (expectedPlanDigest !== planDigest) {
    throw new Error('E2E launcher plan digest does not match its suite plan')
  }

  if (mode === 'readonly-external') {
    if (
      specPaths.length !== 1 ||
      specPaths[0] !== 'tests/e2e/website-visual.spec.ts' ||
      requestedSuites.length !== 1 ||
      requestedSuites[0] !== 'readonly-visual'
    ) {
      throw new Error('External read-only E2E is restricted to the website visual suite')
    }
    const baseURL = requireEnvironment(environment, 'BASE_URL')
    assertHTTPURL(baseURL, 'BASE_URL')
    return { baseURL, commitSHA, databaseName: '', launchToken, mode, planDigest, runID, specPaths }
  }

  const databaseName = requireEnvironment(environment, 'IVYBM_E2E_DATABASE_NAME')
  if (!generatedDatabaseName.test(databaseName))
    throw new Error('E2E database name is not launcher-generated')
  if (environment.DATABASE_URL?.trim() === '')
    throw new Error('E2E mutation DATABASE_URL is required')
  const databaseURL = requireEnvironment(environment, 'DATABASE_URL')
  const database = new URL(databaseURL)
  const databaseHost = database.hostname.replace(/^\[(.*)\]$/u, '$1')
  if (!loopbackHosts.has(databaseHost)) throw new Error('E2E mutation database must use loopback')
  const actualDatabaseName = decodeURIComponent(database.pathname.replace(/^\//u, ''))
  if (actualDatabaseName !== databaseName)
    throw new Error('E2E database URL does not match launcher database')

  const port = Number(environment.E2E_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error('E2E_PORT must be 1..65535')
  const baseURL = `http://localhost:${port}`
  assertLocalURL(baseURL, 'E2E baseURL')

  return { baseURL, commitSHA, databaseName, launchToken, mode, planDigest, runID, specPaths }
}

export const assertMutationSpecLaunch = (): void => {
  const context = readE2ELaunchContext()
  if (context.mode !== 'mutation')
    throw new Error('Mutation E2E specs require the mutation suite launcher')
}

export const hasMatchingLaunchToken = (provided: string, expected: string): boolean => {
  const providedBuffer = Buffer.from(provided)
  const expectedBuffer = Buffer.from(expected)
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  )
}
