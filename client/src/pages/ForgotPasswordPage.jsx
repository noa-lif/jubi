import { useState } from 'react'
import { Link } from 'react-router-dom'
import { authApi } from '../api/auth'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await authApi.forgotPassword(email)
      setSent(true)
    } catch {
      setError('משהו השתבש. אנא נסה שנית.')
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
          <h1 className="text-2xl font-bold text-gray-900">שכחתי סיסמה</h1>
          <p className="text-sm text-gray-500 mt-1">נשלח לך קישור לאיפוס הסיסמה</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
          {sent ? (
            <div className="text-center space-y-4">
              <div className="text-4xl">📧</div>
              <p className="font-medium text-gray-800">הקישור נשלח!</p>
              <p className="text-sm text-gray-500">בדוק את תיבת הדואר שלך ולחץ על הקישור לאיפוס הסיסמה.</p>
              <Link to="/auth" className="block text-sm text-primary-600 hover:underline mt-4">
                חזרה להתחברות
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="אימייל"
                name="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              {error && (
                <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}
              <Button type="submit" loading={loading} className="w-full">
                שלח קישור לאיפוס
              </Button>
              <p className="text-center text-sm">
                <Link to="/auth" className="text-primary-600 hover:underline">
                  חזרה להתחברות
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
