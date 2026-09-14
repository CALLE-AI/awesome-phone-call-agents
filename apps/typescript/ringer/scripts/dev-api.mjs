/**
 * Local dev backend for the `/api` serverless functions.
 *
 * `vite` alone serves only the front end; the `/api/*` Vercel functions don't
 * run, so Live mode 404s. This tiny server mounts those same handler files
 * behind a Vercel-shaped req/res shim, so `pnpm dev` (with the Vite proxy →
 * this port) can exercise the real live path locally — no Vercel login needed.
 * Production still uses real Vercel serverless functions; this is dev-only.
 *
 * Run with tsx so the handlers' TypeScript (and `.js`→`.ts` NodeNext imports)
 * resolve:  pnpm dev:api      (or: pnpm dev:full to run this + Vite together)
 */
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { existsSync, appendFileSync } from 'node:fs'
import path from 'node:path'

const PORT = Number(process.env.DEV_API_PORT || 3001)
const API_DIR = path.resolve(process.cwd(), 'api')
const CALL_LOG = path.resolve(process.cwd(), 'dev-calls.log')

/**
 * Persist every accepted CALL-E call id so a live run is verifiable later
 * (the browser gets `{ id }`, but that's easy to lose once the tab closes).
 * Append-only, tab-separated: <iso-timestamp>\t<id>. Gitignored.
 */
const recordCallId = (id) => {
  try {
    appendFileSync(CALL_LOG, `${new Date().toISOString()}\t${id}\n`)
  } catch {
    /* logging is best-effort; never break a request over it */
  }
}

const color = (s, c) => `\x1b[${c}m${s}\x1b[0m`
const log = (method, p, status, ms, extra = '') => {
  const c = status >= 500 ? 31 : status >= 400 ? 33 : 32
  console.log(`${color(`${method} ${p} → ${status}`, c)}  ${ms}ms ${extra}`)
}

const readBody = (req) =>
  new Promise((resolve) => {
    let d = ''
    req.on('data', (c) => (d += c))
    req.on('end', () => resolve(d))
    req.on('error', () => resolve(''))
  })
const safeJson = (t) => {
  try {
    return JSON.parse(t)
  } catch {
    return {}
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost')
  if (!url.pathname.startsWith('/api/')) {
    res.statusCode = 404
    res.end('Not an /api route (this server only handles /api/*).')
    return
  }

  const rel = url.pathname.replace(/^\/api\//, '') // 'calls' | 'cron/run-due' | …
  const modPath = path.join(API_DIR, rel + '.ts')
  if (!rel || !existsSync(modPath)) {
    res.statusCode = 404
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: { code: 'not_found', message: `No handler for /api/${rel}` } }))
    return
  }

  // Vercel-shaped request extras.
  req.query = Object.fromEntries(url.searchParams.entries())
  const isWebhook = rel === 'webhook' // reads the raw stream itself; don't pre-consume
  if (!isWebhook && req.method !== 'GET' && req.method !== 'HEAD') {
    const raw = await readBody(req)
    const ct = String(req.headers['content-type'] || '')
    req.body = raw && ct.includes('application/json') ? safeJson(raw) : raw || undefined
  }

  // Vercel-shaped response helpers.
  res.status = (c) => {
    res.statusCode = c
    return res
  }
  res.json = (o) => {
    if (!res.headersSent) res.setHeader('content-type', 'application/json')
    // Surface CALL-E's error body (code + message + details) in the dev log.
    if (res.statusCode >= 400) {
      console.log(color('  ↳ ' + JSON.stringify(o), 90))
    } else if (rel === 'calls' && o && o.id) {
      // Success: capture the accepted CALL-E call id (prominently + on disk).
      console.log(color(`  ✔ CALL-E call id: ${o.id}`, 36))
      recordCallId(o.id)
    }
    res.end(JSON.stringify(o))
    return res
  }
  res.send = (d) => {
    res.end(typeof d === 'string' ? d : JSON.stringify(d))
    return res
  }

  const started = Date.now()
  try {
    const mod = await import(pathToFileURL(modPath).href)
    await mod.default(req, res)
    log(req.method, url.pathname, res.statusCode, Date.now() - started)
  } catch (e) {
    log(req.method, url.pathname, 500, Date.now() - started, color((e && e.message) || String(e), 31))
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
    }
    res.end(JSON.stringify({ error: { code: 'dev_api_error', message: (e && e.message) || String(e) } }))
  }
})

server.listen(PORT, () => {
  console.log(color(`[dev-api]`, 36) + ` Ringer /api functions on http://localhost:${PORT}`)
  console.log(`         Live mode BYOK: paste your CALL-E key in Settings → Live (no server env needed).`)
  console.log(`         Server key: set CALLE_API_KEY + CALLE_APP_SECRET before starting to use a shared key.`)
})
