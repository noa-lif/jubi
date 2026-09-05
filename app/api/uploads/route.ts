/**
 * POST /api/uploads — upload a bank statement file (.xlsx / .csv) and bulk-insert
 * the extracted transactions.
 * Port of server/app/api/routes/uploads.py.
 *
 * Security & integrity guarantees (same as the original):
 *   - Files are never written to disk — processed entirely from bytes.
 *   - A SHA-256 hash of the raw bytes is stored in file_imports. Re-uploading
 *     the same file replaces the old import record (allows recovering
 *     accidentally deleted transactions).
 *   - Row-level dedup happens separately (see deduplicateTransactions).
 *
 * Supported formats: .xlsx, .csv (legacy binary .xls is not supported — see
 * the migration plan for the security rationale).
 */
import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { deduplicateTransactions, ParseError, parseStatementFile } from '@/lib/excelParser'
import { getCurrentUser, unauthorized } from '@/lib/session'
import { toDateOnlyString } from '@/lib/transactions'
import type { MonthImported, UploadResponse } from '@/types/api'

const ALLOWED_EXTENSIONS = new Set(['xlsx', 'csv'])

function fileExtension(filename: string): string {
  return filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : ''
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser(request)
  if (!user) return unauthorized()

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!file || typeof file === 'string') {
    return NextResponse.json({ detail: 'No file provided' }, { status: 422 })
  }

  const filename = file.name || 'upload'
  const ext = fileExtension(filename)
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json(
      { detail: `Unsupported file type '.${ext}'. Allowed: .xlsx, .csv` },
      { status: 415 },
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const fileHash = createHash('sha256').update(buffer).digest('hex')

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // Allow re-upload of the same file: drop the old import record so
        // the unique constraint doesn't block the new insert.
        await tx.file_imports.deleteMany({ where: { user_id: user.id, file_hash: fileHash } })

        const { transactions: parsed, rowsSkipped } = await parseStatementFile(buffer, filename, tx, user.id)
        const { toInsert, duplicatesSkipped } = await deduplicateTransactions(parsed, tx, user.id)

        const inserted = await tx.transactions.createManyAndReturn({
          data: toInsert.map((t) => ({
            user_id: user.id,
            date: t.date,
            amount: t.amount,
            business_name: t.business_name,
            category_id: t.category_id,
          })),
        })

        await tx.file_imports.create({
          data: {
            user_id: user.id,
            file_hash: fileHash,
            filename,
            uploaded_at: new Date(),
            transaction_count: inserted.length,
          },
        })

        return { inserted, rowsSkipped, duplicatesSkipped }
      },
      { timeout: 30_000 },
    )

    const monthCounts = new Map<string, MonthImported>()
    for (const t of result.inserted) {
      const key = toDateOnlyString(t.date).slice(0, 7) // yyyy-mm
      const [year, month] = key.split('-').map(Number)
      const entry = monthCounts.get(key) ?? { year, month, count: 0 }
      entry.count++
      monthCounts.set(key, entry)
    }
    const monthsImported = [...monthCounts.values()].sort((a, b) =>
      a.year !== b.year ? a.year - b.year : a.month - b.month,
    )

    const response: UploadResponse = {
      filename,
      file_hash: fileHash,
      transactions_imported: result.inserted.length,
      rows_skipped: result.rowsSkipped,
      duplicates_skipped: result.duplicatesSkipped,
      months_imported: monthsImported,
      transaction_ids: result.inserted.map((t) => t.id),
    }
    return NextResponse.json(response, { status: 201 })
  } catch (err) {
    if (err instanceof ParseError) {
      return NextResponse.json({ detail: err.message }, { status: 422 })
    }
    throw err
  }
}
