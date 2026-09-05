/**
 * DELETE /api/transactions/:id — delete a transaction owned by the current user.
 * Port of server/app/api/routes/transactions.py::delete_transaction.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser, unauthorized } from '@/lib/session'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<NextResponse> {
  const user = await getCurrentUser(request)
  if (!user) return unauthorized()

  const transactionId = Number((await params).id)
  if (!Number.isInteger(transactionId)) {
    return NextResponse.json({ detail: 'Transaction not found' }, { status: 404 })
  }

  const txn = await prisma.transactions.findFirst({ where: { id: transactionId, user_id: user.id } })
  if (!txn) {
    return NextResponse.json({ detail: 'Transaction not found' }, { status: 404 })
  }

  await prisma.transactions.delete({ where: { id: txn.id } })
  return new NextResponse(null, { status: 204 })
}
