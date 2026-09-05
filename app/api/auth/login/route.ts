/**
 * POST /api/auth/login — authenticate with email + password.
 * Port of server/app/api/routes/auth.py::login.
 */
import { NextResponse } from 'next/server'
import { createAccessToken, verifyPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'
import type { TokenResponse } from '@/types/api'

interface LoginBody {
  email?: unknown
  password?: unknown
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as LoginBody | null
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  const user = email ? await prisma.users.findUnique({ where: { email } }) : null

  // Use a generic error to avoid leaking whether the email exists
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return NextResponse.json({ detail: 'Invalid email or password' }, { status: 401 })
  }

  const response: TokenResponse = {
    access_token: await createAccessToken(user.id),
    token_type: 'bearer',
  }
  return NextResponse.json(response)
}
