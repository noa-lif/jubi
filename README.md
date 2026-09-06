# 💰 Jubi — Personal Expense Tracker

A monthly expense tracker built with **Next.js (App Router) + TypeScript**, backed by
**Supabase Postgres** via **Prisma**, and deployed on **Vercel**.

Upload a credit-card or bank statement (`.xlsx` / `.csv`), and Jubi parses it, deduplicates
against what you already have, categorizes each row, and shows the month's spending as a
running total and a per-category breakdown.

**Live app:** https://www.jubijubi.com
**Repository:** https://github.com/noa-lif/jubi

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | One deployable unit for UI and API — Route Handlers replace a separate backend service, so there is no second host or CORS layer to maintain. |
| Language | TypeScript (strict) | The API response shapes in `types/api.ts` are shared by the route handlers and the client, so a change to a payload breaks the build rather than the app. |
| Database | Supabase Postgres | Managed Postgres with a connection pooler, which matters because serverless functions open a connection per invocation. |
| ORM | Prisma | Typed query results derived from the schema, and versioned migrations. |
| Auth | Custom JWT (`jose` + `bcryptjs`) | Ported from the previous FastAPI backend, which used the same bcrypt + HS256 scheme, so existing password hashes stayed valid. Supabase Auth would have invalidated them. |
| Styling | Tailwind CSS v4 | Utility classes kept alongside the markup; no separate stylesheet to keep in sync. |
| Charts | Recharts | Declarative React components for the category breakdown pie chart. |
| Spreadsheets | ExcelJS | Parses `.xlsx` uploads. Chosen over SheetJS (`xlsx`), whose npm distribution has unpatched prototype-pollution advisories — the parser handles untrusted user uploads, so that mattered. |
| Tests | Vitest + React Testing Library | Vitest shares Vite's transform pipeline, so the TypeScript and path aliases work without extra configuration. |

---

## Running it locally

**Prerequisites:** Node.js 20+ and a Supabase project (or any Postgres 14+).

```bash
git clone https://github.com/noa-lif/jubi.git
cd jubi
npm install

# Configure environment
cp .env.example .env.local
# then edit .env.local — see "Environment variables" below

# Create the schema
npx prisma migrate deploy

# Start the dev server
npm run dev
# → http://localhost:3000
```

`npm install` runs `prisma generate` automatically, so the Prisma client is
ready before the first build.

Open http://localhost:3000, sign up, and upload a statement. There is no seed data —
signing up creates your account plus its two built-in categories.

### Environment variables

Names and purpose only — real values belong in `.env.local`, which is gitignored.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Runtime Postgres connection. Use the Supabase **pooler** host. |
| `DIRECT_URL` | yes | Direct (session-mode) connection, used by the Prisma CLI for migrations. |
| `JWT_SECRET` | yes | Signing key for session tokens. The app refuses to start without it. |
| `JWT_EXPIRES_IN` | no | Token lifetime, default `7d`. |
| `TEST_DATABASE_URL` | no | Separate schema for the database test suite. Without it those tests skip. |

See [.env.example](.env.example) for the exact format and how to generate a `JWT_SECRET`.

---

## Testing

```bash
npm test           # everything (327 tests)
npm run test:unit  # unit + component tests only — no database needed
npm run test:db    # database-backed API tests
npm run test:watch # watch mode
```

The database tests run against a **separate schema** (`TEST_DATABASE_URL` ends with
`?schema=jubi_test`), never the app's data. Set it up once:

```bash
npm run db:migrate:test
```

Without `TEST_DATABASE_URL` the database suites skip themselves and the rest still runs,
so a fresh clone can run `npm test` with no database access.

### What's covered

