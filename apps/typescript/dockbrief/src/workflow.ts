import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, link } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { CalleClient, type Call, type CreateCallInput } from '@call-e/calle';
import { buildRequest, validateInput, type Input } from './domain.js';

export interface State {
  version: 1; mode: 'live' | 'fixture'; createdAt: string; updatedAt: string;
  input: Input; consentNote: string; idempotencyKey: string; request: CreateCallInput;
  requestHash: string; phase: 'prepared' | 'create_ambiguous' | 'call_known';
  callId?: string; call?: Call; lastError?: string;
}
export interface Client { calls: Pick<CalleClient['calls'], 'create' | 'get'> }
export function hashRequest(request: CreateCallInput): string { return createHash('sha256').update(JSON.stringify(request)).digest('hex'); }
export async function writeState(path: string, state: State, exclusive = false): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(state, null, 2) + '\n'); await file.sync(); } finally { await file.close(); }
  try { if (exclusive) await link(temp, path); else await rename(temp, path); }
  finally { await unlink(temp).catch(() => {}); }
}
export async function readState(path: string): Promise<State> {
  const state = JSON.parse(await readFile(path, 'utf8')) as State;
  if (state.version !== 1 || !['live', 'fixture'].includes(state.mode) || !['prepared', 'create_ambiguous', 'call_known'].includes(state.phase)) throw new Error('Unsupported state file.');
  state.input = validateInput(state.input);
  if (!state.request || hashRequest(state.request) !== state.requestHash) throw new Error('Saved request was modified. Refusing to send or resume.');
  if (!/^dockbrief-[a-f0-9-]{36}$/.test(state.idempotencyKey)) throw new Error('Invalid saved idempotency key.');
  if (JSON.stringify(state.request) !== JSON.stringify(buildRequest(state.input))) throw new Error('Saved input and request do not match this app version. Do not reconstruct a request for replay.');
  if (state.callId && (!/^[A-Za-z0-9_-]{1,160}$/.test(state.callId) || state.call && state.call.id !== state.callId)) throw new Error('Invalid or mismatched saved call ID.');
  return state;
}
async function locked<T>(path: string, action: () => Promise<T>): Promise<T> {
  await mkdir(dirname(resolve(path)), { recursive: true });
  const lock = `${path}.lock`;
  const handle = await open(lock, 'wx', 0o600).catch(() => { throw new Error('State is locked. Another process may be running. After verifying it has stopped, remove only the stale .lock file and resume; never start again.'); });
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })); await handle.sync(); return await action(); }
  finally { await handle.close(); await unlink(lock).catch(() => {}); }
}
function consent(note: string): void {
  if (typeof note !== 'string' || note.trim().length < 12 || note.length > 500 || /[\r\n\u0000-\u001f]/.test(note)) throw new Error('Provide --consent-note (12–500 characters) describing the specific recipient authorization.');
}
function validateCall(call: Call, state: State): void {
  if (!call || typeof call.id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(call.id)) throw new Error('Provider returned an invalid call ID.');
  if (state.callId && call.id !== state.callId) throw new Error('Provider returned a different call ID.');
  if (call.recipients.length !== 1 || call.recipients[0]?.phones.length !== 1 || call.recipients[0]?.phones[0] !== state.input.site.phone) throw new Error('Provider response does not match the one authorized recipient.');
}
async function createSaved(state: State, path: string, client: Client): Promise<State> {
  try {
    const call = await client.calls.create(state.request, { idempotencyKey: state.idempotencyKey });
    // Store the returned ID before inspecting the rest of the result: a malformed result must not lose a dialed call.
    if (typeof call?.id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(call.id)) { state.callId = call.id; state.phase = 'call_known'; state.updatedAt = new Date().toISOString(); await writeState(path, state); }
    validateCall(call, state);
    state.call = call; state.phase = 'call_known'; delete state.lastError;
    state.updatedAt = new Date().toISOString(); await writeState(path, state); return state;
  } catch {
    if (!state.callId) state.phase = 'create_ambiguous';
    state.lastError = 'Create did not finish cleanly. A call may already exist. Keep this state. If an ID is known, resume (GET only). Otherwise use explicit retry-create with the identical saved request and key; never start again.';
    state.updatedAt = new Date().toISOString(); await writeState(path, state);
    throw new Error(state.lastError);
  }
}
export async function start(input: Input, path: string, client: Client, note: string, mode: 'live' | 'fixture' = 'live'): Promise<State> {
  input = validateInput(input); consent(note);
  return locked(path, async () => {
    const request = buildRequest(input);
    const state: State = { version: 1, mode, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), input, consentNote: note.trim(), idempotencyKey: `dockbrief-${randomUUID()}`, request, requestHash: hashRequest(request), phase: 'prepared' };
    // Atomic, exclusive initial creation means a repeat of `start` cannot silently replace an existing run.
    await writeState(path, state, true).catch(() => { throw new Error('Cannot create state without overwriting a prior run. Use that state with resume or retry-create; do not change --out to retry the same call.'); });
    return createSaved(state, path, client);
  });
}
export async function resume(path: string, client: Client): Promise<State> {
  return locked(path, async () => {
    const state = await readState(path);
    if (!state.callId) throw new Error('No call ID was received. Resume never sends POST. Review the saved state, then explicitly retry-create with the same request and key if reconciliation is necessary.');
    const call = await client.calls.get(state.callId);
    validateCall(call, state); state.call = call; state.phase = 'call_known'; delete state.lastError;
    state.updatedAt = new Date().toISOString(); await writeState(path, state); return state;
  });
}
export async function retryCreate(path: string, client: Client): Promise<State> {
  return locked(path, async () => {
    const state = await readState(path);
    if (state.callId) throw new Error('A call ID is known. Use resume; retry-create refuses a second POST.');
    return createSaved(state, path, client);
  });
}
export function liveClient(): CalleClient {
  const apiKey = process.env.CALLE_API_KEY;
  if (!apiKey || !apiKey.trim()) throw new Error('Set CALLE_API_KEY in this trusted terminal environment. Never pass it in command-line arguments.');
  return new CalleClient({ apiKey, baseUrl: 'https://api.heycall-e.com', fetch: request => fetch(new Request(request, { signal: AbortSignal.timeout(20_000) })) });
}
