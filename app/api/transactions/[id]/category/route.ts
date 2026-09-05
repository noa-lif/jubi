/**
 * PATCH /api/transactions/:id/category — inline category update, called when
 * the user selects a new category from the dashboard table dropdown.
 * Port of server/app/api/routes/transactions.py::update_transaction_category.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ApiError } from '@/lib/errors'
import { getCurrentUser, unauthorized } from '@/lib/session'
import { resolveCategoryId, transactionToResponse } from '@/lib/transactions'

interface RouteParams {
  params: Promise<{ id: string }>
}

interface UpdateCategoryBody {
  category_id?: unknown
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<NextResponse> {
  const user = await getCurrentUser(request)
  if (!user) return unauthorized()

  const transactionId = Number((await params).id)
  if (!Number.isInteger(transactionId)) {
    return NextResponse.json({ detail: 'Transaction not found' }, { status: 404 })
  }

  const txn = await prisma.transactions.findFirst({ where: { id: transactionId, user_id: user.id } })
  if (!txn) {
    return NextResponse.json({ detail: 'Transaction not found' }, { status: 404 })
  }
  if (txn.amount < 0) {
    return NextResponse.json(
      { detail: 'Category of an income transaction cannot be changed' },
      { status: 403 },
    )
  }

  const body = (await request.json().catch(() => null)) as UpdateCategoryBody | null
  const categoryId = typeof body?.category_id === 'number' ? body.category_id : null

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // txn.amount is already known to be >= 0 here, so this only ever takes
      // the "validate ownership, else fall back to שונות" branch.
      const resolvedCategoryId = await resolveCategoryId(tx, user.id, txn.amount, categoryId)
      return tx.transactions.update({
        where: { id: txn.id },
        data: { category_id: resolvedCategoryId },
        include: { categories: true },
      })
    })
    return NextResponse.json(transactionToResponse(updated))
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ detail: err.message }, { status: err.status })
    }
    throw err
  }
}
