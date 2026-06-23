import apiClient from './client'

export const uploadsApi = {
  /**
   * Upload a bank statement file (XLSX / CSV / PDF).
   * Sends as multipart/form-data; the backend placeholder echoes back filename + size.
   */
  upload: (file) => {
    const form = new FormData()
    form.append('file', file)
    return apiClient.post('/uploads', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
}
