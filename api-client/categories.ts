import { apiClient } from './client'
import type { CategoryResponse } from '@/types/api'

export const categoriesApi = {
  /** List system defaults + user-owned categories */
  list: () => apiClient.get<CategoryResponse[]>('/categories'),

  /** Create a new user-owned custom category */
  create: (name: string) => apiClient.post<CategoryResponse>('/categories', { name }),

  /** Rename a user-owned category. Protected categories are rejected server-side. */
  rename: (categoryId: number, name: string) =>
    apiClient.patch<CategoryResponse>(`/categories/${categoryId}`, { name }),

  /** Delete a user-owned category */
  remove: (categoryId: number) => apiClient.delete<void>(`/categories/${categoryId}`),
}
