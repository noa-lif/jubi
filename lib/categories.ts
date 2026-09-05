/**
 * Category domain helpers shared across routes.
 * Port of the protected-category rules in server/app/api/routes/categories.py
 * and server/app/db/init_db.py.
 */
import type { categories as Category, Prisma } from '@prisma/client'
import type { CategoryResponse } from '@/types/api'

// The two categories created automatically for every user at signup.
// "שונות" (Other/Misc) is the catch-all fallback; "הכנסות" (Income) is the
// forced category for negative-amount (income) transactions. Neither can be
// deleted by the user.
export const PROTECTED_NAMES = new Set(['שונות', 'הכנסות'])
export const SHONOT = 'שונות'
export const HACHNASOT = 'הכנסות'

export function categoryToResponse(category: Category): CategoryResponse {
  return {
    id: category.id,
    name: category.name,
    is_system: PROTECTED_NAMES.has(category.name),
  }
}

/** Find a user's "שונות" (catch-all) category — the fallback for uncategorized/reassigned transactions. */
export function findShonot(
  tx: Prisma.TransactionClient,
  userId: number,
): Promise<Category | null> {
  return tx.categories.findFirst({ where: { user_id: userId, name: SHONOT } })
}

/** Find a user's "הכנסות" (income) category — the forced category for negative-amount transactions. */
export function findHachnasot(
  tx: Prisma.TransactionClient,
  userId: number,
): Promise<Category | null> {
  return tx.categories.findFirst({ where: { user_id: userId, name: HACHNASOT } })
}
