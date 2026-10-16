// Run inside the worker: checks access without reading financial records.
const headers = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY }
const database = await fetch(`${process.env.SUPABASE_URL}/rest/v1/card_import_items?select=id&limit=0`, { method: 'HEAD', headers })
console.log(`Supabase inbox access: ${database.status}`)
if (!database.ok) process.exitCode = 1
for (const [label, extra, expected] of [
  ['untrusted origin', { Origin: 'https://example.invalid' }, 403],
  ['missing authentication', { Origin: process.env.APP_ORIGIN }, 401],
  ['invalid authentication', { Origin: process.env.APP_ORIGIN, Authorization: 'Bearer invalid-test-token' }, 401],
]) {
  const response = await fetch('https://142.93.99.71/connections', { headers: extra })
  console.log(`${label}: ${response.status} (expected ${expected})`)
  if (response.status !== expected) process.exitCode = 1
}
