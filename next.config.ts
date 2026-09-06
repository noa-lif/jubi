import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // exceljs parses uploaded statements and is used only in the /api/uploads
  // route handler. Keeping it external leaves it as a plain Node require at
  // runtime instead of being traced into the serverless bundle.
  // (This previously named 'xlsx', a package the project no longer uses —
  // SheetJS was dropped in favour of exceljs.)
  serverExternalPackages: ['exceljs'],
}

export default nextConfig
