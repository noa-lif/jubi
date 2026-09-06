/**
 * Helpers for the database-backed route tests.
 *
 * These tests run against a real Postgres — the same Supabase project as the
 * app, but an isolated schema (TEST_DATABASE_URL ends with `?schema=...`), so
 * they exercise the actual constraints, cascades and unique indexes rather
 * than a mock's idea of them, while never touching production rows.
 *
 * tests/setup.ts points the Prisma client at that URL before any app module
 * is imported. When TEST_DATABASE_URL is absent the suites skip themselves
 * instead of falling back to the production database.
 */
import { describe } from 'vitest'
import { createAccessToken } from '@/lib/auth'
import { HACHNASOT, SHONOT } from '@/lib/categories'
import { prisma } from '@/lib/db'

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL)

/**
 * `describe` that skips when no test database is configured, so `npm test`
 * still passes on a machine with no database access.
 */
export const describeDb = hasTestDb ? describe : describe.skip

/**
 * Empties every table between tests. RESTART IDENTITY keeps sequence values
 * predictable, and CASCADE handles the FK graph in one statement so the
 * delete order doesn't have to be maintained by hand.
 */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE transactions, file_imports, password_reset_tokens, categories, users RESTART IDENTITY CASCADE',
  )
}

/**
 * A precomputed bcrypt hash of TEST_PASSWORD. Hashing at cost factor 12 takes
 * roughly 100ms, which is pure waste in the many tests that never log in — so
 * it is computed once, here, rather than per user.
 */
export const TEST_PASSWORD = 'password123'
export const TEST_PASSWORD_HASH = '$2b$12$efBKTP2U6Tv5Y6qPyhnpROIHdVWe7XWkEUCCg11IDRnQgqys5MYQ2'

export interface TestUser {
  id: number
  email: string
  token: string
  shonotId: number
  hachnasotId: number
}

/**
 * Creates a user with the two seed categories every real signup produces,
 * plus a valid bearer token. Built directly rather than through the signup
 * route so that tests for *other* endpoints don't fail for signup's reasons.
 */
export async function createTestUser(email = `user${Date.now()}@example.com`): Promise<TestUser> {
  const user = await prisma.users.create({
    data: {
      email,
      password_hash: TEST_PASSWORD_HASH,
      id_number: String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
    },
  })

  const shonot = await prisma.categories.create({ data: { user_id: user.id, name: SHONOT } })
  const hachnasot = await prisma.categories.create({ data: { user_id: user.id, name: HACHNASOT } })

  return {
    id: user.id,
    email: user.email,
    token: await createAccessToken(user.id),
    shonotId: shonot.id,
    hachnasotId: hachnasot.id,
  }
}

interface RequestOptions {
  method?: string
  token?: string | null
  body?: unknown
  params?: Record<string, string | number>
}

/**
 * Builds a Request for a route handler. Route handlers take a plain Request,
 * so they can be invoked directly — no HTTP server needed, and the assertions
 * still cover the real auth, validation and database code paths.
 */
export function apiRequest(path: string, options: RequestOptions = {}): Request {
  const url = new URL(`http://localhost${path}`)
  for (const [key, value] of Object.entries(options.params ?? {})) {
    url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = {}
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  return new Request(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
}

/** Route context shape for dynamic segments, e.g. /api/transactions/[id]. */
export const routeParams = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) })

/** Seeds a transaction directly, bypassing the API. */
export async function seedTransaction(
  user: TestUser,
  overrides: Partial<{ date: string; amount: number; business_name: string; category_id: number | null }> = {},
) {
  const date = overrides.date ?? '2026-03-15'
  return prisma.transactions.create({
    data: {
      user_id: user.id,
      date: new Date(`${date}T00:00:00.000Z`),
      amount: overrides.amount ?? 100,
      business_name: overrides.business_name ?? 'Test Shop',
      category_id: overrides.category_id === undefined ? user.shonotId : overrides.category_id,
    },
  })
}
