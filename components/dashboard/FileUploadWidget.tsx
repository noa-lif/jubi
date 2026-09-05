'use client'

import { useCallback, useRef, useState } from 'react'
import { uploadsApi } from '@/api-client/uploads'
import { ApiClientError } from '@/api-client/client'
import type { UploadResponse } from '@/types/api'

// .xls (legacy binary Excel) is not supported — see the migration plan for
// the security rationale (unpatched vulnerabilities in the npm xlsx parser).
const ACCEPTED_EXTENSIONS = '.xlsx,.csv'

const formatMonth = (year: number, month: number) =>
  new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1))

interface FileUploadWidgetProps {
  onSuccess?: (data: UploadResponse) => void
}

export default function FileUploadWidget({ onSuccess }: FileUploadWidgetProps) {
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const processFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      setStatus(null)
      setUploading(true)
      try {
        const data = await uploadsApi.upload(file)
        const { transactions_imported, duplicates_skipped, months_imported } = data

        const parts = [`יובאו ${transactions_imported} עסקאות`]
        if (duplicates_skipped > 0) parts.push(`${duplicates_skipped} כבר קיימות`)
        if (months_imported?.length > 0) {
          parts.push(`עבור: ${months_imported.map((m) => formatMonth(m.year, m.month)).join(', ')}`)
        }

        setStatus({ type: 'success', message: parts.join(' | ') })
        onSuccess?.(data)
      } catch (err) {
        setStatus({
          type: 'error',
          message: err instanceof ApiClientError ? err.message : 'ההעלאה נכשלה. אנא נסה שנית.',
        })
      } finally {
        setUploading(false)
      }
    },
    [onSuccess],
  )

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    processFile(e.target.files?.[0])
    e.target.value = '' // reset so same file can be re-selected
  }

  return (
    <div className="relative">
      {/* Icon button */}
      <button
        onClick={() => !uploading && inputRef.current?.click()}
        disabled={uploading}
        title="העלה קובץ עסקאות"
        aria-label="העלה קובץ עסקאות"
        className={`
          p-2 rounded-lg border transition-colors
          ${
            uploading
              ? 'border-gray-200 text-gray-300 cursor-wait'
              : 'border-gray-200 text-gray-500 hover:border-primary-400 hover:text-primary-600 hover:bg-primary-50'
          }
        `}
      >
        {uploading ? (
          <svg className="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
        )}
      </button>

      <input ref={inputRef} type="file" accept={ACCEPTED_EXTENSIONS} className="hidden" onChange={handleChange} />

      {/* Notification bubble */}
      {status && (
        <div
          className={`
          absolute left-0 top-full mt-2 z-50 w-72 text-xs rounded-xl px-3 py-2.5 shadow-lg
          ${status.type === 'success' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-600 border border-red-100'}
        `}
        >
          <button onClick={() => setStatus(null)} className="float-left ml-1 opacity-50 hover:opacity-100">
            ✕
          </button>
          {status.message}
        </div>
      )}
    </div>
  )
}
