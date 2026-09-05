/**
 * GET /api/transactions/summary — monthly aggregate (total spend + count).
 * Port of server/app/api/routes/transactions.py::monthly_summary.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser, unauthorized } from '@/lib/session'
import { monthRange } from '@/lib/transactions'
import type { MonthlySummaryResponse } from '@/types/api'

export async function GET(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser(request)
  if (!user) return unauthorized()

  const url = new URL(request.url)
  const year = Number(url.searchParams.get('year'))
  const month = Number(url.searchParams.get('month'))
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ detail: 'year and month (1-12) are required' }, { status: 422 })
  }

  const { start, end } = monthRange(year, month)
  const result = await prisma.transactions.aggregate({
    where: { user_id: user.id, date: { gte: start, lt: end } },
    _sum: { amount: true },
    _count: { id: true },
  })

  const response: MonthlySummaryResponse = {
    year,
    month,
    total: result._sum.amount ?? 0,
    transaction_count: result._count.id,
  }
  return NextResponse.json(response)
}
