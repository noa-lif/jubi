'use client'

/**
 * AuthContext — global authentication state.
 * Port of client/src/context/AuthContext.jsx — same localStorage-backed JWT
 * pattern (token in localStorage, sent as an Authorization header), unchanged.
 */
import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react'
import { authApi } from '@/api-client/auth'
import type { UserResponse } from '@/types/api'

interface AuthContextValue {
  token: string | null
  user: UserResponse | null
  loading: boolean
  login: (token: string, user: UserResponse) => void
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<UserResponse | null>(null)
  // True while we're validating an existing token on first load.
  const [loading, setLoading] = useState(true)

  // On mount, if a token exists, fetch the current user profile to validate it.
  useEffect(() => {
    const stored = localStorage.getItem('access_token')
    if (!stored) {
      setLoading(false)
      return
    }
    setToken(stored)
    authApi
      .getMe()
      .then((res) => setUser(res))
      .catch(() => {
        // Token is stale — clear it so AuthGate redirects to /auth.
        localStorage.removeItem('access_token')
        setToken(null)
      })
      .finally(() => setLoading(false))
    // Intentionally runs once on mount only.
  }, [])

  /** Called after a successful login or signup API response. */
  const login = useCallback((newToken: string, userData: UserResponse) => {
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
