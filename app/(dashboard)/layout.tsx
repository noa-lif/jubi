'use client'

/**
 * Auth-gated dashboard shell. Port of App.jsx's <ProtectedRoute> — same
 * behavior: show a spinner while the token is being validated, redirect to
 * /auth if there's no valid token, otherwise render the sidebar layout.
 *
 * This has to be a client-side check (not middleware) because the token
 * lives in localStorage, not a cookie — preserved as-is from the original.
 */
import { useEffect, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import AppLayout from '@/components/layout/AppLayout'
import { useAuth } from '@/hooks/useAuth'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { token, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !token) router.replace('/auth')
  }, [loading, token, router])

  if (loading || !token) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  return <AppLayout>{children}</AppLayout>
}
