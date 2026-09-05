import { apiClient } from './client'
import type { TokenResponse, UserResponse } from '@/types/api'

export const authApi = {
  signup: (email: string, password: string, idNumber: string) =>
    apiClient.post<TokenResponse>('/auth/signup', { email, password, id_number: idNumber }),

  login: (email: string, password: string) =>
    apiClient.post<TokenResponse>('/auth/login', { email, password }),

  getMe: () => apiClient.get<UserResponse>('/auth/me'),
}
