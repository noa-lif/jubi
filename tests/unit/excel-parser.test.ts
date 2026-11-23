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
import JSZip from 'jszip'
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

  // Statements often carry two date columns per row: the original purchase
  // date and the date that row is actually charged. This is a monthly
  // tracker, so the charge date is the one worth storing — a purchase made in
  // April and still being paid off in September belongs to September's total.
  // When the issuer labels the columns, the label decides; column order never
  // does.
  it('prefers an explicit charge-date column over the purchase date', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`תאריך עסקה,תאריך חיוב,שם בית עסק,סכום\n14/04/2026,02/09/2026,Shop,10\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].date.toISOString().slice(0, 10)).toBe('2026-09-02')
  })

  it('prefers the charge column regardless of which column comes first', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`charge date,purchase date,business name,amount\n02/09/2026,14/04/2026,Shop,10\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].date.toISOString().slice(0, 10)).toBe('2026-09-02')
  })

  // With two unlabelled columns there is no header signal, but a purchase can
  // never postdate its own charge, so the later value is the charge date.
  it('reads the later of two unlabelled date columns as the charge date', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`date,תאריך,business name,amount\n14/04/2026,02/09/2026,Shop,10\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].date.toISOString().slice(0, 10)).toBe('2026-09-02')
  })

  it('falls back to whichever date column parses when the other is unparseable', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`תאריך עסקה,תאריך חיוב,שם בית עסק,סכום\n15/03/2026,bad,Shop,10\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].date.toISOString().slice(0, 10)).toBe('2026-03-15')
  })
})

describe('parseStatementFile — installment plans', () => {
  // Statements repeat the *original purchase date* on every installment row
  // of a plan (rather than that installment's own charge date), with a free
  // text note like "תשלום 2 מתוך 12" (payment 2 of 12) marking progress.
  // Payment N is actually charged N-1 months after the purchase date, so the
  // parser must shift the date forward accordingly rather than taking the
  // purchase date at face value.
  it('shifts the date forward by (installment - 1) months for a Hebrew installment note', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`date,business name,amount,note\n05/08/2026,ליברה עסקאות ביטוח,112.33,תשלום 2 מתוך 12\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].date.toISOString().slice(0, 10)).toBe('2026-09-05')
  })

  it('shifts the date forward for an English "payment N of M" note', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`date,business name,amount,note\n14/04/2026,Some Shop,105.42,payment 6 of 12\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].date.toISOString().slice(0, 10)).toBe('2026-09-14')
  })

  it('does not shift the first installment', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`date,business name,amount,note\n05/08/2026,Shop,50,תשלום 1 מתוך 12\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].date.toISOString().slice(0, 10)).toBe('2026-08-05')
  })

  it('leaves ordinary (non-installment) rows unchanged', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`date,business name,amount,note\n05/08/2026,Shop,50,הוראת קבע\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].date.toISOString().slice(0, 10)).toBe('2026-08-05')
  })

  it('clamps day-of-month overflow (e.g. Jan 31 + 1 month lands on Feb 28)', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`date,business name,amount,note\n31/01/2026,Shop,50,תשלום 2 מתוך 12\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].date.toISOString().slice(0, 10)).toBe('2026-02-28')
  })

  it('ignores a nonsensical installment note rather than shifting by it', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`date,business name,amount,note\n05/08/2026,Shop,50,תשלום 14 מתוך 12\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].date.toISOString().slice(0, 10)).toBe('2026-08-05')
  })

  // The shift reconstructs a charge date the file didn't give us. When the
  // file *does* give us one, shifting it again would push the row a further
  // N-1 months out — five months, for "payment 6 of 12".
  it('does not shift a row that already carries its own charge date', async () => {
    const db = stubDb(['שונות'])
    const file = csv(
      `תאריך עסקה,תאריך חיוב,שם בית עסק,סכום,הערות\n14/04/2026,02/09/2026,Some Shop,105.42,תשלום 6 מתוך 12\n`,
    )
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].date.toISOString().slice(0, 10)).toBe('2026-09-02')
  })

  it('does not shift an installment row with an English charge-date column', async () => {
    const db = stubDb(['שונות'])
    const file = csv(
      `purchase date,charge date,business name,amount,note\n14/04/2026,02/09/2026,Shop,105.42,payment 6 of 12\n`,
    )
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].date.toISOString().slice(0, 10)).toBe('2026-09-02')
  })

  it('does not shift when the charge date came from two unlabelled columns', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`date,תאריך,business name,amount,note\n14/04/2026,02/09/2026,Shop,10,payment 6 of 12\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].date.toISOString().slice(0, 10)).toBe('2026-09-02')
  })

  it('still shifts when the only date column is labelled as the purchase date', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`תאריך עסקה,שם בית עסק,סכום,הערות\n14/04/2026,Shop,105.42,תשלום 6 מתוך 12\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].date.toISOString().slice(0, 10)).toBe('2026-09-14')
  })
})

