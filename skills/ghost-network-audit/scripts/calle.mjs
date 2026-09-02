// CALL-E request construction and result interpretation.
// The contract this implements is documented in references/call-contract.md.

import { createHash } from 'node:crypto';
import { maskPhone } from './mask.mjs';

export const DEFAULT_BASE_URL = 'https://api.heycall-e.com';

export const RESULT_SCHEMA = {
  type: 'object',
  required: ['reached_office', 'providers', 'accepts_plan', 'accepting_new_patients'],
  properties: {
    reached_office: {
      type: 'string',
      enum: ['yes', 'no', 'unknown'],
      description:
        "Did a person at this office speak with you? Voicemail, an answering service, or a phone tree is 'no'.",
    },
    providers: {
      type: 'array',
      description: 'One entry per clinician asked about, in the order asked.',
      items: {
        type: 'object',
        required: ['name', 'practices_here'],
        properties: {
          name: { type: 'string' },
          practices_here: {
            type: 'string',
            enum: ['yes', 'no', 'unknown'],
            description:
              "Only 'no' if the person said this clinician does not practice at this location.",
          },
        },
      },
    },
    accepts_plan: {
      type: 'string',
      enum: ['yes', 'no', 'unknown'],
      description: "Does the office accept the named plan today? 'I'd have to check' is 'unknown'.",
    },
    accepting_new_patients: {
      type: 'string',
      enum: ['yes', 'no', 'unknown'],
      description: "Accepting new patients under that plan. 'unknown' if not clearly stated.",
    },
    next_appointment_weeks: {
      type: ['integer', 'null'],
      description: 'Rough weeks until the next new-patient appointment. Null if not stated.',
    },
    declined: { type: 'boolean', description: 'True if the person asked to end the call.' },
    notes: {
      type: 'string',
      description: 'Short administrative note. Must contain no patient or clinical information.',
    },
  },
};

export function buildTaskText(office, { auditingOrganization, planName, callbackNumber }) {
  const providerLines = office.listings
    .map((listing) => `- ${listing.provider_name}, ${listing.specialty}`)
    .join('\n');

  return `You are placing a directory-verification call to a medical office on behalf of ${auditingOrganization}.

Open with this disclosure before anything else, and do not skip it:
"Hello, this is an automated call from ${auditingOrganization}. We're verifying a public provider-directory listing for your office. This will take about a minute, and nothing about any patient is involved. If you'd like to confirm this call is genuine, you can reach us at ${callbackNumber}."

Then ask only these questions, in order, about the listed clinicians:
${providerLines}

1. For each clinician named above, does that clinician currently practice at this location?
2. Does this office currently accept ${planName}?
3. Are those clinicians accepting new patients under ${planName}?
4. If they are accepting new patients, roughly how far out is the next available new-patient appointment? A rough answer in weeks is fine.

Rules you must follow:
- This is an administrative call about the directory listing only.
- Do not discuss any patient, symptom, diagnosis, medication, or treatment. If the person starts to, say "I only need to confirm the directory listing" once, and if it continues, thank them and end the call.
- Do not request or accept an appointment. You are only asking how far out scheduling runs.
- Do not claim to be a patient or to be calling for a patient.
- If the person asks to end the call, thank them and end it immediately. Do not persuade, do not re-ask, and do not offer to call back.
- If you reach voicemail, an answering service, or an automated system, do not leave a message and do not attempt to navigate a phone tree into a clinical queue. End the call.
- If you are not certain of an answer, report it as unknown. Never guess.`;
}

export function buildPayload(office, config) {
  const errors = [];
  if (!config.auditingOrganization) errors.push('auditing_organization is required for disclosure.');
  if (!config.callbackNumber) errors.push('callback_number is required for disclosure.');
  if (!config.planName) errors.push('plan_name is required.');

  const recipient = { phones: [office.phone] };
  // Set explicitly from the listing, never inferred from the number.
  if (office.region) recipient.region = office.region;
  if (office.locale) recipient.locale = office.locale;

  const payload = {
    task: buildTaskText(office, config),
    recipients: [recipient],
    result_schema: RESULT_SCHEMA,
    metadata: {
      source_platform: 'ghost-network-audit',
      correlation_id: office.office_key,
      audit_run_id: config.runId,
    },
  };
  if (config.webhookUrl) payload.webhook_url = config.webhookUrl;

  const idempotencyKey = createHash('sha256')
    .update(JSON.stringify({ payload, runId: config.runId }))
    .digest('hex')
    .slice(0, 32);

  return { payload, idempotencyKey, errors };
}

