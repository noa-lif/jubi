/**
 * Statement upload, end to end: multipart request -> parse -> deduplicate ->
 * bulk insert -> file_imports bookkeeping.
 *
 * This is the app's primary business process and the only endpoint that
 * writes many rows at once, so it is exercised against a real database with
 * real files rather than stubs.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { POST as upload } from '@/app/api/uploads/route'
import { prisma } from '@/lib/db'
import { createTestUser, describeDb, resetDb, type TestUser } from '../helpers/db'

const CSV = `תאריך,שם בית עסק,סכום,קטגוריה
01/03/2026,שופרסל,150.50,מזון
02/03/2026,קפה,18,מזון
03/03/2026,משכורת,-9000,
`

describeDb('POST /api/uploads', () => {
  let user: TestUser

  beforeEach(async () => {
    await resetDb()
    user = await createTestUser()
  })

  /** Builds the multipart request the browser's FormData upload produces. */
  function uploadRequest(content: Buffer | string, filename: string, token = user.token): Request {
    const form = new FormData()
    const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
    form.append('file', new File([new Uint8Array(bytes)], filename))

    return new Request('http://localhost/api/uploads', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    })
  }

  it('imports a CSV statement and reports what it did', async () => {
    const res = await upload(uploadRequest(CSV, 'statement.csv'))
    expect(res.status).toBe(201)

    const body = await res.json()
    expect(body.transactions_imported).toBe(3)
    expect(body.duplicates_skipped).toBe(0)
    expect(body.months_imported).toEqual([{ year: 2026, month: 3, count: 3 }])
    expect(body.transaction_ids).toHaveLength(3)
    expect(body.file_hash).toMatch(/^[0-9a-f]{64}$/)

    expect(await prisma.transactions.count({ where: { user_id: user.id } })).toBe(3)
  })

  it('creates categories found in the file and files income under הכנסות', async () => {
    await upload(uploadRequest(CSV, 'statement.csv'))

    const food = await prisma.categories.findFirst({ where: { user_id: user.id, name: 'מזון' } })
    expect(food).not.toBeNull()

    const salary = await prisma.transactions.findFirst({ where: { business_name: 'משכורת' } })
    expect(salary!.category_id).toBe(user.hachnasotId)
    expect(salary!.amount).toBe(-9000)
  })

  it('records the import in file_imports', async () => {
    await upload(uploadRequest(CSV, 'statement.csv'))

    const record = await prisma.file_imports.findFirst({ where: { user_id: user.id } })
    expect(record).toMatchObject({ filename: 'statement.csv', transaction_count: 3 })
  })

  it('skips every row on a second upload of the same file', async () => {
    // Re-uploading a statement is the common accident this must absorb: the
    // user must not end up with two copies of every transaction.
    await upload(uploadRequest(CSV, 'statement.csv'))
    const res = await upload(uploadRequest(CSV, 'statement.csv'))
    const body = await res.json()

    expect(body.transactions_imported).toBe(0)
    expect(body.duplicates_skipped).toBe(3)
    expect(await prisma.transactions.count({ where: { user_id: user.id } })).toBe(3)
  })

  it('replaces the previous file_imports row rather than violating its unique constraint', async () => {
    await upload(uploadRequest(CSV, 'statement.csv'))
    await upload(uploadRequest(CSV, 'statement.csv'))

    expect(await prisma.file_imports.count({ where: { user_id: user.id } })).toBe(1)
  })

  it('imports only the new rows when a statement is extended', async () => {
    await upload(uploadRequest(CSV, 'march.csv'))
    const extended = `${CSV}04/03/2026,מסעדה,88,מזון\n`
    const body = await (await upload(uploadRequest(extended, 'march-updated.csv'))).json()

    expect(body.transactions_imported).toBe(1)
    expect(body.duplicates_skipped).toBe(3)
    expect(await prisma.transactions.count({ where: { user_id: user.id } })).toBe(4)
  })

  it('groups the import summary by month when a file spans several', async () => {
    const multi = `date,business name,amount\n01/02/2026,A,10\n01/03/2026,B,20\n02/03/2026,C,30\n`
    const body = await (await upload(uploadRequest(multi, 'multi.csv'))).json()

    expect(body.months_imported).toEqual([
      { year: 2026, month: 2, count: 1 },
      { year: 2026, month: 3, count: 2 },
    ])
  })

  it('imports an xlsx statement', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Sheet1')
    sheet.addRow(['תאריך', 'שם בית עסק', 'סכום'])
    sheet.addRow(['01/03/2026', 'שופרסל', 150.5])
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())

    const res = await upload(uploadRequest(buffer, 'statement.xlsx'))
    expect(res.status).toBe(201)
    expect((await res.json()).transactions_imported).toBe(1)
  })

  it('keeps each user\'s import separate', async () => {
    // Identical files uploaded by two users must both import in full — the
    // dedup key is scoped per user.
    const other = await createTestUser('other@example.com')
    await upload(uploadRequest(CSV, 'statement.csv'))
    const body = await (await upload(uploadRequest(CSV, 'statement.csv', other.token))).json()

    expect(body.transactions_imported).toBe(3)
    expect(await prisma.transactions.count({ where: { user_id: user.id } })).toBe(3)
    expect(await prisma.transactions.count({ where: { user_id: other.id } })).toBe(3)
  })

  describe('rejected uploads', () => {
    it('rejects a request with no file', async () => {
      const req = new Request('http://localhost/api/uploads', {
        method: 'POST',
        headers: { Authorization: `Bearer ${user.token}` },
        body: new FormData(),
      })
      expect((await upload(req)).status).toBe(422)
    })

    it.each(['statement.xls', 'statement.pdf', 'statement.txt', 'noextension'])(
      'rejects %s with 415',
      async (filename) => {
        // Legacy binary .xls is deliberately unsupported.
        expect((await upload(uploadRequest(CSV, filename))).status).toBe(415)
      },
    )

    it('rejects a file with no usable columns with 422', async () => {
      const res = await upload(uploadRequest('a,b,c\n1,2,3\n', 'junk.csv'))
      expect(res.status).toBe(422)
      expect((await res.json()).detail).toMatch(/columns/i)
    })

    it('writes nothing when the file is rejected', async () => {
      // The whole import runs in one transaction, so a mid-file failure must
      // not leave a partial statement behind.
      await upload(uploadRequest('a,b,c\n1,2,3\n', 'junk.csv'))

      expect(await prisma.transactions.count()).toBe(0)
      expect(await prisma.file_imports.count()).toBe(0)
    })

    it('imports the good rows and counts the bad ones', async () => {
      const mixed = `date,business name,amount\n01/03/2026,Good,100\nbad-date,Bad,50\n`
      const body = await (await upload(uploadRequest(mixed, 'mixed.csv'))).json()

      expect(body.transactions_imported).toBe(1)
      expect(body.rows_skipped).toBe(1)
    })
  })
})
