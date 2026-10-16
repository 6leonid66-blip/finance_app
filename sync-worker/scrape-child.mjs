// No database keys, access tokens or server encryption keys enter this process.
import { createScraper } from '@sergienko4/israeli-bank-scrapers'
import { normalizeCardImport } from '../src/lib/bankImport.ts'
let otpResolve
let otpReject
let started = false
process.on('message', async message => {
  if (message.type === 'otp' && otpResolve) {
    const resolve = otpResolve; otpResolve = undefined; otpReject = undefined
    resolve(message.code); return
  }
  if (message.type !== 'start' || started) return
  started = true
  try {
    const startDate = new Date(Date.now() - 60 * 86_400_000)
    const scraper = createScraper({ companyId: message.provider, startDate,
      otpTimeoutMs: 180_000,
      otpCodeRetriever: () => new Promise((resolve, reject) => {
        otpResolve = resolve; otpReject = reject
        // Do not forward provider text or phone hints; they may contain personal data.
        process.send({ type: 'otp_required' })
      }),
    })
    const result = await scraper.scrape(message.credentials)
    message.credentials = null
    if (!result.success) {
      const safe = ['INVALID_PASSWORD', 'INVALID_OTP', 'CHANGE_PASSWORD', 'ACCOUNT_BLOCKED', 'OTP_TIMEOUT', 'TIMEOUT', 'NETWORK_ERROR', 'WAF_BLOCKED', 'TWO_FACTOR_RETRIEVER_MISSING']
      process.send({ type: 'failed', code: safe.includes(result.errorType) ? result.errorType : 'PROVIDER_ERROR' })
    } else {
      try {
        const parsed = await normalizeCardImport(result, message.provider)
        process.send({ type: 'result', ...parsed })
      } catch { process.send({ type: 'failed', code: 'IMPORT_FORMAT_ERROR' }) }
    }
  } catch {
    process.send?.({ type: 'failed', code: 'PROVIDER_ERROR' })
  } finally {
    otpReject?.(new Error('CLOSED'))
    process.disconnect?.()
  }
})
