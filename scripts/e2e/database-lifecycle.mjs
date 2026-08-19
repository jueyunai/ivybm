import { randomBytes } from 'node:crypto'

import { Client } from 'pg'

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1'])
const bootstrapDatabaseNamePattern = /(?:_test|_ci)$|^ivybm_(?:mvp_)?e2e_[a-z0-9_-]+$/u
export const generatedDatabaseNamePattern = /^ivybm_e2e_[a-f0-9]{24}_(?:ci|test)$/u

export const assertBootstrapDatabaseURL = (value) => {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('E2E bootstrap DATABASE_URL must be a valid URL')
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('E2E bootstrap DATABASE_URL must use postgres or postgresql')
  }
  const hostname = parsed.hostname.replace(/^\[(.*)\]$/u, '$1')
  if (!loopbackHosts.has(hostname))
    throw new Error('E2E bootstrap database must use a loopback host')
  const name = decodeURIComponent(parsed.pathname.replace(/^\//u, ''))
  if (!bootstrapDatabaseNamePattern.test(name)) {
    throw new Error('E2E bootstrap database must be a project-scoped test database')
  }
  return parsed
}

export const createE2EDatabaseName = (isCI = Boolean(process.env.CI)) => {
  const name = `ivybm_e2e_${randomBytes(12).toString('hex')}_${isCI ? 'ci' : 'test'}`
  if (!generatedDatabaseNamePattern.test(name))
    throw new Error('Generated E2E database name is invalid')
  return name
}

export const databaseURLForName = (bootstrapURL, databaseName) => {
  if (!generatedDatabaseNamePattern.test(databaseName))
    throw new Error('Refusing untrusted E2E database name')
  const url = new URL(bootstrapURL)
  url.pathname = `/${databaseName}`
  return url.toString()
}

const quoteGeneratedIdentifier = (value) => {
  if (!generatedDatabaseNamePattern.test(value))
    throw new Error('Refusing untrusted E2E database identifier')
  return `"${value}"`
}

export const createE2EDatabase = async (bootstrapURL, databaseName) => {
  const validatedBootstrapURL = assertBootstrapDatabaseURL(bootstrapURL)
  const client = new Client({ connectionString: validatedBootstrapURL.toString() })
  await client.connect()
  try {
    await client.query(`CREATE DATABASE ${quoteGeneratedIdentifier(databaseName)}`)
  } finally {
    await client.end()
  }
}

export const dropE2EDatabase = async (bootstrapURL, databaseName) => {
  const validatedBootstrapURL = assertBootstrapDatabaseURL(bootstrapURL)
  const client = new Client({ connectionString: validatedBootstrapURL.toString() })
  await client.connect()
  try {
    await client.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [databaseName],
    )
    await client.query(`DROP DATABASE ${quoteGeneratedIdentifier(databaseName)}`)
  } finally {
    await client.end()
  }
}
