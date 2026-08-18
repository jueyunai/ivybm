import { defineConfig, devices } from '@playwright/test'

import {
  E2E_META_APP_SECRET,
  E2E_META_PAGE_ID,
  E2E_META_VERIFY_TOKEN,
} from './tests/e2e/admin-portal-facebook.constants'
import { assertMutationE2ETarget } from './tests/e2e/mutation-safety'

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
import 'dotenv/config'

assertMutationE2ETarget()

const isCI = Boolean(process.env.CI)
const e2ePort = process.env.E2E_PORT || '3000'
const devPort = process.env.PORT || '3001'
// Chromium grants localhost a secure-context exception, which lets production-mode
// Secure session cookies work without weakening Payload's cookie configuration.
const defaultBaseURL = `http://localhost:${isCI ? e2ePort : devPort}`
const baseURL = process.env.BASE_URL || defaultBaseURL
const usesExternalServer = Boolean(process.env.BASE_URL)
const e2eEncryptionKey = process.env.AI_CONFIG_ENCRYPTION_KEY || 'e'.repeat(64)

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests/e2e',
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{platform}/{arg}-{projectName}{ext}',
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: isCI ? 2 : 0,
  // All Portal browser scenarios share one local seed account. Run serially so
  // login failure protection is exercised without tests locking each other out.
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: usesExternalServer
    ? undefined
    : {
        command: isCI ? 'corepack pnpm e2e:server' : 'corepack pnpm dev',
        env: {
          AI_CONFIG_ENCRYPTION_KEY: e2eEncryptionKey,
          META_WEBHOOK_ALLOWED_ACCOUNT_IDS: E2E_META_PAGE_ID,
          META_WEBHOOK_APP_SECRET: E2E_META_APP_SECRET,
          META_WEBHOOK_VERIFY_TOKEN: E2E_META_VERIFY_TOKEN,
          NEXT_PUBLIC_SERVER_URL: baseURL,
          ...(isCI ? { IVYBM_E2E_ALLOW_HTTP_LOOPBACK: 'true' } : {}),
          PORT: isCI ? e2ePort : devPort,
          ...(isCI ? { HOSTNAME: '127.0.0.1' } : {}),
        },
        reuseExistingServer: !isCI,
        timeout: 120_000,
        url: isCI ? `${baseURL}/api/health/ready` : baseURL,
      },
})
