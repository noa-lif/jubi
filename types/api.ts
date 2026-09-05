/**
 * Shared request/response DTOs — the JSON contract between the frontend and
 * the API routes. Mirrors server/app/schemas/schemas.py.
 */

export interface TokenResponse {
  access_token: string
  token_type: 'bearer'
}

export interface UserResponse {
  id: number
  email: string
  id_number: string
}

export interface CategoryResponse {
  id: number
  name: string
  is_system: boolean
}

export interface TransactionResponse {
  id: number
  date: string // ISO yyyy-mm-dd
  amount: number
  business_name: string
  category_id: number | null
  category_name: string | null
}

export interface MonthlySummaryResponse {
  year: number
  month: number
  total: number
  transaction_count: number
}

export interface MonthImported {
  year: number
  month: number
  count: number
}

export interface UploadResponse {
  filename: string
  file_hash: string
  transactions_imported: number
  rows_skipped: number
  duplicates_skipped: number
  months_imported: MonthImported[]
  transaction_ids: number[]
}

export interface ApiErrorBody {
  detail: string
}
