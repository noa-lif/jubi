import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { authApi } from '../api/auth'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) return setError('הסיסמה חייבת להכיל לפחות 8 תווים')
    if (password !== confirmPassword) return setError('הסיסמאות אינן תואמות')

    setLoading(true)
    try {
      await authApi.resetPassword(token, password)
      setDone(true)
      setTimeout(() => navigate('/auth'), 2000)
    } catch (err) {
      setError(err.response?.data?.detail || 'הקישור אינו תקין או פג תוקפו')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-indigo-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-primary-600 rounded-2xl mb-4 shadow-lg">
            <span className="text-2xl font-bold text-white">J</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">איפוס סיסמה</h1>
          <p className="text-sm text-gray-500 mt-1">הזן סיסמה חדשה לחשבונך</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
          {!token ? (
            <div className="text-center space-y-3">
              <p className="text-red-500">קישור האיפוס אינו תקין.</p>
              <Link to="/forgot-password" className="text-sm text-primary-600 hover:underline">
                בקש קישור חדש
              </Link>
            </div>
          ) : done ? (
            <div className="text-center space-y-3">
              <div className="text-4xl">✅</div>
              <p className="font-medium text-gray-800">הסיסמה עודכנה בהצלחה!</p>
              <p className="text-sm text-gray-500">מועבר לדף הכניסה...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="סיסמה חדשה"
                name="password"
                type="password"
                placeholder="לפחות 8 תווים"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <Input
                label="אימות סיסמה"
                name="confirmPassword"
                type="password"
                placeholder="חזור על הסיסמה"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
              {error && (
                <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}
              <Button type="submit" loading={loading} className="w-full">
                עדכן סיסמה
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
