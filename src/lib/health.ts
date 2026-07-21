import packageJson from '../../package.json'

export { DEFAULT_LOCALE } from './i18n'

export type HealthStatus = {
  name: typeof packageJson.name
  status: 'ok'
  version: string
}

export function getHealth(): HealthStatus {
  return {
    name: packageJson.name,
    status: 'ok',
    version: process.env.APP_VERSION || packageJson.version,
  }
}
