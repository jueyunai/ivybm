import { defineConfig, devices } from '@playwright/test'

import {
  E2E_META_APP_SECRET,
  E2E_META_PAGE_ID,
  E2E_META_VERIFY_TOKEN,
} from './tests/e2e/admin-portal-facebook.constants'
import { readE2ELaunchContext } from './tests/e2e/launch-context'

import 'dotenv/config'

const context = readE2ELaunchContext()
const isCI = Boolean(process.env.CI)
const isExternalReadOnly = context.mode === 'readonly-external'
const testMatch = context.specPaths.map((specPath) => specPath.replace(/^tests\/e2e\//u, ''))

export default defineConfig({
  testDir: './tests/e2e',
  testMatch,
  globalSetup: './tests/e2e/global-setup.ts',
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{platform}/{arg}-{projectName}{ext}',
  forbidOnly: !!process.env.CI,
  retries: isCI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: context.baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: isExternalReadOnly
    ? undefined
    : {
        command: isCI ? 'corepack pnpm e2e:server' : 'corepack pnpm dev',
        env: {
          AI_CONFIG_ENCRYPTION_KEY: 'e'.repeat(64),
          HOSTNAME: '127.0.0.1',
          IVYBM_E2E_ALLOW_HTTP_LOOPBACK: 'true',
          META_WEBHOOK_ALLOWED_ACCOUNT_IDS: E2E_META_PAGE_ID,
          META_WEBHOOK_APP_SECRET: E2E_META_APP_SECRET,
          META_WEBHOOK_VERIFY_TOKEN: E2E_META_VERIFY_TOKEN,
          NEXT_PUBLIC_SERVER_URL: context.baseURL,
          PORT: new URL(context.baseURL).port,
          PLATFORM_CREDENTIAL_ENCRYPTION_KEY: 'b'.repeat(64),
        },
        reuseExistingServer: false,
        timeout: 120_000,
        url: isCI ? `${context.baseURL}/api/health/ready` : context.baseURL,
      },
})
