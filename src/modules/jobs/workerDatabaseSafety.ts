type WorkerDatabaseTarget = {
  databaseURL?: string
}

export const assertWorkerDatabaseTarget = ({
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
  if (isTestDatabase) {
    throw new Error(
      `Refusing real worker connection to test database "${databaseName}"; browser E2E must use the in-process harness and isolated real-worker tests require a separate test-only entrypoint`,
    )
  }
}
