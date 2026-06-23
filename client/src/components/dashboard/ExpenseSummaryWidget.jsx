/**
 * ExpenseSummaryWidget — hero card showing the total spend for the selected month.
 * Props:
 *   total           — number (₪ / $ amount)
 *   transactionCount — number
 *   loading         — boolean
 */
export default function ExpenseSummaryWidget({ total, transactionCount, loading }) {
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'ILS',         // Change to 'USD' or any ISO code as needed
    minimumFractionDigits: 2,
  }).format(total ?? 0)

  return (
    <div className="bg-gradient-to-br from-primary-600 to-primary-700 rounded-2xl p-6 text-white shadow-lg">
      <p className="text-sm font-medium text-primary-100 uppercase tracking-wider mb-1">
        מאזן חודשי
      </p>

      {loading ? (
        <div className="h-10 w-40 bg-white/20 rounded-lg animate-pulse mt-2" />
      ) : (
        <p className="text-4xl font-bold tracking-tight mt-1">{formatted}</p>
      )}

      <div className="mt-4 flex items-center gap-2 text-primary-100 text-sm">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        {loading
          ? 'טוען…'
          : `${transactionCount} עסקא${transactionCount !== 1 ? 'ות' : 'ה'}`}
      </div>
    </div>
  )
}
