/**
 * Authentication route tests, run against a real Postgres schema.
 *
 * Covers the signup/login/me flow end to end: real bcrypt hashing, real
 * unique constraints, real JWT signing and verification.
 */
import { beforeAll, beforeEach, expect, it } from 'vitest'
import { POST as login } from '@/app/api/auth/login/route'
import { GET as me } from '@/app/api/auth/me/route'
import { POST as signup } from '@/app/api/auth/signup/route'
import { createAccessToken } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { apiRequest, createTestUser, describeDb, resetDb, TEST_PASSWORD } from '../helpers/db'

// Checksum-valid Israeli ID numbers, required by signup.
const VALID_ID = '123456782'
const VALID_ID_2 = '100000009'

const signupBody = (overrides: Record<string, unknown> = {}) => ({
  email: 'new@example.com',
  password: 'password123',
  id_number: VALID_ID,
  ...overrides,
})

describeDb('POST /api/auth/signup', () => {
  beforeAll(resetDb)
  beforeEach(resetDb)

  it('creates the user, seeds both system categories and returns a token', async () => {
    const res = await signup(apiRequest('/api/auth/signup', { method: 'POST', body: signupBody() }))
    expect(res.status).toBe(201)

    const body = await res.json()
    expect(body.token_type).toBe('bearer')
    expect(typeof body.access_token).toBe('string')

    const user = await prisma.users.findUnique({ where: { email: 'new@example.com' } })
    expect(user).not.toBeNull()

    // Every account must start with the two load-bearing categories, or the
    // income/fallback rules have nowhere to put a transaction.
    const categories = await prisma.categories.findMany({ where: { user_id: user!.id } })
    expect(categories.map((c) => c.name).sort()).toEqual(['הכנסות', 'שונות'])
  })

  it('never stores the password in plaintext', async () => {
    await signup(apiRequest('/api/auth/signup', { method: 'POST', body: signupBody() }))
    const user = await prisma.users.findUnique({ where: { email: 'new@example.com' } })

    expect(user!.password_hash).not.toBe('password123')
    expect(user!.password_hash).toMatch(/^\$2[aby]\$/) // a bcrypt hash
  })

  it('normalizes the email to lowercase', async () => {
    await signup(
      apiRequest('/api/auth/signup', { method: 'POST', body: signupBody({ email: 'MiXeD@Example.COM' }) }),
    )
    expect(await prisma.users.findUnique({ where: { email: 'mixed@example.com' } })).not.toBeNull()
  })

  it('left-pads a short ID number before storing it', async () => {
    await signup(
      apiRequest('/api/auth/signup', { method: 'POST', body: signupBody({ id_number: '1000009' }) }),
    )
    const user = await prisma.users.findUnique({ where: { email: 'new@example.com' } })
    expect(user!.id_number).toBe('001000009')
  })

  it('rejects a duplicate email with 409', async () => {
    await signup(apiRequest('/api/auth/signup', { method: 'POST', body: signupBody() }))
    const res = await signup(
      apiRequest('/api/auth/signup', { method: 'POST', body: signupBody({ id_number: VALID_ID_2 }) }),
    )
    expect(res.status).toBe(409)
  })

  it('rejects a duplicate ID number with 409', async () => {
    await signup(apiRequest('/api/auth/signup', { method: 'POST', body: signupBody() }))
    const res = await signup(
      apiRequest('/api/auth/signup', { method: 'POST', body: signupBody({ email: 'other@example.com' }) }),
    )
    expect(res.status).toBe(409)
  })

  it.each([
    ['invalid email', { email: 'not-an-email' }],
    ['short password', { password: 'short' }],
    ['checksum-invalid ID', { id_number: '123456789' }],
    ['missing email', { email: undefined }],
    ['missing password', { password: undefined }],
    ['non-string password', { password: 12345678 }],
  ])('rejects %s with 422', async (_label, overrides) => {
    const res = await signup(
      apiRequest('/api/auth/signup', { method: 'POST', body: signupBody(overrides) }),
    )
    expect(res.status).toBe(422)
    // No partial account may be left behind by a rejected signup.
    expect(await prisma.users.count()).toBe(0)
  })

  it('rejects a malformed JSON body without crashing', async () => {
    const res = await signup(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      }),
    )
    expect(res.status).toBe(422)
  })
})

