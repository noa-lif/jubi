/**
 * Unit tests for the shared input validators.
 *
 * These are the rules every API route enforces, so they carry most of the
 * "rejects bad input" coverage for the whole application. Valid input is
 * checked too, to make sure the rules aren't simply refusing everything.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PAGE_SIZE,
  MAX_AMOUNT,
  MAX_BUSINESS_NAME,
  MAX_CATEGORY_NAME,
  MAX_PAGE_SIZE,
  parseRouteId,
  validateAmount,
  validateBusinessName,
  validateCategoryName,
  validateDateOnly,
  validateEmail,
  validateIsraeliId,
  validateOptionalId,
  validatePagination,
  validatePassword,
  validateYearMonth,
} from '@/lib/validation'

describe('validateEmail', () => {
  it('accepts a normal address and normalizes case and whitespace', () => {
    const result = validateEmail('  Noa.Lif@Example.COM  ')
    expect(result).toEqual({ ok: true, value: 'noa.lif@example.com' })
  })

  it.each([
    ['missing @', 'noaexample.com'],
    ['missing domain dot', 'noa@example'],
    ['missing local part', '@example.com'],
    ['empty', ''],
    ['whitespace only', '   '],
    ['internal space', 'noa lif@example.com'],
  ])('rejects %s', (_label, input) => {
    expect(validateEmail(input).ok).toBe(false)
  })

  it('rejects non-string input', () => {
    // A JSON body can contain anything; the validator must not assume a string.
    expect(validateEmail(undefined).ok).toBe(false)
    expect(validateEmail(null).ok).toBe(false)
    expect(validateEmail(12345).ok).toBe(false)
    expect(validateEmail({ email: 'a@b.co' }).ok).toBe(false)
  })

  it('rejects an address longer than the column allows', () => {
    const tooLong = `${'a'.repeat(250)}@example.com`
    expect(validateEmail(tooLong).ok).toBe(false)
  })
})

describe('validatePassword', () => {
  it('accepts exactly the minimum length', () => {
    expect(validatePassword('12345678').ok).toBe(true)
  })

  it('rejects one character below the minimum', () => {
    expect(validatePassword('1234567')).toEqual({
      ok: false,
      error: 'Password must be at least 8 characters',
    })
  })

  it('rejects a password over bcrypt\'s 72-byte limit', () => {
    // Beyond 72 bytes bcrypt silently ignores the rest, so accepting it would
    // mean two different passwords unlock the same account.
    expect(validatePassword('a'.repeat(73)).ok).toBe(false)
  })

  it('measures the 72-byte limit in bytes, not characters', () => {
    // Hebrew is 2 bytes per character in UTF-8: 40 chars = 80 bytes, which is
    // over the limit even though the string is well under 72 characters.
    const hebrew = 'ס'.repeat(40)
    expect(hebrew.length).toBeLessThan(72)
    expect(validatePassword(hebrew).ok).toBe(false)

    // 36 characters = 72 bytes exactly, which is still allowed.
    expect(validatePassword('ס'.repeat(36)).ok).toBe(true)
  })

  it('rejects non-string input', () => {
    expect(validatePassword(null).ok).toBe(false)
    expect(validatePassword(12345678).ok).toBe(false)
  })
})

describe('validateIsraeliId', () => {
  // 123456782 satisfies the checksum; 123456789 does not.
  it('accepts a checksum-valid ID', () => {
    expect(validateIsraeliId('123456782')).toEqual({ ok: true, value: '123456782' })
  })

  it('left-pads a short ID to nine digits before checking', () => {
    // 1000009 padded is 001000009, which is checksum-valid. The padded form
    // is what gets stored, so the returned value matters as much as the verdict.
    const result = validateIsraeliId('1000009')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('001000009')
  })

  it('rejects an ID that fails the checksum', () => {
    expect(validateIsraeliId('123456789').ok).toBe(false)
  })

  it.each([
    ['letters', '12345678a'],
    ['too long', '1234567890'],
    ['empty', ''],
    ['whitespace only', '   '],
    ['punctuation', '123-456-78'],
  ])('rejects %s', (_label, input) => {
    expect(validateIsraeliId(input).ok).toBe(false)
  })

  it('rejects non-string input', () => {
    expect(validateIsraeliId(123456782).ok).toBe(false)
    expect(validateIsraeliId(null).ok).toBe(false)
  })
})

describe('validateDateOnly', () => {
  it('parses a valid date to UTC midnight', () => {
    const result = validateDateOnly('2026-03-15')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.toISOString()).toBe('2026-03-15T00:00:00.000Z')
  })

  it('accepts a leap day in a leap year', () => {
    expect(validateDateOnly('2024-02-29').ok).toBe(true)
  })

  it('rejects a leap day in a non-leap year', () => {
    // Date.UTC would silently roll this to March 1st, so the validator has to
    // compare the round-tripped parts to catch it.
    expect(validateDateOnly('2025-02-29').ok).toBe(false)
  })

  it.each([
    ['day overflow', '2025-04-31'],
    ['month 13', '2025-13-01'],
    ['month 00', '2025-00-10'],
    ['day 00', '2025-01-00'],
    ['slashes', '2025/01/01'],
    ['unpadded', '2025-1-1'],
    ['with time', '2025-01-01T00:00:00Z'],
    ['empty', ''],
  ])('rejects %s', (_label, input) => {
    expect(validateDateOnly(input).ok).toBe(false)
  })

  it('rejects non-string input', () => {
    expect(validateDateOnly(new Date()).ok).toBe(false)
    expect(validateDateOnly(20250101).ok).toBe(false)
  })
})

describe('validateAmount', () => {
  it('accepts a positive expense and a negative income', () => {
    expect(validateAmount(42.5)).toEqual({ ok: true, value: 42.5 })
    expect(validateAmount(-1200)).toEqual({ ok: true, value: -1200 })
  })

  it('rejects zero, which has no meaning as a transaction', () => {
    expect(validateAmount(0)).toEqual({ ok: false, error: 'Amount cannot be zero' })
  })

  it('rejects NaN and Infinity', () => {
    // Both pass a `typeof x === 'number'` check, so they need explicit handling.
    expect(validateAmount(Number.NaN).ok).toBe(false)
    expect(validateAmount(Number.POSITIVE_INFINITY).ok).toBe(false)
    expect(validateAmount(Number.NEGATIVE_INFINITY).ok).toBe(false)
  })

  it('rejects amounts beyond the sane maximum, in both directions', () => {
    expect(validateAmount(MAX_AMOUNT + 1).ok).toBe(false)
    expect(validateAmount(-MAX_AMOUNT - 1).ok).toBe(false)
    expect(validateAmount(MAX_AMOUNT).ok).toBe(true)
  })

  it('rejects a numeric string — JSON numbers must arrive as numbers', () => {
    expect(validateAmount('42').ok).toBe(false)
  })
})

describe('validateBusinessName', () => {
  it('trims surrounding whitespace', () => {
    expect(validateBusinessName('  שופרסל  ')).toEqual({ ok: true, value: 'שופרסל' })
  })

  it('rejects empty and whitespace-only names', () => {
    expect(validateBusinessName('').ok).toBe(false)
    expect(validateBusinessName('     ').ok).toBe(false)
  })

  it('accepts the maximum length and rejects one over', () => {
    // The column is VARCHAR(255); without this check the DB raises an error
    // that would escape the handler as a 500 instead of a 422.
    expect(validateBusinessName('a'.repeat(MAX_BUSINESS_NAME)).ok).toBe(true)
    expect(validateBusinessName('a'.repeat(MAX_BUSINESS_NAME + 1)).ok).toBe(false)
  })

  it('counts length after trimming', () => {
    expect(validateBusinessName(`  ${'a'.repeat(MAX_BUSINESS_NAME)}  `).ok).toBe(true)
  })
})

describe('validateCategoryName', () => {
  it('accepts the maximum length and rejects one over', () => {
    expect(validateCategoryName('a'.repeat(MAX_CATEGORY_NAME)).ok).toBe(true)
    expect(validateCategoryName('a'.repeat(MAX_CATEGORY_NAME + 1)).ok).toBe(false)
  })

  it('rejects empty and whitespace-only names', () => {
    expect(validateCategoryName('').ok).toBe(false)
    expect(validateCategoryName('\t\n ').ok).toBe(false)
  })
})

describe('validateOptionalId', () => {
  it('treats absent and null as "no category"', () => {
    expect(validateOptionalId(undefined)).toEqual({ ok: true, value: null })
    expect(validateOptionalId(null)).toEqual({ ok: true, value: null })
  })

  it('accepts a positive integer', () => {
    expect(validateOptionalId(7)).toEqual({ ok: true, value: 7 })
  })

  it.each([
    ['zero', 0],
    ['negative', -3],
    ['fractional', 1.5],
    ['string', '7'],
    ['NaN', Number.NaN],
  ])('rejects %s', (_label, input) => {
    expect(validateOptionalId(input).ok).toBe(false)
  })
})

describe('parseRouteId', () => {
  it('accepts a positive integer segment', () => {
    expect(parseRouteId('42')).toBe(42)
  })

  it.each([
    ['zero', '0'],
    ['negative', '-1'],
    ['fractional', '1.5'],
    ['letters', 'abc'],
    ['empty', ''],
    ['whitespace', ' 1 '],
    ['SQL-ish injection attempt', '1 OR 1=1'],
    ['beyond safe integer range', '99999999999999999999'],
  ])('rejects %s', (_label, input) => {
    expect(parseRouteId(input)).toBeNull()
  })
})

describe('validateYearMonth', () => {
  it('accepts a valid year and month', () => {
    expect(validateYearMonth('2026', '3')).toEqual({ ok: true, value: { year: 2026, month: 3 } })
  })

  it('accepts the month boundaries', () => {
    expect(validateYearMonth('2026', '1').ok).toBe(true)
    expect(validateYearMonth('2026', '12').ok).toBe(true)
  })

  it.each([
    ['month 0', '2026', '0'],
    ['month 13', '2026', '13'],
    ['negative month', '2026', '-1'],
    ['year below range', '1800', '5'],
    ['year above range', '9999', '5'],
    ['non-numeric', '20x6', '5'],
    ['fractional month', '2026', '5.5'],
    ['missing year', null, '5'],
    ['missing month', '2026', null],
    ['both missing', null, null],
  ])('rejects %s', (_label, year, month) => {
    expect(validateYearMonth(year, month).ok).toBe(false)
  })
})

describe('validatePagination', () => {
  it('falls back to defaults when both params are absent', () => {
    expect(validatePagination(null, null)).toEqual({
      ok: true,
      value: { limit: DEFAULT_PAGE_SIZE, offset: 0 },
    })
  })

  it('treats an empty string like an absent param', () => {
    expect(validatePagination('', '')).toEqual({
      ok: true,
      value: { limit: DEFAULT_PAGE_SIZE, offset: 0 },
    })
  })

  it('accepts explicit values within range', () => {
    expect(validatePagination('25', '100')).toEqual({ ok: true, value: { limit: 25, offset: 100 } })
  })

  it('caps limit at the maximum rather than allowing an unbounded fetch', () => {
    // The cap is the reason a single request can't be turned into a full-table
    // export, so it must reject rather than silently clamp.
    expect(validatePagination(String(MAX_PAGE_SIZE), null).ok).toBe(true)
    expect(validatePagination(String(MAX_PAGE_SIZE + 1), null).ok).toBe(false)
  })

  it.each([
    ['limit 0', '0', null],
    ['negative limit', '-5', null],
    ['fractional limit', '10.5', null],
    ['non-numeric limit', 'all', null],
    ['negative offset', null, '-1'],
    ['fractional offset', null, '2.5'],
    ['non-numeric offset', null, 'start'],
  ])('rejects %s', (_label, limit, offset) => {
    expect(validatePagination(limit, offset).ok).toBe(false)
  })

  it('allows offset 0 explicitly', () => {
    expect(validatePagination(null, '0')).toEqual({
      ok: true,
      value: { limit: DEFAULT_PAGE_SIZE, offset: 0 },
    })
  })
})
