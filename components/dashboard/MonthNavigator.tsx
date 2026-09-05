'use client'

const MONTH_NAMES = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]

interface MonthNavigatorProps {
  year: number
  month: number
  onChange: (year: number, month: number) => void
}

export default function MonthNavigator({ year, month, onChange }: MonthNavigatorProps) {
  const go = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1)
    onChange(d.getFullYear(), d.getMonth() + 1)
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => go(-1)}
        aria-label="חודש קודם"
        className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <span className="text-lg font-semibold text-gray-800 min-w-[160px] text-center">
        {MONTH_NAMES[month - 1]} {year}
      </span>

      <button
        onClick={() => go(1)}
        aria-label="חודש הבא"
        className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  )
}
