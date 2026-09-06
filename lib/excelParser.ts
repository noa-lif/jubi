/**
 * Excel/CSV parser for credit card statements.
 * Port of server/app/services/excel_parser.py — same strategy:
 *
 *   1. Read the file entirely in-memory (xlsx via exceljs; csv by hand) into
 *      a raw string[][] grid — no header applied yet, everything as strings.
 *   2. Auto-detect the header row by scanning the first 20 rows for the one
 *      that scores best against known column aliases.
 *   3. Build a col_map: canonical name -> column index in the header row.
 *   4. For every data row: skip empties / summary totals, clean the amount,
 *      parse a flexible date, resolve the category (creating it if new).
 *   5. Return plain transaction data ready for bulk insert.
 *
 * Deviation from the original: legacy binary .xls is not supported (dropped
 * for a security reason — see plan/conversation — only .xlsx and .csv).
 */
import ExcelJS from 'exceljs'
import type { Prisma } from '@prisma/client'

// ---------------------------------------------------------------------------
// Column alias registry — verbatim port of COLUMN_ALIASES.
// ---------------------------------------------------------------------------

const COLUMN_ALIASES: Record<'amount' | 'date' | 'business_name' | 'category', Set<string>> = {
  amount: new Set([
    'amount', 'סכום', 'סכום עסקה', 'סכום חיוב', 'סכום בש"כ', 'סכום בשקלים',
    'charge amount', 'charged amount', 'debit', 'credit', 'sum',
    'transaction amount',
  ]),
  date: new Set([
    'date', 'תאריך', 'תאריך עסקה', 'תאריך רכישה', 'תאריך פעולה',
    'transaction date', 'purchase date', 'פעולה תאריך',
  ]),
  business_name: new Set([
    'business name', 'business', 'שם בית עסק', 'שם בית העסק', 'שם עסק', 'שם בית-עסק',
    'merchant', 'תיאור', 'תאור', 'description', 'name', 'פירוט',
    'details', 'בית עסק',
  ]),
  category: new Set(['category', 'קטגוריה', 'ענף', 'תחום', 'category name']),
}

const SUMMARY_RE = /סה[״"'’]?כ|סהכ|total|grand total|subtotal/i

export class ParseError extends Error {}

// ---------------------------------------------------------------------------
// File loading — normalize xlsx/csv into a raw string[][] grid.
// ---------------------------------------------------------------------------

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return toIsoDateOnly(value)
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((run) => run.text).join('')
    }
    if ('result' in value) return cellToString(value.result as ExcelJS.CellValue)
    if ('text' in value && typeof value.text === 'string') return value.text
    if ('error' in value) return ''
    return String(value)
  }
  return String(value)
}

function toIsoDateOnly(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

async function loadXlsxGrid(buffer: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer)
  const worksheet = workbook.worksheets[0]
  if (!worksheet) throw new ParseError('The uploaded file has no worksheets.')

  const grid: string[][] = []
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const values = row.values as ExcelJS.CellValue[] // 1-indexed, index 0 unused
    const cells: string[] = []
    for (let i = 1; i < values.length; i++) cells.push(cellToString(values[i]))
    grid.push(cells)
  })
  return padGrid(grid)
}

function padGrid(grid: string[][]): string[][] {
  const width = grid.reduce((max, row) => Math.max(max, row.length), 0)
  return grid.map((row) => (row.length === width ? row : [...row, ...Array(width - row.length).fill('')]))
}

/** Minimal RFC4180-ish CSV parser — comma-delimited, double-quote escaping. */
function parseCsvText(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }
    // A quote only opens a quoted field at the *start* of a field (RFC4180).
    // Treating a mid-field quote as an opener would swallow the rest of the
    // file, and Israeli statements hit this constantly: the summary row label
    // סה"כ contains a bare double quote.
    if (c === '"' && field.length === 0) inQuotes = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\r') {
      // ignore — paired \n (if any) ends the row below
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return padGrid(rows)
}

