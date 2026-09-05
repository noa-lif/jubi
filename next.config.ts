import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Needed for the SheetJS (xlsx) parser used by the uploads route —
  // it relies on some Node built-ins that don't bundle cleanly by default.
  serverExternalPackages: ['xlsx'],
}

export default nextConfig
