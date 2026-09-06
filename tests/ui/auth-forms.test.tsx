// @vitest-environment jsdom
/**
 * UI tests for the authentication forms.
 *
 * These drive the components the way a user does — typing into labelled
 * fields and clicking the submit button — so they cover the client-side
 * validation rules and the rendering of server errors, not implementation
 * details. The API layer is mocked; the routes themselves are covered by the
 * integration suite.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LoginForm from '@/components/auth/LoginForm'
import SignupForm from '@/components/auth/SignupForm'
import { ApiClientError } from '@/api-client/client'

const { login, signup } = vi.hoisted(() => ({ login: vi.fn(), signup: vi.fn() }))

vi.mock('@/api-client/auth', () => ({ authApi: { login, signup } }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('LoginForm', () => {
  it('renders the email and password fields', () => {
    render(<LoginForm onSuccess={vi.fn()} />)

    expect(screen.getByLabelText('אימייל')).toBeInTheDocument()
    expect(screen.getByLabelText('סיסמה')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'כניסה' })).toBeInTheDocument()
  })

  it('submits the credentials and hands the token to onSuccess', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    login.mockResolvedValue({ access_token: 'token-123', token_type: 'bearer' })

    render(<LoginForm onSuccess={onSuccess} />)
    await user.type(screen.getByLabelText('אימייל'), 'noa@example.com')
    await user.type(screen.getByLabelText('סיסמה'), 'password123')
    await user.click(screen.getByRole('button', { name: 'כניסה' }))

    await waitFor(() => expect(login).toHaveBeenCalledWith('noa@example.com', 'password123'))
    expect(onSuccess).toHaveBeenCalledWith('token-123')
  })

  it("shows the server's message when the credentials are rejected", async () => {
    const user = userEvent.setup()
    login.mockRejectedValue(new ApiClientError(401, 'Invalid email or password'))

    render(<LoginForm onSuccess={vi.fn()} />)
    await user.type(screen.getByLabelText('אימייל'), 'noa@example.com')
    await user.type(screen.getByLabelText('סיסמה'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'כניסה' }))

    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument()
  })

  it('falls back to a generic message for a non-API failure', async () => {
    // A network failure has no `detail` to show, so the form must still say
    // something useful rather than rendering "undefined".
    const user = userEvent.setup()
    login.mockRejectedValue(new TypeError('Failed to fetch'))

    render(<LoginForm onSuccess={vi.fn()} />)
    await user.type(screen.getByLabelText('אימייל'), 'noa@example.com')
    await user.type(screen.getByLabelText('סיסמה'), 'password123')
    await user.click(screen.getByRole('button', { name: 'כניסה' }))

    expect(await screen.findByText(/Login failed/i)).toBeInTheDocument()
  })

  it('does not call onSuccess when login fails', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    login.mockRejectedValue(new ApiClientError(401, 'Invalid email or password'))

    render(<LoginForm onSuccess={onSuccess} />)
    await user.type(screen.getByLabelText('אימייל'), 'a@b.co')
    await user.type(screen.getByLabelText('סיסמה'), 'x')
    await user.click(screen.getByRole('button', { name: 'כניסה' }))

    await screen.findByText('Invalid email or password')
    expect(onSuccess).not.toHaveBeenCalled()
  })
})

describe('SignupForm', () => {
  const fill = async (
    user: ReturnType<typeof userEvent.setup>,
    values: { email?: string; id?: string; password?: string; confirm?: string },
  ) => {
    if (values.email) await user.type(screen.getByLabelText('אימייל'), values.email)
    if (values.id) await user.type(screen.getByLabelText('מספר תעודת זהות'), values.id)
    if (values.password) await user.type(screen.getByLabelText('סיסמה'), values.password)
    if (values.confirm) await user.type(screen.getByLabelText('אימות סיסמה'), values.confirm)
  }

  const submit = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole('button', { name: 'הרשמה' }))

  it('submits when every field is valid', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    signup.mockResolvedValue({ access_token: 'token-abc', token_type: 'bearer' })

    render(<SignupForm onSuccess={onSuccess} />)
    await fill(user, {
      email: 'noa@example.com',
      id: '123456782', // checksum-valid
      password: 'password123',
      confirm: 'password123',
    })
    await submit(user)

    await waitFor(() =>
      expect(signup).toHaveBeenCalledWith('noa@example.com', 'password123', '123456782'),
    )
    expect(onSuccess).toHaveBeenCalledWith('token-abc')
  })

  it('rejects a checksum-invalid ID without calling the API', async () => {
    const user = userEvent.setup()

    render(<SignupForm onSuccess={vi.fn()} />)
    await fill(user, {
      email: 'noa@example.com',
      id: '123456789', // fails the checksum
      password: 'password123',
      confirm: 'password123',
    })
    await submit(user)

    expect(await screen.findByText('מספר תעודת זהות אינו תקין')).toBeInTheDocument()
    expect(signup).not.toHaveBeenCalled()
  })

  it('rejects mismatched passwords', async () => {
    const user = userEvent.setup()

    render(<SignupForm onSuccess={vi.fn()} />)
    await fill(user, {
      email: 'noa@example.com',
      id: '123456782',
      password: 'password123',
      confirm: 'password456',
    })
    await submit(user)

    expect(await screen.findByText('הסיסמאות אינן תואמות')).toBeInTheDocument()
    expect(signup).not.toHaveBeenCalled()
  })

  it('rejects a password under eight characters', async () => {
    const user = userEvent.setup()

    render(<SignupForm onSuccess={vi.fn()} />)
    await fill(user, { email: 'noa@example.com', id: '123456782', password: 'short', confirm: 'short' })
    await submit(user)

    expect(await screen.findByText('הסיסמה חייבת להכיל לפחות 8 תווים')).toBeInTheDocument()
    expect(signup).not.toHaveBeenCalled()
  })

  it('surfaces a duplicate-account error from the server', async () => {
    const user = userEvent.setup()
    signup.mockRejectedValue(new ApiClientError(409, 'An account with this email already exists'))

    render(<SignupForm onSuccess={vi.fn()} />)
    await fill(user, {
      email: 'taken@example.com',
      id: '123456782',
      password: 'password123',
      confirm: 'password123',
    })
    await submit(user)

    expect(await screen.findByText('An account with this email already exists')).toBeInTheDocument()
  })

  it('clears a field error once the user edits that field', async () => {
    const user = userEvent.setup()

    render(<SignupForm onSuccess={vi.fn()} />)
    await fill(user, {
      email: 'noa@example.com',
      id: '123456789',
      password: 'password123',
      confirm: 'password123',
    })
    await submit(user)
    expect(await screen.findByText('מספר תעודת זהות אינו תקין')).toBeInTheDocument()

    await user.type(screen.getByLabelText('מספר תעודת זהות'), '0')
    expect(screen.queryByText('מספר תעודת זהות אינו תקין')).not.toBeInTheDocument()
  })
})