const CSV_ENCODINGS = ['utf-8', 'windows-1255', 'iso-8859-8', 'iso-8859-1'] as const

function loadCsvGrid(buffer: Buffer): string[][] {
  // Strip a UTF-8 BOM if present (mirrors pandas' "utf-8-sig").
  const bytes =
    buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
      ? buffer.subarray(3)
      : buffer

  for (const encoding of CSV_ENCODINGS) {
    try {
      const decoder = new TextDecoder(encoding, { fatal: encoding !== 'iso-8859-1' })
      const text = decoder.decode(bytes)
      return parseCsvText(text)
    } catch {
      continue // try the next encoding
    }
  }
  throw new ParseError('Could not decode CSV file — unsupported encoding.')
}

function fileExtension(filename: string): string {
  return filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : ''
}

async function loadRawGrid(buffer: Buffer, filename: string): Promise<string[][]> {
  const ext = fileExtension(filename)
  if (ext === 'xlsx') return loadXlsxGrid(buffer)
  if (ext === 'csv') return loadCsvGrid(buffer)
  throw new ParseError(`Unsupported file extension: .${ext}`)
}

// ---------------------------------------------------------------------------
// Header detection
// ---------------------------------------------------------------------------

const ALL_ALIASES = new Set(
  Object.values(COLUMN_ALIASES).flatMap((set) => [...set]),
)

function findHeaderRow(grid: string[][]): number {
  let bestIdx = 0
  let bestScore = 0
  for (let i = 0; i < Math.min(20, grid.length); i++) {
    const cellValues = new Set(
      grid[i].map((v) => v.trim().toLowerCase()).filter((v) => v.length > 0),
    )
    let score = 0
    for (const v of cellValues) if (ALL_ALIASES.has(v)) score++
    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  }
  return bestIdx
}

function buildColMap(headerRow: string[]): Partial<Record<keyof typeof COLUMN_ALIASES, number>> {
  const colMap: Partial<Record<keyof typeof COLUMN_ALIASES, number>> = {}
  headerRow.forEach((col, index) => {
    const colLower = col.trim().toLowerCase()
    for (const canonical of Object.keys(COLUMN_ALIASES) as (keyof typeof COLUMN_ALIASES)[]) {
      if (canonical in colMap) continue
      if (COLUMN_ALIASES[canonical].has(colLower)) colMap[canonical] = index
    }
  })
  return colMap
}

// ---------------------------------------------------------------------------
// Row-level helpers
// ---------------------------------------------------------------------------

function isSkipRow(row: string[], businessColIdx: number | undefined): boolean {
  const nonEmpty = row.filter((v) => v.trim().length > 0)
  if (nonEmpty.length === 0) return true
  if (businessColIdx !== undefined) {
    const val = (row[businessColIdx] ?? '').trim()
    if (SUMMARY_RE.test(val)) return true
  }
  return false
}

function cleanAmount(raw: string): number {
  let s = raw.trim()
  if (!s || s.toLowerCase() === 'nan') throw new ParseError(`Empty amount: ${JSON.stringify(raw)}`)
  s = s.replace(/[₪$€£,\s\u00a0]/g, '')
  if (s.startsWith('(') && s.endsWith(')')) s = `-${s.slice(1, -1)}`
  const value = Number(s)
  if (Number.isNaN(value)) throw new ParseError(`Cannot parse amount: ${JSON.stringify(raw)}`)
  return value
}

interface DatePattern {
  regex: RegExp
  order: readonly ['d' | 'm' | 'y', 'd' | 'm' | 'y', 'd' | 'm' | 'y']
  twoDigitYear: boolean
}

