/**
 * Applies the Prisma migrations to the test database.
 *
 * The test suite runs against TEST_DATABASE_URL — a separate schema on the
 * same Postgres server — but `prisma migrate deploy` only reads DATABASE_URL
 * and DIRECT_URL. This remaps them for the child process only, so there is no
 * path by which a stray invocation migrates the production schema.
 *
 * Usage: npm run db:migrate:test
 */
import { spawnSync } from 'node:child_process'
import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })
config({ path: '.env', quiet: true })

const testUrl = process.env.TEST_DATABASE_URL
if (!testUrl) {
  console.error(
    'TEST_DATABASE_URL is not set. Add it to .env.local — see .env.example for the format.',
  )
  process.exit(1)
}

// Guard against the schema qualifier being dropped, which would silently
// point the migration at the production schema.
if (!/[?&]schema=/.test(testUrl)) {
  console.error(
    'TEST_DATABASE_URL must end with a ?schema=... qualifier so tests cannot touch production data.',
  )
  process.exit(1)
}

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, DATABASE_URL: testUrl, DIRECT_URL: testUrl },
})

process.exit(result.status ?? 1)
