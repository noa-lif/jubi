'use client'

import type { CategoryResponse, TransactionResponse } from '@/types/api'

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
const AMOUNT_FORMAT = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2 })

function LockIcon() {
  return (
    <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
      />
    </svg>
  )
}

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {[...Array(5)].map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-gray-200 rounded w-3/4" />
        </td>
      ))}
    </tr>
  )
}

interface TransactionsTableProps {
  transactions: TransactionResponse[]
  categories: CategoryResponse[]
  loading: boolean
  onCategoryChange: (txnId: number, categoryId: number | null) => void
  onDelete: (txnId: number) => void
}

export default function TransactionsTable({
  transactions,
  categories,
  loading,
  onCategoryChange,
  onDelete,
}: TransactionsTableProps) {
  const expenseCategories = categories.filter((c) => c.name !== 'הכנסות')

  const handleCategoryChange = (txnId: number, newCategoryId: string) => {
    if (!newCategoryId) return
    onCategoryChange(txnId, Number(newCategoryId))
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-4 py-3 text-left font-semibold text-gray-500 uppercase tracking-wider text-xs">
                תאריך
              </th>
              <th className="px-4 py-3 text-left font-semibold text-gray-500 uppercase tracking-wider text-xs">
                שם עסק
              </th>
              <th className="px-4 py-3 text-right font-semibold text-gray-500 uppercase tracking-wider text-xs">
                סכום
              </th>
              <th className="px-4 py-3 text-left font-semibold text-gray-500 uppercase tracking-wider text-xs">
                קטגוריה
              </th>
              <th className="px-4 py-3 text-center font-semibold text-gray-500 uppercase tracking-wider text-xs">
                פעולות
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-50">
            {loading ? (
              [...Array(5)].map((_, i) => <SkeletonRow key={i} />)
            ) : transactions.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-gray-400">
                  <div className="flex flex-col items-center gap-2">
                    <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      />
                    </svg>
                    <span className="font-medium">לא הוספת עוד אף עסקה</span>
                    <span className="text-xs">העלה קובץ עסקאות מהבנק</span>
                  </div>
                </td>
              </tr>
            ) : (
              transactions.map((txn) => {
                const isIncome = txn.amount < 0
                return (
                  <tr key={txn.id} className={`hover:bg-gray-50/60 transition-colors ${isIncome ? 'bg-green-50/30' : ''}`}>
                    {/* Date */}
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {DATE_FORMAT.format(new Date(`${txn.date}T00:00:00`))}
                    </td>

                    {/* Business name */}
                    <td className="px-4 py-3 font-medium text-gray-800 max-w-[200px] truncate">
                      {txn.business_name}
                    </td>

                    {/* Amount — green for income */}
                    <td className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${isIncome ? 'text-green-600' : 'text-gray-900'}`}>
                      {isIncome && '+'}
                      {AMOUNT_FORMAT.format(Math.abs(txn.amount))}
                    </td>

                    {/* Category — locked for income */}
                    <td className="px-4 py-3">
                      {isIncome ? (
                        <span className="inline-flex items-center gap-1.5 text-sm text-green-700 bg-green-100 rounded-lg px-2.5 py-1">
                          <LockIcon />
                          {txn.category_name ?? 'הכנסות'}
                        </span>
                      ) : (
                        <select
                          value={txn.category_id ?? ''}
                          onChange={(e) => handleCategoryChange(txn.id, e.target.value)}
                          className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 text-gray-700 cursor-pointer"
                        >
                          {expenseCategories.map((cat) => (
                            <option key={cat.id} value={cat.id}>
                              {cat.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>

                    {/* Delete */}
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => onDelete(txn.id)}
                        aria-label="מחק עסקה"
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
