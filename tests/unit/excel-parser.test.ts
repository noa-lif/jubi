/**
 * Unit tests for the bank-statement importer.
 *
 * Importing a statement is the app's main business process, and the input is
 * the least controlled thing it handles — real exports vary in header row
 * position, column naming (Hebrew and English), date format, currency
 * symbols and encoding. These tests pin that behaviour down, including the
 * rows the parser is expected to skip rather than reject the whole file over.
 */
import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import type { Prisma } from '@prisma/client'
import {
  deduplicateTransactions,
  ParseError,
  parseStatementFile,
  type ParsedTransaction,
} from '@/lib/excelParser'

const USER = 1

interface StubDb {
  client: Prisma.TransactionClient
  categoryNames: () => string[]
  idOf: (name: string) => number | undefined
}

/**
 * In-memory stand-in for the Prisma transaction client. The parser resolves
 * (and creates) categories as it goes, so the stub records what it was asked
 * for — letting the tests assert on category side effects as well as output.
 */
function stubDb(existingCategories: string[] = [], existingTransactions: ParsedTransaction[] = []): StubDb {
  const categories = existingCategories.map((name, i) => ({ id: i + 1, user_id: USER, name }))
  let nextId = categories.length + 1

  const client = {
    categories: {
      findFirst: async ({ where }: { where: { name: { equals: string } } }) =>
        categories.find((c) => c.name.toLowerCase() === where.name.equals.toLowerCase()) ?? null,
      create: async ({ data }: { data: { user_id: number; name: string } }) => {
        const created = { id: nextId++, user_id: data.user_id, name: data.name }
        categories.push(created)
        return created
      },
    },
    transactions: {
      findMany: async () =>
        existingTransactions.map((t) => ({
          date: t.date,
          amount: t.amount,
          business_name: t.business_name,
        })),
    },
  } as unknown as Prisma.TransactionClient

  return {
    client,
    categoryNames: () => categories.map((c) => c.name),
    idOf: (name) => categories.find((c) => c.name === name)?.id,
  }
}

const csv = (text: string) => Buffer.from(text, 'utf8')

const BASIC_CSV = `date,business name,amount
2026-03-01,Supermarket,150.50
2026-03-02,Coffee Shop,18
`