describe('parseStatementFile — installment amounts', () => {
  // On an installment row "סכום עסקה" is the full original purchase and
  // "סכום חיוב" is what this month is actually charged. They are different
  // numbers, and the app records what was charged — so the charge column
  // wins whichever side of the file the issuer happened to put it on.
  it('prefers the charge column over the transaction column', async () => {
    const db = stubDb(['שונות'])
    const file = csv(
      `תאריך,שם בית עסק,סכום עסקה,סכום חיוב,הערות\n05/08/2026,ליברה,1347.96,112.33,תשלום 2 מתוך 12\n`,
    )
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].amount).toBe(112.33)
  })

  it('prefers the charge column regardless of column order', async () => {
    const db = stubDb(['שונות'])
    const file = csv(
      `תאריך,שם בית עסק,סכום חיוב,סכום עסקה,הערות\n05/08/2026,ליברה,112.33,1347.96,תשלום 2 מתוך 12\n`,
    )
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].amount).toBe(112.33)
  })

  // When the only money column is the purchase total, the statement repeats
  // it on every row of the plan, so this month's share has to be derived.
  it('divides the transaction amount by the installment total', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`תאריך,שם בית עסק,סכום עסקה,הערות\n05/08/2026,ליברה,1347.96,תשלום 2 מתוך 12\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].amount).toBe(112.33)
  })

  it('rounds a derived installment to agorot', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`date,business name,transaction amount,note\n05/08/2026,Shop,1000,payment 2 of 3\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].amount).toBe(333.33)
  })

  it('leaves a lone charge column untouched', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`תאריך,שם בית עסק,סכום חיוב,הערות\n05/08/2026,ליברה,112.33,תשלום 2 מתוך 12\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].amount).toBe(112.33)
  })

  // A generically-named column carries no evidence of which number it holds,
  // and in practice issuers put this month's charge there. Dividing it would
  // turn a correct 112.33 into a plausible-looking but wrong 9.36, so the
  // parser deliberately leaves it alone.
  it('does not divide a generically-named amount column', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`תאריך,שם בית עסק,סכום,הערות\n05/08/2026,ליברה,112.33,תשלום 2 מתוך 12\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].amount).toBe(112.33)
  })

  it('falls back to the transaction column when the charge cell is blank', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`תאריך,שם בית עסק,סכום חיוב,סכום עסקה,הערות\n05/08/2026,ליברה,,1347.96,תשלום 2 מתוך 12\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].amount).toBe(112.33)
  })

  it('leaves ordinary rows with two amount columns alone', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`תאריך,שם בית עסק,סכום עסקה,סכום חיוב\n05/08/2026,שופרסל,150.50,150.50\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].amount).toBe(150.5)
  })

  it('does not divide a single-payment row', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`תאריך,שם בית עסק,סכום עסקה,הערות\n05/08/2026,שופרסל,150.50,תשלום 1 מתוך 1\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].amount).toBe(150.5)
  })

  it('preserves the sign of a credit and still files it under הכנסות', async () => {
    const db = stubDb(['שונות', 'הכנסות'])
    const file = csv(`date,business name,transaction amount,note\n05/08/2026,Refund,-1200,payment 2 of 12\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].amount).toBe(-100)
    expect(transactions[0].category_id).toBe(db.idOf('הכנסות'))
  })

  it('ignores a malformed installment note rather than dividing by it', async () => {
    const db = stubDb(['שונות'])
    const file = csv(`date,business name,transaction amount,note\n05/08/2026,Shop,1200,payment 0 of 0\n`)
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions[0].amount).toBe(1200)
  })

  // The shape this feature exists for: a real statement carries both date
  // columns and both amount columns, and lists several installments of one
  // plan. Each row must land in the month it is charged, carrying that
  // month's charge — not twelve copies of the full 1347.96 in August.
  it('spreads a plan across months at the per-month charge', async () => {
    const db = stubDb(['שונות'])
    const file = csv(
      `תאריך עסקה,תאריך חיוב,שם בית עסק,סכום עסקה,סכום חיוב,הערות\n` +
        `05/08/2026,05/08/2026,ליברה,1347.96,112.33,תשלום 1 מתוך 12\n` +
        `05/08/2026,05/09/2026,ליברה,1347.96,112.33,תשלום 2 מתוך 12\n` +
        `05/08/2026,05/10/2026,ליברה,1347.96,112.33,תשלום 3 מתוך 12\n`,
    )
    const { transactions } = await parseStatementFile(file, 'x.csv', db.client, USER)

    expect(transactions.map((t) => t.date.toISOString().slice(0, 10))).toEqual([
      '2026-08-05',
      '2026-09-05',
      '2026-10-05',
    ])
    expect(transactions.map((t) => t.amount)).toEqual([112.33, 112.33, 112.33])
  })

  it('still skips a row where no amount column parses', async () => {
    const db = stubDb(['שונות'])
    const file = csv(
      `date,business name,charge amount,transaction amount\n05/08/2026,Good,,100\n06/08/2026,Bad,abc,xyz\n`,
    )
    const { transactions, rowsSkipped } = await parseStatementFile(file, 'x.csv', db.client, USER)
    expect(transactions).toHaveLength(1)
    expect(rowsSkipped).toBe(1)
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

  // Reproduces a real bank export (seen from an Israeli credit card issuer)
  // that ExcelJS 4.4.0 can't read as-is: its internal OOXML uses an explicit
  // namespace prefix (<x:workbook>, <x:sheets>, ...) instead of the
  // unprefixed tags Excel itself always emits, and its table relationship
  // targets are absolute package paths (Target="/xl/tables/table1.xml")
  // instead of the relative form ExcelJS expects. Both are valid OOXML, but
  // ExcelJS's SAX parser matches bare tag names and its table lookup matches
  // by literal relative-style key, so together they used to crash the
  // uploads route with a 500 instead of importing the file.
  it('parses a real xlsx whose OOXML uses a namespace prefix and absolute table-relationship targets', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Sheet1')
    sheet.addTable({
      name: 'ApprovedTransactions1',
      ref: 'A1',
      headerRow: true,
      columns: [{ name: 'תאריך' }, { name: 'שם בית עסק' }, { name: 'סכום' }],
      rows: [
        ['01/03/2026', 'שופרסל', 150.5],
        ['02/03/2026', 'קפה', 22],
      ],
    })
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())

    const zip = await JSZip.loadAsync(buffer)
    const nsUri = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || !entry.name.startsWith('xl/') || !entry.name.endsWith('.xml')) continue
      const xml = await entry.async('string')
      if (!xml.includes(nsUri)) continue
      // Rewrite the default namespace onto an explicit "x" prefix, as the
      // real bank export does.
      const prefixed = xml
        .replace(`xmlns="${nsUri}"`, `xmlns:x="${nsUri}"`)
        .replace(/<(\/?)(workbook|sheets|sheet|worksheet|dimension|sheetViews|sheetView|selection|cols|col|sheetData|row|c|v|tableParts|tablePart|table|autoFilter|tableColumns|tableColumn|is|t)\b/g, '<$1x:$2')
      zip.file(entry.name, prefixed)
    }
    const relsPath = 'xl/worksheets/_rels/sheet1.xml.rels'
    const relsXml = await zip.file(relsPath)!.async('string')
    zip.file(relsPath, relsXml.replace('Target="../tables/table1.xml"', 'Target="/xl/tables/table1.xml"'))

    const mutatedBuffer = await zip.generateAsync({ type: 'nodebuffer' })

    const db = stubDb(['שונות'])
    const { transactions } = await parseStatementFile(mutatedBuffer, 'stmt.xlsx', db.client, USER)

    expect(transactions).toHaveLength(2)
    expect(transactions[0].amount).toBe(150.5)
    expect(transactions[0].business_name).toBe('שופרסל')
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
