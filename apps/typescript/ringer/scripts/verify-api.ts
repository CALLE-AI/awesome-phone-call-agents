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
import { createServer } from 'node:http'

const mod: any = await import(pathToFileURL(path.resolve(process.cwd(), 'api/_lib/calle.ts')).href)
const {
  contentIdempotencyKey,
  createCalleCall,
  deriveWebhookUrl,
  isAllowedBaseUrl,
  resolveCreds,
  requireKey,
  scheduleJobId,
} = mod
const webhookMod: any = await import(
  pathToFileURL(path.resolve(process.cwd(), 'api/webhook.ts')).href
)
const { default: webhookHandler, parseWebhookEvent } = webhookMod

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

console.log('\n[6] Current unsigned webhook contract')
const webhookEvent = {
  id: 'evt_test_123',
  type: 'call.completed',
  created_at: '2026-08-20T10:00:00.000Z',
  data: { id: 'call_test_123', status: 'completed' },
}
const parsed = parseWebhookEvent(JSON.stringify(webhookEvent), {
  'content-type': 'application/json',
  'call-e-event-id': webhookEvent.id,
})
ok('unsigned terminal event is accepted', parsed.id === webhookEvent.id)
ok('terminal call id is preserved', parsed.data.id === webhookEvent.data.id)
const opaqueIdEvent = parseWebhookEvent(
  JSON.stringify({ ...webhookEvent, id: 'evt:opaque.v1/@example', data: { id: 'call:opaque.v1/@example' } }),
  {
    'content-type': 'application/json',
    'call-e-event-id': 'evt:opaque.v1/@example',
  },
)
ok('bounded opaque provider ids are accepted', opaqueIdEvent.data.id === 'call:opaque.v1/@example')
for (const type of ['call.failed', 'call.result_validation_failed']) {
  const terminal = parseWebhookEvent(JSON.stringify({ ...webhookEvent, type }), {
    'content-type': 'application/json; charset=utf-8',
    'call-e-event-id': webhookEvent.id,
  })
  ok(`${type} is accepted`, terminal.type === type)
}

const expectWebhookError = (name: string, code: string, run: () => unknown) => {
  try {
    run()
    ok(name, false)
  } catch (error) {
    ok(name, (error as { code?: string }).code === code)
  }
}

expectWebhookError('missing event-id header is rejected', 'missing_event_id', () =>
  parseWebhookEvent(JSON.stringify(webhookEvent), { 'content-type': 'application/json' }),
)
expectWebhookError('header/body event-id mismatch is rejected', 'event_id_mismatch', () =>
  parseWebhookEvent(JSON.stringify(webhookEvent), {
    'content-type': 'application/json',
    'call-e-event-id': 'evt_other',
  }),
)
expectWebhookError('malformed JSON is rejected', 'invalid_json', () =>
  parseWebhookEvent('{', {
    'content-type': 'application/json',
    'call-e-event-id': webhookEvent.id,
  }),
)
expectWebhookError('non-terminal event type is rejected', 'unsupported_event_type', () =>
  parseWebhookEvent(JSON.stringify({ ...webhookEvent, type: 'call.in_progress' }), {
    'content-type': 'application/json',
    'call-e-event-id': webhookEvent.id,
  }),
)
expectWebhookError('non-ISO created_at is rejected', 'invalid_created_at', () =>
  parseWebhookEvent(JSON.stringify({ ...webhookEvent, created_at: 'August 20, 2026' }), {
    'content-type': 'application/json',
    'call-e-event-id': webhookEvent.id,
  }),
)
expectWebhookError('impossible ISO calendar date is rejected', 'invalid_created_at', () =>
  parseWebhookEvent(JSON.stringify({ ...webhookEvent, created_at: '2026-02-31T10:00:00Z' }), {
    'content-type': 'application/json',
    'call-e-event-id': webhookEvent.id,
  }),
)
expectWebhookError('unsafe call id is rejected before logging', 'invalid_call_id', () =>
  parseWebhookEvent(
    JSON.stringify({ ...webhookEvent, data: { id: 'call_test\nforged-log', status: 'completed' } }),
    { 'content-type': 'application/json', 'call-e-event-id': webhookEvent.id },
  ),
)
expectWebhookError('C1 control in call id is rejected', 'invalid_call_id', () =>
  parseWebhookEvent(
    JSON.stringify({ ...webhookEvent, data: { id: 'call_test\u0085forged', status: 'completed' } }),
    { 'content-type': 'application/json', 'call-e-event-id': webhookEvent.id },
  ),
)
expectWebhookError('bidi control in call id is rejected', 'invalid_call_id', () =>
  parseWebhookEvent(
    JSON.stringify({ ...webhookEvent, data: { id: 'call_test\u202eforged', status: 'completed' } }),
    { 'content-type': 'application/json', 'call-e-event-id': webhookEvent.id },
  ),
)
expectWebhookError('duplicate event-id headers are rejected', 'duplicate_header', () =>
  parseWebhookEvent(JSON.stringify(webhookEvent), {
    'content-type': 'application/json',
    'call-e-event-id': [webhookEvent.id, webhookEvent.id],
  }),
)

