import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CALLE_BASE_URL = 'https://api.heycall-e.com';
export const DEFAULT_RUNTIME_DIR = fileURLToPath(new URL('../runtime/', import.meta.url));
// Display-only copy; never use this masked representation for provider dispatch.
export function maskForDisplay(value) {
  return JSON.parse(JSON.stringify(value).replace(/\+[1-9]\d{6,14}/g, phone => `${phone.slice(0, 2)}***${phone.slice(-4)}`));
}
const PHONE = /^\+[1-9]\d{6,14}$/;
const REGIONS = new Set('AU BD BR CA DE ES FI GB ID IN JP MX MY NL PH PK PL SG TH TR US VN'.split(' '));
const API_CODES = new Set('invalid_request unauthorized forbidden rate_limit_exceeded insufficient_balance unsupported_region unsupported_language recipient_blocked policy_violation call_not_ready no_recipients invalid_recipient invalid_phone result_schema_invalid recipient_result_schema_invalid idempotency_conflict goal_not_published goal_not_executable goal_not_ready schema_override_not_allowed variables_invalid provider_unavailable internal_error not_found'.split(' '));

export class CalleError extends Error {
  constructor(code, message, { status, acceptance, callId, operationId } = {}) {
    super(message);
    this.name = 'CalleError';
    this.code = code;
    if (status !== undefined) this.status = status;
    if (acceptance !== undefined) this.acceptance = acceptance;
    if (callId !== undefined) this.call_id = callId;
    if (operationId !== undefined) this.operation_id = operationId;
  }

  toJSON() {
    return { code: this.code, message: this.message, status: this.status, acceptance: this.acceptance, call_id: this.call_id, operation_id: this.operation_id };
  }
}

export function publicError(error) {
  return error instanceof CalleError ? error.toJSON() : { code: 'local_error', message: 'The local operation failed. Check the runtime directory and configuration; no automatic retry was made.' };
}

function validatePhone(phone) {
  if (typeof phone !== 'string' || !PHONE.test(phone)) throw new CalleError('invalid_phone', 'Provide one complete E.164 phone number, including its country code.');
}

function validCallId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id);
}

const numeric = (description, type = 'number') => ({ type, description: `${description} Omit this field if not explicitly confirmed; never substitute zero for unknown.` });

export function buildCallRequest(scenario, { providerType, providerId, phone, region, locale } = {}) {
  validatePhone(phone);
  if (region !== undefined && !REGIONS.has(region)) throw new CalleError('unsupported_region', 'Use a destination region from CALL-E\'s supported regions list.');
  if (locale !== undefined && (typeof locale !== 'string' || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale))) throw new CalleError('invalid_locale', 'Provide a BCP 47 locale such as en-US, or omit the locale.');
  const providers = providerType === 'storage' ? scenario?.storages : providerType === 'carrier' ? scenario?.carriers : null;
  const provider = providers?.find(item => item.id === providerId);
  if (!provider) throw new CalleError('invalid_provider', 'Select an existing storage or carrier provider.');
  const lot = scenario.lot;
  if (!lot || !Number.isFinite(lot.quantity_kg) || lot.quantity_kg <= 0 || !Number.isFinite(lot.min_temp_c) || !Number.isFinite(lot.max_temp_c)) throw new CalleError('invalid_scenario', 'The lot needs a positive quantity and a known temperature range.');

  const properties = {
    availability: { type: 'string', enum: ['yes', 'no', 'unknown'], description: 'Whether this provider explicitly confirms availability for the complete requested load. Use unknown when the person is not reached, facts are unclear, or the answer is conditional.' },
    capacity_kg: numeric('Maximum confirmed capacity in kilograms.'),
    min_temp_c: numeric('Lowest temperature the offered room or vehicle maintains, in Celsius.'),
    max_temp_c: numeric('Highest temperature the offered room or vehicle maintains, in Celsius.'),
    cost_usd: numeric('Explicitly quoted total price in USD for this service. Omit if the currency or amount is unconfirmed.'),
    valid_until_min: numeric('When the quote expires, in local minutes after midnight on service_date.', 'integer'),
    service_date: { type: 'string', description: 'The local service date explicitly confirmed by the recipient, as YYYY-MM-DD. Omit if unknown.' },
    timezone: { type: 'string', description: 'The explicitly confirmed local timezone. Omit if unknown.' },
    evidence: { type: 'string', description: 'A concise quote or faithful paraphrase supporting the availability answer and collected facts. Say when the recipient was not reached. Never invent evidence.' },
  };
  if (providerType === 'storage') {
    properties.receive_from_min = numeric('Earliest receiving time in local minutes after midnight on service_date.', 'integer');
    properties.receive_until_min = numeric('Latest receiving time in local minutes after midnight on service_date; distinguish actual staffed receiving hours from directory opening hours.', 'integer');
  } else {
    properties.pickup_min = numeric('Earliest confirmed pickup time in local minutes after midnight on service_date.', 'integer');
    properties.travel_min = {
      type: 'object',
      properties: Object.fromEntries(scenario.storages.map(storage => [storage.id, numeric(`Travel duration in minutes from the stated origin to ${storage.name}.`, 'integer')])),
      additionalProperties: false,
      description: 'Confirmed route duration for each named storage. Omit unconfirmed routes; do not estimate missing distances.',
    };
  }
  const rehearsal = scenario.provenance === 'synthetic' || scenario.evidence_mode === 'test';
  const task = [
    'Introduce yourself as Harvest Relay\'s automated assistant and ask whether the recipient is willing to answer a short availability inquiry. Stop politely if they decline.',
    rehearsal ? 'This is a consented pilot rehearsal with a fictional lot and fictional provider labels. Explain that clearly and ask the recipient to role-play; do not present this as an actual shipment.' : 'This is an availability inquiry for an operator to review.',
    `The planning label is ${provider.name}. The lot is ${lot.quantity_kg} kilograms of ${lot.commodity}, with a requested temperature range of ${lot.min_temp_c} to ${lot.max_temp_c} degrees Celsius, originating at ${lot.origin}.`,
    ...(scenario.service_date && scenario.timezone ? [`The operator's requested local service day is ${scenario.service_date} in ${scenario.timezone}. Ask the recipient to confirm that date and timezone; do not assume they agree.`] : []),
    providerType === 'storage'
      ? 'Ask about capacity for the whole lot, actual maintained temperature range, staffed receiving start and cutoff, total price for 24 hours in USD, and the quote expiry.'
      : `Ask about capacity for the whole lot, actual maintained temperature range, earliest pickup, total transport price in USD, quote expiry, and travel duration to each candidate: ${scenario.storages.map(storage => storage.name).join(', ')}.`,
    'Ask the recipient to confirm the service date and timezone. Read back critical quantities, temperature, times, and prices. Record only explicitly confirmed facts; leave missing numeric facts absent and unclear availability unknown.',
    'Do not reserve storage, book transport, promise payment, make food-safety claims, or authorize any transaction. Tell the recipient a human coordinator must confirm any later handoff.',
  ].join('\n');
  return {
    task,
    recipients: [{ phones: [phone], ...(region ? { region } : {}), ...(locale ? { locale } : {}) }],
    recipient_result_schema: { type: 'object', required: ['availability', 'evidence'], properties, additionalProperties: false },
    metadata: { app: 'harvest-relay', scenario_id: scenario.id, provider_type: providerType, provider_id: providerId, source_provenance: scenario.provenance ?? 'unknown', evidence_mode: rehearsal ? 'test' : 'operator-supplied', booking_authorized: false },
  };
}

