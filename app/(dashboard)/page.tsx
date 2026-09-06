'use client'

import { useCallback, useEffect, useState } from 'react'
import { categoriesApi } from '@/api-client/categories'
import { ApiClientError } from '@/api-client/client'
import { transactionsApi, type CreateTransactionInput } from '@/api-client/transactions'
import ExpensePieChart from '@/components/dashboard/ExpensePieChart'
import ExpenseSummaryWidget from '@/components/dashboard/ExpenseSummaryWidget'
import FileUploadWidget from '@/components/dashboard/FileUploadWidget'
import MonthNavigator from '@/components/dashboard/MonthNavigator'
import TransactionModal from '@/components/dashboard/TransactionModal'
import TransactionsTable from '@/components/dashboard/TransactionsTable'
import type { CategoryResponse, MonthlySummaryResponse, TransactionResponse, UploadResponse } from '@/types/api'

const PAGE_SIZE = 50

type UndoAction =
  | { type: 'delete'; transaction: TransactionResponse }
  | { type: 'upload'; transactionIds: number[] }

const EMPTY_SUMMARY = (year: number, month: number): MonthlySummaryResponse => ({
  year,
  month,
  total: 0,
  transaction_count: 0,
  income_total: 0,
  expense_total: 0,
  by_category: [],
})

/** Reads the persisted { year, month } from localStorage — client-only, called from an effect (see below). */
function readPersistedYearMonth(): [number, number] {
  const now = new Date()
  const fallbackYear = now.getFullYear()
  const fallbackMonth = now.getMonth() + 1
  try {
    const stored = JSON.parse(localStorage.getItem('dashboard_month') ?? 'null')
    if (stored?.year && stored?.month) return [stored.year, stored.month]
  } catch {
    // ignore malformed localStorage value
  }
  return [fallbackYear, fallbackMonth]
}

function undoLabel(action: UndoAction): string {
  if (action.type === 'delete') return `בטל מחיקה: ${action.transaction.business_name}`
  return `נוספו ${action.transactionIds.length} עסקאות`
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiClientError ? err.message : fallback
}

