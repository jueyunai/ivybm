import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['tests/contract/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 5_000,
  },
})
