'use client'

import { useContext } from 'react'
import { AuthContext } from '@/context/AuthContext'

/**
 * Convenience hook — use instead of importing AuthContext directly.
 * Throws a clear error if called outside <AuthProvider>.
 */
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an <AuthProvider>')
  return ctx
}
