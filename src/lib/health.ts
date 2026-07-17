import packageJson from '../../package.json'

export const DEFAULT_LOCALE = 'en' as const

export type HealthStatus = {
  name: typeof packageJson.name
  status: 'ok'
  version: typeof packageJson.version
}

export function getHealth(): HealthStatus {
  return {
    name: packageJson.name,
    status: 'ok',
    version: packageJson.version,
  }
}
