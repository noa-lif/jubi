/**
 * Unit tests for the transaction domain helpers.
 *
 * resolveCategoryId encodes the app's central business rule — income is
 * always filed under הכנסות, expenses fall back to שונות, and a category
 * belonging to another user is never usable — so it is tested here against a
 * stub Prisma client rather than only through the routes.
 */
import { describe, expect, it } from 'vitest'
import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/errors'
import {
  monthRange,
  parseDateOnly,
  resolveCategoryId,
  toDateOnlyString,
  transactionToResponse,
} from '@/lib/transactions'

interface StubCategory {
  id: number
  user_id: number | null
  name: string
}

/**
 * Minimal stand-in for Prisma.TransactionClient covering the two calls
 * resolveCategoryId makes. Using a stub keeps this suite fast and hermetic;
 * the same rules are re-verified against a real database in the integration
 * tests.
 */
function stubClient(categories: StubCategory[]): Prisma.TransactionClient {
  return {
    categories: {
      findFirst: async ({ where }: { where: { user_id: number; name: string } }) =>
        categories.find((c) => c.user_id === where.user_id && c.name === where.name) ?? null,
      findUnique: async ({ where }: { where: { id: number } }) =>
        categories.find((c) => c.id === where.id) ?? null,
    },
  } as unknown as Prisma.TransactionClient
}

const USER = 1
const OTHER_USER = 2

const CATEGORIES: StubCategory[] = [
  { id: 10, user_id: USER, name: 'שונות' },
  { id: 11, user_id: USER, name: 'הכנסות' },
  { id: 12, user_id: USER, name: 'מזון' },
  { id: 99, user_id: OTHER_USER, name: 'מזון של מישהו אחר' },
]

describe('monthRange', () => {
  it('spans exactly one month as a half-open [start, end) range', () => {
    const { start, end } = monthRange(2026, 3)
    expect(start.toISOString()).toBe('2026-03-01T00:00:00.000Z')
    expect(end.toISOString()).toBe('2026-04-01T00:00:00.000Z')
  })

  it('rolls over the year for December', () => {
    // The off-by-one that a naive `month + 1` would produce here (month 13)
    // is the reason this case is called out explicitly.
    const { start, end } = monthRange(2026, 12)
    expect(start.toISOString()).toBe('2026-12-01T00:00:00.000Z')
    expect(end.toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })

  it('handles February in a leap year', () => {
    const { end } = monthRange(2024, 2)
    expect(end.toISOString()).toBe('2024-03-01T00:00:00.000Z')
  })

  it('excludes the first instant of the next month', () => {
    // Half-open is what stops a transaction dated the 1st from being counted
    // in both the previous month and the current one.
    const { end } = monthRange(2026, 1)
    const firstOfFeb = new Date(Date.UTC(2026, 1, 1))
    expect(end.getTime()).toBe(firstOfFeb.getTime())
  })
})

describe('parseDateOnly / toDateOnlyString', () => {
  it('round-trips a date string unchanged', () => {
    expect(toDateOnlyString(parseDateOnly('2026-07-04'))).toBe('2026-07-04')
  })

  it('parses to UTC midnight, not local midnight', () => {
    // Local-midnight parsing shifts the date by a day in some timezones, which
    // would file a transaction under the wrong month near month boundaries.
    expect(parseDateOnly('2026-01-01').toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })
})

describe('transactionToResponse', () => {
  it('formats the date and flattens the category relation', () => {
    const response = transactionToResponse({
      id: 5,
      user_id: USER,
      date: new Date(Date.UTC(2026, 4, 20)),
      amount: 99.9,
      business_name: 'שופרסל',
      category_id: 12,
      categories: { id: 12, user_id: USER, name: 'מזון' },
    })

    expect(response).toEqual({
      id: 5,
      date: '2026-05-20',
      amount: 99.9,
      business_name: 'שופרסל',
      category_id: 12,
      category_name: 'מזון',
    })
  })

  it('reports a null category rather than throwing', () => {
    const response = transactionToResponse({
      id: 6,
      user_id: USER,
      date: new Date(Date.UTC(2026, 0, 1)),
      amount: 10,
      business_name: 'x',
      category_id: null,
      categories: null,
    })
    expect(response.category_name).toBeNull()
    expect(response.category_id).toBeNull()
  })
})

describe('resolveCategoryId', () => {
  const client = stubClient(CATEGORIES)

  it('forces income (negative amount) into הכנסות', async () => {
    expect(await resolveCategoryId(client, USER, -5000, null)).toBe(11)
  })

  it('forces income into הכנסות even when another category is requested', async () => {
    // A client could post a salary with category "מזון"; the sign wins.
    expect(await resolveCategoryId(client, USER, -5000, 12)).toBe(11)
  })

  it('falls back to שונות when an expense has no category', async () => {
    expect(await resolveCategoryId(client, USER, 250, null)).toBe(10)
    expect(await resolveCategoryId(client, USER, 250, undefined)).toBe(10)
  })

  it('keeps a valid category the user owns', async () => {
    expect(await resolveCategoryId(client, USER, 250, 12)).toBe(12)
  })

  it("rejects another user's category", async () => {
    // The authorization rule that stops one account referencing another's data.
    await expect(resolveCategoryId(client, USER, 250, 99)).rejects.toThrow(ApiError)
    await expect(resolveCategoryId(client, USER, 250, 99)).rejects.toThrow('Invalid category')
  })

  it('rejects a category that does not exist', async () => {
    await expect(resolveCategoryId(client, USER, 250, 12345)).rejects.toThrow(ApiError)
  })

  it('redirects an expense filed under הכנסות to שונות', async () => {
    // The mirror of the income rule: without it, editing an income
    // transaction's amount to positive would strand it in the income category
    // and corrupt the expense breakdown.
    expect(await resolveCategoryId(client, USER, 250, 11)).toBe(10)
  })

  it('treats a zero amount as an expense', async () => {
    // Zero is rejected upstream by validateAmount; this documents that the
    // `< 0` boundary here is exclusive, so the two rules agree.
    expect(await resolveCategoryId(client, USER, 0, null)).toBe(10)
  })

  it('returns null when the fallback category is missing entirely', async () => {
    // Degrades to an uncategorized transaction rather than throwing, so a
    // user whose seed categories were deleted can still record spending.
    const bare = stubClient([])
    expect(await resolveCategoryId(bare, USER, 250, null)).toBeNull()
    expect(await resolveCategoryId(bare, USER, -250, null)).toBeNull()
  })

  it('sets the ApiError status to 400 so the route returns a client error', async () => {
    await expect(resolveCategoryId(client, USER, 250, 99)).rejects.toMatchObject({ status: 400 })
  })
})