| Area | Where | What it checks |
|---|---|---|
| Input validation | `tests/unit/validation.test.ts` | Every rule the API enforces, valid and invalid: emails, bcrypt's 72-**byte** password limit, the Israeli ID checksum, calendar-invalid dates, `NaN`/`Infinity` amounts, column-length limits, pagination bounds. |
| Business rules | `tests/unit/transactions-domain.test.ts` | Month boundaries including the December→January rollover; the category-resolution rules (income pinned to הכנסות, expenses falling back to שונות, another user's category rejected). |
| Statement parsing | `tests/unit/excel-parser.test.ts` | Header auto-detection under preamble rows, Hebrew and English column aliases, five date formats, two-digit-year pivoting, currency symbols and accounting negatives, encoding and BOM handling, summary-row skipping, and the frequency-based deduplication that preserves legitimate same-day repeats. |
| Authentication | `tests/integration/auth.test.ts` | Signup/login/me against real Postgres: password hashing, duplicate handling, and that a wrong password is indistinguishable from an unknown email. Forged, expired, unsigned and orphaned tokens are all rejected. |
| Authorization | `tests/integration/authorization.test.ts` | Every endpoint, twice: unauthenticated requests are refused, and one user cannot read, update or delete another's data. Includes the bulk-delete endpoint and cascade behaviour. |
| CRUD + pagination | `tests/integration/transactions.test.ts` | Full lifecycle, month filtering at the boundaries, and a pagination walk asserting every row appears exactly once across pages. |
| Categories | `tests/integration/categories.test.ts` | Create/rename/delete, case-insensitive duplicate rejection, protected categories, and that deleting a category reassigns its transactions rather than orphaning them. |
| Upload flow | `tests/integration/uploads.test.ts` | The end-to-end import, re-upload deduplication, per-user isolation, rejected file types, and that a rejected file writes nothing. |
| UI | `tests/ui/` | Forms driven through labels and buttons: validation messages, server errors, the debit/credit sign convention, edit prefill, and the pager's range display and disabled states. |

Three real bugs were found by writing these tests and are fixed in the code: the CSV parser
treated a mid-field quote as a quoted-field opener (breaking on `סה"כ`, the Hebrew summary
row label, which swallowed the rest of the file); the shared `Input` component rendered
labels not associated with their inputs; and native browser validation pre-empted the
transaction form's own Hebrew error messages.

---

## Architecture

```
app/
├── (dashboard)/            # Auth-gated route group
│   ├── layout.tsx          # Redirects to /auth without a valid token
│   ├── page.tsx            # Dashboard: summary, chart, paginated table
│   └── categories/page.tsx # Category management
├── auth/page.tsx           # Login / signup
└── api/                    # Route Handlers (the backend)
    ├── auth/               # signup, login, me
    ├── categories/         # list, create, rename, delete
    ├── transactions/       # list+create, get/update/delete, category, summary, batch-delete
    └── uploads/            # statement import

lib/                        # Server-side domain logic
├── auth.ts                 # bcrypt hashing, JWT sign/verify
├── session.ts              # Bearer-token -> user resolution
├── validation.ts           # Shared input validators (pure, unit-tested)
├── transactions.ts         # Month ranges, category resolution
├── categories.ts           # Protected-category rules
├── excelParser.ts          # .xlsx/.csv parsing and deduplication
└── db.ts                   # Prisma client singleton

api-client/                 # Typed fetch wrappers used by the client components
components/                 # UI, grouped by feature (auth / dashboard / layout / ui)
types/api.ts                # Request/response contracts shared by both sides
prisma/                     # Schema and versioned migrations
tests/                      # unit / integration / ui
```

### Data flow

Client components call `api-client/*`, a thin `fetch` wrapper that attaches the bearer token
from `localStorage` and throws a typed `ApiClientError` carrying the server's message. Route
handlers resolve the token to a user via `getCurrentUser`, validate the input with
`lib/validation`, and query Postgres through Prisma. Every response is shaped by a type in
`types/api.ts`, which both sides import — so the contract is enforced at compile time.

### Data model

| Table | Purpose |
|---|---|
| `users` | Account: email, bcrypt password hash, Israeli ID number. |
| `categories` | Per-user spending categories. `(user_id, name)` is unique, so two users can both have "Food". |
| `transactions` | One row per expense or income. Positive = expense, negative = income. |
| `file_imports` | SHA-256 of each uploaded file, so a re-upload is recognised. |
| `password_reset_tokens` | Reserved. The password-reset flow existed in the previous FastAPI backend and has **not** been ported yet; the table is retained so the migration history stays continuous. No application code reads or writes it. |

Two categories — **שונות** (miscellaneous) and **הכנסות** (income) — are seeded for every
account at signup and cannot be renamed or deleted. They are load-bearing: income is always
filed under הכנסות, and שונות is the fallback for anything uncategorized, including the
transactions rescued when a category is deleted.

---

## Design decisions worth explaining

**Amount sign carries the expense/income distinction.** A negative amount is income. This
avoids a separate `type` column that could contradict the amount, and makes the monthly net
a single `SUM`. The trade-off is that the rule has to be enforced everywhere, which is why
`resolveCategoryId` is the single place that decides a transaction's category.

**Deduplication is frequency-based, not presence-based.** A transaction's identity is
`(date, amount, business_name)`. Two identical coffees on the same day are legitimate, so
the importer inserts `max(0, count_in_file - count_in_db)` rows per key instead of skipping
anything that already exists.

**The category breakdown is aggregated in Postgres.** `/api/transactions/summary` returns
per-category totals from a `GROUP BY`. The chart therefore needs a handful of rows rather
than the whole month, which is also what makes paginating the table safe — a client-side
sum would only ever chart the current page.

**One composite index does the work.** Every read path filters `user_id` *and* a date range
together, and Postgres uses one index per scan, so the separate single-column indexes forced
it to filter the rest by hand. `(user_id, date)` covers all of them — `user_id` first
because it is an equality match, letting the date range scan one contiguous slice. The
redundant indexes Postgres already provides via the primary keys were dropped. See
[`prisma/migrations/1_performance_indexes/migration.sql`](prisma/migrations/1_performance_indexes/migration.sql).

**Auth is checked on the server, gated on the client.** The token lives in `localStorage`,
so the `(dashboard)` layout can only redirect after hydration — meaning route protection is
a UX affordance, not the security boundary. The actual boundary is that **every** route
handler calls `getCurrentUser` and scopes its queries by `user_id`; the UI never decides who
sees what. Requests for another user's record return `404` rather than `403`, so the
response doesn't confirm that the record exists.

---

## Deployment

Deployed on **Vercel**, connected to the GitHub repository — pushes to `main` deploy
automatically. The database is hosted on **Supabase**.

The four required variables (`DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`)
are set in **Vercel → Project Settings → Environment Variables**. `DATABASE_URL` must use
the Supabase pooler host: each serverless invocation opens its own connection, and the
pooler is what keeps that within Postgres' connection limit.

Migrations are applied with `npx prisma migrate deploy` against `DIRECT_URL`. The build
command runs `prisma generate` first, so the client always matches the schema being built.

---

## Known gaps

- **Password reset is not implemented.** The table exists (see above) but the flow was not
  ported from the FastAPI backend; it needs an email provider.
- **No rate limiting** on login or signup. bcrypt at cost factor 12 makes online password
  guessing slow, but a determined attacker isn't throttled. The intended fix is Vercel
  middleware or an Upstash-backed limiter.
- **Legacy binary `.xls` is not supported** — only `.xlsx` and `.csv`. This is deliberate;
  see the ExcelJS note in the stack table.
