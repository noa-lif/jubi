/**
 * POST /api/auth/signup — register a new user.
 * Port of server/app/api/routes/auth.py::signup.
 */
import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { createAccessToken, hashPassword } from '@/lib/auth'
import { HACHNASOT, SHONOT } from '@/lib/categories'
import { prisma } from '@/lib/db'
import { validateEmail, validateIsraeliId, validatePassword } from '@/lib/validation'
import type { TokenResponse } from '@/types/api'

interface SignupBody {
  email?: unknown
  password?: unknown
  id_number?: unknown
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as SignupBody | null

  const emailResult = validateEmail(body?.email)
  if (!emailResult.ok) return NextResponse.json({ detail: emailResult.error }, { status: 422 })
  const email = emailResult.value

  const passwordResult = validatePassword(body?.password)
  if (!passwordResult.ok) return NextResponse.json({ detail: passwordResult.error }, { status: 422 })
  const password = passwordResult.value

  const idResult = validateIsraeliId(body?.id_number)
  if (!idResult.ok) return NextResponse.json({ detail: idResult.error }, { status: 422 })
  const idNumber = idResult.value

  // Reject duplicate email or ID number
  const existingEmail = await prisma.users.findUnique({ where: { email } })
  if (existingEmail) {
    return NextResponse.json({ detail: 'An account with this email already exists' }, { status: 409 })
  }
  const existingIdNumber = await prisma.users.findUnique({ where: { id_number: idNumber } })
  if (existingIdNumber) {
    return NextResponse.json({ detail: 'An account with this ID number already exists' }, { status: 409 })
  }

  const passwordHash = await hashPassword(password)

  let user
  try {
    user = await prisma.$transaction(async (tx) => {
      const created = await tx.users.create({
        data: { email, password_hash: passwordHash, id_number: idNumber },
      })
      // Every user starts with the two load-bearing categories: שונות is the
      // fallback for uncategorized expenses, הכנסות the forced target for
      // income. Seeded in the same transaction as the user so an account can
      // never exist without them.
      await tx.categories.createMany({
        data: [
          { user_id: created.id, name: SHONOT },
          { user_id: created.id, name: HACHNASOT },
        ],
      })
      return created
    })
  } catch (err) {
    // The duplicate checks above are a check-then-act race: two concurrent
    // signups with the same email both pass them, and the loser hits the
    // unique constraint. The database is the real arbiter, so translate its
    // rejection into the same 409 rather than letting it surface as a 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ detail: 'An account with these details already exists' }, { status: 409 })
    }
    throw err
  }

  const response: TokenResponse = {
    access_token: await createAccessToken(user.id),
    token_type: 'bearer',
  }
  return NextResponse.json(response, { status: 201 })
}
