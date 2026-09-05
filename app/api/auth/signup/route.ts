/**
 * POST /api/auth/signup — register a new user.
 * Port of server/app/api/routes/auth.py::signup.
 */
import { NextResponse } from 'next/server'
import { createAccessToken, hashPassword } from '@/lib/auth'
import { HACHNASOT, SHONOT } from '@/lib/categories'
import { prisma } from '@/lib/db'
import type { TokenResponse } from '@/types/api'

interface SignupBody {
  email?: unknown
  password?: unknown
  id_number?: unknown
}

/** Port of SignupRequest's id_number validator — Israeli ID checksum (Luhn-like). */
function validateIsraeliId(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const padded = trimmed.padStart(9, '0')
  if (!/^\d{9}$/.test(padded)) return null

  let total = 0
  for (let i = 0; i < 9; i++) {
    let n = Number(padded[i]) * (i % 2 === 0 ? 1 : 2)
    if (n > 9) n -= 9
    total += n
  }
  return total % 10 === 0 ? padded : null
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as SignupBody | null

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const idNumberRaw = typeof body?.id_number === 'string' ? body.id_number : ''

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ detail: 'Invalid email address' }, { status: 422 })
  }
  if (password.length < 8) {
    return NextResponse.json({ detail: 'Password must be at least 8 characters' }, { status: 422 })
  }
  const idNumber = validateIsraeliId(idNumberRaw)
  if (!idNumber) {
    return NextResponse.json({ detail: 'Invalid Israeli ID number' }, { status: 422 })
  }

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

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.users.create({
      data: { email, password_hash: passwordHash, id_number: idNumber },
    })
    await tx.categories.createMany({
      data: [
        { user_id: created.id, name: SHONOT },
        { user_id: created.id, name: HACHNASOT },
      ],
    })
    return created
  })

  const response: TokenResponse = {
    access_token: await createAccessToken(user.id),
    token_type: 'bearer',
  }
  return NextResponse.json(response, { status: 201 })
}