export class CalleClient {
  #apiKey;
  #fetch;
  #timeoutMs;

  constructor({ apiKey = process.env.CALLE_API_KEY, fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
    this.#apiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  get configured() { return Boolean(this.#apiKey); }

  async #request(method, path, { body, idempotencyKey } = {}) {
    if (!this.configured) throw new CalleError('not_configured', 'Set CALLE_API_KEY in the server environment.', { acceptance: 'not_sent' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(`${CALLE_BASE_URL}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.#apiKey}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
        redirect: 'error',
      });
      let data;
      try { data = await response.json(); } catch { data = null; }
      if (!response.ok) {
        const code = API_CODES.has(data?.error?.code) ? data.error.code : 'api_error';
        const guidance = code === 'unauthorized' ? 'Check the complete dashboard API key.' : code === 'forbidden' ? 'The key does not have access to this operation.' : 'Inspect this operation before intentionally retrying.';
        throw new CalleError(code, `CALL-E returned HTTP ${response.status}. ${guidance}`, { status: response.status, acceptance: response.status >= 400 && response.status < 500 ? 'rejected' : 'unknown' });
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new CalleError('invalid_response', 'CALL-E returned an unreadable response. A create request may already have been accepted.', { acceptance: 'unknown' });
      // Never return a reflected credential, even if an upstream diagnostic accidentally includes it.
      return JSON.parse(JSON.stringify(data).split(this.#apiKey).join('[REDACTED]'));
    } catch (error) {
      if (controller.signal.aborted) throw new CalleError('timeout', 'CALL-E request timed out and was aborted locally. No resend was attempted; a create request may already have been accepted.', { acceptance: 'unknown' });
      if (error instanceof CalleError) throw error;
      throw new CalleError('network_error', 'CALL-E could not be reached or its response was interrupted. No resend was attempted; a create request may already have been accepted.', { acceptance: 'unknown' });
    } finally {
      clearTimeout(timer);
    }
  }

  async check() {
    const data = await this.#request('GET', '/v1/goals?limit=1');
    if (!Array.isArray(data.data)) throw new CalleError('invalid_response', 'The authentication check returned an unexpected Goals response.');
    return { connected: true, goal_count: data.data.length, checked_at: new Date().toISOString() };
  }

  async createCall(request, idempotencyKey) {
    return this.#request('POST', '/v1/calls', { body: request, idempotencyKey });
  }

  async getCall(callId) {
    if (!validCallId(callId)) throw new CalleError('invalid_call_id', 'Provide the CallTask ID returned by CALL-E.');
    return this.#request('GET', `/v1/calls/${encodeURIComponent(callId)}`);
  }

  async getEvents(callId, { cursor, limit = 50 } = {}) {
    if (!validCallId(callId)) throw new CalleError('invalid_call_id', 'Provide the CallTask ID returned by CALL-E.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new CalleError('invalid_limit', 'The event limit must be an integer from 1 to 100.');
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor !== undefined) query.set('cursor', cursor);
    return this.#request('GET', `/v1/calls/${encodeURIComponent(callId)}/events?${query}`);
  }
}

function reservationPath(runtimeDir, operationId) {
  if (typeof operationId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(operationId)) throw new CalleError('operation_id_required', 'Provide a stable --operation-id of 1–128 letters, digits, dots, colons, hyphens, or underscores.');
  return join(runtimeDir, `${createHash('sha256').update(operationId).digest('hex')}.json`);
}

export async function loadReservation(runtimeDir, operationId) {
  return JSON.parse(await readFile(reservationPath(runtimeDir, operationId), 'utf8'));
}

async function updateReservation(path, record) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(record, null, 2)}\n`);
    await file.sync();
  } finally { await file.close(); }
  await rename(temporary, path);
}

export async function createReservedCall({ client, request, operationId, confirm, allowedPhones = process.env.CALLE_ALLOWED_PHONES ?? '', runtimeDir = DEFAULT_RUNTIME_DIR }) {
  if (confirm !== true) throw new CalleError('confirmation_required', 'Live calls require an explicit --confirm flag and authorization from the recipient.', { acceptance: 'not_sent' });
  const snapshot = structuredClone(request);
  const recipients = snapshot?.recipients;
  if (!Array.isArray(recipients) || recipients.length !== 1 || recipients[0]?.phones?.length !== 1) throw new CalleError('invalid_recipient', 'This command accepts exactly one explicitly supplied destination.', { acceptance: 'not_sent' });
  const phone = recipients[0].phones[0];
  validatePhone(phone);
  const allowed = new Set(String(allowedPhones).split(/[\s,]+/).filter(Boolean));
  if (!allowed.has(phone)) throw new CalleError('phone_not_allowed', 'The exact destination must appear in CALLE_ALLOWED_PHONES before calling.', { acceptance: 'not_sent' });
  const path = reservationPath(runtimeDir, operationId);
  if (!client.configured) throw new CalleError('not_configured', 'Set CALLE_API_KEY in the server environment.', { acceptance: 'not_sent' });
  await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  let file;
  try { file = await open(path, 'wx', 0o600); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let existing;
    try { existing = await loadReservation(runtimeDir, operationId); } catch { /* An in-flight writer may still be flushing its reservation. */ }
    const callId = validCallId(existing?.call_id) ? existing.call_id : undefined;
    throw new CalleError('duplicate_operation', callId ? `This operation already exists. Read status for ${callId}; do not create it again.` : 'This operation is already reserved or has an uncertain outcome. Reconcile the original request with CALL-E before starting another operation.', { acceptance: existing?.state ?? 'unknown', callId, operationId });
  }
  const record = { version: 1, operation_id: operationId, idempotency_key: `harvest-relay:${operationId}`, state: 'reserved', created_at: new Date().toISOString(), request: snapshot, call_id: null };
  try {
    await file.writeFile(`${JSON.stringify(record, null, 2)}\n`);
    await file.sync();
  } finally { await file.close(); }

  let call;
  try {
    call = await client.createCall(record.request, record.idempotency_key);
    if (!validCallId(call.id)) throw new CalleError('invalid_response', 'CALL-E did not return a usable CallTask ID. The request may be accepted; reconcile the saved reservation before doing anything else.', { acceptance: 'unknown' });
  } catch (error) {
    record.state = error.acceptance === 'rejected' || error.acceptance === 'not_sent' ? 'rejected' : 'unknown';
    record.updated_at = new Date().toISOString();
    record.error = publicError(error);
    try { await updateReservation(path, record); } catch { /* The original durable reservation still blocks duplicate creation. */ }
    if (error instanceof CalleError) {
      error.operation_id = operationId;
      throw error;
    }
    throw new CalleError('network_error', 'Call acceptance is unknown. Inspect the saved reservation and reconcile with CALL-E; no automatic resend was attempted.', { acceptance: 'unknown', operationId });
  }
  record.state = 'accepted';
  record.call_id = call.id;
  record.call = call;
  record.updated_at = new Date().toISOString();
  try { await updateReservation(path, record); } catch {
    throw new CalleError('persistence_failed', `CALL-E accepted ${call.id}, but the local result could not be saved. Save this ID and read its status; do not create another call.`, { acceptance: 'accepted', callId: call.id, operationId });
  }
  return { mode: 'live', operation_id: operationId, reservation_file: path, call, next_action: `status --id ${call.id}` };
}

export async function saveSnapshot(runtimeDir, kind, callId, data) {
  if (!validCallId(callId) || !['status', 'events', 'check'].includes(kind)) throw new CalleError('invalid_snapshot', 'Snapshot kind or identifier is invalid.');
  const directory = join(runtimeDir, 'snapshots');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${kind}-${callId}-${Date.now()}-${randomUUID()}.json`);
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return path;
}
