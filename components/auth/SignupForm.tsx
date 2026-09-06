'use client'

import { useState, type FormEvent } from 'react'
import { authApi } from '@/api-client/auth'
import { ApiClientError } from '@/api-client/client'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
// Shared with the signup route, so the form and the API can never disagree
// about which ID numbers are valid.
import { validateEmail, validateIsraeliId, validatePassword } from '@/lib/validation'

export default function SignupForm({ onSuccess }: { onSuccess: (token: string) => void }) {
  const [form, setForm] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    idNumber: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
    setErrors((prev) => ({ ...prev, [e.target.name]: '' }))
  }

  const validate = (): Record<string, string> => {
    const errs: Record<string, string> = {}

    if (!validateEmail(form.email).ok) errs.email = 'כתובת אימייל אינה תקינה'

    const password = validatePassword(form.password)
    if (!password.ok) {
      errs.password =
        form.password.length < 8 ? 'הסיסמה חייבת להכיל לפחות 8 תווים' : 'הסיסמה ארוכה מדי'
    }
    if (form.password !== form.confirmPassword) errs.confirmPassword = 'הסיסמאות אינן תואמות'

    if (!form.idNumber.trim()) errs.idNumber = 'נדרש מספר תעודת זהות'
    else if (!validateIsraeliId(form.idNumber).ok) errs.idNumber = 'מספר תעודת זהות אינו תקין'

    return errs
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setServerError('')
    const errs = validate()
    if (Object.keys(errs).length) {
      setErrors(errs)
      return
    }

    setLoading(true)
    try {
      const res = await authApi.signup(form.email, form.password, form.idNumber)
      onSuccess(res.access_token)
    } catch (err) {
      setServerError(err instanceof ApiClientError ? err.message : 'ההרשמה נכשלה. אנא נסה שנית.')
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
        error={errors.email}
        required
      />
      <Input
        label="מספר תעודת זהות"
        name="idNumber"
        type="text"
        placeholder="123456789"
        value={form.idNumber}
        onChange={handleChange}
        error={errors.idNumber}
        required
      />
      <Input
        label="סיסמה"
        name="password"
        type="password"
        autoComplete="new-password"
        placeholder="לפחות 8 תווים"
        value={form.password}
        onChange={handleChange}
        error={errors.password}
        required
      />
      <Input
        label="אימות סיסמה"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        placeholder="חזור על הסיסמה"
        value={form.confirmPassword}
        onChange={handleChange}
        error={errors.confirmPassword}
        required
      />

      {serverError && (
        <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{serverError}</p>
      )}

      <Button type="submit" loading={loading} className="w-full">
        הרשמה
      </Button>
    </form>
  )
}
