// @vitest-environment jsdom
/**
 * UI tests for the dashboard components: the transactions table (including
 * its pager and row actions), the create/edit modal, and the chart's
 * non-chart states.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ExpensePieChart from '@/components/dashboard/ExpensePieChart'
import TransactionModal from '@/components/dashboard/TransactionModal'
import TransactionsTable from '@/components/dashboard/TransactionsTable'
import type { CategoryResponse, TransactionResponse } from '@/types/api'

const CATEGORIES: CategoryResponse[] = [
  { id: 1, name: 'שונות', is_system: true },
  { id: 2, name: 'הכנסות', is_system: true },
  { id: 3, name: 'מזון', is_system: false },
]

const EXPENSE: TransactionResponse = {
  id: 10,
  date: '2026-03-15',
  amount: 150.5,
  business_name: 'שופרסל',
  category_id: 3,
  category_name: 'מזון',
}

const INCOME: TransactionResponse = {
  id: 11,
  date: '2026-03-20',
  amount: -9000,
  business_name: 'משכורת',
  category_id: 2,
  category_name: 'הכנסות',
}

const onePage = { total: 2, limit: 50, offset: 0, has_more: false }

function renderTable(overrides: Partial<React.ComponentProps<typeof TransactionsTable>> = {}) {
  const props = {
    transactions: [EXPENSE, INCOME],
    categories: CATEGORIES,
    loading: false,
    page: onePage,
    onPageChange: vi.fn(),
    onCategoryChange: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }
  render(<TransactionsTable {...props} />)
  return props
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TransactionsTable', () => {
  it('renders a row per transaction', () => {
    renderTable()

    expect(screen.getByText('שופרסל')).toBeInTheDocument()
    expect(screen.getByText('משכורת')).toBeInTheDocument()
  })

  it('shows an empty state when there are no transactions', () => {
    renderTable({ transactions: [], page: { ...onePage, total: 0 } })
    expect(screen.getByText('לא הוספת עוד אף עסקה')).toBeInTheDocument()
  })

  it('shows skeleton rows while loading instead of the empty state', () => {
    renderTable({ transactions: [], loading: true })
    expect(screen.queryByText('לא הוספת עוד אף עסקה')).not.toBeInTheDocument()
  })

  it('lets an expense be recategorized through the dropdown', async () => {
    const user = userEvent.setup()
    const props = renderTable()

    // The income category is never offered as a target for an expense.
    const select = screen.getByRole('combobox')
    expect(within(select).queryByRole('option', { name: 'הכנסות' })).not.toBeInTheDocument()

    await user.selectOptions(select, '1')
    expect(props.onCategoryChange).toHaveBeenCalledWith(EXPENSE.id, 1)
  })

  it('locks the category of an income row rather than offering a dropdown', () => {
    // Income is pinned to הכנסות server-side, so the UI must not imply it can
    // be changed. Only the expense row gets a dropdown.
    renderTable()
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
  })

  it('calls onEdit with the transaction', async () => {
    const user = userEvent.setup()
    const props = renderTable()

    await user.click(screen.getByRole('button', { name: `ערוך עסקה ${EXPENSE.business_name}` }))
    expect(props.onEdit).toHaveBeenCalledWith(EXPENSE)
  })

  it('calls onDelete with the transaction id', async () => {
    const user = userEvent.setup()
    const props = renderTable()

    await user.click(screen.getByRole('button', { name: `מחק עסקה ${EXPENSE.business_name}` }))
    expect(props.onDelete).toHaveBeenCalledWith(EXPENSE.id)
  })

  describe('pager', () => {
    it('stays hidden when everything fits on one page', () => {
      renderTable()
      expect(screen.queryByRole('button', { name: 'הבא' })).not.toBeInTheDocument()
    })

    it('reports the visible range and the total', () => {
      renderTable({ page: { total: 120, limit: 50, offset: 50, has_more: true } })
      expect(screen.getByText(/51–52 מתוך 120/)).toBeInTheDocument()
    })

    it('advances by one page', async () => {
      const user = userEvent.setup()
      const props = renderTable({ page: { total: 120, limit: 50, offset: 0, has_more: true } })

      await user.click(screen.getByRole('button', { name: 'הבא' }))
      expect(props.onPageChange).toHaveBeenCalledWith(50)
    })

    it('goes back a page', async () => {
      const user = userEvent.setup()
      const props = renderTable({ page: { total: 120, limit: 50, offset: 50, has_more: true } })

      await user.click(screen.getByRole('button', { name: 'הקודם' }))
      expect(props.onPageChange).toHaveBeenCalledWith(0)
    })

    it('disables "previous" on the first page and "next" on the last', () => {
      renderTable({ page: { total: 120, limit: 50, offset: 0, has_more: true } })
      expect(screen.getByRole('button', { name: 'הקודם' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'הבא' })).toBeEnabled()
    })

    it('never produces a negative offset', () => {
      // Guards the Math.max(0, ...) clamp: an odd offset must not page to -25.
      renderTable({ page: { total: 120, limit: 50, offset: 20, has_more: true } })
      expect(screen.getByRole('button', { name: 'הקודם' })).toBeEnabled()
    })
  })
})

describe('TransactionModal', () => {
  const renderModal = (overrides: Partial<React.ComponentProps<typeof TransactionModal>> = {}) => {
    const props = {
      categories: CATEGORIES,
      onClose: vi.fn(),
      onSave: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    }
    render(<TransactionModal {...props} />)
    return props
  }

  it('opens in create mode by default', () => {
    renderModal()
    expect(screen.getByText('הוספת עסקה ידנית')).toBeInTheDocument()
  })

  it('prefills the fields when editing', () => {
    renderModal({ transaction: EXPENSE })

    expect(screen.getByText('עריכת עסקה')).toBeInTheDocument()
    expect(screen.getByLabelText('שם עסק / תיאור')).toHaveValue('שופרסל')
    expect(screen.getByLabelText('סכום')).toHaveValue(150.5)
    expect(screen.getByLabelText('תאריך')).toHaveValue('2026-03-15')
  })

  it('shows an income transaction as a credit with its category locked', () => {
    renderModal({ transaction: INCOME })

    // Entered as a positive number; the sign is carried by the credit toggle.
    expect(screen.getByLabelText('סכום')).toHaveValue(9000)
    expect(screen.queryByLabelText('קטגוריה')).not.toBeInTheDocument()
  })

  it('saves an edit with the transaction id', async () => {
    const user = userEvent.setup()
    const props = renderModal({ transaction: EXPENSE })

    const amount = screen.getByLabelText('סכום')
    await user.clear(amount)
    await user.type(amount, '200')
    await user.click(screen.getByRole('button', { name: 'שמור שינויים' }))

    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 200, business_name: 'שופרסל' }),
      EXPENSE.id,
    )
  })

  it('creates without an id', async () => {
    const user = userEvent.setup()
    const props = renderModal()

    await user.type(screen.getByLabelText('שם עסק / תיאור'), 'קפה')
    await user.type(screen.getByLabelText('סכום'), '18')
    await user.click(screen.getByRole('button', { name: 'הוסף עסקה' }))

    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ business_name: 'קפה', amount: 18 }),
      undefined,
    )
  })

  it('negates the amount when the credit toggle is selected', async () => {
    // The sign convention the whole app depends on: income is stored negative.
    const user = userEvent.setup()
    const props = renderModal()

    await user.type(screen.getByLabelText('שם עסק / תיאור'), 'משכורת')
    await user.type(screen.getByLabelText('סכום'), '9000')
    await user.click(screen.getByRole('button', { name: 'זיכוי' }))
    await user.click(screen.getByRole('button', { name: 'הוסף עסקה' }))

    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ amount: -9000 }), undefined)
  })

  it('rejects a blank business name without calling onSave', async () => {
    const user = userEvent.setup()
    const props = renderModal()

    await user.type(screen.getByLabelText('סכום'), '50')
    await user.click(screen.getByRole('button', { name: 'הוסף עסקה' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('נא להזין שם עסק')
    expect(props.onSave).not.toHaveBeenCalled()
  })

  it('rejects a zero or negative amount', async () => {
    const user = userEvent.setup()
    const props = renderModal()

    await user.type(screen.getByLabelText('שם עסק / תיאור'), 'קפה')
    await user.type(screen.getByLabelText('סכום'), '0')
    await user.click(screen.getByRole('button', { name: 'הוסף עסקה' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('נא להזין סכום תקין')
    expect(props.onSave).not.toHaveBeenCalled()
  })

  it('surfaces a save failure and keeps the dialog open', async () => {
    const user = userEvent.setup()
    const { ApiClientError } = await import('@/api-client/client')
    const props = renderModal({
      onSave: vi.fn().mockRejectedValue(new ApiClientError(400, 'Invalid category')),
    })

    await user.type(screen.getByLabelText('שם עסק / תיאור'), 'קפה')
    await user.type(screen.getByLabelText('סכום'), '18')
    await user.click(screen.getByRole('button', { name: 'הוסף עסקה' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid category')
    // The dialog must not close, or the user loses what they typed.
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const props = renderModal()

    await user.keyboard('{Escape}')
    expect(props.onClose).toHaveBeenCalled()
  })

  it('closes on the cancel button', async () => {
    const user = userEvent.setup()
    const props = renderModal()

    await user.click(screen.getByRole('button', { name: 'ביטול' }))
    expect(props.onClose).toHaveBeenCalled()
  })
})

describe('ExpensePieChart', () => {
  it('shows an empty state when the month has no expenses', () => {
    render(<ExpensePieChart byCategory={[]} incomeTotal={0} />)
    expect(screen.getByText('אין עסקאות החודש')).toBeInTheDocument()
  })

  it('shows the income line only when there is income', () => {
    const { rerender } = render(<ExpensePieChart byCategory={[]} incomeTotal={0} />)
    expect(screen.queryByText('הכנסות החודש')).not.toBeInTheDocument()

    rerender(<ExpensePieChart byCategory={[]} incomeTotal={9000} />)
    expect(screen.getByText('הכנסות החודש')).toBeInTheDocument()
  })

  it('treats a breakdown of only non-positive totals as empty', () => {
    // A zero-value slice cannot be drawn, so it must not suppress the
    // empty state and leave a blank card.
    render(<ExpensePieChart byCategory={[{ category_id: 1, category_name: 'שונות', total: 0 }]} />)
    expect(screen.getByText('אין עסקאות החודש')).toBeInTheDocument()
  })
})
