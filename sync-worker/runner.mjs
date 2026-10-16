import { fork, spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function launchScrape({ provider, credentials, onOtp }) {
  let child
  let cancelled = false
  let finish
  let otpSent = false
  const promise = new Promise((resolve, reject) => { finish = { resolve, reject } })
  function kill() {
    if (!child?.pid) return
    if (process.platform === 'win32') {
      // PID is obtained from fork(), never from a request or provider response.
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } else {
      try { process.kill(-child.pid, 'SIGKILL') } catch { /* already exited */ }
    }
  }
  void (async () => {
    const directory = await mkdtemp(join(tmpdir(), 'finance-scrape-'))
    let timer
    let otpTimer
    try {
      if (cancelled) throw new Error('CANCELLED')
      const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'XDG_CACHE_HOME'].filter(k => process.env[k]).map(k => [k, process.env[k]]))
      child = fork(fileURLToPath(new URL('./scrape-child.mjs', import.meta.url)), [], {
        cwd: directory, env: { ...env, TEMP: directory, TMP: directory, TMPDIR: directory, LOG_LEVEL: 'silent', NODE_ENV: 'production', PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
        detached: process.platform !== 'win32', windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      })
      let settled = false
      const settle = (error, data) => {
        if (settled) return
        settled = true
        clearTimeout(timer); clearTimeout(otpTimer)
        if (error) finish.reject(error); else finish.resolve(data)
        kill()
      }
      timer = setTimeout(() => settle(new Error('TIMEOUT')), 10 * 60_000)
      child.on('error', () => settle(new Error('PROVIDER_ERROR')))
      child.on('exit', () => settle(new Error('PROVIDER_ERROR')))
      child.on('message', message => {
        if (message.type === 'otp_required') {
          otpSent = false
          clearTimeout(otpTimer)
          otpTimer = setTimeout(() => settle(new Error('OTP_TIMEOUT')), 180_000)
          onOtp()
        } else if (message.type === 'result') settle(null, message)
        else if (message.type === 'failed') settle(new Error(message.code))
      })
      child.send({ type: 'start', provider, credentials })
      credentials = null
      await promise.catch(() => {})
    } catch { finish.reject(new Error('PROVIDER_ERROR')) }
    finally {
      clearTimeout(timer); clearTimeout(otpTimer)
      // Only the exact fresh directory created above is removed.
      await rm(directory, { recursive: true, force: true }).catch(() => {})
    }
  })().catch(() => finish.reject(new Error('PROVIDER_ERROR')))
  return { promise,
    otp(code) { if (!child?.connected || otpSent) throw new Error('EXPIRED'); otpSent = true; child.send({ type: 'otp', code }) },
    cancel() { cancelled = true; finish.reject(new Error('CANCELLED')); kill() },
  }
}
