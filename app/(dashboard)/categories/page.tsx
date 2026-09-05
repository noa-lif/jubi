'use client'

/**
 * CategoriesPage — manage personal expense categories.
 *
 * All categories are personal. "שונות" is the only protected category
 * (shown with a lock icon, cannot be deleted). All others can be deleted;
 * their transactions are automatically reassigned to "שונות" by the backend.
 */
import { useEffect, useState } from 'react'
import { categoriesApi } from '@/api-client/categories'
import { ApiClientError } from '@/api-client/client'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import type { CategoryResponse } from '@/types/api'

function LockIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
      />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  )
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<CategoryResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    categoriesApi
      .list()
      .then(setCategories)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return

    const isDuplicate = categories.some((c) => c.name.toLowerCase() === name.toLowerCase())
    if (isDuplicate) {
      setError(`הקטגוריה "${name}" כבר קיימת`)
      return
    }

    setError('')
    setAdding(true)
    try {
      const created = await categoriesApi.create(name)
      setCategories((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'he')))
      setNewName('')
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to add category')
    } finally {
      setAdding(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await categoriesApi.remove(id)
      setCategories((prev) => prev.filter((c) => c.id !== id))
    } catch (err) {
      alert(err instanceof ApiClientError ? err.message : 'Delete failed')
    }
  }

  // שונות always first, rest alphabetical
  const sorted = [...categories.filter((c) => c.is_system), ...categories.filter((c) => !c.is_system)]

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">קטגוריות</h1>
        <p className="text-sm text-gray-500 mt-0.5">נהל את הקטגוריות האישיות שלך</p>
      </div>

      {/* Add new category */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">הוסף קטגוריה</h2>
        <form onSubmit={handleAdd} className="flex gap-3">
          <div className="flex-1">
            <Input
              placeholder="שם הקטגוריה"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value)
                setError('')
              }}
              error={error}
            />
          </div>
          <Button type="submit" loading={adding} disabled={!newName.trim()}>
            הוסף
          </Button>
        </form>
      </div>

      {/* Category list */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">
            הקטגוריות שלי
            <span className="ml-2 text-xs font-normal text-gray-400">({categories.length})</span>
          </h2>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {sorted.map((cat) => (
              <li key={cat.id} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-2">
                  {cat.is_system ? (
                    <LockIcon />
                  ) : (
                    <span className="inline-block w-2 h-2 bg-primary-500 rounded-full flex-shrink-0" />
                  )}
                  <span className="text-sm font-medium text-gray-800">{cat.name}</span>
                  {cat.is_system && (
                    <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">ברירת מחדל</span>
                  )}
                </div>
                {!cat.is_system && (
                  <button
                    onClick={() => handleDelete(cat.id)}
                    aria-label={`Delete ${cat.name}`}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <TrashIcon />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
