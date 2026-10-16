import test from 'node:test'
import assert from 'node:assert/strict'
import { generateMonthInsights, DEFAULT_INSIGHTS_MODEL, InsightsError } from '../api/gemini.ts'
import type { InsightSnapshot } from '../src/lib/insightSnapshot.ts'

const snapshot: InsightSnapshot = {
  monthKey: '2026-10', monthLabel: 'אוקטובר', scopeLabel: 'כל הבית',
  household: { income: 100, expense: 40, remaining: 60 }, people: [],
  shared: { income: 0, expense: 0, remaining: 0, topExpenses: [] }, householdTopExpenses: [],
}
test('insights uses supported model and keeps API key out of URL and hidden thoughts out of result', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).includes(DEFAULT_INSIGHTS_MODEL))
    assert.ok(!String(url).includes('test-key'))
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'test-key')
    assert.ok(init?.signal)
    return Response.json({ candidates: [{ content: { parts: [{ thought: true, text: 'hidden' }, { text: 'סיכום בדיקה' }] } }] })
  }
  try { assert.equal(await generateMonthInsights('test-key', snapshot), 'סיכום בדיקה') }
  finally { globalThis.fetch = original }
})
test('insights distinguishes quota, missing model, and timeout without exposing provider errors', async () => {
  const original = globalThis.fetch
  try {
    for (const [upstream, expected] of [[429, 429], [404, 503], [403, 503]]) {
      globalThis.fetch = async () => Response.json({ error: { message: 'private-provider-detail' } }, { status: upstream })
      await assert.rejects(generateMonthInsights('test-key', snapshot), error => error instanceof InsightsError && error.status === expected && !error.message.includes('private-provider-detail'))
    }
    globalThis.fetch = async () => { throw new DOMException('private-detail', 'TimeoutError') }
    await assert.rejects(generateMonthInsights('test-key', snapshot), error => error instanceof InsightsError && error.status === 504)
  } finally { globalThis.fetch = original }
})
