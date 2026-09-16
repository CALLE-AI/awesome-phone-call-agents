import { mkdir, open, realpath } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { CalleError, DEFAULT_RUNTIME_DIR, buildCallRequest } from './calle.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const minute = value => Number.isInteger(value) && value >= 0 && value < 1440;
const money = value => finite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
const nullableText = value => value === null || typeof value === 'string';

function fail(code, message) { throw new CalleError(code, message); }

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function timezone(value) {
  if (!text(value)) return null;
  try { return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone; } catch { return null; }
}

function timestamp(value) {
  return typeof value === 'string' && validDate(value.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

function validateContext(scenario) {
  const lot = scenario?.lot;
  if (!object(scenario) || !validDate(scenario.service_date) || !timezone(scenario.timezone) || !minute(scenario.now_min)
    || !object(lot) || !finite(lot.quantity_kg) || lot.quantity_kg <= 0 || !finite(lot.min_temp_c) || !finite(lot.max_temp_c)
    || lot.min_temp_c > lot.max_temp_c || !minute(lot.latest_arrival_min) || !money(lot.budget_usd)
    || !Array.isArray(scenario.storages) || !Array.isArray(scenario.carriers) || !scenario.storages.length || !scenario.carriers.length) {
    fail('invalid_scenario_context', 'Provide a scenario with an explicit valid service_date (YYYY-MM-DD), IANA timezone, same-day now_min and lot deadline, positive lot quantity, known temperatures and budget, and provider lists.');
  }
  for (const providers of [scenario.storages, scenario.carriers]) {
    if (providers.some(provider => !object(provider) || !text(provider.id) || !text(provider.name)) || new Set(providers.map(provider => provider.id)).size !== providers.length) {
      fail('invalid_scenario_context', 'Every provider needs a unique ID and a name.');
    }
  }
}

// Validate the same supported schema subset sent by buildCallRequest. No coercion or text parsing.
function validateSchema(value, schema, path = 'structured_result') {
  if (schema.type === 'object') {
    if (!object(value)) fail('invalid_facts', `${path} must be an object.`);
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) fail('invalid_facts', `${path}.${key} is required.`);
    for (const [key, child] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key)) fail('invalid_facts', `${path} contains a field outside the requested result schema.`);
      validateSchema(child, schema.properties[key], `${path}.${key}`);
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || (schema.enum && !schema.enum.includes(value))) fail('invalid_facts', `${path} must match its string contract.`);
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (!finite(value) || (schema.type === 'integer' && !Number.isInteger(value))) fail('invalid_facts', `${path} must be a real JSON number of the requested type.`);
  } else fail('invalid_facts', 'Unsupported extraction schema.');
}

function identity(provider) {
  return { id: provider.id, name: provider.name, ...(text(provider.short) ? { short: provider.short } : {}), status: 'unknown' };
}

