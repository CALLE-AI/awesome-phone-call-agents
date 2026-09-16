import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CLAIM_STATUS_RESULT_SCHEMA } from './schema.ts';
import type { CallRecord } from './types.ts';

const DEFAULT_BASE_URL = 'https://api.heycall-e.com';
const TERMINAL = new Set(['completed', 'failed', 'no_answer', 'declined', 'canceled', 'cancelled', 'voicemail', 'busy', 'expired']);

export interface LiveOptions {
  to: string;
  authorisedDestination: string;
  claimReference: string;
  expectedDepartment: string;
  route?: string[];
  timeoutMs?: number;
}

export async function runLiveCall(options: LiveOptions): Promise<CallRecord> {
  const apiKey = process.env.CALLE_API_KEY ?? '';
  if (!apiKey) throw new Error('CALLE_API_KEY is required. Copy .env.example to .env; never commit it.');
  const baseUrl = checkedBaseUrl(process.env.CALLE_BASE_URL ?? DEFAULT_BASE_URL);
  const to = normaliseE164(options.to);
  if (normaliseE164(options.authorisedDestination) !== to) throw new Error('--authorise must exactly match --to. No call was placed.');
  const routeText = options.route?.length ? `The last reviewed route was ${options.route.map((key) => `press ${key}`).join(', then ')}. Treat it only as a hint; listen to every menu and stop using it if prompts differ.` : 'Explore the menu from the beginning and record each prompt and action.';
  const task = [
    'You are calling a fictional test payer line for a healthcare claim-status demonstration.',
    'Disclose that you are an automated assistant. Do not provide real patient data.',
    routeText,
    `Reach the ${options.expectedDepartment}.`,
    `Ask exactly: What is the current status of claim ${options.claimReference}?`,
    'Do not infer any status, amount, date, code, or department. Use exact words from the call as evidence; use empty strings when unsupported.',
  ].join(' ');
  const request = {
    task,
    recipients: [{ phones: [to], region: 'US', locale: 'en-US' }],
    result_schema: CLAIM_STATUS_RESULT_SCHEMA,
    metadata: { kol_scenario: 'fictional-claim-status-demo', kol_reference: options.claimReference },
  };
  const idempotencyKey = `kol-${createHash('sha256').update(`${JSON.stringify(request)}:${new Date().toISOString().slice(0, 13)}`).digest('hex').slice(0, 32)}`;
  const created = await createOnce(baseUrl, apiKey, request, idempotencyKey);
  const callId = String(created.id ?? created.call_id ?? '');
  if (!callId) throw new Error('CALL-E returned no call id. Do not retry the POST; reconcile in the dashboard first.');
  console.log(`CALL-E accepted call ${callId}; destination ${maskPhone(to)}.`);
  const final = await poll(baseUrl, apiKey, callId, options.timeoutMs ?? 15 * 60_000);
  await saveArtifact(callId, final);
  return final;
}

async function createOnce(baseUrl: string, apiKey: string, body: unknown, idempotencyKey: string): Promise<CallRecord> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/calls`, { method: 'POST', headers: headers(apiKey, idempotencyKey), body: JSON.stringify(body) });
  } catch (error) {
    throw new Error(`Call creation outcome is unknown (${String(error)}). Do not retry; reconcile by idempotency key in CALL-E first.`);
  }
  const text = await response.text();
  if (!response.ok) throw new Error(`CALL-E create failed with HTTP ${response.status}. No automatic POST retry was attempted; inspect the CALL-E dashboard.`);
  return JSON.parse(text) as CallRecord;
}

async function poll(baseUrl: string, apiKey: string, callId: string, timeoutMs: number): Promise<CallRecord> {
  const started = Date.now();
  await sleep(15_000);
  while (Date.now() - started < timeoutMs) {
    const response = await fetch(`${baseUrl}/v1/calls/${encodeURIComponent(callId)}`, { headers: headers(apiKey) });
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) { await sleep(8_000); continue; }
      throw new Error(`CALL-E polling failed with HTTP ${response.status}. The call may still be running; reconcile it in the dashboard.`);
    }
    const call = await response.json() as CallRecord;
    console.log(`  ${Math.round((Date.now() - started) / 1000)}s ${call.status ?? 'unknown'}`);
    if (TERMINAL.has(String(call.status ?? '').toLowerCase())) return call;
    await sleep(8_000);
  }
  throw new Error(`Polling timed out for ${callId}. The call may still be running; resume GET polling and do not create another call.`);
}

function headers(apiKey: string, idempotencyKey?: string) { return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }; }
function checkedBaseUrl(value: string) { const url = new URL(value); if (url.protocol !== 'https:' || (url.hostname !== 'api.heycall-e.com' && process.env.KOL_ALLOW_CUSTOM_CALLE_BASE_URL !== 'true')) throw new Error('Refusing non-official CALL-E base URL. Set KOL_ALLOW_CUSTOM_CALLE_BASE_URL=true only for an owned test fixture.'); return value.replace(/\/$/, ''); }
function normaliseE164(value: string) { const clean = value.replace(/[\s()-]/g, ''); if (!/^\+[1-9]\d{7,14}$/.test(clean)) throw new Error(`Invalid E.164 destination: ${maskPhone(clean)}`); if (!/^\+1\d{10}$/.test(clean)) throw new Error('Kol\'s public healthcare demo requires an authorised US/Canada (+1) fixture line with ten national digits.'); return clean; }
function maskPhone(value: string) { const digits = value.replace(/\D/g, ''); return digits.length < 4 ? '***' : `+***${digits.slice(-4)}`; }
function sleep(ms: number) { return new Promise((resolvePromise) => setTimeout(resolvePromise, ms)); }
async function saveArtifact(callId: string, call: CallRecord) { const directory = resolve('artifacts'); await mkdir(directory, { recursive: true }); await writeFile(resolve(directory, `${callId || randomUUID()}.json`), `${JSON.stringify(call, null, 2)}\n`, { flag: 'wx' }); }
