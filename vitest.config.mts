import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  // tsconfigPaths resolves the "@/..." aliases from tsconfig.json so tests
  // import modules exactly the way the app does.
  plugins: [tsconfigPaths(), react()],
  resolve: {
    // Explicit fallback: tsconfigPaths only rewrites imports in files covered
    // by the tsconfig "include" globs, which makes alias resolution quietly
    // dependent on that list. Declaring the alias directly keeps it working.
    alias: {
      '@': dirname(fileURLToPath(import.meta.url)),
    },
  },
  test: {
    // Node is the default because most of the suite exercises server-side
    // code (validators, domain helpers, route handlers). Component test files
    // opt into a browser-like DOM with a `@vitest-environment jsdom` docblock.
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Route-handler tests share one database schema, so they must not run
    // concurrently with each other — see tests/helpers/db.ts.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
