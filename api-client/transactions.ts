import { apiClient } from './client'
import type {
  MonthlySummaryResponse,
  PaginatedResponse,
  TransactionResponse,
} from '@/types/api'

export interface CreateTransactionInput {
  date: string
  amount: number
  business_name: string
  category_id: number | null
}

/** Every field optional — the PATCH endpoint applies only the keys present. */
export type UpdateTransactionInput = Partial<CreateTransactionInput>

export interface ListTransactionsParams {
  year: number
  month: number
  limit?: number
  offset?: number
}

export const transactionsApi = {
  /**
   * Fetch one page of transactions for the given month. The server caps
   * `limit`, so this can never pull an unbounded number of rows.
   */
  list: ({ year, month, limit, offset }: ListTransactionsParams) =>
    apiClient.get<PaginatedResponse<TransactionResponse>>('/transactions', {
      year,
      month,
      limit,
      offset,
    }),

  /** Monthly totals plus the per-category breakdown used by the pie chart. */
  summary: (year: number, month: number) =>
    apiClient.get<MonthlySummaryResponse>('/transactions/summary', { year, month }),

  /** Fetch a single transaction by id. */
  get: (transactionId: number) =>
    apiClient.get<TransactionResponse>(`/transactions/${transactionId}`),

  create: (data: CreateTransactionInput) =>
    apiClient.post<TransactionResponse>('/transactions', data),

  /** Full partial-update: date, amount, business_name and/or category. */
  update: (transactionId: number, data: UpdateTransactionInput) =>
    apiClient.patch<TransactionResponse>(`/transactions/${transactionId}`, data),

  /**
   * Inline category-only update — called from the TransactionsTable dropdown.
   * Kept separate from `update` because the table's dropdown is a
   * single-purpose control and this endpoint additionally refuses to
   * recategorize income.
   */
  updateCategory: (transactionId: number, categoryId: number | null) =>
    apiClient.patch<TransactionResponse>(`/transactions/${transactionId}/category`, {
      category_id: categoryId,
    }),

  remove: (transactionId: number) => apiClient.delete<void>(`/transactions/${transactionId}`),

  /** Batch-delete by ID (used to undo an upload). */
  batchDelete: (ids: number[]) => apiClient.post<void>('/transactions/batch-delete', { ids }),
}
