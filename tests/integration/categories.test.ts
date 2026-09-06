/**
 * Category CRUD against a real database, including the two rules that keep
 * the data model coherent: the seeded categories are protected, and deleting
 * a category never orphans the transactions filed under it.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { GET as listCategories, POST as createCategory } from '@/app/api/categories/route'
import { DELETE as deleteCategory, PATCH as renameCategory } from '@/app/api/categories/[id]/route'
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

describeDb('categories', () => {
  let user: TestUser

  beforeEach(async () => {
    await resetDb()
    user = await createTestUser()
  })

  const create = (name: unknown) =>
    createCategory(apiRequest('/api/categories', { token: user.token, method: 'POST', body: { name } }))

  const rename = (id: number, name: unknown) =>
    renameCategory(
      apiRequest(`/api/categories/${id}`, { token: user.token, method: 'PATCH', body: { name } }),
      routeParams(id),
    )

  const remove = (id: number) =>
    deleteCategory(
      apiRequest(`/api/categories/${id}`, { token: user.token, method: 'DELETE' }),
      routeParams(id),
    )

  describe('GET /api/categories', () => {
    it('lists the seeded categories and flags them as system', async () => {
      const body = await (await listCategories(apiRequest('/api/categories', { token: user.token }))).json()

      expect(body).toHaveLength(2)
      expect(body.every((c: { is_system: boolean }) => c.is_system)).toBe(true)
    })

    it('returns categories sorted by name', async () => {
      await create('Zebra')
      await create('Apple')
      const body = await (await listCategories(apiRequest('/api/categories', { token: user.token }))).json()

      const names = body.map((c: { name: string }) => c.name)
      expect(names).toEqual([...names].sort())
    })
  })

  describe('POST /api/categories', () => {
    it('creates a custom category, not flagged as system', async () => {
      const res = await create('Groceries')

      expect(res.status).toBe(201)
      expect(await res.json()).toMatchObject({ name: 'Groceries', is_system: false })
    })

    it('trims surrounding whitespace', async () => {
      const body = await (await create('  Travel  ')).json()
      expect(body.name).toBe('Travel')
    })

    it('rejects an exact duplicate with 409', async () => {
      await create('Groceries')
      expect((await create('Groceries')).status).toBe(409)
    })

    it('rejects a case-insensitive duplicate with 409', async () => {
      // The DB's unique index is case-sensitive, so this rule lives in the
      // route — without it a user could end up with both "Food" and "food".
      await create('Groceries')
      expect((await create('GROCERIES')).status).toBe(409)
      expect(await prisma.categories.count({ where: { user_id: user.id } })).toBe(3)
    })

    it.each([
      ['empty', ''],
      ['whitespace only', '   '],
      ['missing', undefined],
      ['non-string', 42],
      ['over the column length', 'a'.repeat(101)],
    ])('rejects a %s name with 422', async (_label, name) => {
      expect((await create(name)).status).toBe(422)
    })
  })

  describe('PATCH /api/categories/:id', () => {
    it('renames a custom category', async () => {
      const created = await (await create('Groceries')).json()
      const res = await rename(created.id, 'Supermarket')

      expect(res.status).toBe(200)
      expect((await res.json()).name).toBe('Supermarket')
    })

    it('keeps the transactions attached across a rename', async () => {
      const created = await (await create('Groceries')).json()
      const txn = await seedTransaction(user, { category_id: created.id })

      await rename(created.id, 'Supermarket')

      const row = await prisma.transactions.findUnique({ where: { id: txn.id } })
      expect(row!.category_id).toBe(created.id)
    })

    it('allows changing only the casing of a name', async () => {
      // The duplicate check has to exclude the row being renamed, or this
      // would collide with itself.
      const created = await (await create('groceries')).json()
      const res = await rename(created.id, 'Groceries')

      expect(res.status).toBe(200)
      expect((await res.json()).name).toBe('Groceries')
    })

    it('rejects renaming to an existing category with 409', async () => {
      await create('Food')
      const other = await (await create('Travel')).json()
      expect((await rename(other.id, 'Food')).status).toBe(409)
    })

    it.each(['שונות', 'הכנסות'])('refuses to rename the protected category %s', async (name) => {
      const category = await prisma.categories.findFirst({ where: { user_id: user.id, name } })
      const res = await rename(category!.id, 'Renamed')

      expect(res.status).toBe(403)
      const unchanged = await prisma.categories.findUnique({ where: { id: category!.id } })
      expect(unchanged!.name).toBe(name)
    })

    it.each(['שונות', 'הכנסות'])('refuses to rename a category *into* the reserved name %s', async (name) => {
      // A second שונות would break the findFirst-by-name lookups the fallback
      // logic depends on.
      const created = await (await create('Temp')).json()
      expect((await rename(created.id, name)).status).toBe(409)
    })

    it('rejects an invalid new name with 422', async () => {
      const created = await (await create('Groceries')).json()
      expect((await rename(created.id, '   ')).status).toBe(422)
      expect((await rename(created.id, 'a'.repeat(101))).status).toBe(422)
    })

    it('returns 404 for a nonexistent category', async () => {
      expect((await rename(999_999, 'Whatever')).status).toBe(404)
    })
  })

  describe('DELETE /api/categories/:id', () => {
    it('deletes a custom category', async () => {
      const created = await (await create('Groceries')).json()
      const res = await remove(created.id)

      expect(res.status).toBe(204)
      expect(await prisma.categories.findUnique({ where: { id: created.id } })).toBeNull()
    })

    it('reassigns the deleted category\'s transactions to שונות', async () => {
      // The rule that keeps deletion non-destructive: spending history must
      // survive, just uncategorized.
      const created = await (await create('Groceries')).json()
      const first = await seedTransaction(user, { category_id: created.id })
      const second = await seedTransaction(user, { category_id: created.id })

      expect((await remove(created.id)).status).toBe(204)

      for (const txn of [first, second]) {
        const row = await prisma.transactions.findUnique({ where: { id: txn.id } })
        expect(row).not.toBeNull()
        expect(row!.category_id).toBe(user.shonotId)
      }
    })

    it('leaves transactions in other categories untouched', async () => {
      const doomed = await (await create('Doomed')).json()
      const kept = await (await create('Kept')).json()
      const kepTxn = await seedTransaction(user, { category_id: kept.id })
      await seedTransaction(user, { category_id: doomed.id })

      await remove(doomed.id)

      const row = await prisma.transactions.findUnique({ where: { id: kepTxn.id } })
      expect(row!.category_id).toBe(kept.id)
    })

    it.each(['שונות', 'הכנסות'])('refuses to delete the protected category %s', async (name) => {
      const category = await prisma.categories.findFirst({ where: { user_id: user.id, name } })
      const res = await remove(category!.id)

      expect(res.status).toBe(403)
      expect(await prisma.categories.findUnique({ where: { id: category!.id } })).not.toBeNull()
    })

    it('returns 404 for a nonexistent category', async () => {
      expect((await remove(999_999)).status).toBe(404)
    })

    it.each(['abc', '-1', '0'])('returns 404 for the malformed id %s', async (id) => {
      const res = await deleteCategory(
        apiRequest(`/api/categories/${id}`, { token: user.token, method: 'DELETE' }),
        routeParams(id),
      )
      expect(res.status).toBe(404)
    })
  })
})
