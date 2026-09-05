/**
 * GET  /api/categories — list the user's own categories.
 * POST /api/categories — create a new category.
 * Port of server/app/api/routes/categories.py.
 */
import { NextResponse } from 'next/server'
import { categoryToResponse } from '@/lib/categories'
import { prisma } from '@/lib/db'
import { getCurrentUser, unauthorized } from '@/lib/session'

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
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) {
    return NextResponse.json({ detail: 'Category name cannot be empty' }, { status: 422 })
  }

  const existing = await prisma.categories.findFirst({
    where: { user_id: user.id, name: { equals: name, mode: 'insensitive' } },
  })
  if (existing) {
    return NextResponse.json({ detail: `Category '${name}' already exists` }, { status: 409 })
  }

  const category = await prisma.categories.create({ data: { user_id: user.id, name } })
  return NextResponse.json(categoryToResponse(category), { status: 201 })
}
