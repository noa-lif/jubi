import { apiClient } from './client'
import type { UploadResponse } from '@/types/api'

export const uploadsApi = {
  /**
   * Upload a bank statement file (.xlsx / .csv).
   * Sent as multipart/form-data.
   */
  upload: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiClient.postForm<UploadResponse>('/uploads', form)
  },
}
