/**
 * Authorization tests: every endpoint, checked from two angles.
 *
 *   1. Unauthenticated requests are refused.
 *   2. An authenticated user cannot reach another user's data.
 *
 * The app has a single role, so authorization is entirely about ownership
 * scoping — which makes these the tests that matter most. They are written
 * per-endpoint rather than as one generic loop, because a missed `user_id`
 * filter on a single handler is exactly the bug they exist to catch.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { GET as listCategories, POST as createCategory } from '@/app/api/categories/route'
import {
  DELETE as deleteCategory,
  PATCH as renameCategory,
} from '@/app/api/categories/[id]/route'
import { GET as listTransactions, POST as createTransaction } from '@/app/api/transactions/route'
import {
  DELETE as deleteTransaction,
  GET as getTransaction,
  PATCH as updateTransaction,
} from '@/app/api/transactions/[id]/route'
import { PATCH as updateCategoryOfTransaction } from '@/app/api/transactions/[id]/category/route'
import { POST as batchDelete } from '@/app/api/transactions/batch-delete/route'
import { GET as summary } from '@/app/api/transactions/summary/route'
import { GET as me } from '@/app/api/auth/me/route'
import { POST as upload } from '@/app/api/uploads/route'
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

describeDb('authorization', () => {
  let alice: TestUser
  let bob: TestUser

  beforeEach(async () => {
    await resetDb()
    alice = await createTestUser('alice@example.com')
    bob = await createTestUser('bob@example.com')
  })

  describe('unauthenticated access is refused', () => {
    it('GET /api/auth/me', async () => {
      expect((await me(apiRequest('/api/auth/me'))).status).toBe(401)
    })

    it('GET /api/transactions', async () => {
      const req = apiRequest('/api/transactions', { params: { year: 2026, month: 3 } })
      expect((await listTransactions(req)).status).toBe(401)
    })

    it('POST /api/transactions', async () => {
      const req = apiRequest('/api/transactions', {
        method: 'POST',
        body: { date: '2026-03-01', amount: 10, business_name: 'X' },
      })
      expect((await createTransaction(req)).status).toBe(401)
      // The write must not have happened.
      expect(await prisma.transactions.count()).toBe(0)
    })

    it('GET /api/transactions/summary', async () => {
      const req = apiRequest('/api/transactions/summary', { params: { year: 2026, month: 3 } })
      expect((await summary(req)).status).toBe(401)
    })

    it('GET/PATCH/DELETE /api/transactions/:id', async () => {
      const txn = await seedTransaction(alice)
      const params = routeParams(txn.id)

      expect((await getTransaction(apiRequest(`/api/transactions/${txn.id}`), params)).status).toBe(401)
      expect(
        (
          await updateTransaction(
            apiRequest(`/api/transactions/${txn.id}`, { method: 'PATCH', body: { amount: 1 } }),
            params,
          )
        ).status,
      ).toBe(401)
      expect(
        (await deleteTransaction(apiRequest(`/api/transactions/${txn.id}`, { method: 'DELETE' }), params))
          .status,
      ).toBe(401)

      expect(await prisma.transactions.count()).toBe(1)
    })

    it('POST /api/transactions/batch-delete', async () => {
      const txn = await seedTransaction(alice)
      const req = apiRequest('/api/transactions/batch-delete', {
        method: 'POST',
        body: { ids: [txn.id] },
      })
      expect((await batchDelete(req)).status).toBe(401)
      expect(await prisma.transactions.count()).toBe(1)
    })

    it('GET/POST /api/categories', async () => {
      expect((await listCategories(apiRequest('/api/categories'))).status).toBe(401)
      const req = apiRequest('/api/categories', { method: 'POST', body: { name: 'X' } })
      expect((await createCategory(req)).status).toBe(401)
    })

    it('PATCH/DELETE /api/categories/:id', async () => {
      const category = await prisma.categories.create({
        data: { user_id: alice.id, name: 'Groceries' },
      })
      const params = routeParams(category.id)

      expect(
        (
          await renameCategory(
            apiRequest(`/api/categories/${category.id}`, { method: 'PATCH', body: { name: 'New' } }),
            params,
          )
        ).status,
      ).toBe(401)
      expect(
        (await deleteCategory(apiRequest(`/api/categories/${category.id}`, { method: 'DELETE' }), params))
          .status,
      ).toBe(401)
    })

    it('POST /api/uploads', async () => {
      expect((await upload(apiRequest('/api/uploads', { method: 'POST' }))).status).toBe(401)
    })
  })

  describe('transactions are scoped to their owner', () => {
    it('does not list another user\'s transactions', async () => {
      await seedTransaction(alice, { business_name: "Alice's shop" })
      await seedTransaction(bob, { business_name: "Bob's shop" })

      const res = await listTransactions(
        apiRequest('/api/transactions', { token: alice.token, params: { year: 2026, month: 3 } }),
      )
      const body = await res.json()

      expect(body.items).toHaveLength(1)
      expect(body.items[0].business_name).toBe("Alice's shop")
      expect(body.total).toBe(1)
    })

    it('excludes another user\'s transactions from the monthly summary', async () => {
      await seedTransaction(alice, { amount: 100 })
      await seedTransaction(bob, { amount: 999 })

      const res = await summary(
        apiRequest('/api/transactions/summary', {
          token: alice.token,
          params: { year: 2026, month: 3 },
        }),
      )
      const body = await res.json()

      expect(body.total).toBe(100)
      expect(body.transaction_count).toBe(1)
    })

    it('returns 404 — not 403 — when reading another user\'s transaction', async () => {
      // 403 would confirm the row exists, leaking that another account holds
      // that id. 404 makes it indistinguishable from a nonexistent record.
      const bobTxn = await seedTransaction(bob)
      const res = await getTransaction(
        apiRequest(`/api/transactions/${bobTxn.id}`, { token: alice.token }),
        routeParams(bobTxn.id),
      )
      expect(res.status).toBe(404)
    })

    it('refuses to update another user\'s transaction', async () => {
      const bobTxn = await seedTransaction(bob, { business_name: 'Bob original' })
      const res = await updateTransaction(
        apiRequest(`/api/transactions/${bobTxn.id}`, {
          token: alice.token,
          method: 'PATCH',
          body: { business_name: 'Hacked' },
        }),
        routeParams(bobTxn.id),
      )

      expect(res.status).toBe(404)
      const unchanged = await prisma.transactions.findUnique({ where: { id: bobTxn.id } })
      expect(unchanged!.business_name).toBe('Bob original')
    })

    it('refuses to recategorize another user\'s transaction', async () => {
      const bobTxn = await seedTransaction(bob)
      const res = await updateCategoryOfTransaction(
        apiRequest(`/api/transactions/${bobTxn.id}/category`, {
          token: alice.token,
          method: 'PATCH',
          body: { category_id: alice.shonotId },
        }),
        routeParams(bobTxn.id),
      )
      expect(res.status).toBe(404)
    })

    it('refuses to delete another user\'s transaction', async () => {
      const bobTxn = await seedTransaction(bob)
      const res = await deleteTransaction(
        apiRequest(`/api/transactions/${bobTxn.id}`, { token: alice.token, method: 'DELETE' }),
        routeParams(bobTxn.id),
      )

      expect(res.status).toBe(404)
      expect(await prisma.transactions.findUnique({ where: { id: bobTxn.id } })).not.toBeNull()
    })

    it('batch-delete silently ignores ids belonging to another user', async () => {
      // The bulk endpoint is the easiest place to leak a cross-user write,
      // because it takes a list of ids straight from the request body.
      const aliceTxn = await seedTransaction(alice)
      const bobTxn = await seedTransaction(bob)

      const res = await batchDelete(
        apiRequest('/api/transactions/batch-delete', {
          token: alice.token,
          method: 'POST',
          body: { ids: [aliceTxn.id, bobTxn.id] },
        }),
      )

      expect(res.status).toBe(204)
      expect(await prisma.transactions.findUnique({ where: { id: aliceTxn.id } })).toBeNull()
      expect(await prisma.transactions.findUnique({ where: { id: bobTxn.id } })).not.toBeNull()
    })

    it('refuses to assign another user\'s category to your own transaction', async () => {
      const bobCategory = await prisma.categories.create({
        data: { user_id: bob.id, name: "Bob's category" },
      })

      const res = await createTransaction(
        apiRequest('/api/transactions', {
          token: alice.token,
          method: 'POST',
          body: {
            date: '2026-03-01',
            amount: 50,
            business_name: 'Shop',
            category_id: bobCategory.id,
          },
        }),
      )

      expect(res.status).toBe(400)
      expect(await prisma.transactions.count()).toBe(0)
    })
  })

  describe('categories are scoped to their owner', () => {
    it('does not list another user\'s categories', async () => {
      await prisma.categories.create({ data: { user_id: bob.id, name: "Bob's secret" } })

      const res = await listCategories(apiRequest('/api/categories', { token: alice.token }))
      const body = await res.json()

      expect(body.map((c: { name: string }) => c.name).sort()).toEqual(['הכנסות', 'שונות'])
    })

    it('refuses to rename another user\'s category', async () => {
      const bobCategory = await prisma.categories.create({
        data: { user_id: bob.id, name: 'Bob original' },
      })

      const res = await renameCategory(
        apiRequest(`/api/categories/${bobCategory.id}`, {
          token: alice.token,
          method: 'PATCH',
          body: { name: 'Hacked' },
        }),
        routeParams(bobCategory.id),
      )

      expect(res.status).toBe(404)
      const unchanged = await prisma.categories.findUnique({ where: { id: bobCategory.id } })
      expect(unchanged!.name).toBe('Bob original')
    })

    it('refuses to delete another user\'s category', async () => {
      const bobCategory = await prisma.categories.create({
        data: { user_id: bob.id, name: 'Bob category' },
      })

      const res = await deleteCategory(
        apiRequest(`/api/categories/${bobCategory.id}`, { token: alice.token, method: 'DELETE' }),
        routeParams(bobCategory.id),
      )

      expect(res.status).toBe(404)
      expect(await prisma.categories.findUnique({ where: { id: bobCategory.id } })).not.toBeNull()
    })

    it('lets two users hold categories with the same name independently', async () => {
      await createCategory(
        apiRequest('/api/categories', { token: alice.token, method: 'POST', body: { name: 'Food' } }),
      )
      const res = await createCategory(
        apiRequest('/api/categories', { token: bob.token, method: 'POST', body: { name: 'Food' } }),
      )

      // Uniqueness is per-user, so this must not collide.
      expect(res.status).toBe(201)
      expect(await prisma.categories.count({ where: { name: 'Food' } })).toBe(2)
    })
  })

  describe('account deletion cascades', () => {
    it('removes the user\'s categories and transactions, leaving other users intact', async () => {
      await seedTransaction(alice)
      await seedTransaction(bob)

      await prisma.users.delete({ where: { id: alice.id } })

      expect(await prisma.transactions.count({ where: { user_id: alice.id } })).toBe(0)
      expect(await prisma.categories.count({ where: { user_id: alice.id } })).toBe(0)
      expect(await prisma.transactions.count({ where: { user_id: bob.id } })).toBe(1)
    })
  })
})
