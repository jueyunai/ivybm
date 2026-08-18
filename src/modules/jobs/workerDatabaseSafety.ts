type WorkerDatabaseTarget = {
  allowTestDatabaseWorker?: string
  databaseURL?: string
}

export const assertWorkerDatabaseTarget = ({
  allowTestDatabaseWorker = process.env.IVYBM_ALLOW_TEST_DATABASE_WORKER,
  databaseURL = process.env.DATABASE_URL,
}: WorkerDatabaseTarget = {}): void => {
  if (!databaseURL) return

  let parsedDatabaseURL: URL
  try {
    parsedDatabaseURL = new URL(databaseURL)
  } catch {
    throw new Error('DATABASE_URL must be a valid URL before starting the real worker')
  }

  const databaseName = decodeURIComponent(parsedDatabaseURL.pathname.replace(/^\//u, ''))
  const isTestDatabase = databaseName.endsWith('_test') || databaseName.endsWith('_ci')
  if (isTestDatabase && allowTestDatabaseWorker !== 'true') {
    throw new Error(
      `Refusing real worker connection to test database "${databaseName}"; use the in-process E2E harness or explicitly set IVYBM_ALLOW_TEST_DATABASE_WORKER=true for an isolated worker test`,
    )
  }
}
