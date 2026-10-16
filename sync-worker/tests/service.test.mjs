import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { createVault } from '../vault.mjs'
import { createSyncService } from '../service.mjs'
import { PROVIDERS, validateCredentials } from '../providers.mjs'
import { SCRAPERS } from '@sergienko4/israeli-bank-scrapers'
import { createRequire } from 'node:module'

const origin = 'https://finance.example'
const user = randomUUID(), other = randomUUID(), home = randomUUID()
const flush = () => new Promise(resolve => setImmediate(resolve))
function fixture() {
  const vault = createVault(':memory:', randomBytes(32).toString('base64'))
  const launches = [], imports = []
  let time = Date.now(), member = true
  const service = createSyncService({ vault, origin, now: () => time, intervalMs: 100_000,
    authenticate: async token => token === 'test-user' ? user : token === 'test-other' ? other : null,
    isMember: async (_user, household) => member && household === home,
    ingest: async (...args) => imports.push(args),
    launch(options) {
      let resolve, reject
      const promise = new Promise((ok, fail) => { resolve = ok; reject = fail })
      const item = { options, resolve, reject, codes: [], cancelled: false }
      launches.push(item)
      return { promise, otp: code => item.codes.push(code), cancel() { item.cancelled = true; reject(new Error('CANCELLED')) } }
    },
  })
  async function request(path, { method = 'GET', body, token = 'test-user', from = origin, household = home } = {}) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
    req.url = `${path}?household=${household}`; req.method = method
    req.headers = { origin: from, authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    req.socket = { remoteAddress: '127.0.0.1' }
    return new Promise(resolve => {
      const res = { statusCode: 200, setHeader() {}, end(text) { resolve({ status: this.statusCode, body: text ? JSON.parse(text) : null }) } }
      service.server.emit('request', req, res)
    })
  }
  const connect = () => request('/connections', { method: 'POST', body: { provider: 'max', credentials: { username: 'synthetic', password: 'synthetic-secret' }, consent: true } })
  return { vault, service, launches, imports, request, connect, advance: delta => { time += delta }, revoke: () => { member = false }, close() { service.close(); vault.close() } }
}

test('the 2 GB deployment queues browser jobs and runs only one at a time', async () => {
  const f = fixture()
  try {
    await f.connect(); await flush()
    const second = await f.request('/connections', { method: 'POST', token: 'test-other', body: { provider: 'max', credentials: { username: 'synthetic', password: 'synthetic-secret' }, consent: true } })
    await flush()
    assert.equal(second.status, 202)
    assert.equal(f.launches.length, 1)
    assert.equal(f.vault.get(second.body.id).metadata.status, 'queued')
    f.launches[0].resolve({ rows: [], pending: 0, unidentified: 0 })
    await flush()
    f.service.tick(); await flush()
    assert.equal(f.launches.length, 2)
    assert.equal(f.vault.get(second.body.id).metadata.status, 'syncing')
  } finally { f.close() }
})

