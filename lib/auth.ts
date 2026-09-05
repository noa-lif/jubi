/**
 * Security utilities: password hashing and JWT token creation/verification.
 * Port of server/app/core/security.py — same scheme (bcrypt + HS256 JWT),
 * just reimplemented with bcryptjs + jose instead of python-jose/bcrypt.
 */
import bcrypt from 'bcryptjs'
import { jwtVerify, SignJWT } from 'jose'

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is not set')
}
const secretKey = new TextEncoder().encode(JWT_SECRET)

// Default: 7 days (suitable for a personal single-user app) — same default
// as the old ACCESS_TOKEN_EXPIRE_MINUTES=10080.
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d'

/** Hash a plaintext password using bcrypt. Cost factor 12, matching bcrypt.gensalt()'s default in the old Python backend. */
export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, 12)
}

/** Compare a plaintext password against a stored bcrypt hash. */
export async function verifyPassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, hashedPassword)
}

/**
 * Create a signed JWT access token.
 *
 * @param subject Typically the user's ID (stored in the 'sub' claim).
 */
export async function createAccessToken(subject: number | string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(subject))
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRES_IN)
    .sign(secretKey)
}

/**
 * Decode and validate a JWT token.
 *
 * @returns The user ID (number) extracted from the 'sub' claim, or null if invalid.
 */
export async function decodeAccessToken(token: string): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey)
    if (typeof payload.sub !== 'string') return null
    const userId = Number.parseInt(payload.sub, 10)
    return Number.isNaN(userId) ? null : userId
  } catch {
    return null
  }
}
