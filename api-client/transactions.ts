import { apiClient } from './client'
import type { MonthlySummaryResponse, TransactionResponse } from '@/types/api'

export interface CreateTransactionInput {
  date: string
  amount: number
  business_name: string
  category_id: number | null
}

export const transactionsApi = {
  /** Fetch all transactions for the given month/year */
  list: (year: number, month: number) =>
    apiClient.get<TransactionResponse[]>('/transactions', { year, month }),

  /** Monthly aggregate (total spend + count) */
  summary: (year: number, month: number) =>
    apiClient.get<MonthlySummaryResponse>('/transactions/summary', { year, month }),

  /** Create a new expense transaction */
  create: (data: CreateTransactionInput) => apiClient.post<TransactionResponse>('/transactions', data),

  /**
   * Inline category update — called from the TransactionsTable dropdown.
   * categoryId may be null to remove the category.
   */
  updateCategory: (transactionId: number, categoryId: number | null) =>
    apiClient.patch<TransactionResponse>(`/transactions/${transactionId}/category`, {
      category_id: categoryId,
    }),

  /** Delete a transaction */
  remove: (transactionId: number) => apiClient.delete<void>(`/transactions/${transactionId}`),

  /** Batch-delete transactions by ID (used for undo after upload) */
  batchDelete: (ids: number[]) => apiClient.post<void>('/transactions/batch-delete', { ids }),
}
