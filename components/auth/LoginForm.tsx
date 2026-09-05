'use client'

/**
 * LoginForm — email + password credentials.
 * On success, calls onSuccess(token) so the parent page can call login().
 */
import { useState, type FormEvent } from 'react'
import { authApi } from '@/api-client/auth'
import { ApiClientError } from '@/api-client/client'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

export default function LoginForm({ onSuccess }: { onSuccess: (token: string) => void }) {
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await authApi.login(form.email, form.password)
      onSuccess(res.access_token)
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="אימייל"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={form.email}
        onChange={handleChange}
        required
      />
      <Input
        label="סיסמה"
        name="password"
        type="password"
        autoComplete="current-password"
        placeholder="••••••••"
        value={form.password}
        onChange={handleChange}
        required
      />

      {error && <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      <Button type="submit" loading={loading} className="w-full">
        כניסה
      </Button>
    </form>
  )
}
