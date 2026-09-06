/**
 * GET  /api/categories — list the user's own categories.
 * POST /api/categories — create a new category.
 * Port of server/app/api/routes/categories.py.
 */
import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { categoryToResponse } from '@/lib/categories'
import { prisma } from '@/lib/db'
import { getCurrentUser, unauthorized } from '@/lib/session'
import { validateCategoryName } from '@/lib/validation'

export async function GET(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser(request)
  if (!user) return unauthorized()

  const rows = await prisma.categories.findMany({
    where: { user_id: user.id },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(rows.map(categoryToResponse))
}

interface CreateCategoryBody {
  name?: unknown
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser(request)
  if (!user) return unauthorized()

  const body = (await request.json().catch(() => null)) as CreateCategoryBody | null
  const result = validateCategoryName(body?.name)
  if (!result.ok) return NextResponse.json({ detail: result.error }, { status: 422 })
  const name = result.value

  // Case-insensitive, so a user can't end up with both "Food" and "food".
  // The DB's uq_category_user_name constraint is case-sensitive and so
  // cannot enforce this on its own — hence the explicit lookup.
  const existing = await prisma.categories.findFirst({
    where: { user_id: user.id, name: { equals: name, mode: 'insensitive' } },
  })
  if (existing) {
    return NextResponse.json({ detail: `Category '${name}' already exists` }, { status: 409 })
  }

  try {
    const category = await prisma.categories.create({ data: { user_id: user.id, name } })
    return NextResponse.json(categoryToResponse(category), { status: 201 })
  } catch (err) {
    // Backstop for the check-then-act race on exact-case duplicates.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ detail: `Category '${name}' already exists` }, { status: 409 })
    }
    throw err
  }
}