function mapCall(scenario, call, providerType, provider) {
  const required = ['id', 'object', 'status', 'task', 'recipients', 'structured_result', 'summary', 'task_completed', 'completion_confidence', 'evidence', 'metadata', 'failure_code', 'failure_message', 'created_at', 'completed_at'];
  if (!object(call) || required.some(key => !Object.hasOwn(call, key)) || !text(call.id) || call.object !== 'call_task' || call.status !== 'completed'
    || call.task_completed !== true || !text(call.task) || !object(call.metadata) || !nullableText(call.summary)
    || !(call.structured_result === null || object(call.structured_result)) || !Array.isArray(call.evidence) || call.evidence.some(item => typeof item !== 'string')
    || call.failure_code !== null || call.failure_message !== null || !timestamp(call.created_at) || !timestamp(call.completed_at)
    || Date.parse(call.completed_at) < Date.parse(call.created_at) || !Array.isArray(call.recipients) || call.recipients.length !== 1) {
    fail('invalid_call_result', 'Import a complete, completed Calls API CallTask with task_completed=true, one recipient, valid timestamps, and its original metadata.');
  }
  const confidence = call.completion_confidence;
  if (confidence !== null && (!object(confidence) || !finite(confidence.score) || confidence.score < 0 || confidence.score > 1 || !text(confidence.label))) fail('invalid_call_result', 'The call completion confidence is malformed.');
  if (call.metadata.app !== 'harvest-relay' || call.metadata.provider_type !== providerType || call.metadata.provider_id !== provider.id) fail('provider_mismatch', 'The CallTask metadata must identify this exact Harvest Relay provider and provider type.');

  const recipient = call.recipients[0];
  if (!object(recipient) || !text(recipient.id) || recipient.status !== 'completed' || !Array.isArray(recipient.phones) || recipient.phones.length !== 1
    || !/^\+[1-9]\d{6,14}$/.test(recipient.phones[0]) || !nullableText(recipient.region) || !nullableText(recipient.locale)
    || !nullableText(recipient.summary) || !object(recipient.structured_result) || !Array.isArray(recipient.attempts) || !recipient.attempts.length) {
    fail('invalid_call_result', 'The call needs one completed recipient with structured_result and original attempt evidence.');
  }
  const transcript = [];
  for (const attempt of recipient.attempts) {
    const attemptFields = ['id', 'phone', 'status', 'started_at', 'completed_at', 'summary', 'transcript_turns', 'provider_call_id', 'failure_code', 'failure_message'];
    if (!object(attempt) || attemptFields.some(key => !Object.hasOwn(attempt, key)) || !text(attempt.id) || attempt.phone !== recipient.phones[0]
      || !['completed', 'failed', 'canceled'].includes(attempt.status)
      || !(attempt.started_at === null || timestamp(attempt.started_at)) || !timestamp(attempt.completed_at)
      || !nullableText(attempt.summary) || !nullableText(attempt.provider_call_id) || !nullableText(attempt.failure_code) || !nullableText(attempt.failure_message)
      || !Array.isArray(attempt.transcript_turns)) fail('invalid_call_result', 'Call attempt evidence is malformed.');
    for (const turn of attempt.transcript_turns) {
      if (!object(turn) || !['bot', 'user', 'unknown'].includes(turn.speaker) || !text(turn.text)
        || !(turn.offset_seconds === null || (Number.isInteger(turn.offset_seconds) && turn.offset_seconds >= 0))) fail('invalid_call_result', 'Transcript turns must preserve the official speaker, text, and offset fields.');
      transcript.push({ ...structuredClone(turn), attempt_id: attempt.id });
    }
  }
  const facts = recipient.structured_result;
  const schema = buildCallRequest(scenario, { providerType, providerId: provider.id, phone: recipient.phones[0] }).recipient_result_schema;
  validateSchema(facts, schema);
  if (!text(facts.evidence) || !validDate(facts.service_date) || facts.service_date !== scenario.service_date
    || !timezone(facts.timezone) || timezone(facts.timezone) !== timezone(scenario.timezone)) fail('invalid_facts', 'Facts need evidence and an explicitly confirmed service_date and timezone matching this scenario. No date or timezone inference is performed.');

  if (facts.availability === 'yes') {
    const requiredFacts = ['capacity_kg', 'min_temp_c', 'max_temp_c', 'cost_usd', 'valid_until_min', ...(providerType === 'storage' ? ['receive_from_min', 'receive_until_min'] : ['pickup_min', 'travel_min'])];
    if (requiredFacts.some(key => !Object.hasOwn(facts, key)) || facts.capacity_kg <= 0 || facts.min_temp_c > facts.max_temp_c || !money(facts.cost_usd)) fail('invalid_facts', 'An affirmative quote needs all confirmed capacity, temperature, price, expiry, and service-time facts. Unknown values cannot inherit demo facts.');
    if (!recipient.attempts.some(attempt => attempt.status === 'completed' && attempt.transcript_turns.some(turn => turn.speaker === 'user'))) fail('invalid_call_result', 'An affirmative quote requires a completed attempt with an available recipient transcript for factual review.');
  }
  for (const field of ['valid_until_min', 'receive_from_min', 'receive_until_min', 'pickup_min']) {
    if (Object.hasOwn(facts, field) && !minute(facts[field])) fail('invalid_facts', 'Service times and expiry must be explicit same-day local minutes from 0 through 1439.');
  }
  if (Object.hasOwn(facts, 'capacity_kg') && facts.capacity_kg < 0) fail('invalid_facts', 'Capacity cannot be negative.');
  if (Object.hasOwn(facts, 'cost_usd') && !money(facts.cost_usd)) fail('invalid_facts', 'Price must be a nonnegative USD amount with no fractional cent.');
  if (finite(facts.min_temp_c) && finite(facts.max_temp_c) && facts.min_temp_c > facts.max_temp_c) fail('invalid_facts', 'The temperature range is inverted.');
  if (minute(facts.receive_from_min) && minute(facts.receive_until_min) && facts.receive_from_min > facts.receive_until_min) fail('invalid_facts', 'The receiving window is inverted.');
  if (Object.hasOwn(facts, 'travel_min') && (!Object.keys(facts.travel_min).length || Object.values(facts.travel_min).some(value => !minute(value)))) fail('invalid_facts', 'Travel times need at least one named route with a nonnegative whole-minute duration below one day. Missing routes stay unknown.');

  const evidenceMode = call.metadata.evidence_mode === 'test' || call.metadata.source_provenance === 'synthetic' ? 'test' : 'operator-supplied';
  const copiedFacts = Object.fromEntries(Object.entries(facts).filter(([key]) => !['availability', 'service_date', 'timezone'].includes(key)));
  return {
    ...identity(provider), ...structuredClone(copiedFacts), status: facts.availability === 'yes' ? 'confirmed' : facts.availability === 'no' ? 'unavailable' : 'unknown',
    call_id: call.id, transcript,
    source: { kind: 'calle-call-task', reviewed: true, call_id: call.id, recipient_id: recipient.id, service_date: facts.service_date, timezone: facts.timezone, evidence_mode: evidenceMode },
    source_call: structuredClone(call),
  };
}