// Same explicit format list/order as _DATE_FORMATS in excel_parser.py.
const DATE_PATTERNS: DatePattern[] = [
  { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: ['d', 'm', 'y'], twoDigitYear: false },
  { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, order: ['d', 'm', 'y'], twoDigitYear: true },
  { regex: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, order: ['d', 'm', 'y'], twoDigitYear: false },
  { regex: /^(\d{1,2})-(\d{1,2})-(\d{2})$/, order: ['d', 'm', 'y'], twoDigitYear: true },
  { regex: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, order: ['d', 'm', 'y'], twoDigitYear: false },
  { regex: /^(\d{1,2})\.(\d{1,2})\.(\d{2})$/, order: ['d', 'm', 'y'], twoDigitYear: true },
  { regex: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, order: ['y', 'm', 'd'], twoDigitYear: false },
  { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: ['m', 'd', 'y'], twoDigitYear: false },
  { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, order: ['m', 'd', 'y'], twoDigitYear: true },
  { regex: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, order: ['y', 'm', 'd'], twoDigitYear: false },
]

/** POSIX strptime %y pivot: 00-68 -> 2000s, 69-99 -> 1900s. */
function pivotTwoDigitYear(y: number): number {
  return y <= 68 ? 2000 + y : 1900 + y
}

function tryDatePattern(raw: string, pattern: DatePattern): Date | null {
  const match = pattern.regex.exec(raw)
  if (!match) return null

  const parts: Record<'d' | 'm' | 'y', number> = { d: 1, m: 1, y: 1970 }
  pattern.order.forEach((field, i) => {
    parts[field] = Number(match[i + 1])
  })
  if (pattern.twoDigitYear) parts.y = pivotTwoDigitYear(parts.y)

  if (parts.m < 1 || parts.m > 12 || parts.d < 1 || parts.d > 31) return null

  const date = new Date(Date.UTC(parts.y, parts.m - 1, parts.d))
  // Reject overflow (e.g. Feb 30 rolling into March).
  if (date.getUTCFullYear() !== parts.y || date.getUTCMonth() !== parts.m - 1 || date.getUTCDate() !== parts.d) {
    return null
  }
  return date
}

function parseDate(raw: string): Date {
  const s = raw.trim()
  if (!s || s.toLowerCase() === 'nan') throw new ParseError(`Empty date: ${JSON.stringify(raw)}`)

  // If the source cell was already a real Date (xlsx), it comes through the
  // grid as an ISO yyyy-mm-dd string (see cellToString) and matches the
  // "%Y-%m-%d" pattern below directly.
  for (const pattern of DATE_PATTERNS) {
    const parsed = tryDatePattern(s, pattern)
    if (parsed) return parsed
  }
  throw new ParseError(`Cannot parse date: ${JSON.stringify(raw)}`)
}

// ---------------------------------------------------------------------------
// Category resolution — mirrors _resolve_category, with an in-memory cache
// scoped to a single upload so repeated names only hit the DB once.
// ---------------------------------------------------------------------------

class CategoryResolver {
  private cache = new Map<string, number>()

  constructor(
    private tx: Prisma.TransactionClient,
    private userId: number,
  ) {}

