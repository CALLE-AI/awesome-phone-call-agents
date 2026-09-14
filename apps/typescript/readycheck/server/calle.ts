import { z } from 'zod';
import type {
  CandidateResult,
  ExtractionRepair,
  RepairRule,
  Task,
  Turn,
} from '../src/domain/model';
import { valueSchema, SCHEMA_VERSION } from '../src/domain/model';
import { reviewConversation, reversedDropoffRole } from '../src/domain/conversation-review';
import { explicitDollars } from '../src/domain/money';
import { repairableDollars } from '../src/domain/repairs';
import type { Recipient } from './config';

export const CALLE_ORIGIN = 'https://api.heycall-e.com';
export const resultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['disposition', 'facts'],
  properties: {
    disposition: { type: 'string', enum: ['answered', 'no_answer', 'voicemail', 'refused'] },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'field',
          'value_json',
          'quote',
          'turn_index',
          'certainty',
          'conditions',
          'unit',
          'price_basis',
        ],
        properties: {
          expires_at: {
            type: 'string',
            description:
              'Earlier explicit expiry stated by the recipient as an ISO timestamp with offset. Omit this optional field when no expiry was stated. Never invent an expiry.',
          },
          field: {
            type: 'string',
            description:
              'Use exactly an approved requirement ID. Initial and revised prices use the same money requirement ID in separate facts; never invent price_initial, price_revised or availability aliases.',
          },
          value_json: {
            type: 'string',
            description:
              'JSON-encoded value. Money is integer USD cents: $1,000 = 100000, $40 = 4000, $38 = 3800. Preserve the actual recipient amount even if over budget. Time is ISO 8601 with offset. Window is {start,end,minimumMinutes}. Unknown values must be omitted as facts.',
          },
          quote: {
            type: 'string',
            description: 'Exact verbatim words spoken by the recipient, preserving qualifications.',
          },
          turn_index: {
            type: 'integer',
            description:
              'Zero-based position in the FULL transcript_turns array, counting bot, user, screening and greeting segments. The selected segment must be a recipient statement. Never count only user segments.',
          },
          evidence_turn_indices: {
            type: 'array',
            items: { type: 'integer' },
            description:
              'Positions in the FULL transcript including the question, original offer and confirmation needed to interpret this answer. Do not count only recipient turns.',
          },
          answer_state: {
            type: 'string',
            enum: ['value', 'unavailable', 'unknown'],
            description:
              'value for a stated value; unavailable only for an explicit inability to meet the requested requirement; unknown for uncertainty. For unavailable or unknown use value_json "false" if no typed value was stated. Never invent dates for a negative availability answer.',
          },
          context: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Supporting question context and explanation, not caveats. Put actual prerequisites or exceptions in conditions only.',
          },
          certainty: { type: 'string', enum: ['confirmed', 'tentative'] },
          conditions: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Actual unresolved caveats, prerequisites or exceptions only. A description of the preceding question or price revision belongs in context, not conditions.',
          },
          unit: { type: 'string', enum: ['USD', 'count', 'minutes', 'none'] },
          price_basis: {
            type: 'string',
            enum: ['all_in', 'minimum', 'estimate', 'unit', 'not_applicable'],
          },
        },
      },
    },
  },
};
const extraction = z
  .object({
    disposition: z.enum(['answered', 'no_answer', 'voicemail', 'refused']),
    facts: z
      .array(
        z
          .object({
            expires_at: z.string().nullable().optional(),
            field: z.string(),
            value_json: z.string().max(2000),
            quote: z.string().min(1).max(3000),
            turn_index: z.number().int().nonnegative(),
            evidence_turn_indices: z.array(z.number().int().nonnegative()).max(20).optional(),
            answer_state: z.enum(['value', 'unavailable', 'unknown']).optional(),
            context: z.array(z.string().max(500)).max(10).optional(),
            certainty: z.enum(['confirmed', 'tentative']),
            conditions: z.array(z.string().max(500)).max(10),
            unit: z.enum(['USD', 'count', 'minutes', 'none']),
            price_basis: z.enum(['all_in', 'minimum', 'estimate', 'unit', 'not_applicable']),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
export class DispatchUnknown extends Error {}
export class CreateRejected extends Error {}
const rejectionReasons: Record<string, string> = {
  invalid_request: 'The request did not pass provider validation.',
  result_schema_invalid: 'The task result schema is not supported.',
  recipient_result_schema_invalid: 'The recipient result schema is not supported.',
  insufficient_balance: 'The CALL-E account has insufficient balance for this request.',
  unauthorized: 'The API key was rejected.',
  forbidden: 'The API key does not permit this request.',
  unsupported_region: 'The recipient region is not supported.',
  unsupported_language: 'The conversation language is not supported.',
  recipient_blocked: 'The recipient is blocked by CALL-E.',
  policy_violation: 'CALL-E declined this request under its calling policy.',
  no_recipients: 'No recipient was accepted.',
  invalid_recipient: 'The recipient configuration is invalid.',
  invalid_phone: 'The recipient phone number was rejected.',
};
export class ProviderReadError extends Error {
  constructor(public readonly status: number) {
    super(`Could not read CALL-E status (HTTP ${status}). The existing call will be reconciled.`);
  }
}
export interface CallTransport {
  create(payload: unknown, key: string): Promise<string>;
  read(id: string): Promise<unknown>;
  recover?(originalBody: string, key: string): Promise<string>;
}
export class CalleTransport implements CallTransport {
  constructor(
    private apiKey: string,
    private request: typeof fetch = fetch,
  ) {}
  async create(payload: unknown, key: string): Promise<string> {
    return this.recover(JSON.stringify(payload), key);
  }
  async recover(originalBody: string, key: string): Promise<string> {
    let response: Response;
    try {
      response = await this.request(`${CALLE_ORIGIN}/v1/calls`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: originalBody,
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      });
    } catch {
      throw new DispatchUnknown(
        'The create response was lost. Reconcile the existing attempt; do not redial.',
      );
    }
    if ([400, 401, 403, 422].includes(response.status)) {
      let code: unknown;
      try {
        code = (await response.json())?.error?.code;
      } catch {
        /* A rejected request stays rejected even without a JSON error body. */
      }
      if (code === 'idempotency_conflict')
        throw new DispatchUnknown(
          'CALL-E reported an idempotency conflict. Reconcile the existing attempt; do not redial.',
        );
      const reason =
        typeof code === 'string' && Object.hasOwn(rejectionReasons, code)
          ? ` ${rejectionReasons[code]}`
          : '';
      throw new CreateRejected(`CALL-E rejected the request (HTTP ${response.status}).${reason}`);
    }
    if (!response.ok)
      throw new DispatchUnknown(
        `CALL-E returned HTTP ${response.status}; dispatch outcome is uncertain.`,
      );
    try {
      const body = (await response.json()) as Record<string, unknown>;
      const id = body.call_id ?? body.id;
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw Error();
      return id;
    } catch {
      throw new DispatchUnknown(
        'The create response did not contain a usable call ID. Operator reconciliation is required.',
      );
    }
  }
  async read(id: string): Promise<unknown> {
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw new Error('Invalid provider call ID.');
    const r = await this.request(`${CALLE_ORIGIN}/v1/calls/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (!r.ok) throw new ProviderReadError(r.status);
    return r.json();
  }
}
export function callPayload(
  taskText: string,
  recipient: Recipient,
  inquiryId: string,
  fields: string[],
) {
  if (!fields.length || new Set(fields).size !== fields.length)
    throw new Error('A call result schema needs distinct approved requirement IDs.');
  const schema = {
    ...resultSchema,
    properties: {
      ...resultSchema.properties,
      facts: {
        ...resultSchema.properties.facts,
        items: {
          ...resultSchema.properties.facts.items,
          properties: {
            ...resultSchema.properties.facts.items.properties,
            field: { ...resultSchema.properties.facts.items.properties.field, enum: [...fields] },
          },
        },
      },
    },
  };
  return {
    task: taskText,
    recipients: [{ phones: [recipient.phone], region: 'US', locale: 'en-US' }],
    result_schema: schema,
    recipient_result_schema: schema,
    metadata: { readycheck_inquiry_id: inquiryId, schema_version: SCHEMA_VERSION },
  };
}
export function providerStatus(value: unknown): string {
  return value && typeof value === 'object' && 'status' in value && typeof value.status === 'string'
    ? value.status
    : 'invalid';
}
export function providerPhase(value: unknown): 'queued' | 'calling' | 'finalizing' | 'waiting' {
  const status = providerStatus(value);
  if (status === 'queued' || status === 'scheduled') return 'queued';
  if (status !== 'in_progress') return 'waiting';
  const recipients = (value as { recipients?: unknown }).recipients;
  if (
    Array.isArray(recipients) &&
    recipients.length &&
    recipients.every(
      (r) =>
        r &&
        typeof r === 'object' &&
        ['completed', 'failed', 'canceled', 'cancelled'].includes(r.status),
    )
  )
    return 'finalizing';
  return 'calling';
}
export function parseCallResult(
  body: unknown,
  task: Task,
  recipient: Recipient,
  inquiryId: string,
  observedAt: string,
  disabled: RepairRule[] = [],
): CandidateResult {
  const record = body as Record<string, unknown>;
  const recipientRecords = Array.isArray(record?.recipients) ? record.recipients : [];
  const rawRecipient =
    recipientRecords.length === 1 ? (recipientRecords[0] as Record<string, unknown>) : null;
  const result: CandidateResult = {
    id: recipient.id,
    name: recipient.name,
    category: 'Consenting test participant',
    area: 'Controlled live test',
    initials: recipient.name
      .split(' ')
      .map((x) => x[0])
      .slice(0, 2)
      .join(''),
    mode: 'live',
    disposition: 'invalid_output',
    facts: [],
    transcript: [],
    checkedAt: observedAt,
    sourceId: inquiryId,
    inquiryId,
  };
  if (!rawRecipient) return result;
  const attempts = Array.isArray(rawRecipient.attempts)
    ? (rawRecipient.attempts as Record<string, unknown>[])
    : [];
  // Multiple provider attempts remain separate evidence. Only the final attempt is extracted.
  const turns = attempts.at(-1)?.transcript_turns;
  if (
    Array.isArray(turns) &&
    turns.some(
      (t) =>
        !t || typeof t !== 'object' || typeof t.text !== 'string' || typeof t.speaker !== 'string',
    )
  )
    return result;
  if (Array.isArray(turns))
    result.transcript = turns.slice(0, 2000).map((t: Record<string, unknown>): Turn => ({
      speaker: ['user', 'recipient', 'human'].includes(String(t.speaker)) ? 'recipient' : 'caller',
      text: typeof t.text === 'string' ? t.text.slice(0, 10000) : '',
      offsetSeconds: typeof t.offset_seconds === 'number' ? t.offset_seconds : 0,
    }));
  result.conversationWarnings = reviewConversation(task, result.transcript);
  const parsed = extraction.safeParse(rawRecipient.structured_result);
  if (!parsed.success) return result;
  result.disposition = parsed.data.disposition;
  if (result.disposition !== 'answered') return result;
  if (!result.transcript.length) {
    result.disposition = 'invalid_output';
    return result;
  }
  for (const [index, f] of parsed.data.facts.entries()) {
    const repairs: ExtractionRepair[] = [];
    const requirement = task.requirements.find((r) => r.id === f.field);
    if (!requirement) {
      const warning =
        'Some answers used unrecognized requirement names and were excluded. Review the transcript for missing price or availability details.';
      if (!result.extractionWarnings?.includes(warning))
        (result.extractionWarnings ||= []).push(warning);
      continue;
    }
    let value;
    try {
      value = valueSchema.parse(JSON.parse(f.value_json));
    } catch {
      continue;
    }
    // A wrong claimed index may be recovered only by a unique exact recipient quote.
    let turn = f.turn_index;
    if (
      result.transcript[turn]?.speaker !== 'recipient' ||
      !result.transcript[turn]?.text.includes(f.quote)
    ) {
      if (disabled.includes('source_reference')) continue;
      const matches = result.transcript
        .map((t, i) => (t.speaker === 'recipient' && t.text.includes(f.quote) ? i : -1))
        .filter((i) => i >= 0);
      if (matches.length !== 1) continue;
      turn = matches[0];
      repairs.push({ rule: 'source_reference', originalTurn: f.turn_index });
    }
    const quotedCents =
      requirement.unit === 'USD'
        ? (explicitDollars(f.quote) ?? repairableDollars(f.quote, result.transcript[turn].text))
        : null;
    if (quotedCents !== null && quotedCents !== value) {
      const repaired =
        !disabled.includes('explicit_usd') && f.unit === 'USD' && typeof value === 'number'
          ? repairableDollars(f.quote, result.transcript[turn].text)
          : null;
      if (repaired !== null) {
        repairs.push({ rule: 'explicit_usd', originalValue: value });
        value = repaired;
      } else {
        (result.extractionWarnings ||= []).push(
          'A price interpretation did not match its explicit dollar quote and was excluded. Review the transcript before relying on that amount.',
        );
        continue;
      }
    }
    const scope = Object.fromEntries(
      task.requirements
        .filter(
          (r) =>
            ['item', 'service', 'quantity', 'period'].includes(r.id) ||
            (r.id === 'deadline' && f.field === 'deadline'),
        )
        .map((r) => [r.id, r.value]),
    );
    if (
      f.answer_state === 'unavailable' ||
      (value === false && ['window', 'deadline', 'exact'].includes(requirement.kind))
    )
      scope[f.field] = requirement.value;
    if (task.template === 'rental') scope.$acquisition = task.acquisition || 'rental';
    const evidenceTurns = new Set([turn]);
    for (const i of f.evidence_turn_indices || [])
      if (i < result.transcript.length) evidenceTurns.add(i);
    // Include the question next to a short confirmation without treating caller speech as proof.
    for (
      let i = turn - 1;
      i >= 0 && i >= turn - 8 && result.transcript[i].speaker === 'caller';
      i--
    )
      evidenceTurns.add(i);
    const precedingQuestion = [...evidenceTurns]
      .sort((a, b) => a - b)
      .filter((i) => i < turn && result.transcript[i].speaker === 'caller')
      .map((i) => result.transcript[i].text)
      .join(' ');
    const roleAmbiguous = f.field === 'dropoff' && reversedDropoffRole(precedingQuestion);
    result.facts.push({
      id: `${inquiryId}-${index}`,
      field: f.field,
      value,
      raw: f.quote,
      sourceId: inquiryId,
      turn,
      speaker: 'recipient',
      observedAt,
      expiresAt: new Date(
        f.expires_at
          ? Math.min(
              Number.isFinite(Date.parse(f.expires_at))
                ? Date.parse(f.expires_at)
                : Date.parse(observedAt),
              Date.parse(observedAt) + 86400000,
            )
          : Date.parse(observedAt) + 86400000,
      ).toISOString(),
      certainty: f.certainty,
      unit: f.unit,
      priceBasis: f.price_basis === 'not_applicable' ? undefined : f.price_basis,
      conditions: f.conditions,
      answerState: roleAmbiguous
        ? 'unknown'
        : (f.answer_state ??
          (value === false && ['window', 'deadline', 'exact'].includes(requirement.kind)
            ? 'unavailable'
            : 'value')),
      context: f.context || [],
      evidenceTurns: [...evidenceTurns].sort((a, b) => a - b),
      reviewed: false,
      scope,
      ...(repairs.length ? { repairs } : {}),
    });
  }
  // Bind dependent facts to the returned model. Human review must still check that
  // each quote actually applies to that model and preserves its qualifications.
  const models = [
    ...new Set(
      result.facts
        .filter(
          (f) => f.field === 'item' && f.certainty === 'confirmed' && typeof f.value === 'string',
        )
        .map((f) => f.value as string),
    ),
  ];
  if (models.length === 1)
    for (const fact of result.facts) {
      if (fact.field !== 'item' && 'item' in fact.scope) fact.scope.item = models[0];
    }
  return result;
}
export function mergeResults(
  old: CandidateResult | undefined,
  fresh: CandidateResult,
): CandidateResult {
  if (!old) return fresh;
  const facts = new Map(old.facts.map((f) => [f.id, f]));
  for (const fact of fresh.facts) if (!facts.has(fact.id)) facts.set(fact.id, fact);
  return {
    ...fresh,
    extractionWarnings: [...(old.extractionWarnings || []), ...(fresh.extractionWarnings || [])],
    // Existing reviews win when the same provider result is delivered again.
    facts: [...facts.values()],
    conversationWarnings: [
      ...new Set([...(old.conversationWarnings || []), ...(fresh.conversationWarnings || [])]),
    ],
    sources: { ...old.sources, [old.sourceId]: old.transcript, ...fresh.sources },
    sourceTimes: {
      ...old.sourceTimes,
      [old.sourceId]: old.checkedAt,
      ...fresh.sourceTimes,
      [fresh.sourceId]: fresh.checkedAt,
    },
  };
}
