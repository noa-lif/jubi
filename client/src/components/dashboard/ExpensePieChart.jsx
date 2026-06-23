import { useMemo } from 'react'
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'

const COLORS = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444',
  '#3b82f6', '#ec4899', '#14b8a6', '#f97316',
  '#8b5cf6', '#84cc16',
]

const ILS = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'ILS',
  minimumFractionDigits: 2,
})

function buildSlices(transactions) {
  const totals = {}
  for (const t of transactions) {
    if (t.amount < 0) continue          // income handled separately
    const key = t.category_name ?? 'שונות'
    totals[key] = (totals[key] ?? 0) + t.amount
  }
  return Object.entries(totals)
    .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value)
}

function calcIncomeTotal(transactions) {
  return transactions
    .filter((t) => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0)
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const { name, value } = payload[0].payload
  return (
    <div
      style={{ animation: 'tooltip-appear 140ms ease' }}
      className="bg-white border border-gray-100 rounded-xl shadow-lg px-4 py-2.5 text-sm pointer-events-none"
    >
      <p className="font-semibold text-gray-800">{name}</p>
      <p className="text-gray-500 mt-0.5">{ILS.format(value)}</p>
    </div>
  )
}

const TOOLTIP_KEYFRAME = `
  @keyframes tooltip-appear {
    from { opacity: 0; transform: scale(0.93) translateY(4px); }
    to   { opacity: 1; transform: scale(1)    translateY(0);   }
  }
`

export default function ExpensePieChart({ transactions = [], loading = false }) {
  const slices      = useMemo(() => buildSlices(transactions),    [transactions])
  const incomeTotal = useMemo(() => calcIncomeTotal(transactions), [transactions])

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
      <style>{TOOLTIP_KEYFRAME}</style>
      <p className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">
        הוצאות לפי קטגוריה
      </p>

      {loading ? (
        <div className="flex items-center justify-center h-56">
          <div className="w-40 h-40 rounded-full bg-gray-100 animate-pulse" />
        </div>
      ) : slices.length === 0 ? (
        <div className="flex items-center justify-center h-56 text-gray-400 text-sm">
          אין עסקאות החודש
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={slices}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={2}
              dataKey="value"
            >
              {slices.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} isAnimationActive={false} />
            <Legend
              formatter={(value) => (
                <span className="text-xs text-gray-600">{value}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      )}

      {/* Income summary */}
      {!loading && incomeTotal > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-sm">
          <span className="text-gray-500 flex items-center gap-1.5">
            <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
            </svg>
            הכנסות החודש
          </span>
          <span className="font-semibold text-green-600">
            +{ILS.format(incomeTotal)}
          </span>
        </div>
      )}
    </div>
  )
}
