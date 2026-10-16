import { createClient } from '@supabase/supabase-js'
import { mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createVault } from './vault.mjs'
import { createSyncService } from './service.mjs'
import { launchScrape } from './runner.mjs'

function required(name) { if (!process.env[name]) throw new Error(`Missing ${name}`); return process.env[name] }
const origin = required('APP_ORIGIN')
const parsedOrigin = new URL(origin)
if (parsedOrigin.origin !== origin || (parsedOrigin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsedOrigin.hostname))) throw new Error('APP_ORIGIN requires HTTPS except for local development')
const directory = resolve(process.env.SYNC_DATA_DIR || './private-data')
process.umask(0o077)
mkdirSync(directory, { recursive: true, mode: 0o700 })
const vault = createVault(join(directory, 'connections.sqlite'), required('SYNC_ENCRYPTION_KEY'))
const client = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
const service = createSyncService({ vault, origin,
  async authenticate(token) { const { data, error } = await client.auth.getUser(token); return error ? null : data.user?.id },
  async isMember(owner, household) {
    const { data, error } = await client.from('household_members').select('user_id').eq('user_id', owner).eq('household_id', household).maybeSingle()
    return !error && !!data
  },
  async ingest(owner, household, rows) {
    if (!rows.length) return
    const { error } = await client.from('card_import_items').upsert(rows.map(row => ({ ...row, owner_id: owner, household_id: household })), { onConflict: 'household_id,owner_id,source_key', ignoreDuplicates: true })
    if (error) throw new Error('INBOX_FAILED')
  }, launch: launchScrape,
})
const port = Number(process.env.PORT || 8787)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
service.server.listen(port, process.env.HOST || '127.0.0.1', () => console.log('Card sync service listening'))
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { service.close(); vault.close() })
