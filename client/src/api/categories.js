import apiClient from './client'

export const categoriesApi = {
  /** List system defaults + user-owned categories */
  list: () =>
    apiClient.get('/categories'),

  /** Create a new user-owned custom category */
  create: (name) =>
    apiClient.post('/categories', { name }),

  /** Delete a user-owned category */
  remove: (categoryId) =>
    apiClient.delete(`/categories/${categoryId}`),
}
