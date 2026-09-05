'use client'

import { useEffect, useRef, useState } from 'react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { ApiClientError } from '@/api-client/client'
import type { CreateTransactionInput } from '@/api-client/transactions'
import type { CategoryResponse } from '@/types/api'

const today = () => new Date().toISOString().slice(0, 10)

interface AddTransactionModalProps {
  categories: CategoryResponse[]
  onClose: () => void
  onAdd: (data: CreateTransactionInput) => Promise<void>
}

export default function AddTransactionModal({ categories, onClose, onAdd }: AddTransactionModalProps) {
  const [form, setForm] = useState({
    business_name: '',
    amount: '',
    type: 'debit' as 'debit' | 'credit',
    date: today(),
    category_id: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const firstInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstInputRef.current?.focus()
    // Set default category to שונות
    const shonot = categories.find((c) => c.name === 'שונות')
    if (shonot) setForm((prev) => ({ ...prev, category_id: String(shonot.id) }))
  }, [categories])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }))
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const amount = Number.parseFloat(form.amount)
    if (!form.business_name.trim()) {
      setError('נא להזין שם עסק')
      return
    }
    if (!form.amount || Number.isNaN(amount) || amount <= 0) {
      setError('נא להזין סכום תקין')
      return
    }
    if (!form.date) {
      setError('נא לבחור תאריך')
      return
    }

    setLoading(true)
    try {
      await onAdd({
        business_name: form.business_name.trim(),
        amount: form.type === 'credit' ? -amount : amount,
        date: form.date,
        category_id: form.category_id ? Number(form.category_id) : null,
      })
      onClose()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'אירעה שגיאה. נסה שנית.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ animation: 'modal-bg 150ms ease' }}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Card */}
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5"
        style={{ animation: 'modal-card 180ms cubic-bezier(0.34,1.56,0.64,1)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">הוספת עסקה ידנית</h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Business name */}
          <Input
            ref={firstInputRef}
            label="שם עסק / תיאור"
            placeholder="לדוגמה: סופרמרקט שופרסל"
            value={form.business_name}
            onChange={set('business_name')}
            required
          />

          {/* Amount + debit/credit */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">סכום</label>
            <div className="flex gap-2">
              {/* Amount input */}
              <input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={form.amount}
                onChange={set('amount')}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                required
              />
              {/* Debit / Credit toggle */}
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm font-medium">
                <button
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, type: 'debit' }))}
                  className={`px-3 py-2 transition-colors ${
                    form.type === 'debit' ? 'bg-red-50 text-red-600' : 'bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  חיוב
                </button>
                <button
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, type: 'credit' }))}
                  className={`px-3 py-2 transition-colors border-l border-gray-200 ${
                    form.type === 'credit' ? 'bg-green-50 text-green-600' : 'bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  זיכוי
                </button>
              </div>
            </div>
          </div>

          {/* Date */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">תאריך</label>
            <input
              type="date"
              value={form.date}
              onChange={set('date')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              required
            />
          </div>

          {/* Category — locked to הכנסות for credit transactions */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">קטגוריה</label>
            {form.type === 'credit' ? (
              <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
                הכנסות
              </div>
            ) : (
              <select
                value={form.category_id}
                onChange={set('category_id')}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
              >
                {categories.filter((c) => c.name !== 'הכנסות').map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-1">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
              ביטול
            </Button>
            <Button type="submit" loading={loading} className="flex-1">
              הוסף עסקה
            </Button>
          </div>
        </form>
      </div>

      <style>{`
        @keyframes modal-bg   { from { opacity: 0; } to { opacity: 1; } }
        @keyframes modal-card { from { opacity: 0; transform: scale(0.92) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      `}</style>
    </div>
  )
}