export default function DashboardPage() {
  // localStorage isn't available during the server render, so the real
  // month/year is read on mount (see the effect below) — this just avoids
  // an SSR crash; the client immediately overwrites it before first paint.
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth() + 1)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const [y, m] = readPersistedYearMonth()
    setYear(y)
    setMonth(m)
    setHydrated(true)
  }, [])

  const [summary, setSummary] = useState<MonthlySummaryResponse>(() => EMPTY_SUMMARY(year, month))
  const [transactions, setTransactions] = useState<TransactionResponse[]>([])
  const [categories, setCategories] = useState<CategoryResponse[]>([])
  const [loadingTxns, setLoadingTxns] = useState(true)
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [error, setError] = useState('')

  // ── Pagination ──────────────────────────────────────────────────────────
  const [offset, setOffset] = useState(0)
  const [pageMeta, setPageMeta] = useState({ total: 0, limit: PAGE_SIZE, offset: 0, has_more: false })

  // ── Create / edit modal ─────────────────────────────────────────────────
  // null = closed. { txn: null } = create. { txn } = edit that transaction.
  const [modal, setModal] = useState<{ txn: TransactionResponse | null } | null>(null)

  // ── Undo stack (max 2 entries) ──────────────────────────────────────────
  const [undoStack, setUndoStack] = useState<UndoAction[]>([])

  const pushUndo = useCallback((action: UndoAction) => {
    setUndoStack((prev) => [action, ...prev].slice(0, 2))
  }, [])

  // ── Data fetching ───────────────────────────────────────────────────────
  useEffect(() => {
    categoriesApi
      .list()
      .then(setCategories)
      .catch((err) => setError(errorMessage(err, 'טעינת הקטגוריות נכשלה')))
  }, [])

  useEffect(() => {
    if (!hydrated) return
    let cancelled = false

    setLoadingTxns(true)
    setLoadingSummary(true)
    Promise.all([
      transactionsApi.list({ year, month, limit: PAGE_SIZE, offset }),
      transactionsApi.summary(year, month),
    ])
      .then(([page, sum]) => {
        // A month/page change can resolve out of order; drop stale responses
        // so a slow earlier request can't overwrite newer data.
        if (cancelled) return
        setTransactions(page.items)
        setPageMeta({
          total: page.total,
          limit: page.limit,
          offset: page.offset,
          has_more: page.has_more,
        })
        setSummary(sum)
        setError('')
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, 'טעינת העסקאות נכשלה'))
      })
      .finally(() => {
        if (cancelled) return
        setLoadingTxns(false)
        setLoadingSummary(false)
      })

    return () => {
      cancelled = true
    }
  }, [year, month, offset, refreshKey, hydrated])

  /** Re-fetch the current page and summary after a mutation. */
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  // ── Month navigation ────────────────────────────────────────────────────
  const handleMonthChange = useCallback((y: number, m: number) => {
    setYear(y)
    setMonth(m)
    setOffset(0) // a new month starts at its first page
    localStorage.setItem('dashboard_month', JSON.stringify({ year: y, month: m }))
  }, [])

  // ── Upload ──────────────────────────────────────────────────────────────
  const handleUploadSuccess = useCallback(
    (data: UploadResponse) => {
      const months = data?.months_imported ?? []
      const transactionIds = data?.transaction_ids ?? []

      if (transactionIds.length > 0) {
        pushUndo({ type: 'upload', transactionIds })
      }

      if (months.length === 1) {
        handleMonthChange(months[0].year, months[0].month)
      } else {
        setOffset(0)
      }
      refresh()
    },
    [handleMonthChange, pushUndo, refresh],
  )

  // ── Inline category change ──────────────────────────────────────────────
  const handleCategoryChange = useCallback(
    async (txnId: number, categoryId: number | null) => {
      try {
        const updated = await transactionsApi.updateCategory(txnId, categoryId)
        // Use the server's response rather than guessing locally: it applies
        // the income/שונות fallback rules and may return a different category
        // than the one requested.
        setTransactions((prev) => prev.map((t) => (t.id === txnId ? updated : t)))
        // The pie chart is a server-side aggregate, so it has to be refetched.
        const sum = await transactionsApi.summary(year, month)
        setSummary(sum)
      } catch (err) {
        setError(errorMessage(err, 'עדכון הקטגוריה נכשל'))
        refresh() // resync — local state may no longer match the server
      }
    },
    [year, month, refresh],
  )

  // ── Delete ──────────────────────────────────────────────────────────────
  const handleDelete = useCallback(
    async (txnId: number) => {
      const txn = transactions.find((t) => t.id === txnId)
      try {
        await transactionsApi.remove(txnId)
        if (txn) pushUndo({ type: 'delete', transaction: txn })
        refresh() // refetch: deleting pulls a row from the next page onto this one
      } catch (err) {
        setError(errorMessage(err, 'מחיקת העסקה נכשלה'))
      }
    },
    [transactions, pushUndo, refresh],
  )

  // ── Create / update ─────────────────────────────────────────────────────
  const handleSave = useCallback(
    async (data: CreateTransactionInput, id?: number) => {
      // Errors propagate to the modal, which renders them inline next to the
      // fields rather than as a page-level banner.
      if (id === undefined) {
        await transactionsApi.create(data)
      } else {
        await transactionsApi.update(id, data)
      }
      refresh()
    },
    [refresh],
  )

  // ── Undo ────────────────────────────────────────────────────────────────
  const handleUndo = useCallback(
    async (index: number) => {
      const action = undoStack[index]
      if (!action) return
      setUndoStack((prev) => prev.filter((_, i) => i !== index))

      try {
        if (action.type === 'delete') {
          const t = action.transaction
          await transactionsApi.create({
            date: t.date,
            amount: t.amount,
            business_name: t.business_name,
            category_id: t.category_id,
          })
        } else {
          await transactionsApi.batchDelete(action.transactionIds)
        }
        refresh()
      } catch (err) {
        setError(errorMessage(err, 'הפעולה נכשלה'))
      }
    },
    [undoStack, refresh],
  )

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary-600">Jubi</h1>
          <p className="text-sm text-gray-500 mt-0.5">מעקב הוצאות חודשי</p>
        </div>
        <div className="flex items-center gap-2">
          <MonthNavigator year={year} month={month} onChange={handleMonthChange} />
          <button
            onClick={() => setModal({ txn: null })}
            title="הוסף עסקה ידנית"
            aria-label="הוסף עסקה ידנית"
            className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:border-primary-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <FileUploadWidget onSuccess={handleUploadSuccess} />
        </div>
      </div>

      {/* ── Page-level error ───────────────────────────────── */}
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-4 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm"
        >
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label="סגור התראה" className="text-red-400 hover:text-red-700">
            ✕
          </button>
        </div>
      )}

      {/* ── Summary ────────────────────────────────────────── */}
      <ExpenseSummaryWidget total={summary.total} transactionCount={summary.transaction_count} loading={loadingSummary} />

      {/* ── Pie chart ──────────────────────────────────────── */}
      <ExpensePieChart
        byCategory={summary.by_category}
        incomeTotal={summary.income_total}
        loading={loadingSummary}
      />

      {/* ── Transactions table ─────────────────────────────── */}
      <div>
        <h2 className="text-base font-semibold text-gray-700 mb-3">עסקאות</h2>
        <TransactionsTable
          transactions={transactions}
          categories={categories}
          loading={loadingTxns}
          page={pageMeta}
          onPageChange={setOffset}
          onCategoryChange={handleCategoryChange}
          onEdit={(txn) => setModal({ txn })}
          onDelete={handleDelete}
        />
      </div>

      {/* ── Create / edit modal ────────────────────────────── */}
      {modal && (
        <TransactionModal
          categories={categories}
          transaction={modal.txn}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}

      {/* ── Undo toasts ────────────────────────────────────── */}
      {undoStack.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex flex-col gap-2 items-center z-50">
          {undoStack.map((action, i) => (
            <div
              key={i}
              style={{ animation: 'undo-appear 200ms ease' }}
              className="flex items-center gap-4 bg-gray-900 text-white rounded-2xl px-5 py-3 shadow-2xl text-sm"
            >
              <span className="text-gray-300">{undoLabel(action)}</span>
              <button
                onClick={() => handleUndo(i)}
                className="font-semibold text-indigo-400 hover:text-white transition-colors whitespace-nowrap"
              >
                בטל
              </button>
              <button
                onClick={() => setUndoStack((prev) => prev.filter((_, j) => j !== i))}
                className="text-gray-500 hover:text-gray-300 transition-colors"
                aria-label="סגור"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes undo-appear {
          from { opacity: 0; transform: translateX(-50%) translateY(12px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </div>
  )
}