describe('parseStatementFile — CSV', () => {
  it('parses a simple English statement', async () => {
    const db = stubDb(['שונות'])
    const { transactions, rowsSkipped } = await parseStatementFile(csv(BASIC_CSV), 'stmt.csv', db.client, USER)

    expect(rowsSkipped).toBe(0)
    expect(transactions).toHaveLength(2)
    expect(transactions[0]).toMatchObject({ business_name: 'Supermarket', amount: 150.5 })
    expect(transactions[0].date.toISOString()).toBe('2026-03-01T00:00:00.000Z')
  })

  it('parses Hebrew column headers', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`תאריך,שם בית עסק,סכום\n01/03/2026,שופרסל,250.75\n`)
    const { transactions } = await parseStatementFile(file, 'statement.csv', db.client, USER)

    expect(transactions).toHaveLength(1)
    expect(transactions[0].business_name).toBe('שופרסל')
    expect(transactions[0].amount).toBe(250.75)
    // dd/mm/yyyy, not mm/dd/yyyy — 01/03 is 1 March, not 3 January.
    expect(transactions[0].date.toISOString()).toBe('2026-03-01T00:00:00.000Z')
  })

  it('finds the header row when preamble rows sit above it', async () => {
    // Card issuers commonly put the account holder, card number and a blank
    // line above the real header.
    const db = stubDb(['שונות'])
    const file = csv(
      `פירוט עסקאות\nכרטיס 1234\n\nתאריך,שם בית עסק,סכום\n05/03/2026,קפה,22.50\n`,
    )
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions).toHaveLength(1)
    expect(transactions[0].business_name).toBe('קפה')
  })

  it('strips currency symbols, thousands separators and whitespace from amounts', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`date,business name,amount\n2026-03-01,Rent,"₪ 4,500.00"\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].amount).toBe(4500)
  })

  it('reads parenthesised amounts as negative', async () => {
    // Accounting notation for a credit.
    const db = stubDb(['שונות', 'הכנסות'])
    const file = csv(`date,business name,amount\n2026-03-01,Refund,(250.00)\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].amount).toBe(-250)
  })

  it('files negative amounts under הכנסות regardless of the file\'s category column', async () => {
    const db = stubDb(['שונות', 'הכנסות'])
    const file = csv(`date,business name,amount,category\n2026-03-01,Salary,-12000,מזון\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].category_id).toBe(db.idOf('הכנסות'))
  })

  it('creates categories that appear in the file but not yet in the account', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`date,business name,amount,category\n2026-03-01,Supermarket,100,מזון\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)

    expect(db.categoryNames()).toContain('מזון')
    expect(transactions[0].category_id).toBe(db.idOf('מזון'))
  })

  it('reuses an existing category case-insensitively instead of duplicating it', async () => {
    const db = stubDb(['שונות', 'Food'])
    const file = csv(`date,business name,amount,category\n2026-03-01,Shop,100,food\n`)
    await parseStatementFile(file, 'x.csv', db.client, USER)

    expect(db.categoryNames().filter((n) => n.toLowerCase() === 'food')).toHaveLength(1)
  })

  it('falls back to שונות when the category cell is blank or "nan"', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`date,business name,amount,category\n2026-03-01,A,10,\n2026-03-02,B,20,nan\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)

    expect(transactions.every((t) => t.category_id === db.idOf('שונות'))).toBe(true)
  })

  it('handles quoted fields containing commas', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`date,business name,amount\n2026-03-01,"Shop, Downtown Branch",100\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].business_name).toBe('Shop, Downtown Branch')
  })

  it('handles escaped double quotes inside a quoted field', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`date,business name,amount\n2026-03-01,"The ""Best"" Cafe",100\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].business_name).toBe('The "Best" Cafe')
  })

  it('strips a UTF-8 BOM so the first header is still recognised', async () => {
    // Excel writes a BOM when saving CSV as UTF-8; without stripping it the
    // first column name would be U+FEFF followed by "date", which never matches an alias.
    const db = stubDb(['שונות'])
    const file = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), csv(BASIC_CSV)])
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions).toHaveLength(2)
  })

  it('accepts CRLF line endings', async () => {
    const db = stubDb(['שונות'])
    const file = csv(BASIC_CSV.replace(/\n/g, '\r\n'))
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions).toHaveLength(2)
    expect(transactions[0].business_name).toBe('Supermarket')
  })
})

describe('parseStatementFile — date formats', () => {
  it.each([
    ['dd/mm/yyyy', '15/03/2026', '2026-03-15'],
    ['dd-mm-yyyy', '15-03-2026', '2026-03-15'],
    ['dd.mm.yyyy', '15.03.2026', '2026-03-15'],
    ['yyyy-mm-dd', '2026-03-15', '2026-03-15'],
    ['yyyy/mm/dd', '2026/03/15', '2026-03-15'],
  ])('parses %s', async (_label, input, expected) => {
    const db = stubDb(['שונות'])
    const file = csv(`date,business name,amount\n${input},Shop,10\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].date.toISOString().slice(0, 10)).toBe(expected)
  })

  it('pivots two-digit years at 68, matching strptime', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`date,business name,amount\n01/01/68,A,10\n01/01/69,B,10\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)

    expect(transactions[0].date.getUTCFullYear()).toBe(2068)
    expect(transactions[1].date.getUTCFullYear()).toBe(1969)
  })
})

describe('parseStatementFile — rows it skips', () => {
  it('skips blank rows and summary rows without failing the import', async () => {
    const db = stubDb(['שונות'])
    const file = csv(
      `תאריך,שם בית עסק,סכום\n01/03/2026,קפה,20\n,,\nסה"כ,,20\n02/03/2026,מכולת,30\n`,
    )
    const { transactions, rowsSkipped } = await parseStatementFile(file, 'x.csv', db.client, USER)

    expect(transactions).toHaveLength(2)
    expect(rowsSkipped).toBe(2)
  })

  it('skips rows with an unparseable date or amount and counts them', async () => {
    // One bad row must not cost the user the whole statement.
    const db = stubDb(['שונות'])
    const file = csv(
      `date,business name,amount\n2026-03-01,Good,100\nnot-a-date,Bad,100\n2026-03-02,AlsoBad,abc\n`,
    )
    const { transactions, rowsSkipped } = await parseStatementFile(file, 'x.csv', db.client, USER)

    expect(transactions).toHaveLength(1)
    expect(transactions[0].business_name).toBe('Good')
    expect(rowsSkipped).toBe(2)
  })

  it('skips rows with an empty business name', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`date,business name,amount\n2026-03-01,,100\n2026-03-02,Real,50\n`)
    const { transactions, rowsSkipped } = await parseStatementFile(file, 'x.csv', db.client, USER)

    expect(transactions).toHaveLength(1)
    expect(rowsSkipped).toBe(1)
  })
})

