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

function PencilIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
      />
    </svg>
  )
}

const byName = (a: CategoryResponse, b: CategoryResponse) => a.name.localeCompare(b.name, 'he')

export default function CategoriesPage() {
  const [categories, setCategories] = useState<CategoryResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [listError, setListError] = useState('')

  // id of the category being renamed, plus its in-progress value
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  useEffect(() => {
    setLoading(true)
    categoriesApi
      .list()
      .then(setCategories)
      .catch((err) =>
        setListError(err instanceof ApiClientError ? err.message : 'טעינת הקטגוריות נכשלה'),
      )
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
      setCategories((prev) => [...prev, created].sort(byName))
      setNewName('')
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'הוספת הקטגוריה נכשלה')
    } finally {
      setAdding(false)
    }
  }

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing) return
    const name = editing.name.trim()
    const original = categories.find((c) => c.id === editing.id)

    // No-op rename: close without a pointless round trip.
    if (!name || name === original?.name) {
      setEditing(null)
      return
    }

    setListError('')
    setSavingEdit(true)
    try {
      const updated = await categoriesApi.rename(editing.id, name)
      setCategories((prev) => prev.map((c) => (c.id === updated.id ? updated : c)).sort(byName))
      setEditing(null)
    } catch (err) {
      setListError(err instanceof ApiClientError ? err.message : 'שינוי השם נכשל')
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDelete = async (id: number) => {
    const category = categories.find((c) => c.id === id)
    // Deleting reassigns the category's transactions to שונות, which is not
    // something to do on a stray click.
    if (!window.confirm(`למחוק את הקטגוריה "${category?.name}"? העסקאות שלה יועברו לשונות.`)) return

    setListError('')
    try {
      await categoriesApi.remove(id)
      setCategories((prev) => prev.filter((c) => c.id !== id))
    } catch (err) {
      setListError(err instanceof ApiClientError ? err.message : 'המחיקה נכשלה')
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

        {listError && (
          <p role="alert" className="mx-5 mt-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {listError}
          </p>
        )}

        {loading ? (
          <div className="p-6 space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {sorted.map((cat) => (
              <li key={cat.id} className="flex items-center justify-between px-5 py-3 gap-3">
                {editing?.id === cat.id ? (
                  // Inline rename — submitting on Enter, cancelling on Escape.
                  <form onSubmit={handleRename} className="flex items-center gap-2 flex-1">
                    <input
                      autoFocus
                      value={editing.name}
                      onChange={(e) => setEditing({ id: cat.id, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setEditing(null)
                      }}
                      aria-label={`שם חדש עבור ${cat.name}`}
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <Button type="submit" size="sm" loading={savingEdit}>
                      שמור
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(null)}>
                      ביטול
                    </Button>
                  </form>
                ) : (
                  <>
                    <div className="flex items-center gap-2 min-w-0">
                      {cat.is_system ? (
                        <LockIcon />
                      ) : (
                        <span className="inline-block w-2 h-2 bg-primary-500 rounded-full flex-shrink-0" />
                      )}
                      <span className="text-sm font-medium text-gray-800 truncate">{cat.name}</span>
                      {cat.is_system && (
                        <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                          ברירת מחדל
                        </span>
                      )}
                    </div>
                    {/* Protected categories are load-bearing for the income and
                        fallback rules, so they can be neither renamed nor deleted. */}
                    {!cat.is_system && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => setEditing({ id: cat.id, name: cat.name })}
                          aria-label={`שנה שם ${cat.name}`}
                          className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                        >
                          <PencilIcon />
                        </button>
                        <button
                          onClick={() => handleDelete(cat.id)}
                          aria-label={`מחק ${cat.name}`}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
