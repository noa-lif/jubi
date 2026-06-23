import { useState } from 'react'
import { authApi } from '../../api/auth'
import Button from '../ui/Button'
import Input from '../ui/Input'

export default function SignupForm({ onSuccess }) {
  const [form, setForm] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    idNumber: '',
  })
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
    setErrors((prev) => ({ ...prev, [e.target.name]: '' }))
  }

  const validateIsraeliId = (id) => {
    const padded = id.trim().padStart(9, '0')
    if (!/^\d{9}$/.test(padded)) return false
    let total = 0
    for (let i = 0; i < 9; i++) {
      let n = parseInt(padded[i]) * (i % 2 === 0 ? 1 : 2)
      if (n > 9) n -= 9
      total += n
    }
    return total % 10 === 0
  }

  const validate = () => {
    const errs = {}
    if (form.password.length < 8)
      errs.password = 'הסיסמה חייבת להכיל לפחות 8 תווים'
    if (form.password !== form.confirmPassword)
      errs.confirmPassword = 'הסיסמאות אינן תואמות'
    if (!form.idNumber.trim())
      errs.idNumber = 'נדרש מספר תעודת זהות'
    else if (!validateIsraeliId(form.idNumber))
      errs.idNumber = 'מספר תעודת זהות אינו תקין'
    return errs
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setServerError('')
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }

    setLoading(true)
    try {
      const res = await authApi.signup(form.email, form.password, form.idNumber)
      onSuccess(res.data.access_token)
    } catch (err) {
      setServerError(err.response?.data?.detail || 'ההרשמה נכשלה. אנא נסה שנית.')
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
