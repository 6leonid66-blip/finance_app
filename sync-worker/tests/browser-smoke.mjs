// Run inside the deployment image. Uses only a synthetic local page, no bank login.
import assert from 'node:assert/strict'
import { Camoufox } from '@hieutran094/camoufox-js'

const browser = await Camoufox({ headless: true })
try {
  const page = await browser.newPage()
  await page.setContent('<title>Finance runtime check</title><p>synthetic</p>')
  assert.equal(await page.title(), 'Finance runtime check')
  console.log('Browser runtime check passed; no provider credentials used.')
} finally {
  await browser.close()
}
