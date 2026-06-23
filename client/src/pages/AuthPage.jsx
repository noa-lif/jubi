/**
 * AuthPage — public landing page with a tabbed Login / Sign Up panel.
 * Redirects to the dashboard after successful authentication.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../api/auth'
import LoginForm from '../components/auth/LoginForm'
import SignupForm from '../components/auth/SignupForm'
import { useAuth } from '../hooks/useAuth'

export default function AuthPage() {
  const [tab, setTab] = useState('login')  // 'login' | 'signup'
  const { login } = useAuth()
  const navigate = useNavigate()

  /**
   * Called by both LoginForm and SignupForm after a successful API response.
   * Fetches the full user profile, stores it in context, then navigates home.
   */
  const handleSuccess = async (token) => {
    // Temporarily set the token so the /me request is authenticated
    localStorage.setItem('access_token', token)
    const meRes = await authApi.getMe()
    login(token, meRes.data)
    navigate('/', { replace: true })
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-indigo-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-primary-600 rounded-2xl mb-4 shadow-lg">
            <span className="text-2xl font-bold text-white text-3xl">J</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Jubi</h1>
          <p className="text-sm text-gray-500 mt-1">ניהול הוצאות אישי</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-gray-100">
            {[
              { key: 'login',  label: 'כניסה' },
              { key: 'signup', label: 'הרשמה' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`
                  flex-1 py-3.5 text-sm font-semibold transition-colors
                  ${tab === key
                    ? 'text-primary-600 border-b-2 border-primary-600 bg-primary-50/40'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}
                `}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Form area */}
          <div className="p-6">
            {tab === 'login'
              ? <LoginForm  onSuccess={handleSuccess} />
              : <SignupForm onSuccess={handleSuccess} />
            }
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          הנתונים שמורים אצלך בלבד
        </p>
      </div>
    </div>
  )
}
