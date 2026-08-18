const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1'])

type MutationE2ETarget = {
  baseURL?: string
  databaseURL?: string
  selectedArguments?: string[]
  workerMode?: string
}

const normalizeHostname = (hostname: string): string => hostname.replace(/^\[(.*)\]$/u, '$1')

const positionalSelectorArguments = (arguments_: string[]): string[] => {
  let afterDelimiter = false
  let commandConsumed = false
  const selectors: string[] = []

  for (const argument of arguments_) {
    if (!afterDelimiter && !commandConsumed && argument === 'test') {
      commandConsumed = true
      continue
    }
    if (!afterDelimiter && argument === '--') {
      afterDelimiter = true
      continue
    }
    if (!afterDelimiter && argument.startsWith('-')) continue
    selectors.push(argument)
  }

  return selectors
}

const readOnlySpecPatterns = [/(?:^|\/)website-visual\.spec\.ts(?::\d+)?$/u]

export const mutationE2EIsScheduled = (arguments_: string[]): boolean => {
  const selectors = positionalSelectorArguments(arguments_)
  if (selectors.length === 0) return true

  return selectors.some((argument) => {
    const normalized = argument.replaceAll('\\', '/')
    return !readOnlySpecPatterns.some((pattern) => pattern.test(normalized))
  })
}

const parseURL = (value: string, name: string): URL => {
  try {
    return new URL(value)
  } catch {
    throw new Error(`${name} must be a valid URL for mutation E2E`)
  }
}

export const assertMutationE2ETarget = ({
  baseURL = process.env.BASE_URL,
  databaseURL = process.env.DATABASE_URL,
  selectedArguments = process.argv.slice(2),
  workerMode = process.env.IVYBM_E2E_WORKER_MODE,
}: MutationE2ETarget = {}): void => {
  if (!mutationE2EIsScheduled(selectedArguments)) return

  const configuredBaseURL = baseURL?.trim()
  if (configuredBaseURL) {
    const parsedBaseURL = parseURL(configuredBaseURL, 'BASE_URL')
    const baseHostname = normalizeHostname(parsedBaseURL.hostname)
    if (!loopbackHosts.has(baseHostname)) {
      throw new Error(
        `Refusing mutation E2E against external BASE_URL host "${baseHostname}"; select read-only specs only`,
      )
    }
    throw new Error(
      'Refusing mutation E2E with BASE_URL; mutation suites must use the Playwright-managed local server',
    )
  }

  if (workerMode !== 'harness-only') {
    throw new Error(
      'Mutation E2E requires IVYBM_E2E_WORKER_MODE=harness-only; stop external workers and use the canonical pnpm test:e2e command',
    )
  }

  if (!databaseURL) {
    throw new Error('DATABASE_URL is required for mutation E2E')
  }

  const parsedDatabaseURL = parseURL(databaseURL, 'DATABASE_URL')
  if (parsedDatabaseURL.protocol !== 'postgres:' && parsedDatabaseURL.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use the postgres or postgresql protocol for mutation E2E')
  }

  const databaseHostname = normalizeHostname(parsedDatabaseURL.hostname)
  if (!loopbackHosts.has(databaseHostname)) {
    throw new Error(
      `Refusing mutation E2E against database host "${databaseHostname}"; test databases must use a local loopback host`,
    )
  }

  const databaseName = decodeURIComponent(parsedDatabaseURL.pathname.replace(/^\//u, ''))
  if (!databaseName.endsWith('_test') && !databaseName.endsWith('_ci')) {
    throw new Error(
      `Refusing mutation E2E against database "${databaseName}"; test databases must end with _test or _ci`,
    )
  }
}
