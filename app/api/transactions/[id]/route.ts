/**
 * GET    /api/transactions/:id — fetch a single transaction owned by the current user.
 * PATCH  /api/transactions/:id — partial update (date, amount, business_name, category).
 * DELETE /api/transactions/:id — delete a transaction owned by the current user.
 *
 * Every handler scopes its lookup by `user_id` as well as `id`, so a request
 * for another user's transaction is indistinguishable from one for a
 * transaction that doesn't exist — both 404. Returning 403 instead would
 * confirm the row exists, which leaks the existence of other users' data.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ApiError } from '@/lib/errors'
import { getCurrentUser, unauthorized } from '@/lib/session'
import { resolveCategoryId, transactionToResponse } from '@/lib/transactions'
import {
  parseRouteId,
  validateAmount,
  validateBusinessName,
  validateDateOnly,
  validateOptionalId,
} from '@/lib/validation'

interface RouteParams {
  params: Promise<{ id: string }>
}

const notFound = () => NextResponse.json({ detail: 'Transaction not found' }, { status: 404 })

export async function GET(request: Request, { params }: RouteParams): Promise<NextResponse> {
  const user = await getCurrentUser(request)
  if (!user) return unauthorized()

  const transactionId = parseRouteId((await params).id)
  if (transactionId === null) return notFound()

  const txn = await prisma.transactions.findFirst({
    where: { id: transactionId, user_id: user.id },
    include: { categories: true },
  })
  if (!txn) return notFound()

  return NextResponse.json(transactionToResponse(txn))
}

interface UpdateTransactionBody {
  date?: unknown
  amount?: unknown
  business_name?: unknown
  category_id?: unknown
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<NextResponse> {
  const user = await getCurrentUser(request)
  if (!user) return unauthorized()

  const transactionId = parseRouteId((await params).id)
  if (transactionId === null) return notFound()

  const existing = await prisma.transactions.findFirst({
    where: { id: transactionId, user_id: user.id },
  })
  if (!existing) return notFound()

  const body = (await request.json().catch(() => null)) as UpdateTransactionBody | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ detail: 'Invalid request body' }, { status: 422 })
  }

  // Partial semantics: a field is only touched when the client actually sent
  // the key. `'x' in body` rather than `body.x !== undefined` so an explicit
  // `category_id: null` (clear the category) is distinguishable from omission.
  const data: { date?: Date; amount?: number; business_name?: string } = {}

  if ('date' in body) {
    const result = validateDateOnly(body.date)
    if (!result.ok) return NextResponse.json({ detail: result.error }, { status: 422 })
    data.date = result.value
  }

  if ('amount' in body) {
    const result = validateAmount(body.amount)
    if (!result.ok) return NextResponse.json({ detail: result.error }, { status: 422 })
    data.amount = result.value
  }

  if ('business_name' in body) {
    const result = validateBusinessName(body.business_name)
    if (!result.ok) return NextResponse.json({ detail: result.error }, { status: 422 })
    data.business_name = result.value
  }

  let requestedCategoryId: number | null = existing.category_id
  if ('category_id' in body) {
    const result = validateOptionalId(body.category_id)
    if (!result.ok) return NextResponse.json({ detail: result.error }, { status: 422 })
    requestedCategoryId = result.value
  }

  if (Object.keys(data).length === 0 && !('category_id' in body)) {
    return NextResponse.json({ detail: 'No fields to update' }, { status: 422 })
  }

  // The amount decides which category rules apply (income is pinned to
  // הכנסות), so resolution runs against the amount the row will *end up*
  // with, not the one it had.
  const effectiveAmount = data.amount ?? existing.amount

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const categoryId = await resolveCategoryId(tx, user.id, effectiveAmount, requestedCategoryId)
      return tx.transactions.update({
        where: { id: existing.id },
        data: { ...data, category_id: categoryId },
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

export async function DELETE(request: Request, { params }: RouteParams): Promise<NextResponse> {
  const user = await getCurrentUser(request)
  if (!user) return unauthorized()

  const transactionId = parseRouteId((await params).id)
  if (transactionId === null) return notFound()

  const txn = await prisma.transactions.findFirst({ where: { id: transactionId, user_id: user.id } })
  if (!txn) return notFound()

  await prisma.transactions.delete({ where: { id: txn.id } })
  return new NextResponse(null, { status: 204 })
}
