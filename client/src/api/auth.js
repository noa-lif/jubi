import apiClient from './client'

export const authApi = {
  signup: (email, password, idNumber) =>
    apiClient.post('/auth/signup', { email, password, id_number: idNumber }),

  login: (email, password) =>
    apiClient.post('/auth/login', { email, password }),

  getMe: () =>
    apiClient.get('/auth/me'),
}
