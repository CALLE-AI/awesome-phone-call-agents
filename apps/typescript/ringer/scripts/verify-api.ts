/**
 * Runtime verification of the serverless safety helpers (api/_lib/calle.ts):
 * content-bound idempotency, base-URL allowlisting, shared-key authorization,
 * and deterministic scheduled-job ids. These defend the exact classes of issue
 * the CALL-E maintainer flags on review (key never sent to an arbitrary host;
 * the operator's shared key is not spendable by strangers; a changed request
 * cannot alias a call; a retried schedule POST cannot dial a duplicate).
 *
 * Run: pnpm exec tsx --tsconfig tsconfig.app.json scripts/verify-api.ts
 */
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const mod: any = await import(pathToFileURL(path.resolve(process.cwd(), 'api/_lib/calle.ts')).href)
const { contentIdempotencyKey, isAllowedBaseUrl, resolveCreds, requireKey, scheduleJobId } = mod

let pass = 0
const ok = (name: string, cond: boolean) => {
  if (!cond) {
    console.error(`  ✗ ${name}`)
    process.exit(1)
  }
  pass++
  console.log(`  ✓ ${name}`)
}

const req = (headers: Record<string, string>) => ({ headers }) as any
function fakeRes() {
  const rec = { status: 0, code: '' }
  const res: any = {
    status(s: number) {
      rec.status = s
      return res
    },
    json(b: any) {
      rec.code = b?.error?.code ?? ''
      return res
    },
    setHeader() {
      return res
    },
    send() {
      return res
    },
    end() {
      return res
    },
  }
  return { res, rec }
}

console.log('\n[1] Content-bound idempotency')
const bodyA = { task: 'Call and negotiate.', recipients: [{ phones: ['+14155550111'], region: 'US', locale: 'en-US' }], result_schema: { type: 'object' } }
ok('identical payload → same key', contentIdempotencyKey(bodyA) === contentIdempotencyKey(JSON.parse(JSON.stringify(bodyA))))
ok('edited phone → different key', contentIdempotencyKey(bodyA) !== contentIdempotencyKey({ ...bodyA, recipients: [{ phones: ['+14155550999'], region: 'US', locale: 'en-US' }] }))
ok('edited task → different key', contentIdempotencyKey(bodyA) !== contentIdempotencyKey({ ...bodyA, task: 'Call and CANCEL.' }))
ok('key is namespaced', contentIdempotencyKey(bodyA).startsWith('ringer_'))

console.log('\n[2] Base-URL allowlist')
ok('official host allowed', isAllowedBaseUrl('https://api.heycall-e.com') === true)
ok('official subdomain allowed', isAllowedBaseUrl('https://proxy.heycall-e.com') === true)
ok('loopback allowed for testing', isAllowedBaseUrl('http://localhost:3000') === true)
ok('foreign https host rejected', isAllowedBaseUrl('https://evil.com') === false)
ok('plain http (non-loopback) rejected', isAllowedBaseUrl('http://api.heycall-e.com') === false)

console.log('\n[3] resolveCreds never leaks the server key to a client-chosen host')
const prevKey = process.env.CALLE_API_KEY
const prevBase = process.env.CALLE_BASE_URL
const prevSecret = process.env.CALLE_APP_SECRET
process.env.CALLE_API_KEY = 'server-secret'
delete process.env.CALLE_BASE_URL

let c = resolveCreds(req({ 'x-calle-base-url': 'https://evil.com' }))
ok('server key + evil base → stays on official base', c.apiKey === 'server-secret' && c.baseUrl === 'https://api.heycall-e.com')
c = resolveCreds(req({ 'x-calle-key': 'byok', 'x-calle-base-url': 'https://evil.com' }))
ok('BYOK + evil base → evil rejected', c.apiKey === 'byok' && c.baseUrl === 'https://api.heycall-e.com')
c = resolveCreds(req({ 'x-calle-key': 'byok', 'x-calle-base-url': 'https://proxy.heycall-e.com' }))
ok('BYOK + allowed base → honored', c.baseUrl === 'https://proxy.heycall-e.com')

console.log('\n[4] Shared-key authorization (requireKey)')
// BYOK never needs the app secret.
let f = fakeRes()
let creds = requireKey(req({ 'x-calle-key': 'byok' }), f.res)
ok('BYOK is authorized without a secret', creds?.apiKey === 'byok' && f.rec.status === 0)

// Server key configured but NO secret → locked (fail closed).
delete process.env.CALLE_APP_SECRET
f = fakeRes()
creds = requireKey(req({}), f.res)
ok('server key without a configured secret → locked (403 app_secret_required)', creds === null && f.rec.status === 403 && f.rec.code === 'app_secret_required')

// Server key + secret configured, but caller omits it.
process.env.CALLE_APP_SECRET = 's3cret'
f = fakeRes()
creds = requireKey(req({}), f.res)
ok('shared key without the secret header → 401', creds === null && f.rec.status === 401 && f.rec.code === 'app_secret_required')

// Server key + secret + correct header → authorized.
f = fakeRes()
creds = requireKey(req({ 'x-ringer-app-secret': 's3cret' }), f.res)
ok('shared key with the correct secret → authorized', creds?.apiKey === 'server-secret' && f.rec.status === 0)

// No key anywhere.
delete process.env.CALLE_API_KEY
delete process.env.CALLE_APP_SECRET
f = fakeRes()
creds = requireKey(req({}), f.res)
ok('no key anywhere → 401 unauthorized', creds === null && f.rec.status === 401 && f.rec.code === 'unauthorized')

// Restore env.
if (prevKey === undefined) delete process.env.CALLE_API_KEY
else process.env.CALLE_API_KEY = prevKey
if (prevBase !== undefined) process.env.CALLE_BASE_URL = prevBase
if (prevSecret !== undefined) process.env.CALLE_APP_SECRET = prevSecret

console.log('\n[5] Scheduled-job idempotency (a retried POST cannot schedule a duplicate call)')
const schedBody = { task: 'Renegotiate the bill.', recipients: [{ phones: ['+14155550111'], region: 'US', locale: 'en-US' }], result_schema: { type: 'object' } }
const due1 = '2026-09-01T15:00:00.000Z'
const due2 = '2026-10-01T15:00:00.000Z'
ok('retried POST (same content + dueAt) → same job id', scheduleJobId({ dueAt: due1, body: schedBody }) === scheduleJobId({ dueAt: due1, body: JSON.parse(JSON.stringify(schedBody)) }))
ok('different occurrence (dueAt) → different job id', scheduleJobId({ dueAt: due1, body: schedBody }) !== scheduleJobId({ dueAt: due2, body: schedBody }))
ok('edited task → different job id', scheduleJobId({ dueAt: due1, body: schedBody }) !== scheduleJobId({ dueAt: due1, body: { ...schedBody, task: 'Cancel it.' } }))
ok('client Idempotency-Key overrides content', scheduleJobId({ idempotencyKey: 'req-123', dueAt: due1, body: schedBody }) === scheduleJobId({ idempotencyKey: 'req-123', dueAt: due2, body: { ...schedBody, task: 'different' } }))
ok('job id is namespaced', scheduleJobId({ dueAt: due1, body: schedBody }).startsWith('sched_'))

console.log(`\n✅ All ${pass} API-safety checks passed.\n`)
