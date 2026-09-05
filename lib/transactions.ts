/**
 * Transaction domain helpers shared across routes.
 * Port of the category-resolution and response-shaping logic in
 * server/app/api/routes/transactions.py.
 */
import type { categories as Category, transactions as Transaction, Prisma } from '@prisma/client'
import type { TransactionResponse } from '@/types/api'
import { ApiError } from './errors'
import { findHachnasot, findShonot } from './categories'

type TransactionWithCategory = Transaction & { categories: Category | null }

export function transactionToResponse(txn: TransactionWithCategory): TransactionResponse {
  return {
    id: txn.id,
    date: toDateOnlyString(txn.date),
    amount: txn.amount,
    business_name: txn.business_name,
    category_id: txn.category_id,
    category_name: txn.categories?.name ?? null,
  }
}

/** Format a @db.Date column (stored as UTC midnight) as a plain yyyy-mm-dd string. */
export function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Parse a "yyyy-mm-dd" string into a UTC-midnight Date, matching how Postgres DATE columns round-trip through Prisma. */
export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

/** [start, end) UTC date range covering the given calendar month — used instead of EXTRACT(year/month), which Prisma's query builder doesn't support directly. */
export function monthRange(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1))
  return { start, end }
}

/**
 * Resolve the category_id for a new/updated transaction, mirroring
 * create_transaction / update_transaction_category in transactions.py:
 *   - Negative amounts (income) are always forced to "הכנסות".
 *   - An explicit category_id must belong to the current user.
 *   - Otherwise falls back to "שונות".
 */
export async function resolveCategoryId(
  tx: Prisma.TransactionClient,
  userId: number,
  amount: number,
  categoryId: number | null | undefined,
): Promise<number | null> {
  if (amount < 0) {
    const hachnasot = await findHachnasot(tx, userId)
    return hachnasot?.id ?? null
  }

  if (categoryId != null) {
    const category = await tx.categories.findUnique({ where: { id: categoryId } })
    if (!category || category.user_id !== userId) {
      throw new ApiError(400, 'Invalid category')
    }
    return categoryId
  }

  const shonot = await findShonot(tx, userId)
  return shonot?.id ?? null
}