function withNotice(scenario) {
  const modes = new Set([...scenario.storages, ...scenario.carriers].filter(provider => provider.source?.reviewed).map(provider => provider.source.evidence_mode));
  if (modes.size > 1) fail('mixed_evidence', 'TEST/rehearsal evidence and operator-supplied evidence must use separate scenarios.');
  const mode = modes.values().next().value ?? (scenario.evidence_mode === 'test' ? 'test' : 'operator-supplied');
  return { ...scenario, evidence_mode: mode, notice: mode === 'test' ? 'TEST / REHEARSAL: fictional service facts. Do not use for real dispatch or claim actual food rescued. No booking or food-safety guarantee.' : 'Operator-reviewed CALL-E JSON import. Source authenticity is not independently verified. Unimported providers remain unknown. Proposal only; no booking or food-safety guarantee.' };
}

export function prepareReviewedScenario(scenario) {
  validateContext(scenario);
  const result = {
    id: scenario.id, name: scenario.name, provenance: 'reviewed-call-results', evidence_mode: scenario.evidence_mode,
    service_date: scenario.service_date, timezone: scenario.timezone, now_min: scenario.now_min, lot: structuredClone(scenario.lot),
    storages: [], carriers: [],
  };
  for (const [type, field] of [['storage', 'storages'], ['carrier', 'carriers']]) {
    result[field] = scenario[field].map(provider => provider.source?.kind === 'calle-call-task' && provider.source.reviewed === true
      ? mapCall(scenario, provider.source_call, type, provider)
      : identity(provider));
  }
  return withNotice(result);
}

export function ingestCallResult(scenario, call, { providerType, providerId, reviewed } = {}) {
  if (reviewed !== true) fail('review_required', 'Use --reviewed only after checking the recipient transcript and each extracted fact.');
  const next = prepareReviewedScenario(scenario);
  const field = providerType === 'storage' ? 'storages' : providerType === 'carrier' ? 'carriers' : null;
  const provider = field && next[field].find(item => item.id === providerId);
  if (!provider) fail('invalid_provider', 'Select an existing storage or carrier provider.');
  const imported = mapCall(next, call, providerType, provider);
  next[field] = next[field].map(item => item.id === providerId ? imported : item);
  return withNotice(next);
}

export async function saveReviewedScenario(outputPath, scenario, runtimeDir = DEFAULT_RUNTIME_DIR) {
  if (!text(outputPath)) fail('private_output_required', 'Provide --output as a new JSON file inside runtime/.');
  const root = resolve(runtimeDir);
  const destination = resolve(outputPath);
  if (!destination.startsWith(`${root}${sep}`) || extname(destination) !== '.json') fail('private_output_required', 'Imported call evidence must be saved as a JSON file inside the private runtime directory.');
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const actualRoot = await realpath(root);
  const actualDirectory = await realpath(dirname(destination));
  if (actualDirectory !== actualRoot && !actualDirectory.startsWith(`${actualRoot}${sep}`)) fail('private_output_required', 'The output directory cannot escape runtime through a symbolic link.');
  let file;
  try { file = await open(destination, 'wx', 0o600); } catch (error) {
    if (error.code === 'EEXIST') fail('output_exists', 'The output file already exists. Preserve the prior snapshot and choose a new output file.');
    throw error;
  }
  try { await file.writeFile(`${JSON.stringify(scenario, null, 2)}\n`); await file.sync(); } finally { await file.close(); }
  return destination;
}
