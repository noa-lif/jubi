'use client'

import { useCallback, useEffect, useState } from 'react'
import { categoriesApi } from '@/api-client/categories'
import { transactionsApi, type CreateTransactionInput } from '@/api-client/transactions'
import AddTransactionModal from '@/components/dashboard/AddTransactionModal'
import ExpensePieChart from '@/components/dashboard/ExpensePieChart'
import ExpenseSummaryWidget from '@/components/dashboard/ExpenseSummaryWidget'
import FileUploadWidget from '@/components/dashboard/FileUploadWidget'
import MonthNavigator from '@/components/dashboard/MonthNavigator'
import TransactionsTable from '@/components/dashboard/TransactionsTable'
import type { CategoryResponse, MonthlySummaryResponse, TransactionResponse, UploadResponse } from '@/types/api'

type UndoAction =
  | { type: 'delete'; transaction: TransactionResponse }
  | { type: 'upload'; transactionIds: number[] }

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

  const [summary, setSummary] = useState<MonthlySummaryResponse>({ year, month, total: 0, transaction_count: 0 })
  const [transactions, setTransactions] = useState<TransactionResponse[]>([])
  const [categories, setCategories] = useState<CategoryResponse[]>([])
  const [loadingTxns, setLoadingTxns] = useState(true)
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  // ── Add transaction modal ───────────────────────────────────────────────
  const [showAddModal, setShowAddModal] = useState(false)

  // ── Undo stack (max 2 entries) ──────────────────────────────────────────
  const [undoStack, setUndoStack] = useState<UndoAction[]>([])

  const pushUndo = useCallback((action: UndoAction) => {
    setUndoStack((prev) => [action, ...prev].slice(0, 2))
  }, [])

  // ── Data fetching ───────────────────────────────────────────────────────
  useEffect(() => {
    categoriesApi.list().then(setCategories).catch(console.error)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    setLoadingTxns(true)
    setLoadingSummary(true)
    Promise.all([transactionsApi.list(year, month), transactionsApi.summary(year, month)])
      .then(([txns, sum]) => {
        setTransactions(txns)
        setSummary(sum)
      })
      .catch(console.error)
      .finally(() => {
        setLoadingTxns(false)
        setLoadingSummary(false)
      })
  }, [year, month, refreshKey, hydrated])

  // ── Month navigation ────────────────────────────────────────────────────
  const handleMonthChange = useCallback((y: number, m: number) => {
    setYear(y)
    setMonth(m)
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
      }
      setRefreshKey((k) => k + 1)
    },
    [handleMonthChange, pushUndo],
  )

  // ── Category change ─────────────────────────────────────────────────────
  const handleCategoryChange = useCallback(
    async (txnId: number, categoryId: number | null) => {
      await transactionsApi.updateCategory(txnId, categoryId)
      setTransactions((prev) =>
        prev.map((t) =>
          t.id === txnId
            ? { ...t, category_id: categoryId, category_name: categories.find((c) => c.id === categoryId)?.name ?? null }
            : t,
        ),
      )
      transactionsApi.summary(year, month).then(setSummary)
    },
    [categories, year, month],
  )

  // ── Delete ──────────────────────────────────────────────────────────────
  const handleDelete = useCallback(
    async (txnId: number) => {
      const txn = transactions.find((t) => t.id === txnId)
      await transactionsApi.remove(txnId)
      setTransactions((prev) => prev.filter((t) => t.id !== txnId))
      transactionsApi.summary(year, month).then(setSummary)
      if (txn) pushUndo({ type: 'delete', transaction: txn })
    },
    [transactions, year, month, pushUndo],
  )

  // ── Manual add ─────────────────────────────────────────────────────────
  const handleAddTransaction = useCallback(async (data: CreateTransactionInput) => {
    await transactionsApi.create(data)
    setRefreshKey((k) => k + 1)
  }, [])

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
        } else if (action.type === 'upload') {
          await transactionsApi.batchDelete(action.transactionIds)
        }
        setRefreshKey((k) => k + 1)
      } catch (e) {
        console.error('Undo failed', e)
      }
    },
    [undoStack],
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
          {/* Add transaction manually */}
          <button
            onClick={() => setShowAddModal(true)}
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

      {/* ── Summary ────────────────────────────────────────── */}
      <ExpenseSummaryWidget total={summary.total} transactionCount={summary.transaction_count} loading={loadingSummary} />

      {/* ── Pie chart ──────────────────────────────────────── */}
      <ExpensePieChart transactions={transactions} loading={loadingTxns} />

      {/* ── Transactions table ─────────────────────────────── */}
      <div>
        <h2 className="text-base font-semibold text-gray-700 mb-3">עסקאות</h2>
        <TransactionsTable
          transactions={transactions}
          categories={categories}
          loading={loadingTxns}
          onCategoryChange={handleCategoryChange}
          onDelete={handleDelete}
        />
      </div>

      {/* ── Add transaction modal ──────────────────────────── */}
      {showAddModal && (
        <AddTransactionModal
          categories={categories}
          onClose={() => setShowAddModal(false)}
          onAdd={handleAddTransaction}
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