  async resolve(name: string | null): Promise<number> {
    const target = name && !['nan', 'none', ''].includes(name.trim().toLowerCase()) ? name.trim() : 'שונות'

    const cached = this.cache.get(target)
    if (cached !== undefined) return cached

    let category = await this.tx.categories.findFirst({
      where: { user_id: this.userId, name: { equals: target, mode: 'insensitive' } },
    })
    if (!category) {
      category = await this.tx.categories.create({ data: { user_id: this.userId, name: target } })
    }

    this.cache.set(target, category.id)
    return category.id
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ParsedTransaction {
  date: Date
  amount: number
  business_name: string
  category_id: number
}

export interface ParseResult {
  transactions: ParsedTransaction[]
  rowsSkipped: number
}

export async function parseStatementFile(
  buffer: Buffer,
  filename: string,
  tx: Prisma.TransactionClient,
  userId: number,
): Promise<ParseResult> {
  const raw = await loadRawGrid(buffer, filename)
  const headerIdx = findHeaderRow(raw)
  const headerRow = raw[headerIdx] ?? []
  const dataRows = raw.slice(headerIdx + 1)

  const colMap = buildColMap(headerRow)
  const required: (keyof typeof COLUMN_ALIASES)[] = ['amount', 'date', 'business_name']
  const missing = required.filter((key) => colMap[key] === undefined)
  if (missing.length > 0) {
    const visibleCols = headerRow.filter((c) => c.trim().length > 0)
    throw new ParseError(
      `Could not find required columns: ${missing.join(', ')}. Columns detected in file: ${visibleCols.join(', ')}`,
    )
  }

  const resolver = new CategoryResolver(tx, userId)
  // Resolved lazily — only the first income (negative-amount) row triggers
  // the lookup/create; subsequent ones hit the resolver's own cache.
  let hachnasotId: number | null = null
  const resolveHachnasot = async (): Promise<number> => {
    if (hachnasotId === null) hachnasotId = await resolver.resolve('הכנסות')
    return hachnasotId
  }

  const transactions: ParsedTransaction[] = []
  let rowsSkipped = 0

  for (const row of dataRows) {
    if (isSkipRow(row, colMap.business_name)) {
      rowsSkipped++
      continue
    }
    try {
      const amount = cleanAmount(row[colMap.amount!] ?? '')
      const date = parseDate(row[colMap.date!] ?? '')
      const business = (row[colMap.business_name!] ?? '').trim()
      if (!business || business.toLowerCase() === 'nan') {
        rowsSkipped++
        continue
      }

      const rawCat = colMap.category !== undefined ? row[colMap.category] : undefined
      const catName = rawCat && rawCat.trim() ? rawCat.trim() : null

      const categoryId = amount < 0 ? await resolveHachnasot() : await resolver.resolve(catName)

      transactions.push({ date, amount, business_name: business, category_id: categoryId })
    } catch {
      rowsSkipped++
      continue
    }
  }

  if (transactions.length === 0) {
    throw new ParseError(
      'No valid transactions were found in the file. Ensure it contains Date, Amount, and Business Name columns.',
    )
  }

  return { transactions, rowsSkipped }
}

/**
 * Frequency-based row-level deduplication against the existing DB.
 * Port of deduplicate_transactions — a transaction's identity is
 * (date, amount, business_name); legitimate same-day duplicates are allowed,
 * the system inserts exactly (file_count - db_count) rows per key.
 */
export async function deduplicateTransactions(
  parsed: ParsedTransaction[],
  tx: Prisma.TransactionClient,
  userId: number,
): Promise<{ toInsert: ParsedTransaction[]; duplicatesSkipped: number }> {
  if (parsed.length === 0) return { toInsert: [], duplicatesSkipped: 0 }

  const key = (t: { date: Date; amount: number; business_name: string }) =>
    `${t.date.toISOString().slice(0, 10)}|${t.amount.toFixed(2)}|${t.business_name}`

  const fileCounts = new Map<string, number>()
  for (const t of parsed) fileCounts.set(key(t), (fileCounts.get(key(t)) ?? 0) + 1)

  const uniqueDates = [...new Set(parsed.map((t) => t.date.getTime()))].map((t) => new Date(t))
  const existing = await tx.transactions.findMany({
    where: { user_id: userId, date: { in: uniqueDates } },
    select: { date: true, amount: true, business_name: true },
  })
  const dbCounts = new Map<string, number>()
  for (const row of existing) {
    const k = key(row)
    dbCounts.set(k, (dbCounts.get(k) ?? 0) + 1)
  }

  const groups = new Map<string, ParsedTransaction[]>()
  for (const t of parsed) {
    const k = key(t)
    const arr = groups.get(k) ?? []
    arr.push(t)
    groups.set(k, arr)
  }

  const toInsert: ParsedTransaction[] = []
  let duplicatesSkipped = 0
  for (const [k, txns] of groups) {
    const n = Math.max(0, (fileCounts.get(k) ?? 0) - (dbCounts.get(k) ?? 0))
    toInsert.push(...txns.slice(0, n))
    duplicatesSkipped += txns.length - n
  }

  return { toInsert, duplicatesSkipped }
}
