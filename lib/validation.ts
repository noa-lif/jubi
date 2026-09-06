/**
 * Pure input validators shared by the API route handlers.
 *
 * Why a separate module rather than inline checks in each route:
 *   - The same rules are needed in more than one place (e.g. a transaction's
 *     amount is validated on both POST and PATCH), and drift between two
 *     copies of a rule is exactly the kind of bug that reaches production.
 *   - Being pure and free of Next/Prisma imports, they can be unit-tested
 *     directly without a database or a request object.
 *
 * Every validator returns a discriminated union instead of throwing, so the
 * caller decides the HTTP status and the handler stays linear.
 */

export type Valid<T> = { ok: true; value: T }
export type Invalid = { ok: false; error: string }
export type Validated<T> = Valid<T> | Invalid

const ok = <T>(value: T): Valid<T> => ({ ok: true, value })
const fail = (error: string): Invalid => ({ ok: false, error })

// Column widths from prisma/schema.prisma. Enforced here so an over-long
// value returns a 422 instead of surfacing as a Prisma "value too long for
// type character varying" error, which would escape the handler as a 500.
export const MAX_BUSINESS_NAME = 255
export const MAX_CATEGORY_NAME = 100
export const MAX_EMAIL = 255

// Guards against absurd values that are almost certainly a typo or an
// overflow probe. Well beyond any realistic personal transaction.
export const MAX_AMOUNT = 1_000_000_000

/** RFC-5322 is impractical to match; this rejects the mistakes users actually make. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Normalizes to lowercase + trimmed, which is also how emails are stored. */
export function validateEmail(raw: unknown): Validated<string> {
  if (typeof raw !== 'string') return fail('Invalid email address')
  const email = raw.trim().toLowerCase()
  if (!email || !EMAIL_RE.test(email)) return fail('Invalid email address')
  if (email.length > MAX_EMAIL) return fail('Invalid email address')
  return ok(email)
}

export function validatePassword(raw: unknown): Validated<string> {
  if (typeof raw !== 'string') return fail('Password must be at least 8 characters')
  if (raw.length < 8) return fail('Password must be at least 8 characters')
  // bcrypt silently truncates input beyond 72 bytes, so anything longer would
  // make the extra characters meaningless security theatre. Reject instead.
  // TextEncoder rather than Buffer: this module is imported by client
  // components too, and Buffer is not defined in the browser.
  if (new TextEncoder().encode(raw).length > 72) return fail('Password must be at most 72 bytes')
  return ok(raw)
}

/**
 * Israeli ID (תעודת זהות) checksum — a Luhn variant over 9 digits, where
 * shorter IDs are left-padded with zeros. Single source of truth: the signup
 * route and the signup form both go through this.
 */
export function validateIsraeliId(raw: unknown): Validated<string> {
  if (typeof raw !== 'string') return fail('Invalid Israeli ID number')
  const trimmed = raw.trim()
  if (!trimmed) return fail('Invalid Israeli ID number')

  const padded = trimmed.padStart(9, '0')
  if (!/^\d{9}$/.test(padded)) return fail('Invalid Israeli ID number')

  let total = 0
  for (let i = 0; i < 9; i++) {
    let n = Number(padded[i]) * (i % 2 === 0 ? 1 : 2)
    if (n > 9) n -= 9
    total += n
  }
  return total % 10 === 0 ? ok(padded) : fail('Invalid Israeli ID number')
}

/**
 * Accepts a strict yyyy-mm-dd string and rejects calendar-invalid dates
 * (2025-02-30, 2025-13-01). Returns a UTC-midnight Date, matching how
 * Postgres DATE columns round-trip through Prisma.
 */
export function validateDateOnly(raw: unknown): Validated<Date> {
  if (typeof raw !== 'string' || !DATE_RE.test(raw)) return fail('Invalid date')

  const [year, month, day] = raw.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  // Date.UTC silently rolls overflow forward (Feb 30 -> Mar 2), so compare the
  // round-tripped parts to catch it.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return fail('Invalid date')
  }
  return ok(date)
}

/**
 * A transaction amount. Positive = expense, negative = income; zero is
 * meaningless and rejected. NaN/Infinity are rejected explicitly because
 * they survive a `typeof === 'number'` check and would poison the DB.
 */
export function validateAmount(raw: unknown): Validated<number> {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fail('Invalid amount')
  if (raw === 0) return fail('Amount cannot be zero')
  if (Math.abs(raw) > MAX_AMOUNT) return fail('Amount is out of range')
  return ok(raw)
}

export function validateBusinessName(raw: unknown): Validated<string> {
  if (typeof raw !== 'string') return fail('business_name is required')
  const name = raw.trim()
  if (!name) return fail('business_name is required')
  if (name.length > MAX_BUSINESS_NAME) {
    return fail(`business_name must be at most ${MAX_BUSINESS_NAME} characters`)
  }
  return ok(name)
}

export function validateCategoryName(raw: unknown): Validated<string> {
  if (typeof raw !== 'string') return fail('Category name cannot be empty')
  const name = raw.trim()
  if (!name) return fail('Category name cannot be empty')
  if (name.length > MAX_CATEGORY_NAME) {
    return fail(`Category name must be at most ${MAX_CATEGORY_NAME} characters`)
  }
  return ok(name)
}

/** An optional foreign key: absent/null means "unset", anything else must be a positive integer id. */
export function validateOptionalId(raw: unknown): Validated<number | null> {
  if (raw === undefined || raw === null) return ok(null)
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) return fail('Invalid category')
  return ok(raw)
}

/** A path segment like "/api/transactions/12" — must be a positive integer. */
export function parseRouteId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function validateYearMonth(
  yearRaw: string | null,
  monthRaw: string | null,
): Validated<{ year: number; month: number }> {
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const invalid = fail('year and month (1-12) are required')

  if (!yearRaw || !monthRaw) return invalid
  if (!Number.isInteger(year) || !Number.isInteger(month)) return invalid
  if (month < 1 || month > 12) return invalid
  // Bounds the range so a query can't be aimed at year 0 or year 999999.
  if (year < 1970 || year > 2200) return invalid

  return ok({ year, month })
}

// Pagination defaults. The cap exists so a single request can't be used to
// pull an unbounded number of rows out of the database.
export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 200

/**
 * Parses `limit`/`offset` query params. Both are optional; an absent value
 * takes the default, an unparseable or out-of-range one is an error rather
 * than being silently clamped, so a buggy caller finds out.
 */
export function validatePagination(
  limitRaw: string | null,
  offsetRaw: string | null,
): Validated<{ limit: number; offset: number }> {
  let limit = DEFAULT_PAGE_SIZE
  if (limitRaw !== null && limitRaw !== '') {
    const parsed = Number(limitRaw)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PAGE_SIZE) {
      return fail(`limit must be an integer between 1 and ${MAX_PAGE_SIZE}`)
    }
    limit = parsed
  }

  let offset = 0
  if (offsetRaw !== null && offsetRaw !== '') {
    const parsed = Number(offsetRaw)
    if (!Number.isInteger(parsed) || parsed < 0) {
      return fail('offset must be a non-negative integer')
    }
    offset = parsed
  }

  return ok({ limit, offset })
}
