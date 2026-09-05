/**
 * DELETE /api/categories/:id — delete a category owned by the current user.
 * All transactions in this category are reassigned to "שונות" first.
 * "שונות"/"הכנסות" cannot be deleted.
 * Port of server/app/api/routes/categories.py::delete_category.
 */
import { NextResponse } from 'next/server'
import { PROTECTED_NAMES } from '@/lib/categories'
import { prisma } from '@/lib/db'
import { getCurrentUser, unauthorized } from '@/lib/session'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<NextResponse> {
  const user = await getCurrentUser(request)
  if (!user) return unauthorized()

  const categoryId = Number((await params).id)
  if (!Number.isInteger(categoryId)) {
    return NextResponse.json({ detail: 'Category not found' }, { status: 404 })
  }

  const category = await prisma.categories.findFirst({ where: { id: categoryId, user_id: user.id } })
  if (!category) {
    return NextResponse.json({ detail: 'Category not found' }, { status: 404 })
  }
  if (PROTECTED_NAMES.has(category.name)) {
    return NextResponse.json(
      { detail: `'${category.name}' is a protected category and cannot be deleted` },
      { status: 403 },
    )
  }

  await prisma.$transaction(async (tx) => {
    const shonot = await tx.categories.findFirst({ where: { user_id: user.id, name: 'שונות' } })
    await tx.transactions.updateMany({
      where: { category_id: category.id },
      data: { category_id: shonot?.id ?? null },
    })
    await tx.categories.delete({ where: { id: category.id } })
  })

  return new NextResponse(null, { status: 204 })
}
