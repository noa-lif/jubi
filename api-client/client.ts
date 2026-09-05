/**
 * Thin fetch wrapper for the (now same-origin) API.
 * Port of client/src/api/client.js's axios instance — same behavior:
 *   - Attaches the JWT Bearer token from localStorage to every request.
 *   - On 401, clears the stale token and sends the user back to /auth.
 *   - Throws ApiClientError with the server's `detail` message on failure,
 *     so callers can keep doing `err.message` the way they used
 *     `err.response?.data?.detail` before.
 */

export class ApiClientError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

interface RequestOptions {
  method?: string
  params?: Record<string, string | number | undefined>
  json?: unknown
  body?: FormData
}

function buildUrl(path: string, params?: RequestOptions['params']): string {
  const url = new URL(`/api${path}`, typeof window === 'undefined' ? 'http://localhost' : window.location.origin)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
  }
  return url.pathname + url.search
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null

  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (options.json !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(buildUrl(path, options.params), {
    method: options.method ?? 'GET',
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
  })

  if (res.status === 401 && typeof window !== 'undefined') {
    localStorage.removeItem('access_token')
    window.location.href = '/auth'
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ApiClientError(res.status, body?.detail ?? `Request failed with status ${res.status}`)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const apiClient = {
  get: <T>(path: string, params?: RequestOptions['params']) => request<T>(path, { method: 'GET', params }),
  post: <T>(path: string, json?: unknown) => request<T>(path, { method: 'POST', json }),
  postForm: <T>(path: string, body: FormData) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, json?: unknown) => request<T>(path, { method: 'PATCH', json }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
