/**
 * PATCH  /api/categories/:id — rename a category owned by the current user.
 * DELETE /api/categories/:id — delete a category owned by the current user.
 *          All transactions in this category are reassigned to "שונות" first.
 *
 * "שונות"/"הכנסות" are seeded for every user at signup and are load-bearing:
 * they are the fallback targets for uncategorized expenses and for income
 * respectively, so neither can be renamed nor deleted.
 */
import { NextResponse } from 'next/server'
import { categoryToResponse, PROTECTED_NAMES, SHONOT } from '@/lib/categories'
import { prisma } from '@/lib/db'
import { getCurrentUser, unauthorized } from '@/lib/session'
import { parseRouteId, validateCategoryName } from '@/lib/validation'

interface RouteParams {
  params: Promise<{ id: string }>
}

const notFound = () => NextResponse.json({ detail: 'Category not found' }, { status: 404 })

export async function PATCH(request: Request, { params }: RouteParams): Promise<NextResponse> {
  const user = await getCurrentUser(request)
  if (!user) return unauthorized()

  const categoryId = parseRouteId((await params).id)
  if (categoryId === null) return notFound()

  const category = await prisma.categories.findFirst({
    where: { id: categoryId, user_id: user.id },
  })
  if (!category) return notFound()

  if (PROTECTED_NAMES.has(category.name)) {
    return NextResponse.json(
      { detail: `'${category.name}' is a protected category and cannot be renamed` },
      { status: 403 },
    )
  }

  const body = (await request.json().catch(() => null)) as { name?: unknown } | null
  const result = validateCategoryName(body?.name)
  if (!result.ok) return NextResponse.json({ detail: result.error }, { status: 422 })
  const name = result.value

  // Renaming *into* a protected name would give the user a second שונות or
  // הכנסות, breaking the findFirst-by-name lookups the fallback logic relies on.
  if (PROTECTED_NAMES.has(name)) {
    return NextResponse.json(
      { detail: `'${name}' is a reserved category name` },
      { status: 409 },
    )
  }

  // Case-insensitive so "Food" and "food" can't coexist, excluding this row
  // so renaming a category to a different casing of its own name still works.
  const clash = await prisma.categories.findFirst({
    where: {
      user_id: user.id,
      name: { equals: name, mode: 'insensitive' },
      id: { not: category.id },
    },
  })
  if (clash) {
    return NextResponse.json({ detail: `Category '${name}' already exists` }, { status: 409 })
  }

  const updated = await prisma.categories.update({
    where: { id: category.id },
    data: { name },
  })
  return NextResponse.json(categoryToResponse(updated))
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<NextResponse> {
  const user = await getCurrentUser(request)
  if (!user) return unauthorized()

  const categoryId = parseRouteId((await params).id)
  if (categoryId === null) return notFound()

  const category = await prisma.categories.findFirst({ where: { id: categoryId, user_id: user.id } })
  if (!category) return notFound()

  if (PROTECTED_NAMES.has(category.name)) {
    return NextResponse.json(
      { detail: `'${category.name}' is a protected category and cannot be deleted` },
      { status: 403 },
    )
  }

  // Reassign-then-delete runs in one transaction so a failure can't leave
  // transactions pointing at a category row that no longer exists.
  await prisma.$transaction(async (tx) => {
    const shonot = await tx.categories.findFirst({ where: { user_id: user.id, name: SHONOT } })
    await tx.transactions.updateMany({
      // Scoped by user_id as well as category_id — redundant given the
      // ownership check above, but keeps the blast radius of this bulk
      // write bounded to one user no matter how it's reached.
      where: { category_id: category.id, user_id: user.id },
      data: { category_id: shonot?.id ?? null },
    })
    await tx.categories.delete({ where: { id: category.id } })
  })

  return new NextResponse(null, { status: 204 })
}
