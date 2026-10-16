import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeMonthForecast } from '../src/lib/forecast.ts'
import { normalizeCardImport } from '../src/lib/bankImport.ts'
import type { FinanceEntry, RecurringTemplate } from '../src/types.ts'

const entry = (values: Partial<FinanceEntry>) => ({ id: 'e', type: 'expense', amount: 100, occurred_on: '2025-01-10', planned: false, ...values }) as FinanceEntry
const template = (values: Partial<RecurringTemplate>) => ({ id: 't', active: true, template_start_month: '2025-01-01', end_rule: 'unlimited', mode: 'fixed_amount', direction: 'expense', default_amount: 500, ...values }) as RecurringTemplate
const forecast = (entries: FinanceEntry[], templates: RecurringTemplate[]) => computeMonthForecast({ monthKey: '2025-01', entries, templates })

test('actual one-off income and unpaid salary are additive', () => {
  const result = forecast([entry({ type: 'income', amount: 1000 })], [template({ direction: 'income', default_amount: 5000 })])
  assert.equal(result.expectedIncome, 6000)
})
test('posted edited recurring amount is counted once at its actual value', () => {
  const result = forecast([entry({ amount: 750, auto_post_template_id: 't' }), entry({ amount: 200 })], [template({})])
  assert.equal(result.expectedExpense, 950)
  assert.equal(result.endOfMonthForecast, -950)
  assert.equal(result.pendingRecurringExpense, 0)
})
test('unposted recurring and variable expenses are additive', () => {
  const result = forecast([entry({ amount: 200 })], [template({})])
  assert.equal(result.expectedExpense, 700)
  assert.equal(result.remainingToSpend, -700)
})
test('skips, expired installments, planned entries and other months are excluded', () => {
  const result = forecast([entry({ planned: true }), entry({ occurred_on: '2024-12-01' })], [template({ skippedThisMonth: true }), template({ template_start_month: '2024-01-01', end_rule: 'fixed_installments', max_installments: 2 })])
  assert.equal(result.expectedExpense, 0)
})

const transaction = (values = {}) => ({ identifier: 'a', status: 'completed', chargedAmount: -120.50, chargedCurrency: 'ILS', processedDate: '2026-09-30T21:00:00Z', description: 'בדיקה', ...values })
const result = (txns: unknown[]) => ({ success: true, accounts: [{ accountNumber: '12345678', txns }] })
test('card charges, refunds and Israeli billing dates normalize correctly', async () => {
  const { rows } = await normalizeCardImport(result([transaction(), transaction({ identifier: 'b', chargedAmount: 20 })]), 'max')
  assert.equal(rows[0].occurred_on, '2026-10-01')
  assert.equal(rows[0].amount, 120.5)
  assert.equal(rows[0].type, 'expense')
  assert.equal(rows[1].type, 'income')
  assert.equal(rows[0].card_label, '5678')
})
test('repeated exports have stable identity; distinct same-price purchases survive', async () => {
  const a = await normalizeCardImport(result([transaction(), transaction(), transaction({ identifier: 'b' })]), 'max')
  const b = await normalizeCardImport(result([transaction()]), 'max')
  assert.equal(a.rows.length, 2)
  assert.equal(a.rows[0].source_key, b.rows[0].source_key)
})
test('different installments and different providers retain distinct identities', async () => {
  const a = await normalizeCardImport(result([transaction({ installments: { number: 1, total: 2 } }), transaction({ installments: { number: 2, total: 2 } })]), 'max')
  const b = await normalizeCardImport(result([transaction({ installments: { number: 1, total: 2 } })]), 'visaCal')
  assert.equal(a.rows.length, 2)
  assert.notEqual(a.rows[0].source_key, b.rows[0].source_key)
})
test('pending and unidentified transactions are reported without guessing identity', async () => {
  const parsed = await normalizeCardImport(result([transaction({ status: 'pending' }), transaction({ identifier: undefined })]), 'max')
  assert.equal(parsed.rows.length, 0)
  assert.equal(parsed.pending, 1)
  assert.equal(parsed.unidentified, 1)
})
test('malformed amounts, dates, currency and failed scrapes reject entire file', async () => {
  for (const fields of [{ chargedAmount: '120' }, { chargedAmount: Infinity }, { processedDate: '2026-02-30' }, { chargedCurrency: 'USD' }, { status: 'unknown' }]) {
    await assert.rejects(() => normalizeCardImport(result([transaction(fields)]), 'max'))
  }
  await assert.rejects(() => normalizeCardImport({ success: false, accounts: [] }, 'max'))
})
