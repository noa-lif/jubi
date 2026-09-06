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

/** One slice of the monthly expense pie, aggregated server-side. */
export interface CategoryBreakdown {
  category_id: number | null
  category_name: string | null
  /** Positive; expenses only. */
  total: number
}

export interface MonthlySummaryResponse {
  year: number
  month: number
  /** Net across the month: expenses (positive) plus income (negative). */
  total: number
  transaction_count: number
  /** Absolute value of all income in the month. */
  income_total: number
  /** Sum of all expenses in the month. */
  expense_total: number
  by_category: CategoryBreakdown[]
}

/**
 * Envelope for paginated list endpoints. `total` is the count matching the
 * filter, not the page, so the client can show progress and decide whether
 * to request another page.
 */
export interface PaginatedResponse<T> {
  items: T[]
  total: number
  limit: number
  offset: number
  has_more: boolean
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
