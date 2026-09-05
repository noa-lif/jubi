/**
 * Session helper — extracts and validates the JWT bearer token from an
 * incoming request. Port of server/app/api/deps.py's get_current_user.
 */
import { NextResponse } from 'next/server'
import type { users as User } from '@prisma/client'
import { decodeAccessToken } from './auth'
import { prisma } from './db'

/**
 * Validate the Authorization: Bearer <token> header and return the
 * authenticated user, or null if the token is missing, malformed, expired,
 * or refers to an unknown user.
 */
export async function getCurrentUser(request: Request): Promise<User | null> {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice('Bearer '.length)
  const userId = await decodeAccessToken(token)
  if (userId === null) return null

  return prisma.users.findUnique({ where: { id: userId } })
}

/** Standard 401 response — same message/shape as the FastAPI credentials_exception. */
export function unauthorized(): NextResponse {
  return NextResponse.json({ detail: 'Could not validate credentials' }, { status: 401 })
}
