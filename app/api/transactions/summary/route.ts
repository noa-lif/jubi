/**
 * GET /api/transactions/summary — monthly aggregate for the current user.
 *
 * Returns the headline totals *and* the per-category expense breakdown that
 * the dashboard pie chart draws from. The breakdown is computed in Postgres
 * with a GROUP BY rather than by shipping every transaction to the browser
 * and summing there: the chart needs one row per category (a handful), not
 * one row per transaction (potentially thousands), and now that the table is
 * paginated the client no longer holds the full month anyway.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser, unauthorized } from '@/lib/session'
import { monthRange } from '@/lib/transactions'
import { validateYearMonth } from '@/lib/validation'
import type { CategoryBreakdown, MonthlySummaryResponse } from '@/types/api'

export async function GET(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser(request)
  if (!user) return unauthorized()

  const url = new URL(request.url)
  const ym = validateYearMonth(url.searchParams.get('year'), url.searchParams.get('month'))
  if (!ym.ok) return NextResponse.json({ detail: ym.error }, { status: 422 })

  const { year, month } = ym.value
  const { start, end } = monthRange(year, month)
  const where = { user_id: user.id, date: { gte: start, lt: end } }

  const [overall, expenseByCategory, income] = await prisma.$transaction([
    prisma.transactions.aggregate({ where, _sum: { amount: true }, _count: { id: true } }),
    // Expenses only (amount > 0) — income is reported separately rather than
    // netted off, so a large salary can't cancel out the expense slices.
    prisma.transactions.groupBy({
      by: ['category_id'],
      where: { ...where, amount: { gt: 0 } },
      _sum: { amount: true },
    }),
    prisma.transactions.aggregate({
      where: { ...where, amount: { lt: 0 } },
      _sum: { amount: true },
    }),
  ])

  // groupBy returns category_id only, so names are resolved in a single
  // extra query over the user's own categories (a small, bounded set)
  // instead of a join per group.
  const categoryIds = expenseByCategory
    .map((g) => g.category_id)
    .filter((id): id is number => id !== null)

  const categories = categoryIds.length
    ? await prisma.categories.findMany({
        where: { id: { in: categoryIds }, user_id: user.id },
        select: { id: true, name: true },
      })
    : []
  const nameById = new Map(categories.map((c) => [c.id, c.name]))

  const byCategory: CategoryBreakdown[] = expenseByCategory
    .map((g) => ({
      category_id: g.category_id,
      category_name: g.category_id === null ? null : (nameById.get(g.category_id) ?? null),
      // Rounded to cents: summing floats in Postgres can leave artefacts
      // like 1234.5600000000002, which would render badly in the chart.
      total: Math.round((g._sum.amount ?? 0) * 100) / 100,
    }))
    .sort((a, b) => b.total - a.total)

  const response: MonthlySummaryResponse = {
    year,
    month,
    total: overall._sum.amount ?? 0,
    transaction_count: overall._count.id,
    // Reported as a positive number; stored negative by convention.
    income_total: Math.abs(income._sum.amount ?? 0),
    expense_total: Math.round(byCategory.reduce((sum, c) => sum + c.total, 0) * 100) / 100,
    by_category: byCategory,
  }
  return NextResponse.json(response)
}
