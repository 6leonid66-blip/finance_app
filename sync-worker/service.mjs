import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { PROVIDERS, validateCredentials } from './providers.mjs'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab0-9][a-f0-9]{3}-[a-f0-9]{12}$/i
const activeStates = ['syncing', 'awaiting_otp']
const publicItem = row => ({ id: row.id, provider: row.provider, ...row.metadata })
class HttpError extends Error { constructor(status, code) { super(code); this.status = status } }
async function readBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'JSON_REQUIRED')
  let size = 0; const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > 16_384) throw new HttpError(413, 'TOO_LARGE')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new HttpError(400, 'INVALID_INPUT') }
}

/** All authorization and financial I/O are injected, allowing tests without real accounts. */
export function createSyncService({ vault, origin, authenticate, isMember, ingest, launch, now = () => Date.now(), intervalMs = 12 * 3_600_000 }) {
  const jobs = new Map()
  const limits = new Map()
  let closed = false
  for (const row of vault.list()) {
    if (activeStates.includes(row.metadata.status)) vault.update(row.id, { ...row.metadata, status: 'attention', error: 'RESTARTED', challenge: null, otpExpiresAt: null, nextRunAt: null })
  }
  function patch(id, values) {
    const row = vault.get(id)
    if (row) vault.update(id, { ...row.metadata, ...values })
  }
  function rate(key, maximum) {
    const time = now()
    for (const [k, value] of limits) if (value.until <= time) limits.delete(k)
    if (!limits.has(key) && limits.size >= 10_000) throw new HttpError(429, 'RATE_LIMIT')
    const item = limits.get(key) ?? { count: 0, until: time + 60_000 }
    item.count++; limits.set(key, item)
    if (item.count > maximum) throw new HttpError(429, 'RATE_LIMIT')
  }
  async function run(row) {
    // A single browser job keeps the initial 2 GB server's memory use bounded.
    if (closed || jobs.has(row.id) || jobs.size >= 1) return
    const job = { runner: null, challenge: null, prompts: 0 }
    jobs.set(row.id, job)
    patch(row.id, { status: 'syncing', error: null, lastAttemptAt: now(), challenge: null, otpExpiresAt: null })
    try {
      if (!await isMember(row.owner, row.household)) throw new Error('MEMBERSHIP_REQUIRED')
      if (jobs.get(row.id) !== job) return
      const { credentials } = vault.decrypt(row)
      job.runner = launch({ provider: row.provider, credentials, onOtp() {
        if (jobs.get(row.id) !== job) return
        if (++job.prompts > 3) { job.runner?.cancel(); return }
        job.challenge = randomUUID()
        patch(row.id, { status: 'awaiting_otp', challenge: job.challenge, otpExpiresAt: now() + 180_000 })
      } })
      const result = await job.runner.promise
      if (jobs.get(row.id) !== job || !vault.get(row.id)) return
      // Membership can be revoked while the provider login is in progress.
      if (!await isMember(row.owner, row.household)) throw new Error('MEMBERSHIP_REQUIRED')
      if (jobs.get(row.id) !== job) return
      await ingest(row.owner, row.household, result.rows)
      if (jobs.get(row.id) !== job) return
      patch(row.id, { status: 'ready', error: null, lastSuccessAt: now(), nextRunAt: now() + intervalMs,
        checked: result.rows.length, pending: result.pending, unidentified: result.unidentified, challenge: null, otpExpiresAt: null })
    } catch (error) {
      if (jobs.get(row.id) !== job) return
      const codes = ['INVALID_PASSWORD', 'INVALID_OTP', 'CHANGE_PASSWORD', 'ACCOUNT_BLOCKED', 'OTP_TIMEOUT', 'TIMEOUT', 'MEMBERSHIP_REQUIRED']
      patch(row.id, { status: 'attention', error: codes.includes(error.message) ? error.message : 'SYNC_FAILED', nextRunAt: null, challenge: null, otpExpiresAt: null })
    } finally { if (jobs.get(row.id) === job) jobs.delete(row.id) }
  }
  function stop(id) { const job = jobs.get(id); jobs.delete(id); job?.runner?.cancel() }
  function tick() {
    if (closed) return
    for (const row of vault.list()) {
      if (row.metadata.enabled && ['queued', 'ready'].includes(row.metadata.status) && row.metadata.nextRunAt <= now()) void run(row)
    }
  }
  const timer = setInterval(tick, 10_000)
  timer.unref()
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    const send = (status, data) => { res.statusCode = status; res.end(JSON.stringify(data)) }
    try {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === '/health' && req.method === 'GET') { send(200, { ok: true }); return }
      if (req.headers.origin !== origin) throw new HttpError(403, 'ORIGIN_DENIED')
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type')
      if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }
      rate('ip:' + req.socket.remoteAddress, 600)
      const token = req.headers.authorization?.match(/^Bearer (\S{1,4096})$/)?.[1]
      if (!token) throw new HttpError(401, 'AUTH_REQUIRED')
      const user = await authenticate(token)
      if (!user) throw new HttpError(401, 'AUTH_REQUIRED')
      rate('user:' + user, 120)
      const household = url.searchParams.get('household')
      if (!uuid.test(household ?? '')) throw new HttpError(403, 'MEMBERSHIP_REQUIRED')
      // Former members may still view, pause, or delete their own connection secrets.
      const needsMembership = (req.method === 'POST' && !url.pathname.endsWith('/pause')) || url.pathname === '/providers'
      if (needsMembership && !await isMember(user, household)) throw new HttpError(403, 'MEMBERSHIP_REQUIRED')
      if (url.pathname === '/providers' && req.method === 'GET') { send(200, PROVIDERS); return }
      if (url.pathname === '/connections') {
        if (req.method === 'GET') { send(200, vault.list().filter(r => r.owner === user && r.household === household).map(publicItem)); return }
        if (req.method === 'POST') {
          rate('mutation:' + user, 6)
          const body = await readBody(req)
          if (body?.consent !== true) throw new HttpError(400, 'CONSENT_REQUIRED')
          let credentials
          try { credentials = validateCredentials(body.provider, body.credentials) } catch { throw new HttpError(400, 'INVALID_INPUT') }
          if (vault.list().some(r => r.owner === user && r.household === household && r.provider === body.provider)) throw new HttpError(409, 'ALREADY_CONNECTED')
          if (vault.list().length >= 100) throw new HttpError(503, 'CAPACITY')
          const row = { id: randomUUID(), owner: user, household, provider: body.provider,
            metadata: { enabled: true, status: 'queued', createdAt: now(), consentAt: now(), lastSuccessAt: null, lastAttemptAt: null, nextRunAt: now(), challenge: null, otpExpiresAt: null, error: null } }
          vault.insert(row, credentials)
          credentials = null
          tick(); send(202, publicItem(vault.get(row.id))); return
        }
      }
      const match = url.pathname.match(/^\/connections\/([a-f0-9-]+)(?:\/(sync|otp|pause))?$/)
      const row = match && vault.get(match[1])
      if (!row || row.owner !== user || row.household !== household) throw new HttpError(404, 'NOT_FOUND')
      if (req.method === 'DELETE' && !match[2]) {
        rate('mutation:' + user, 6); stop(row.id); vault.remove(row.id); send(200, { disconnected: true }); return
      }
      if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED')
      rate('mutation:' + user, 6)
      const body = await readBody(req)
      if (match[2] === 'otp') {
        const job = jobs.get(row.id)
        if (!job?.runner || !job.challenge || body?.challenge !== job.challenge || row.metadata.status !== 'awaiting_otp' || row.metadata.otpExpiresAt <= now()) throw new HttpError(409, 'OTP_EXPIRED')
        if (typeof body.code !== 'string' || !/^\d{4,10}$/.test(body.code)) throw new HttpError(400, 'INVALID_OTP')
        job.challenge = null
        job.runner.otp(body.code)
        patch(row.id, { status: 'syncing', challenge: null, otpExpiresAt: null })
      } else if (match[2] === 'pause') {
        stop(row.id); patch(row.id, { status: 'paused', enabled: false, nextRunAt: null, challenge: null, otpExpiresAt: null })
      } else if (match[2] === 'sync') {
        if (jobs.has(row.id)) throw new HttpError(409, 'ALREADY_RUNNING')
        if (row.metadata.lastAttemptAt != null && now() - row.metadata.lastAttemptAt < 60_000) throw new HttpError(429, 'COOLDOWN')
        patch(row.id, { status: 'queued', enabled: true, nextRunAt: now(), error: null }); tick()
      } else throw new HttpError(404, 'NOT_FOUND')
      send(200, publicItem(vault.get(row.id)))
    } catch (error) { send(error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : 'SERVICE_ERROR' }) }
  })
  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
  return { server, tick, close() { closed = true; clearInterval(timer); for (const id of jobs.keys()) stop(id); server.close(); server.closeAllConnections() } }
}
