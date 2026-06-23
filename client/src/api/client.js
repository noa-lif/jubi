/**
 * Axios instance pre-configured for the FastAPI backend.
 *
 * - baseURL uses the Vite proxy (/api → http://localhost:8000/api)
 * - Request interceptor attaches the JWT Bearer token from localStorage
 * - Response interceptor redirects to /auth on 401 (expired or invalid token)
 */
import axios from 'axios'

const apiClient = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL ?? ''}/api`,
  headers: { 'Content-Type': 'application/json' },
})

// Attach token to every outgoing request
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// On 401, clear the stale token and send the user back to the auth page
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('access_token')
      window.location.href = '/auth'
    }
    return Promise.reject(error)
  },
)

export default apiClient
