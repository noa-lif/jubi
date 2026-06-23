import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

const NAV_ITEMS = [
  {
    to: '/',
    label: 'לוח בקרה',
    icon: (
      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    to: '/categories',
    label: 'קטגוריות',
    icon: (
      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
      </svg>
    ),
  },
]

export default function AppLayout() {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const handleLogout = () => {
    setSigningOut(true)
    setTimeout(logout, 400)
  }

  return (
    <div
      className="flex h-screen bg-surface font-sans transition-opacity duration-400"
      style={{ opacity: signingOut ? 0 : 1, transition: 'opacity 400ms ease' }}
    >

      {/* ── Collapsed strip (always visible) ─────────────────── */}
      <aside className="w-14 flex-shrink-0 flex flex-col bg-white border-r border-gray-100 shadow-sm">
        {/* Hamburger */}
        <button
          onClick={() => setOpen(true)}
          aria-label="פתח תפריט"
          className="p-4 text-gray-500 hover:text-gray-800 hover:bg-gray-50 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* Icon-only nav */}
        <nav className="flex-1 flex flex-col items-center py-2 gap-1">
          {NAV_ITEMS.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              title={label}
              className={({ isActive }) =>
                `p-3 rounded-lg transition-colors ${isActive
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-400 hover:bg-gray-50 hover:text-gray-700'
                }`
              }
            >
              {icon}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* ── Expanded overlay drawer ───────────────────────────── */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/25 z-40"
            onClick={() => setOpen(false)}
          />

          {/* Drawer */}
          <aside className="fixed inset-y-0 left-0 w-60 bg-white z-50 flex flex-col shadow-2xl">
            {/* Brand + close */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <span className="text-lg font-bold text-primary-600 tracking-tight">Jubi</span>
              <button
                onClick={() => setOpen(false)}
                aria-label="סגור תפריט"
                className="p-1 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Logout — top of menu */}
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-xs text-gray-400 truncate mb-2">{user?.email}</p>
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-500 hover:bg-red-50 rounded-lg transition-colors font-medium"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                התנתק
              </button>
            </div>

            {/* Nav links */}
            <nav className="flex-1 px-3 py-4 space-y-1">
              {NAV_ITEMS.map(({ to, label, icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                    ${isActive
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`
                  }
                >
                  {icon}
                  {label}
                </NavLink>
              ))}
            </nav>
          </aside>
        </>
      )}

      {/* ── Main content ─────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
