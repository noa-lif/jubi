/**
 * GET  /api/transactions — list the current user's transactions for a month, paginated.
 * POST /api/transactions — create a new transaction.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser, unauthorized } from '@/lib/session'
import { monthRange, resolveCategoryId, transactionToResponse } from '@/lib/transactions'
import { ApiError } from '@/lib/errors'
import {
  validateAmount,
  validateBusinessName,
  validateDateOnly,
  validateOptionalId,
  validatePagination,
  validateYearMonth,
} from '@/lib/validation'
import type { PaginatedResponse, TransactionResponse } from '@/types/api'

export async function GET(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser(request)
  if (!user) return unauthorized()

  const url = new URL(request.url)

  const ym = validateYearMonth(url.searchParams.get('year'), url.searchParams.get('month'))
  if (!ym.ok) return NextResponse.json({ detail: ym.error }, { status: 422 })

  const page = validatePagination(url.searchParams.get('limit'), url.searchParams.get('offset'))
  if (!page.ok) return NextResponse.json({ detail: page.error }, { status: 422 })

  const { start, end } = monthRange(ym.value.year, ym.value.month)
  const where = { user_id: user.id, date: { gte: start, lt: end } }

  // One round trip for both the page and the count. The count is what lets the
  // client render "showing 50 of 812" and decide whether to offer a next page.
  const [rows, total] = await prisma.$transaction([
    prisma.transactions.findMany({
      where,
      include: { categories: true },
      // `id` is the tiebreaker, and it is not optional: many transactions
      // share a date, and without a deterministic total order Postgres may
      // return them in a different sequence per query — which makes rows
      // repeat on one page and disappear from another as the client pages.
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      skip: page.value.offset,
      take: page.value.limit,
    }),
    prisma.transactions.count({ where }),
  ])

  const response: PaginatedResponse<TransactionResponse> = {
    items: rows.map(transactionToResponse),
    total,
    limit: page.value.limit,
    offset: page.value.offset,
    has_more: page.value.offset + rows.length < total,
  }
  return NextResponse.json(response)
}

interface CreateTransactionBody {
  date?: unknown
  amount?: unknown
  business_name?: unknown
  category_id?: unknown
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser(request)
  if (!user) return unauthorized()

  const body = (await request.json().catch(() => null)) as CreateTransactionBody | null

  const date = validateDateOnly(body?.date)
  if (!date.ok) return NextResponse.json({ detail: date.error }, { status: 422 })

  const amount = validateAmount(body?.amount)
  if (!amount.ok) return NextResponse.json({ detail: amount.error }, { status: 422 })

  const businessName = validateBusinessName(body?.business_name)
  if (!businessName.ok) return NextResponse.json({ detail: businessName.error }, { status: 422 })

  const categoryId = validateOptionalId(body?.category_id)
  if (!categoryId.ok) return NextResponse.json({ detail: categoryId.error }, { status: 422 })

  try {
    const created = await prisma.$transaction(async (tx) => {
      const resolvedCategoryId = await resolveCategoryId(tx, user.id, amount.value, categoryId.value)
      return tx.transactions.create({
        data: {
          user_id: user.id,
          date: date.value,
          amount: amount.value,
          business_name: businessName.value,
          category_id: resolvedCategoryId,
        },
        include: { categories: true },
      })
    })
    return NextResponse.json(transactionToResponse(created), { status: 201 })
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ detail: err.message }, { status: err.status })
    }
    throw err
  }
}
