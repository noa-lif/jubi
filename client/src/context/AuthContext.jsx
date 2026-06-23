/**
 * AuthContext — global authentication state.
 *
 * Stores the JWT token in localStorage so it survives page refreshes.
 * Exposes:  token, user, loading, login(), logout()
 */
import { createContext, useCallback, useEffect, useState } from 'react'
import { authApi } from '../api/auth'

export const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('access_token'))
  const [user, setUser] = useState(null)
  // True while we're validating an existing token on first load
  const [loading, setLoading] = useState(!!localStorage.getItem('access_token'))

  // On mount, if a token exists, fetch the current user profile to validate it
  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }
    authApi
      .getMe()
      .then((res) => setUser(res.data))
      .catch(() => {
        // Token is stale — clear it so ProtectedRoute redirects to /auth
        localStorage.removeItem('access_token')
        setToken(null)
      })
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** Called after a successful login or signup API response. */
  const login = useCallback((newToken, userData) => {
    localStorage.setItem('access_token', newToken)
    setToken(newToken)
    setUser(userData)
  }, [])

  /** Clear all auth state and redirect. */
  const logout = useCallback(() => {
    localStorage.removeItem('access_token')
    setToken(null)
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ token, user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
