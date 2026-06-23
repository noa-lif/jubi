import apiClient from './client'

export const transactionsApi = {
  /** Fetch all transactions for the given month/year */
  list: (year, month) =>
    apiClient.get('/transactions', { params: { year, month } }),

  /** Monthly aggregate (total spend + count) */
  summary: (year, month) =>
    apiClient.get('/transactions/summary', { params: { year, month } }),

  /** Create a new expense transaction */
  create: (data) =>
    apiClient.post('/transactions', data),

  /**
   * Inline category update — called from the TransactionsTable dropdown.
   * categoryId may be null to remove the category.
   */
  updateCategory: (transactionId, categoryId) =>
    apiClient.patch(`/transactions/${transactionId}/category`, {
      category_id: categoryId,
    }),

  /** Delete a transaction */
  remove: (transactionId) =>
    apiClient.delete(`/transactions/${transactionId}`),

  /** Batch-delete transactions by ID (used for undo after upload) */
  batchDelete: (ids) =>
    apiClient.post('/transactions/batch-delete', { ids }),
}
