/**
 * Transaction CRUD, pagination and monthly-summary tests against a real
 * database — so month boundaries, ordering, aggregation and the float
 * handling are checked as Postgres actually performs them.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { GET as listTransactions, POST as createTransaction } from '@/app/api/transactions/route'
import {
  DELETE as deleteTransaction,
  GET as getTransaction,
  PATCH as updateTransaction,
} from '@/app/api/transactions/[id]/route'
import { PATCH as updateCategoryOfTransaction } from '@/app/api/transactions/[id]/category/route'
import { GET as summary } from '@/app/api/transactions/summary/route'
import { prisma } from '@/lib/db'
import {
  apiRequest,
  createTestUser,
  describeDb,
  resetDb,
  routeParams,
  seedTransaction,
  type TestUser,
} from '../helpers/db'

describeDb('transactions', () => {
  let user: TestUser

  beforeEach(async () => {
    await resetDb()
    user = await createTestUser()
  })

  const post = (body: unknown) =>
    createTransaction(apiRequest('/api/transactions', { token: user.token, method: 'POST', body }))

  const list = (params: Record<string, string | number>) =>
    listTransactions(apiRequest('/api/transactions', { token: user.token, params }))

  describe('POST /api/transactions', () => {
    it('creates an expense and defaults its category to שונות', async () => {
      const res = await post({ date: '2026-03-10', amount: 120.5, business_name: '  Shop  ' })

      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body).toMatchObject({
        date: '2026-03-10',
        amount: 120.5,
        business_name: 'Shop', // trimmed
        category_id: user.shonotId,
        category_name: 'שונות',
      })
    })

    it('forces a negative amount into הכנסות', async () => {
      const res = await post({ date: '2026-03-10', amount: -8000, business_name: 'Salary' })
      const body = await res.json()

      expect(body.category_id).toBe(user.hachnasotId)
      expect(body.category_name).toBe('הכנסות')
    })

    it('stores the date without timezone drift', async () => {
      // A Date parsed at local midnight would land on the previous day in
      // positive-offset zones and move the transaction into the wrong month.
      await post({ date: '2026-01-01', amount: 10, business_name: 'NewYear' })
      const row = await prisma.transactions.findFirst()
      expect(row!.date.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    })

    it.each([
      ['zero amount', { date: '2026-03-01', amount: 0, business_name: 'X' }],
      ['missing amount', { date: '2026-03-01', business_name: 'X' }],
      ['string amount', { date: '2026-03-01', amount: '50', business_name: 'X' }],
      ['blank business name', { date: '2026-03-01', amount: 10, business_name: '   ' }],
      ['missing business name', { date: '2026-03-01', amount: 10 }],
      ['invalid date', { date: '2026-02-30', amount: 10, business_name: 'X' }],
      ['wrong date format', { date: '01/03/2026', amount: 10, business_name: 'X' }],
      ['missing date', { amount: 10, business_name: 'X' }],
      ['NaN-producing amount', { date: '2026-03-01', amount: null, business_name: 'X' }],
    ])('rejects %s with 422 and writes nothing', async (_label, body) => {
      expect((await post(body)).status).toBe(422)
      expect(await prisma.transactions.count()).toBe(0)
    })

    it('rejects a business name longer than the column allows', async () => {
      // Without the length check this surfaces as a Prisma error and a 500.
      const res = await post({ date: '2026-03-01', amount: 10, business_name: 'a'.repeat(256) })
      expect(res.status).toBe(422)
    })

    it('rejects a nonexistent category with 400', async () => {
      const res = await post({
        date: '2026-03-01',
        amount: 10,
        business_name: 'X',
        category_id: 999_999,
      })
      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/transactions/:id', () => {
    it('returns the transaction with its category name', async () => {
      const txn = await seedTransaction(user, { business_name: 'Readable' })
      const res = await getTransaction(
        apiRequest(`/api/transactions/${txn.id}`, { token: user.token }),
        routeParams(txn.id),
      )

      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ id: txn.id, business_name: 'Readable' })
    })

    it('returns 404 for a nonexistent id', async () => {
      const res = await getTransaction(
        apiRequest('/api/transactions/999999', { token: user.token }),
        routeParams(999_999),
      )
      expect(res.status).toBe(404)
    })

    it.each(['abc', '-1', '1.5', '0'])('returns 404 for the malformed id %s', async (id) => {
      const res = await getTransaction(
        apiRequest(`/api/transactions/${id}`, { token: user.token }),
        routeParams(id),
      )
      expect(res.status).toBe(404)
    })
  })

  describe('PATCH /api/transactions/:id', () => {
    it('updates only the fields provided', async () => {
      const txn = await seedTransaction(user, {
        business_name: 'Original',
        amount: 100,
        date: '2026-03-15',
      })

      const res = await updateTransaction(
        apiRequest(`/api/transactions/${txn.id}`, {
          token: user.token,
          method: 'PATCH',
          body: { business_name: 'Renamed' },
        }),
        routeParams(txn.id),
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.business_name).toBe('Renamed')
      // Untouched fields must survive a partial update.
      expect(body.amount).toBe(100)
      expect(body.date).toBe('2026-03-15')
    })

    it('preserves the existing category when only the amount changes', async () => {
      // The category resolver falls back to שונות when given no category, so
      // a partial update has to pass the current one through explicitly.
      const food = await prisma.categories.create({ data: { user_id: user.id, name: 'Food' } })
      const txn = await seedTransaction(user, { category_id: food.id })

      const res = await updateTransaction(
        apiRequest(`/api/transactions/${txn.id}`, {
          token: user.token,
          method: 'PATCH',
          body: { amount: 250 },
        }),
        routeParams(txn.id),
      )

      const body = await res.json()
      expect(body.amount).toBe(250)
      expect(body.category_id).toBe(food.id)
    })

    it('moves a transaction to הכנסות when its amount turns negative', async () => {
      const txn = await seedTransaction(user, { amount: 100 })
      const res = await updateTransaction(
        apiRequest(`/api/transactions/${txn.id}`, {
          token: user.token,
          method: 'PATCH',
          body: { amount: -100 },
        }),
        routeParams(txn.id),
      )

      expect((await res.json()).category_id).toBe(user.hachnasotId)
    })

    it('moves a transaction out of הכנסות when its amount turns positive', async () => {
      // Without this rule an expense would be left sitting in the income
      // category, double-counting it in the breakdown.
      const txn = await seedTransaction(user, { amount: -100, category_id: user.hachnasotId })
      const res = await updateTransaction(
        apiRequest(`/api/transactions/${txn.id}`, {
          token: user.token,
          method: 'PATCH',
          body: { amount: 100 },
        }),
        routeParams(txn.id),
      )

      expect((await res.json()).category_id).toBe(user.shonotId)
    })

    it('rejects an empty patch', async () => {
      const txn = await seedTransaction(user)
      const res = await updateTransaction(
        apiRequest(`/api/transactions/${txn.id}`, { token: user.token, method: 'PATCH', body: {} }),
        routeParams(txn.id),
      )
      expect(res.status).toBe(422)
    })

    it.each([
      ['zero amount', { amount: 0 }],
      ['invalid date', { date: '2026-13-01' }],
      ['blank business name', { business_name: '  ' }],
      ['over-long business name', { business_name: 'a'.repeat(256) }],
    ])('rejects %s with 422 and leaves the row unchanged', async (_label, body) => {
      const txn = await seedTransaction(user, { business_name: 'Untouched', amount: 100 })
      const res = await updateTransaction(
        apiRequest(`/api/transactions/${txn.id}`, { token: user.token, method: 'PATCH', body }),
        routeParams(txn.id),
      )

      expect(res.status).toBe(422)
      const row = await prisma.transactions.findUnique({ where: { id: txn.id } })
      expect(row).toMatchObject({ business_name: 'Untouched', amount: 100 })
    })
  })

  describe('PATCH /api/transactions/:id/category', () => {
    it('changes the category of an expense', async () => {
      const food = await prisma.categories.create({ data: { user_id: user.id, name: 'Food' } })
      const txn = await seedTransaction(user, { amount: 100 })

      const res = await updateCategoryOfTransaction(
        apiRequest(`/api/transactions/${txn.id}/category`, {
          token: user.token,
          method: 'PATCH',
          body: { category_id: food.id },
        }),
        routeParams(txn.id),
      )

      expect(res.status).toBe(200)
      expect((await res.json()).category_name).toBe('Food')
    })

    it('refuses to recategorize income with 403', async () => {
      const txn = await seedTransaction(user, { amount: -500, category_id: user.hachnasotId })
      const food = await prisma.categories.create({ data: { user_id: user.id, name: 'Food' } })

      const res = await updateCategoryOfTransaction(
        apiRequest(`/api/transactions/${txn.id}/category`, {
          token: user.token,
          method: 'PATCH',
          body: { category_id: food.id },
        }),
        routeParams(txn.id),
      )
      expect(res.status).toBe(403)
    })
  })

  describe('DELETE /api/transactions/:id', () => {
    it('deletes the transaction and returns 204', async () => {
      const txn = await seedTransaction(user)
      const res = await deleteTransaction(
        apiRequest(`/api/transactions/${txn.id}`, { token: user.token, method: 'DELETE' }),
        routeParams(txn.id),
      )

      expect(res.status).toBe(204)
      expect(await prisma.transactions.findUnique({ where: { id: txn.id } })).toBeNull()
    })

    it('returns 404 when deleting twice', async () => {
      const txn = await seedTransaction(user)
      const req = () =>
        deleteTransaction(
          apiRequest(`/api/transactions/${txn.id}`, { token: user.token, method: 'DELETE' }),
          routeParams(txn.id),
        )

      expect((await req()).status).toBe(204)
      expect((await req()).status).toBe(404)
    })
  })

  describe('GET /api/transactions — filtering and pagination', () => {
    /** Seeds `count` transactions, all in March 2026, dated day 1..count. */
    async function seedMany(count: number) {
      await prisma.transactions.createMany({
        data: Array.from({ length: count }, (_, i) => ({
          user_id: user.id,
          date: new Date(Date.UTC(2026, 2, (i % 28) + 1)),
          amount: i + 1,
          business_name: `Shop ${i + 1}`,
          category_id: user.shonotId,
        })),
      })
    }

    it('returns only the requested month', async () => {
      await seedTransaction(user, { date: '2026-02-28', business_name: 'February' })
      await seedTransaction(user, { date: '2026-03-01', business_name: 'March first' })
      await seedTransaction(user, { date: '2026-03-31', business_name: 'March last' })
      await seedTransaction(user, { date: '2026-04-01', business_name: 'April' })

      const body = await (await list({ year: 2026, month: 3 })).json()
      const names = body.items.map((t: { business_name: string }) => t.business_name).sort()

      // Boundary dates: the 1st is included, the 1st of the next month is not.
      expect(names).toEqual(['March first', 'March last'])
    })

    it('handles the December→January boundary', async () => {
      await seedTransaction(user, { date: '2026-12-31', business_name: 'December' })
      await seedTransaction(user, { date: '2027-01-01', business_name: 'January' })

      const body = await (await list({ year: 2026, month: 12 })).json()
      expect(body.items).toHaveLength(1)
      expect(body.items[0].business_name).toBe('December')
    })

    it('defaults to a bounded page and reports the full total', async () => {
      await seedMany(120)
      const body = await (await list({ year: 2026, month: 3 })).json()

      expect(body.items).toHaveLength(50) // DEFAULT_PAGE_SIZE
      expect(body.total).toBe(120)
      expect(body.has_more).toBe(true)
      expect(body.offset).toBe(0)
    })

    it('walks every row exactly once across pages, with no repeats or gaps', async () => {
      // The property that actually matters. Many of these transactions share a
      // date, so without the id tiebreaker in the ORDER BY, rows would shuffle
      // between queries and paging would both duplicate and skip records.
      await seedMany(120)

      const seen: number[] = []
      for (let offset = 0; offset < 120; offset += 25) {
        const body = await (await list({ year: 2026, month: 3, limit: 25, offset })).json()
        seen.push(...body.items.map((t: { id: number }) => t.id))
      }

      expect(seen).toHaveLength(120)
      expect(new Set(seen).size).toBe(120)
    })

    it('reports has_more false on the final page', async () => {
      await seedMany(60)
      const body = await (await list({ year: 2026, month: 3, limit: 50, offset: 50 })).json()

      expect(body.items).toHaveLength(10)
      expect(body.has_more).toBe(false)
    })

    it('returns an empty page past the end rather than an error', async () => {
      await seedMany(10)
      const body = await (await list({ year: 2026, month: 3, limit: 50, offset: 500 })).json()

      expect(body.items).toEqual([])
      expect(body.total).toBe(10)
      expect(body.has_more).toBe(false)
    })

    it('returns an empty result for a month with no transactions', async () => {
      const body = await (await list({ year: 2026, month: 7 })).json()
      expect(body).toMatchObject({ items: [], total: 0, has_more: false })
    })

    it('orders by date descending', async () => {
      await seedTransaction(user, { date: '2026-03-01', business_name: 'Oldest' })
      await seedTransaction(user, { date: '2026-03-20', business_name: 'Newest' })

      const body = await (await list({ year: 2026, month: 3 })).json()
      expect(body.items[0].business_name).toBe('Newest')
    })

    it.each([
      ['limit above the cap', { year: 2026, month: 3, limit: 500 }],
      ['limit of zero', { year: 2026, month: 3, limit: 0 }],
      ['negative offset', { year: 2026, month: 3, offset: -1 }],
      ['month 13', { year: 2026, month: 13 }],
      ['month 0', { year: 2026, month: 0 }],
      ['non-numeric month', { year: 2026, month: 'march' }],
    ])('rejects %s with 422', async (_label, params) => {
      expect((await list(params)).status).toBe(422)
    })

    it('requires year and month', async () => {
      expect((await list({})).status).toBe(422)
    })
  })

  describe('GET /api/transactions/summary', () => {
    const getSummary = (year: number, month: number) =>
      summary(
        apiRequest('/api/transactions/summary', { token: user.token, params: { year, month } }),
      )

    it('aggregates totals, income and the per-category breakdown', async () => {
      const food = await prisma.categories.create({ data: { user_id: user.id, name: 'Food' } })
      await seedTransaction(user, { amount: 100, category_id: food.id })
      await seedTransaction(user, { amount: 50, category_id: food.id })
      await seedTransaction(user, { amount: 30, category_id: user.shonotId })
      await seedTransaction(user, { amount: -1000, category_id: user.hachnasotId })

      const body = await (await getSummary(2026, 3)).json()

      expect(body.transaction_count).toBe(4)
      expect(body.total).toBe(-820) // net: 100 + 50 + 30 - 1000
      expect(body.expense_total).toBe(180)
      expect(body.income_total).toBe(1000) // reported positive

      // Sorted by total descending, income excluded from the slices.
      expect(body.by_category).toEqual([
        { category_id: food.id, category_name: 'Food', total: 150 },
        { category_id: user.shonotId, category_name: 'שונות', total: 30 },
      ])
    })

    it('rounds float sums to cents', async () => {
      // Summing float8 in Postgres yields values like 0.30000000000000004,
      // which would render as a long decimal string in the chart tooltip.
      await seedTransaction(user, { amount: 0.1 })
      await seedTransaction(user, { amount: 0.2 })

      const body = await (await getSummary(2026, 3)).json()
      expect(body.by_category[0].total).toBe(0.3)
    })

    it('returns zeroes for an empty month rather than nulls', async () => {
      const body = await (await getSummary(2026, 9)).json()
      expect(body).toMatchObject({
        total: 0,
        transaction_count: 0,
        income_total: 0,
        expense_total: 0,
        by_category: [],
      })
    })

    it('excludes income from the category breakdown entirely', async () => {
      await seedTransaction(user, { amount: -500, category_id: user.hachnasotId })
      const body = await (await getSummary(2026, 3)).json()

      expect(body.by_category).toEqual([])
      expect(body.income_total).toBe(500)
    })

    it('rejects an invalid month with 422', async () => {
      expect((await getSummary(2026, 0)).status).toBe(422)
    })
  })
})
