/**
 * Root routing component.
 *
 * Public routes  → /auth  (login / signup)
 * Protected routes → / (dashboard) and /categories
 *
 * ProtectedRoute redirects unauthenticated visitors to /auth.
 */
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import AuthPage from './pages/AuthPage'
import CategoriesPage from './pages/CategoriesPage'
import DashboardPage from './pages/DashboardPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import AppLayout from './components/layout/AppLayout'

/** Wraps routes that require a valid JWT. */
function ProtectedRoute({ children }) {
  const { token, loading } = useAuth()

  if (loading) {
    // Avoid a flash-of-redirect while the token is being read from localStorage
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  return token ? children : <Navigate to="/auth" replace />
}

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* Protected — all wrapped inside the shared AppLayout sidebar/navbar */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="categories" element={<CategoriesPage />} />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/auth" replace />} />
    </Routes>
  )
}
