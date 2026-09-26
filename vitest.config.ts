import { defineConfig } from 'vitest/config'

// Engine tests run in Node; the UI is not unit-tested yet.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/engine-src/**/*.ts'],
      exclude: ['src/engine-src/**/__tests__/**'],
      thresholds: { lines: 90 },
    },
  },
})
