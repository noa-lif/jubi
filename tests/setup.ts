/**
 * Global test setup. Runs before any test file is imported, which matters:
 * lib/db.ts and lib/auth.ts both read environment variables at module load,
 * so those variables have to exist before the first import of app code.
 */
import { config } from 'dotenv'
import '@testing-library/jest-dom/vitest'

// Load .env.local then .env, matching how Next.js layers them. `override`
// stays false so a variable already set in the shell (CI) wins.
config({ path: '.env.local', quiet: true })
config({ path: '.env', quiet: true })

// A fixed, obviously-fake secret: tests must never depend on the real signing
// key, and tokens minted here should not be valid against any real deployment.
process.env.JWT_SECRET = 'test-only-secret-not-used-by-any-deployment'
process.env.JWT_EXPIRES_IN = '1h'

/**
 * Database tests run against TEST_DATABASE_URL, never DATABASE_URL. Pointing
 * the Prisma client at it here (before lib/db.ts is loaded) is what keeps the
 * suite off the production data; if it is not set, the database tests skip
 * themselves rather than silently falling back to production.
 */
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  process.env.DIRECT_URL = process.env.TEST_DATABASE_URL
} else {
  // Leave a value in place so importing lib/db.ts doesn't throw in the
  // pure-unit suites, which never open a connection.
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused'
  process.env.DIRECT_URL ??= process.env.DATABASE_URL
}
