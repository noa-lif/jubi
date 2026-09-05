/**
 * GET  /api/transactions — list transactions for the current user, filtered by year+month.
 * POST /api/transactions — create a new transaction.
 * Port of server/app/api/routes/transactions.py.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser, unauthorized } from '@/lib/session'
import { monthRange, parseDateOnly, resolveCategoryId, transactionToResponse } from '@/lib/transactions'
import { ApiError } from '@/lib/errors'

function parseYearMonth(url: URL): { year: number; month: number } | null {
  const year = Number(url.searchParams.get('year'))
  const month = Number(url.searchParams.get('month'))
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null
  return { year, month }
}

export async function GET(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser(request)
  if (!user) return unauthorized()

  const ym = parseYearMonth(new URL(request.url))
  if (!ym) return NextResponse.json({ detail: 'year and month (1-12) are required' }, { status: 422 })

  const { start, end } = monthRange(ym.year, ym.month)
  const rows = await prisma.transactions.findMany({
    where: { user_id: user.id, date: { gte: start, lt: end } },
    include: { categories: true },
    orderBy: { date: 'desc' },
  })
  return NextResponse.json(rows.map(transactionToResponse))
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
  const dateStr = typeof body?.date === 'string' ? body.date : ''
  const amount = typeof body?.amount === 'number' ? body.amount : Number.NaN
  const businessName = typeof body?.business_name === 'string' ? body.business_name : ''
  const categoryId = typeof body?.category_id === 'number' ? body.category_id : null

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json({ detail: 'Invalid date' }, { status: 422 })
  }
  if (Number.isNaN(amount) || amount === 0) {
    return NextResponse.json({ detail: 'Amount cannot be zero' }, { status: 422 })
  }
  if (!businessName.trim()) {
    return NextResponse.json({ detail: 'business_name is required' }, { status: 422 })
  }

  try {
    const txn = await prisma.$transaction(async (tx) => {
      const resolvedCategoryId = await resolveCategoryId(tx, user.id, amount, categoryId)
      const created = await tx.transactions.create({
        data: {
          user_id: user.id,
          date: parseDateOnly(dateStr),
          amount,
          business_name: businessName.trim(),
          category_id: resolvedCategoryId,
        },
        include: { categories: true },
      })
      return created
    })
    return NextResponse.json(transactionToResponse(txn), { status: 201 })
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ detail: err.message }, { status: err.status })
    }
    throw err
  }
}
