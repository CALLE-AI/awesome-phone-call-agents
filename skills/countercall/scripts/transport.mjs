/**
 * transport.mjs — the two ways CounterCall reaches CALL-E, behind one interface.
 *
 * Both transports place a real outbound call, both return the SAME validated result shape,
 * and both are checked by the same `validateResult`. Everything above this file — the card
 * renderer, the benchmark, the tests — is transport-blind on purpose.
 *
 *   goals  requires CALLE_API_KEY + COUNTERCALL_GOAL_ID
 *          The published Goal owns the schema. We diff our pinned copy against the live
 *          `published_run_spec` before dialling and refuse on any drift.
 *
 *   calls  requires CALLE_API_KEY only
 *          No published Goal. The schema travels WITH the request as `resultSchema`,
 *          generated from the same CONTRACT that validates the reply, so the two cannot
 *          drift apart.
 *
 * ## Why `calls` exists
 *
 * Publishing a Goal is reachable only through CALL-E Chat — there is no `POST /v1/goals`,
 * no MCP publish tool, and no button on the Goal detail page (FEEDBACK.md finding 5). On
 * 2026-09-02 CALL-E suspended account logins after a security incident, which made that
 * single path unreachable. The Goals transport is still the better product — a published
 * Goal is a reusable, versioned, community-shareable procedure — but a demo path that one
 * vendor outage can sever is not a demo path. `calls` needs nothing but an API key.
 *
 * Selection is by capability, not preference: `selectTransport` picks `goals` whenever a
 * Goal id is configured, and falls back to `calls` otherwise. Set COUNTERCALL_TRANSPORT to
 * force one.
 */
import { CONTRACT, contractFields, resultSchemaJSON, validateResult } from './contract.mjs';
import { diffContract, publishedRunSpec } from './_lib.mjs';

/** What every transport's `run` resolves to. `result` and `error` are mutually exclusive. */
/** @typedef {{result: object|null, error: {code: string}|null, runId: string, calledAt: string|null}} Outcome */

/**
 * The natural-language instruction for the Calls transport.
 *
 * On the Goals transport this text lives in the published Goal and only `variables` travel
 * per run. Here it has to be composed client-side, so it is composed from the SAME office
 * record and procedure — never from free text a caller supplies.
 *
 * The constraints in it are not decoration. This calls a public servant who never opted in,
 * so the agent identifies itself, asks a closed set of questions, and takes a refusal as an
 * answer rather than pressing.
 */
export function buildTask(office, procedure) {
  return [
    `Call ${office.phone_e164}, the public enquiries line for ${office.name} in ${office.city}, Indonesia.`,
    '',
    'Speak Indonesian throughout. You are an assistant calling on behalf of a member of the',
    `public who intends to visit the office in person for: ${procedure}.`,
    '',
    'Identify yourself as an automated assistant calling to ask what to bring, before asking',
    'anything else. Ask only these questions, in this order:',
    '',
    '  1. Which documents must be brought for this procedure?',
    '  2. Must those documents be originals, photocopies, or both?',
    '  3. What is the total fee, if any?',
    '  4. Is the fee paid in cash or by card?',
    '  5. Must an appointment or online registration be made before arriving?',
    '',
    'Rules:',
    '- Do not give advice, do not confirm anything on the office\'s behalf, and do not ask for',
    '  or accept any personal data about the applicant.',
    '- If the clerk says they cannot answer by phone, thank them and end the call. A refusal',
    '  is a valid outcome; do not press, do not ask again, and do not ask for a transfer.',
    '- If the clerk is unsure about a value, record that uncertainty rather than resolving it.',
    '- Keep the call short. This is a public service line and other people are waiting on it.',
  ].join('\n');
}

/**
 * The Goals transport — a published Goal owns the schema.
 * `preflight.mjs` runs the drift guard; `assertReady` here is the same check, so a caller
 * that skips preflight still cannot dial against a drifted Goal.
 */
export const goalsTransport = {
  name: 'goals',
  requires: ['CALLE_API_KEY', 'COUNTERCALL_GOAL_ID'],

  describe(office, procedure, key, env = process.env) {
    return {
      transport: 'goals',
      goalId: env.COUNTERCALL_GOAL_ID ?? '<COUNTERCALL_GOAL_ID>',
      phone: office.phone_e164,
      variables: { office_name: office.name, procedure, city: office.city },
      idempotencyKey: key,
    };
  },

  async assertReady(client, env = process.env) {
    const goal = await client.goals.get(env.COUNTERCALL_GOAL_ID);
    const pinned = { version: CONTRACT.version, result_fields: contractFields() };
    const drift = diffContract(pinned, publishedRunSpec(goal));
    if (drift.length) {
      const error = new Error(`published Goal has drifted from pinned contract v${CONTRACT.version}`);
      error.drift = drift;
      throw error;
    }
  },

  async run(client, office, procedure, key, env = process.env) {
    const goalId = env.COUNTERCALL_GOAL_ID;
    const run = await client.goals.run({
      goalId,
      phone: office.phone_e164,
      variables: { office_name: office.name, procedure, city: office.city },
      idempotencyKey: key,
    });
    // Poll on GoalRun.id. The nested runSpec/telephone `runId` is a different identity and
    // substituting it returns 404.
    const outcome = await client.goals.waitForResult(goalId, run.id);
    return {
      result: outcome.result ?? null,
      error: outcome.error ?? null,
      runId: run.id,
      calledAt: run.createdAt ?? null,
      // Goal Runs do not carry a completion judgment; only the Calls API exposes one. Null
      // here rather than absent, so both transports return the same keys.
      completionConfidence: null,
    };
  },
};

