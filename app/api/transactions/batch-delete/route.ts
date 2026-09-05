/**
 * POST /api/transactions/batch-delete — delete multiple transactions owned by
 * the current user (used for undo-upload).
 * Port of server/app/api/routes/transactions.py::batch_delete_transactions.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser, unauthorized } from '@/lib/session'

interface BatchDeleteBody {
  ids?: unknown
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser(request)
  if (!user) return unauthorized()

  const body = (await request.json().catch(() => null)) as BatchDeleteBody | null
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id): id is number => typeof id === 'number') : []

  if (ids.length > 0) {
    await prisma.transactions.deleteMany({
      where: { id: { in: ids }, user_id: user.id },
    })
  }

  return new NextResponse(null, { status: 204 })
}
