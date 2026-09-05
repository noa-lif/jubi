/**
 * GET /api/auth/me — return the currently authenticated user's profile.
 * Port of server/app/api/routes/auth.py::get_me.
 */
import { NextResponse } from 'next/server'
import { getCurrentUser, unauthorized } from '@/lib/session'
import type { UserResponse } from '@/types/api'

export async function GET(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser(request)
  if (!user) return unauthorized()

  const response: UserResponse = {
    id: user.id,
    email: user.email,
    id_number: user.id_number,
  }
  return NextResponse.json(response)
}
