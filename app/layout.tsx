import type { Metadata } from 'next'
import { AuthProvider } from '@/context/AuthContext'
import './globals.css'

// Same shell as the old index.html: lang="en" with no dir="rtl" — the app
// intentionally renders an LTR shell with Hebrew copy (icons like the month
// navigator arrows assume LTR positioning), preserved as-is.
export const metadata: Metadata = {
  title: 'Jubi',
  icons: { icon: '/favicon.svg' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-surface antialiased font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