// Result -> listing state. Rules are applied in order and the first match wins.
//
// Every path out of an `unknown` lands on `unverified`. There is deliberately no
// rule that turns a missing answer into a negative finding: a false ghost strikes a
// working clinician from a directory, and a false confirmation leaves a patient
// dialing a dead number.
export function classifyListing(result, providerName) {
  if (!result || typeof result !== 'object') {
    return { state: 'unverified', reason: 'no_result' };
  }
  if (result.declined === true) {
    return { state: 'unverified', reason: 'declined' };
  }
  if (result.reached_office !== 'yes') {
    return { state: 'unverified', reason: 'no_answer' };
  }

  const entry = Array.isArray(result.providers)
    ? result.providers.find((item) => item && item.name === providerName)
    : null;
  const practicesHere = entry ? entry.practices_here : 'unknown';

  if (practicesHere === 'no') {
    return { state: 'confirmed_ghost', reason: 'provider_not_at_location' };
  }
  if (result.accepts_plan === 'no') {
    return { state: 'confirmed_ghost', reason: 'plan_not_accepted' };
  }
  if (practicesHere !== 'yes' || result.accepts_plan !== 'yes') {
    return { state: 'unverified', reason: 'ambiguous_answer' };
  }
  if (result.accepting_new_patients === 'no') {
    return { state: 'confirmed_closed_panel', reason: 'panel_closed' };
  }
  if (result.accepting_new_patients === 'yes') {
    return { state: 'confirmed_active', reason: 'verified' };
  }
  return { state: 'unverified', reason: 'ambiguous_answer' };
}

export class CalleError extends Error {
  constructor(message, { status, retryable = false } = {}) {
    super(message);
    this.name = 'CalleError';
    this.status = status;
    this.retryable = retryable;
  }
}

function describeFailure(status, body, apiKey) {
  let detail = '';
  try {
    const parsed = JSON.parse(body);
    detail = (parsed && parsed.error && parsed.error.message) || '';
    if (status === 422 && parsed?.error?.code === 'call_not_ready') {
      const questions = Array.isArray(parsed.error.details?.questions)
        ? parsed.error.details.questions.join(' ')
        : detail;
      detail = `CALL-E asked for clarification before dialing: ${questions}`;
    }
  } catch {
    detail = '';
  }
  // The key can appear inside a provider error message; strip it before the text
  // reaches a log or a terminal.
  if (apiKey) detail = detail.split(apiKey).join('[redacted]');
  return maskPhone(detail);
}

export class CalleClient {
  constructor({ baseUrl = DEFAULT_BASE_URL, apiKey = null, fetchImpl = fetch } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  #headers(extra = {}) {
    const headers = { 'Content-Type': 'application/json', ...extra };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    return headers;
  }

  async createCall(payload, idempotencyKey) {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/calls`, {
      method: 'POST',
      headers: this.#headers({ 'Idempotency-Key': idempotencyKey }),
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const detail = describeFailure(response.status, await response.text(), this.apiKey);
      if (response.status === 401 || response.status === 403) {
        throw new CalleError(`CALL-E rejected the API key. ${detail}`, { status: response.status });
      }
      throw new CalleError(`CALL-E request failed (${response.status}). ${detail}`, {
        status: response.status,
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    return response.json();
  }

  async getCall(callId) {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/calls/${encodeURIComponent(callId)}`, {
      headers: this.#headers(),
    });
    if (!response.ok) {
      const detail = describeFailure(response.status, await response.text(), this.apiKey);
      throw new CalleError(`CALL-E status lookup failed (${response.status}). ${detail}`, {
        status: response.status,
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    return response.json();
  }

  async waitForResult(callId, { intervalMs = 2000, timeoutMs = 300000, sleep } = {}) {
    const pause = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      last = await this.getCall(callId);
      if (last.status !== 'queued' && last.status !== 'in_progress') return last;
      await pause(intervalMs);
    }
    // A timeout is not a finding. It returns as an unresolved call so the caller
    // records `unverified`, which is what "we could not tell" actually means.
    return { ...(last || {}), id: callId, status: 'timeout', result: null };
  }
}