describeDb('POST /api/auth/login', () => {
  beforeEach(resetDb)

  it('returns a token for correct credentials', async () => {
    const user = await createTestUser('login@example.com')
    const res = await login(
      apiRequest('/api/auth/login', {
        method: 'POST',
        body: { email: user.email, password: TEST_PASSWORD },
      }),
    )

    expect(res.status).toBe(200)
    expect(typeof (await res.json()).access_token).toBe('string')
  })

  it('accepts a differently-cased email', async () => {
    await createTestUser('login@example.com')
    const res = await login(
      apiRequest('/api/auth/login', {
        method: 'POST',
        body: { email: 'LOGIN@Example.com', password: TEST_PASSWORD },
      }),
    )
    expect(res.status).toBe(200)
  })

  it('rejects a wrong password with 401', async () => {
    const user = await createTestUser('login@example.com')
    const res = await login(
      apiRequest('/api/auth/login', {
        method: 'POST',
        body: { email: user.email, password: 'wrong-password' },
      }),
    )
    expect(res.status).toBe(401)
  })

  it('gives the same response for an unknown email as for a wrong password', async () => {
    // Distinct messages would turn the login form into an account-enumeration
    // oracle, letting an attacker discover which emails are registered.
    const user = await createTestUser('login@example.com')

    const wrongPassword = await login(
      apiRequest('/api/auth/login', { method: 'POST', body: { email: user.email, password: 'nope' } }),
    )
    const unknownEmail = await login(
      apiRequest('/api/auth/login', {
        method: 'POST',
        body: { email: 'ghost@example.com', password: 'nope' },
      }),
    )

    expect(wrongPassword.status).toBe(unknownEmail.status)
    expect(await wrongPassword.json()).toEqual(await unknownEmail.json())
  })

  it.each([
    ['missing password', { email: 'login@example.com' }],
    ['missing email', { password: TEST_PASSWORD }],
    ['empty body', {}],
    ['non-string email', { email: 42, password: TEST_PASSWORD }],
  ])('rejects %s with 401 rather than an error', async (_label, body) => {
    await createTestUser('login@example.com')
    const res = await login(apiRequest('/api/auth/login', { method: 'POST', body }))
    expect(res.status).toBe(401)
  })
})

describeDb('GET /api/auth/me', () => {
  beforeEach(resetDb)

  it('returns the profile of the token holder', async () => {
    const user = await createTestUser('me@example.com')
    const res = await me(apiRequest('/api/auth/me', { token: user.token }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ id: user.id, email: 'me@example.com' })
  })

  it('never exposes the password hash', async () => {
    const user = await createTestUser('me@example.com')
    const body = await (await me(apiRequest('/api/auth/me', { token: user.token }))).json()

    expect(body).not.toHaveProperty('password_hash')
    expect(JSON.stringify(body)).not.toContain('$2b$')
  })

  it('rejects a request with no token', async () => {
    expect((await me(apiRequest('/api/auth/me'))).status).toBe(401)
  })

  it.each([
    ['a garbage token', 'not-a-jwt'],
    ['an empty token', ''],
    ['a structurally valid but unsigned token', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.'],
  ])('rejects %s with 401', async (_label, token) => {
    const res = await me(
      new Request('http://localhost/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }),
    )
    expect(res.status).toBe(401)
  })

  it('rejects a token signed with a different secret', async () => {
    // Proves the signature is actually verified, not just decoded.
    const forged =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIiwiZXhwIjo0MTAyNDQ0ODAwfQ.' +
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const res = await me(
      new Request('http://localhost/api/auth/me', { headers: { Authorization: `Bearer ${forged}` } }),
    )
    expect(res.status).toBe(401)
  })

  it('rejects a valid token whose user no longer exists', async () => {
    // Tokens are stateless, so a deleted account must be caught at lookup time.
    const token = await createAccessToken(999_999)
    const res = await me(apiRequest('/api/auth/me', { token }))
    expect(res.status).toBe(401)
  })

  it('rejects a token sent without the Bearer scheme', async () => {
    const user = await createTestUser('me@example.com')
    const res = await me(
      new Request('http://localhost/api/auth/me', { headers: { Authorization: user.token } }),
    )
    expect(res.status).toBe(401)
  })
})