test('credentials are encrypted and ciphertext is bound to its owner and connection', () => {
  const vault = createVault(':memory:', randomBytes(32).toString('base64'))
  try {
    const row = { id: randomUUID(), owner: user, household: home, provider: 'max', metadata: {} }
    vault.insert(row, { password: 'synthetic-secret' })
    const saved = vault.get(row.id)
    assert.ok(!saved.secret.includes('synthetic-secret'))
    assert.equal(vault.decrypt(saved).credentials.password, 'synthetic-secret')
    assert.throws(() => vault.decrypt({ ...saved, owner: other }))
    assert.throws(() => vault.decrypt({ ...saved, secret: saved.secret.slice(0, -8) + 'AAAAAAAA' }))
  } finally { vault.close() }
})
test('provider fields match the installed scraper; invalid and extra fields are rejected', () => {
  for (const [key, value] of Object.entries(PROVIDERS)) assert.deepEqual(value.fields, SCRAPERS[key].loginFields)
  assert.throws(() => validateCredentials('max', { username: 'a', password: 'b', otpCodeRetriever: 'bad' }))
  assert.throws(() => validateCredentials('__proto__', {}))
  assert.throws(() => validateCredentials('isracard', { id: '1', card6Digits: '123456', password: 'b' }))
})
test('patched ZIP dependency preserves archive extraction compatibility', () => {
  const require = createRequire(import.meta.url)
  const camoufoxRequire = createRequire(require.resolve('@hieutran094/camoufox-js'))
  const Zip = camoufoxRequire('adm-zip')
  assert.equal(camoufoxRequire('adm-zip/package.json').version, '0.6.1')
  const zip = new Zip(); zip.addFile('fixture.txt', Buffer.from('synthetic-browser-asset'))
  assert.equal(new Zip(zip.toBuffer()).readAsText('fixture.txt'), 'synthetic-browser-asset')
})
test('origin, authentication, household membership and consent are required', async () => {
  const f = fixture()
  try {
    assert.equal((await f.request('/connections', { from: 'https://evil.example' })).status, 403)
    assert.equal((await f.request('/connections', { token: 'invalid' })).status, 401)
    assert.equal((await f.request('/connections', { method: 'POST', body: {}, household: randomUUID() })).status, 403)
    assert.equal((await f.request('/connections', { method: 'POST', body: {} })).status, 400)
    assert.equal(f.vault.list().length, 0)
  } finally { f.close() }
})
test('connections are private and never expose credentials; duplicate connection is rejected', async () => {
  const f = fixture()
  try {
    const created = await f.connect(); assert.equal(created.status, 202)
    const listed = await f.request('/connections')
    assert.ok(!JSON.stringify(listed).includes('synthetic-secret'))
    assert.ok(!JSON.stringify(listed).includes('secret'))
    assert.deepEqual((await f.request('/connections', { token: 'test-other' })).body, [])
    assert.equal((await f.request(`/connections/${created.body.id}`, { method: 'DELETE', token: 'test-other' })).status, 404)
    assert.equal((await f.connect()).status, 409)
  } finally { f.close(); await flush() }
})
test('OTP is tied to the active user and challenge, single-use and never persisted', async () => {
  const f = fixture()
  try {
    const { body: row } = await f.connect(); await flush()
    f.launches[0].options.onOtp()
    const challenge = f.vault.get(row.id).metadata.challenge
    const body = { challenge, code: '123456' }
    assert.equal((await f.request(`/connections/${row.id}/otp`, { method: 'POST', body, token: 'test-other' })).status, 404)
    assert.equal((await f.request(`/connections/${row.id}/otp`, { method: 'POST', body: { ...body, challenge: 'old' } })).status, 409)
    assert.equal((await f.request(`/connections/${row.id}/otp`, { method: 'POST', body })).status, 200)
    assert.equal((await f.request(`/connections/${row.id}/otp`, { method: 'POST', body })).status, 409)
    assert.deepEqual(f.launches[0].codes, ['123456'])
    assert.ok(!JSON.stringify(f.vault.get(row.id)).includes('123456'))
    f.launches[0].resolve({ rows: [], pending: 2, unidentified: 1 }); await flush()
    assert.equal(f.vault.get(row.id).metadata.status, 'ready')
    assert.equal(f.imports.length, 1)
  } finally { f.close(); await flush() }
})
test('expired OTP is rejected and failed login does not retry automatically', async () => {
  const f = fixture()
  try {
    const { body: row } = await f.connect(); await flush(); f.launches[0].options.onOtp()
    const challenge = f.vault.get(row.id).metadata.challenge
    f.advance(181_000)
    assert.equal((await f.request(`/connections/${row.id}/otp`, { method: 'POST', body: { challenge, code: '123456' } })).status, 409)
    f.launches[0].reject(new Error('INVALID_PASSWORD')); await flush()
    f.advance(86_400_000); f.service.tick(); await flush()
    assert.equal(f.launches.length, 1)
    assert.equal(f.vault.get(row.id).metadata.error, 'INVALID_PASSWORD')
  } finally { f.close(); await flush() }
})
test('success schedules another run, pause cancels and disconnect deletes the encrypted secret', async () => {
  const f = fixture()
  try {
    const { body: row } = await f.connect(); await flush()
    f.launches[0].resolve({ rows: [], pending: 0, unidentified: 0 }); await flush()
    f.advance(100_001); f.service.tick(); await flush()
    assert.equal(f.launches.length, 2)
    assert.equal((await f.request(`/connections/${row.id}/pause`, { method: 'POST', body: {} })).status, 200)
    await flush(); assert.equal(f.launches[1].cancelled, true)
    f.advance(200_000); f.service.tick(); await flush(); assert.equal(f.launches.length, 2)
    assert.equal((await f.request(`/connections/${row.id}`, { method: 'DELETE' })).status, 200)
    assert.equal(f.vault.get(row.id), null)
  } finally { f.close(); await flush() }
})
test('membership is checked again after provider login before storing any transactions', async () => {
  const f = fixture()
  try {
    const { body: row } = await f.connect(); await flush(); f.revoke()
    f.launches[0].resolve({ rows: [{ amount: 1 }], pending: 0, unidentified: 0 }); await flush()
    assert.equal(f.imports.length, 0)
    assert.equal(f.vault.get(row.id).metadata.error, 'MEMBERSHIP_REQUIRED')
    assert.equal((await f.request(`/connections/${row.id}`, { method: 'DELETE' })).status, 200)
    assert.equal(f.vault.get(row.id), null)
  } finally { f.close(); await flush() }
})
