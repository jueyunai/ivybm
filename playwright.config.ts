import { defineConfig, devices } from '@playwright/test'

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
import 'dotenv/config'

const isCI = Boolean(process.env.CI)
const e2ePort = process.env.E2E_PORT || '3000'
const defaultBaseURL = isCI ? `http://127.0.0.1:${e2ePort}` : 'http://localhost:3000'
const baseURL = process.env.BASE_URL || defaultBaseURL
const usesExternalServer = Boolean(process.env.BASE_URL)

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests/e2e',
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}',
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: isCI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: isCI ? 1 : undefined,
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
        command: isCI ? 'pnpm e2e:server' : 'pnpm dev',
        env: isCI
          ? {
              HOSTNAME: '127.0.0.1',
              PORT: e2ePort,
            }
          : undefined,
        reuseExistingServer: !isCI,
        timeout: 120_000,
        url: isCI ? `${baseURL}/api/health/ready` : baseURL,
      },
})