/**
 * The Calls transport — the schema travels with the request.
 *
 * `metadata` carries the same three identifiers the Goal's `variables` would have, so a run
 * is reconcilable from the CALL-E dashboard on either path.
 */
export const callsTransport = {
  name: 'calls',
  requires: ['CALLE_API_KEY'],

  describe(office, procedure, key) {
    return {
      transport: 'calls',
      task: buildTask(office, procedure),
      recipients: [{ phones: [office.phone_e164] }],
      resultSchema: resultSchemaJSON(),
      metadata: { office_id: office.id, office_name: office.name, procedure, city: office.city },
      idempotencyKey: key,
    };
  },

  /*
   * Nothing to assert. There is no published artifact to drift against — the schema we send
   * IS the schema we validate, generated from one source. This method exists so callers do
   * not have to branch on transport.
   */
  async assertReady() {},

  async run(client, office, procedure, key) {
    const request = this.describe(office, procedure, key);
    const created = await client.calls.create(
      {
        task: request.task,
        recipients: request.recipients,
        resultSchema: request.resultSchema,
        metadata: request.metadata,
      },
      { idempotencyKey: key },
    );
    const call = await client.calls.waitForResult(created.id);
    return normaliseCall(call, created);
  },
};

/**
 * Map a terminal `Call` onto the Goals-shaped Outcome the rest of the code already handles.
 *
 * Exported for the tests: this is where the two transports are made to agree, so it is the
 * part worth testing against fixtures rather than against a live phone line.
 *
 * Three cases, in order:
 *
 * 1. A non-terminal-success status (`failed`, `canceled`) is a call that did not happen.
 *    The reason lives in `failureCode`, and when that is null it lives on the dial attempt
 *    — a `no_answer` is reported per attempt, not per task.
 * 2. `status: "completed"` with `structuredResult: null` is CALL-E telling us the call
 *    connected but the evidence could not satisfy the schema. The docs are explicit about
 *    this. It is NOT a null result to hand upward — `render.mjs` would have to decide what a
 *    missing checklist means, and the answer is always "render nothing".
 * 3. Otherwise, a result. It is still re-validated by the caller against the pinned
 *    contract; server-side validation and our own are different claims.
 */
export function normaliseCall(call, created = call) {
  const result = call.structuredResult ?? call.structured_result ?? null;
  const status = call.status ?? null;
  const meta = {
    runId: created.id ?? call.id,
    calledAt: created.createdAt ?? created.created_at ?? call.createdAt ?? null,
    // Calls carries a completion judgment that Goal Runs do not expose. It is recorded for
    // the benchmark and never rendered on the card — the card's certainty is `clerk_certainty`,
    // which is what the clerk actually conveyed, not what a model concluded afterwards.
    completionConfidence: call.completionConfidence ?? call.completion_confidence ?? null,
  };

  if (status && status !== 'completed') {
    return { result: null, error: { code: failureCode(call, status) }, ...meta };
  }
  if (result === null) {
    return { result: null, error: { code: 'result_unextractable' }, ...meta };
  }
  return { result, error: null, ...meta };
}

/** The most specific failure code available: task level, then dial attempt, then status. */
function failureCode(call, status) {
  const taskLevel = call.failureCode ?? call.failure_code ?? null;
  if (taskLevel) return normaliseFailure(taskLevel);

  const attempts = call.recipients?.flatMap((r) => r.attempts ?? []) ?? [];
  const attemptLevel = attempts.map((a) => a.failureCode ?? a.failure_code).find(Boolean);
  if (attemptLevel) return normaliseFailure(attemptLevel);

  return status === 'canceled' ? 'canceled' : 'call_failed';
}

/** Fold vendor failure spellings onto the codes render.mjs already knows. */
function normaliseFailure(code) {
  const c = String(code).toLowerCase();
  if (c.includes('no_answer') || c.includes('noanswer') || c.includes('unanswered') || c.includes('timeout')) {
    return 'no_answer';
  }
  if (c.includes('declin') || c.includes('reject') || c.includes('busy')) return 'declined';
  return c;
}

/**
 * Pick a transport from the environment.
 *
 * COUNTERCALL_TRANSPORT forces one and is validated rather than silently ignored — a typo
 * that fell through to the default would place a call on a path the operator did not choose.
 */
export function selectTransport(env = process.env) {
  const forced = env.COUNTERCALL_TRANSPORT;
  if (forced) {
    if (forced === 'goals') return goalsTransport;
    if (forced === 'calls') return callsTransport;
    throw new Error(`COUNTERCALL_TRANSPORT must be "goals" or "calls", got ${JSON.stringify(forced)}`);
  }
  return env.COUNTERCALL_GOAL_ID ? goalsTransport : callsTransport;
}

/** Missing credentials for the selected transport, as a list. Empty means ready. */
export function missingCredentials(transport, env = process.env) {
  return transport.requires.filter((name) => !env[name]);
}

export { validateResult };
