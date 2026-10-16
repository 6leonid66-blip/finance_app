import { createClient } from '@supabase/supabase-js'
import { createScraper, SCRAPERS } from '@sergienko4/israeli-bank-scrapers'
import { normalizeCardImport, CARD_PROVIDERS } from '../src/lib/bankImport.ts'
import { setTimeout as delay } from 'node:timers/promises'

function required(key) {
  const value = process.env[key]?.trim()
  if (!value) throw new Error(`Missing worker setting: ${key}`)
  return value
}
function boundedNumber(key, fallback, min, max) {
  const value = Number(process.env[key] || fallback)
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid worker setting: ${key}`)
  return value
}

async function sync() {
  const provider = required('CARD_PROVIDER')
  if (!Object.hasOwn(CARD_PROVIDERS, provider)) throw new Error('Unsupported card provider')
  const credentials = JSON.parse(required('CARD_CREDENTIALS_JSON'))
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) throw new Error('Invalid card credentials')
  for (const field of SCRAPERS[provider].loginFields) {
    if (typeof credentials[field] !== 'string' || !credentials[field]) throw new Error(`Missing card credential field: ${field}`)
  }
  const client = createClient(required('SUPABASE_URL'), required('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: true },
  })
  try {
    const { data: auth, error: authError } = await client.auth.signInWithPassword({ email: required('SYNC_EMAIL'), password: required('SYNC_PASSWORD') })
    if (authError || !auth.user) throw new Error('App sign-in failed; verify the worker account settings')
    const householdId = required('SYNC_HOUSEHOLD_ID')
    const { data: member, error: memberError } = await client.from('household_members').select('household_id').eq('household_id', householdId).eq('user_id', auth.user.id).single()
    if (memberError || !member) throw new Error('Worker user is not a member of this household')
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - boundedNumber('SYNC_DAYS_BACK', 60, 1, 365))
    const scraper = createScraper({ companyId: provider, startDate, shouldShowBrowser: false,
      ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}),
    })
    const result = await scraper.scrape(credentials)
    if (!result.success) {
      const known = ['INVALID_PASSWORD', 'CHANGE_PASSWORD', 'ACCOUNT_BLOCKED', 'TIMEOUT']
      throw new Error(`Card sync requires attention: ${known.includes(result.errorType) ? result.errorType : 'PROVIDER_ERROR'}`)
    }
    const { rows, pending, unidentified } = await normalizeCardImport(result, provider)
    if (rows.length) {
      const { error } = await client.from('card_import_items').upsert(rows.map(row => ({ ...row, household_id: householdId, owner_id: auth.user.id })),
        { onConflict: 'household_id,owner_id,source_key', ignoreDuplicates: true })
      if (error) throw new Error('Inbox write failed; check migration and household permissions')
    }
    console.log(JSON.stringify({ at: new Date().toISOString(), status: 'complete', checked: rows.length, pending, unidentified }))
  } finally {
    // Local sign-out does not revoke sessions on the user's other devices.
    await client.auth.signOut({ scope: 'local' })
    client.auth.stopAutoRefresh()
  }
}

try {
  const interval = boundedNumber('SYNC_INTERVAL_HOURS', 12, 1, 168) * 3_600_000
  do {
    // Sequential runs: no overlapping scrapes. Stop on error rather than retrying a locked login.
    await sync()
    if (!process.argv.includes('--watch')) break
    await delay(interval)
  } while (true)
} catch {
  // Third-party exceptions can contain credentials, response bodies, or card details.
  console.error('Card sync stopped. Check private worker configuration, browser installation, provider access, and database migration. No transactions were auto-approved.')
  process.exitCode = 1
}