describe('parseStatementFile — rejected files', () => {
  it('rejects a file with no recognisable columns', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`col1,col2,col3\na,b,c\n`)
    await expect(parseStatementFile(file, 'x.csv', db.client, USER)).rejects.toThrow(ParseError)
  })

  it('names the missing columns in the error, to make the failure actionable', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`date,business name\n2026-03-01,Shop\n`)
    await expect(parseStatementFile(file, 'x.csv', db.client, USER)).rejects.toThrow(/amount/)
  })

  it('rejects a file whose rows are all unparseable', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`date,business name,amount\nbad,Shop,bad\n`)
    await expect(parseStatementFile(file, 'x.csv', db.client, USER)).rejects.toThrow(
      /No valid transactions/,
    )
  })

  it('rejects an unsupported extension', async () => {
    // Legacy binary .xls is deliberately unsupported.
    const db = stubDb(['שונות'])
    await expect(parseStatementFile(csv(BASIC_CSV), 'statement.xls', db.client, USER)).rejects.toThrow(
      ParseError,
    )
  })
})

describe('parseStatementFile — XLSX', () => {
  /** Builds a real .xlsx in memory so the ExcelJS path is genuinely exercised. */
  async function xlsxBuffer(rows: unknown[][]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Sheet1')
    rows.forEach((row) => sheet.addRow(row))
    return Buffer.from(await workbook.xlsx.writeBuffer())
  }

  it('parses an xlsx statement', async () => {
    const db = stubDb(['שונות'])
    const file = await xlsxBuffer([
      ['תאריך', 'שם בית עסק', 'סכום'],
      ['01/03/2026', 'שופרסל', 150.5],
      ['02/03/2026', 'קפה', 22],
    ])
    const { transactions } = await parseStatementFile(file, 'stmt.xlsx', db.client, USER)

    expect(transactions).toHaveLength(2)
    expect(transactions[0].amount).toBe(150.5)
  })

  it('reads native Excel date cells', async () => {
    // ExcelJS hands back a Date object rather than a string for real date
    // cells, which the parser normalises before matching its format list.
    const db = stubDb(['שונות'])
    const file = await xlsxBuffer([
      ['date', 'business name', 'amount'],
      [new Date(2026, 2, 15), 'Shop', 75],
    ])
    const { transactions } = await parseStatementFile(file, 'stmt.xlsx', db.client, USER)

    expect(transactions).toHaveLength(1)
    expect(transactions[0].date.toISOString().slice(0, 10)).toBe('2026-03-15')
  })
})

describe('deduplicateTransactions', () => {
  const txn = (date: string, amount: number, name: string): ParsedTransaction => ({
    date: new Date(`${date}T00:00:00.000Z`),
    amount,
    business_name: name,
    category_id: 1,
  })

  it('inserts everything when the account is empty', async () => {
    const db = stubDb([], [])
    const parsed = [txn('2026-03-01', 100, 'A'), txn('2026-03-02', 50, 'B')]
    const { toInsert, duplicatesSkipped } = await deduplicateTransactions(parsed, db.client, USER)

    expect(toInsert).toHaveLength(2)
    expect(duplicatesSkipped).toBe(0)
  })

  it('skips a transaction already stored', async () => {
    const existing = [txn('2026-03-01', 100, 'A')]
    const db = stubDb([], existing)
    const { toInsert, duplicatesSkipped } = await deduplicateTransactions(existing, db.client, USER)

    expect(toInsert).toHaveLength(0)
    expect(duplicatesSkipped).toBe(1)
  })

  it('keeps legitimate same-day repeats by comparing counts, not just presence', async () => {
    // Two identical coffees on the same day are real. Re-importing a file
    // that contains both, when one is already stored, must insert exactly one
    // more — not zero (losing data) and not two (duplicating it).
    const db = stubDb([], [txn('2026-03-01', 18, 'Coffee')])
    const parsed = [txn('2026-03-01', 18, 'Coffee'), txn('2026-03-01', 18, 'Coffee')]
    const { toInsert, duplicatesSkipped } = await deduplicateTransactions(parsed, db.client, USER)

    expect(toInsert).toHaveLength(1)
    expect(duplicatesSkipped).toBe(1)
  })

  it('treats a different date, amount or business name as a different transaction', async () => {
    const db = stubDb([], [txn('2026-03-01', 100, 'A')])
    const parsed = [
      txn('2026-03-02', 100, 'A'), // different date
      txn('2026-03-01', 101, 'A'), // different amount
      txn('2026-03-01', 100, 'B'), // different name
    ]
    const { toInsert } = await deduplicateTransactions(parsed, db.client, USER)
    expect(toInsert).toHaveLength(3)
  })

  it('handles an empty input without querying', async () => {
    const db = stubDb([], [])
    expect(await deduplicateTransactions([], db.client, USER)).toEqual({
      toInsert: [],
      duplicatesSkipped: 0,
    })
  })
})