f = fakeRes()
await webhookHandler({ method: 'GET', headers: {} } as any, f.res)
ok('non-POST webhook request is rejected', f.rec.status === 405)

f = fakeRes()
const oversizedReq = {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'call-e-event-id': webhookEvent.id,
  },
  async *[Symbol.asyncIterator]() {
    yield Buffer.alloc(1_048_577)
  },
} as any
await webhookHandler(oversizedReq, f.res)
ok('webhook body over 1 MiB is rejected', f.rec.status === 413 && f.rec.code === 'payload_too_large')

f = fakeRes()
const validWebhookReq = {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'call-e-event-id': webhookEvent.id,
  },
  async *[Symbol.asyncIterator]() {
    yield Buffer.from(JSON.stringify(webhookEvent))
  },
} as any
const webhookLogs: string[] = []
const previousConsoleLog = console.log
try {
  console.log = (...args: unknown[]) => webhookLogs.push(args.map(String).join(' '))
  await webhookHandler(validWebhookReq, f.res)
} finally {
  console.log = previousConsoleLog
}
ok('valid streamed webhook request is accepted', f.rec.status === 200)
ok(
  'successful webhook log excludes attacker-controlled ids',
  webhookLogs.length === 1 &&
    webhookLogs[0]?.includes('call.completed') === true &&
    webhookLogs[0]?.includes(webhookEvent.id) === false &&
    webhookLogs[0]?.includes(webhookEvent.data.id) === false,
)

const prevWebhookUrl = process.env.CALLE_WEBHOOK_URL
const prevWebhookSecret = process.env.CALLE_WEBHOOK_SECRET
delete process.env.CALLE_WEBHOOK_URL
delete process.env.CALLE_WEBHOOK_SECRET
ok('webhook is opt-in without an explicit URL', deriveWebhookUrl() === undefined)
process.env.CALLE_WEBHOOK_SECRET = 'legacy-secret'
ok('legacy secret alone does not enable current delivery', deriveWebhookUrl() === undefined)
process.env.CALLE_WEBHOOK_URL = 'https://ringer.example/api/webhook'
ok('explicit webhook URL enables current delivery', deriveWebhookUrl() === process.env.CALLE_WEBHOOK_URL)
if (prevWebhookUrl === undefined) delete process.env.CALLE_WEBHOOK_URL
else process.env.CALLE_WEBHOOK_URL = prevWebhookUrl
if (prevWebhookSecret === undefined) delete process.env.CALLE_WEBHOOK_SECRET
else process.env.CALLE_WEBHOOK_SECRET = prevWebhookSecret

console.log('\n[7] SDK 0.7 create-call mapping against a local fake server')
let capturedSdkRequest: {
  authorization?: string
  idempotencyKey?: string
  body?: Record<string, unknown>
} = {}
const sdkServer = createServer(async (request, response) => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  capturedSdkRequest = {
    authorization: request.headers.authorization,
    idempotencyKey: request.headers['idempotency-key'] as string | undefined,
    body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
  }
  response.writeHead(201, { 'content-type': 'application/json' })
  response.end(
    JSON.stringify({
      id: 'call_sdk_070',
      object: 'call_task',
      status: 'queued',
      task: 'Synthetic mapping check.',
      recipients: [],
      structured_result: null,
      summary: null,
      task_completed: null,
      completion_confidence: null,
      evidence: [],
      metadata: { app: 'ringer' },
      failure_code: null,
      failure_message: null,
      created_at: '2026-08-20T10:00:00.000Z',
      completed_at: null,
    }),
  )
})
await new Promise<void>((resolve) => sdkServer.listen(0, '127.0.0.1', resolve))
const sdkAddress = sdkServer.address()
if (!sdkAddress || typeof sdkAddress === 'string') throw new Error('Fake SDK server did not bind.')
try {
  const sdkResult = await createCalleCall(
    { apiKey: 'synthetic-sdk-key', baseUrl: `http://127.0.0.1:${sdkAddress.port}` },
    {
      task: 'Synthetic mapping check.',
      recipients: [{ phones: ['+14155550111'], region: 'US', locale: 'en-US' }],
      result_schema: { type: 'object' },
      metadata: { app: 'ringer' },
      webhook_url: 'https://ringer.example/api/webhook',
    },
    'synthetic-idempotency-key',
  )
  ok('SDK response maps to the call id', sdkResult.id === 'call_sdk_070')
  ok('SDK sends the server key only as bearer auth', capturedSdkRequest.authorization === 'Bearer synthetic-sdk-key')
  ok('SDK forwards the stable idempotency key', capturedSdkRequest.idempotencyKey === 'synthetic-idempotency-key')
  ok('SDK maps resultSchema to result_schema', (capturedSdkRequest.body?.result_schema as any)?.type === 'object')
  ok('SDK maps webhookUrl to webhook_url', capturedSdkRequest.body?.webhook_url === 'https://ringer.example/api/webhook')
} finally {
  await new Promise<void>((resolve, reject) =>
    sdkServer.close((error) => (error ? reject(error) : resolve())),
  )
}

console.log(`\n✅ All ${pass} API-safety checks passed.\n`)
