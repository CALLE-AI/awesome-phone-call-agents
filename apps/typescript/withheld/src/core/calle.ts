/**
 * Call providers.
 *
 * Two implementations behind one interface:
 *
 *   FixtureProvider — replays a recorded transcript. This is the default. The
 *   whole test suite and every CLI command except `run --real` go through it,
 *   with no credentials and no calls.
 *
 *   CalleProvider — places a real call through CALL-E's TypeScript SDK. Only
 *   reachable behind `--real`, and only with CALLE_API_KEY set.
 *
 * The mapping below is written against @call-e/calle 0.7.0, whose shape is:
 *
 *   client.calls.createAndWait({ task, recipient, recipientResultSchema }, opts)
 *     -> Call { status, summary, structuredResult, taskCompleted,
 *               completionConfidence, evidence, failureCode,
 *               recipients: [{ structuredResult, summary,
 *                              attempts: [{ status, failureCode,
 *                                           transcriptTurns }] }] }
 *
 * Two of those fields deserve naming, because Withheld deliberately refuses
 * them as inputs to any verdict: `taskCompleted` and `completionConfidence` are
 * CALL-E's own assessment of whether it succeeded. They are useful telemetry
 * and they are not evidence. Everything this app reports is re-derived from
 * `transcriptTurns`, so if the model believes it booked an appointment and no
 * turn says so, the report says it did not.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { CallStatus, Turn } from './types';
import type { ProviderClaim } from './transcript';

export interface CallRequest {
  to: string;
  goal: string;
  locale?: string;
  region?: string;
  /**
   * Stable across retries of the same leg, so a crash between submitting and
   * recording cannot put a second call through to the same person.
   */
  idempotencyKey: string;
}

export interface CallOutcome {
  status: CallStatus;
  turns: Turn[];
  providerClaims: ProviderClaim[];
  ref: string;
  /** CALL-E's own view of whether it succeeded. Recorded, never trusted. */
  providerSelfAssessment?: {
    taskCompleted: boolean | null;
    confidence: number | null;
  };
}

export interface CallProvider {
  readonly name: string;
  readonly placesRealCalls: boolean;
  placeCall(request: CallRequest): Promise<CallOutcome>;
}

interface FixtureFile {
  name: string;
  description: string;
  status: CallStatus;
  now: string;
  turns: Turn[];
  provider_claims?: ProviderClaim[];
}

export class FixtureProvider implements CallProvider {
  readonly name = 'fixture';
  readonly placesRealCalls = false;

  private readonly dir: string;
  private readonly queue: string[];
  private cursor = 0;

  constructor(dir: string, sequence?: string[]) {
    this.dir = dir;
    this.queue = sequence ?? [];
  }

  static available(dir: string): string[] {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
  }

  load(name: string): FixtureFile {
    const file = path.join(this.dir, `${name}.json`);
    return JSON.parse(readFileSync(file, 'utf8')) as FixtureFile;
  }

  /**
   * The moment the first recorded call was placed.
   *
   * A replay that reads the wall clock is not a replay: the same fixtures would
   * resolve "tomorrow between ten and twelve" to a different date every day, and
   * eventually drift outside the hours the errand accepts. Anchoring to the
   * recording keeps the demo reproducible for good.
   */
  recordedAt(): Date | null {
    const first = this.queue[0];
    if (!first) return null;
    const parsed = Date.parse(this.load(first).now);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }

  async placeCall(_request: CallRequest): Promise<CallOutcome> {
    const name = this.queue[this.cursor] ?? this.queue[this.queue.length - 1];
    if (!name) throw new Error('FixtureProvider was given no fixtures to replay.');
    this.cursor += 1;
    const fixture = this.load(name);
    return {
      status: fixture.status,
      turns: fixture.turns,
      providerClaims: fixture.provider_claims ?? [],
      ref: `fixture:${fixture.name}`,
    };
  }
}

export const LIVE_API_URL = 'https://api.heycall-e.com';

/**
 * The result schema handed to CALL-E.
 *
 * Note what is *not* in it: there is no field for the person's phone number, in
 * either direction. The agent has no slot to put one in and no instruction to
 * collect one. Asking a model not to say something is a request; giving it
 * nowhere to say it is a design.
 */
export const RECIPIENT_RESULT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    callback_offered: {
      type: 'string',
      enum: ['yes', 'no', 'unknown'],
      description: 'Did the person on the line offer to call back later?',
    },
    window_offered: {
      type: 'string',
      description:
        'If they named a time when they could be called back, the time as they said it. Empty if they named none.',
    },
    errand_resolved: {
      type: 'string',
      enum: ['yes', 'no', 'unknown'],
      description:
        'Was the errand finished on this call, with nothing outstanding?',
    },
  },
  required: ['callback_offered', 'errand_resolved'],
};

export class CalleProvider implements CallProvider {
  readonly name = 'call-e';
  readonly placesRealCalls = true;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: { apiKey: string; baseUrl?: string; timeoutMs?: number }) {
    if (!opts.apiKey) {
      throw new Error(
        'CALLE_API_KEY is not set. Withheld will not place a call without it.',
      );
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = approvedBaseUrl(opts.baseUrl ?? LIVE_API_URL, opts.apiKey);
    this.timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  }

  async placeCall(request: CallRequest): Promise<CallOutcome> {
    const { CalleClient } = await import('@call-e/calle');
    const client = new CalleClient({ apiKey: this.apiKey, baseUrl: this.baseUrl });

    const call = await client.calls.createAndWait(
      {
        task: request.goal,
        recipient: {
          phones: [request.to],
          locale: request.locale ?? 'en-US',
          ...(request.region ? { region: request.region } : {}),
        },
        recipientResultSchema: RECIPIENT_RESULT_SCHEMA,
        metadata: { app: 'withheld' },
      },
      { idempotencyKey: request.idempotencyKey, timeoutMs: this.timeoutMs },
    );

    const recipient = call.recipients?.[0];
    const attempts = call.recipients?.flatMap((r) => r.attempts ?? []) ?? [];
    const lastAttempt = attempts.at(-1);
    const turns = normalizeTurns(attempts.flatMap((a) => a.transcriptTurns ?? []));

    return {
      status: foldStatus({
        call: call.status,
        attempt: lastAttempt?.status ?? null,
        failureCode: call.failureCode ?? lastAttempt?.failureCode ?? null,
        anyHumanSpeech: turns.some(
          (t) => t.speaker === 'callee' && t.text.trim().length > 0,
        ),
      }),
      turns,
      providerClaims: normalizeClaims(
        recipient?.structuredResult ?? call.structuredResult,
      ),
      ref: `calle:${call.id}`,
      providerSelfAssessment: {
        taskCompleted: call.taskCompleted ?? null,
        confidence: call.completionConfidence?.score ?? null,
      },
    };
  }
}

/**
 * Is this key obviously not a real credential?
 *
 * Loopback simulators are useful, but "send the key anywhere on localhost" is
 * not a boundary: any process on the machine can bind a port, and a plaintext
 * HTTP hop hands over a live credential to whatever answers. So loopback is
 * allowed only for a key that announces itself as fake. The test must be
 * conservative — anything it is unsure about is treated as real, because the
 * cost of guessing wrong is a working API key sent in the clear.
 */
export function isObviouslyFakeKey(apiKey: string): boolean {
  return /^(test|fake|dummy|sim|local)[-_]/i.test(apiKey.trim());
}

/**
 * Refuse to send an API key anywhere except CALL-E's own origin over HTTPS, or
 * a loopback simulator holding a key that is explicitly fake.
 *
 * A misconfigured base URL is otherwise a silent credential leak, and the
 * silent part is what makes it dangerous: nothing fails, the key is just gone.
 */
export function approvedBaseUrl(value: string, apiKey = ''): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('CALLE_BASE_URL is not a URL.');
  }

  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  // Compared by host, not origin: `http://api.heycall-e.com` is the *live* host
  // over plaintext, and must be refused as such rather than as an unknown one.
  const official = url.hostname === new URL(LIVE_API_URL).hostname;

  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      'Refusing a CALL-E base URL that carries credentials or a query.',
    );
  }
  if (!official && !loopback) {
    throw new Error(
      `Refusing an unapproved CALL-E origin: ${url.origin}. Use ${LIVE_API_URL} or a loopback simulator.`,
    );
  }
  if (official && url.protocol !== 'https:') {
    throw new Error(
      'Refusing to send a CALL-E credential over plaintext to the live API.',
    );
  }
  if (loopback && !isObviouslyFakeKey(apiKey)) {
    throw new Error(
      'Refusing to send a real-looking CALL-E key to a loopback simulator. ' +
        'Prefix the key with `test-`, `fake-`, `dummy-`, `sim-` or `local-` to confirm it is not a live credential.',
    );
  }
  return url.origin;
}

/**
 * CALL-E has no call-level "nobody picked up" — a call task can hold several
 * recipients and several attempts, so the only place a no-answer exists is in
 * the attempt. Fold it up here, and only here, so the rest of the app can reason
 * about one leg at a time.
 *
 * A `completed` task in which the callee never spoke is not a completed
 * conversation. It is reported as a no-answer rather than as a call where
 * nothing was agreed, because those are not the same thing and the second one
 * would quietly become "they said no".
 */
export function foldStatus(input: {
  call: string;
  attempt: string | null;
  failureCode: string | null;
  anyHumanSpeech: boolean;
}): CallStatus {
  const call = String(input.call ?? '').toLowerCase();
  const code = String(input.failureCode ?? '').toLowerCase();

  if (call === 'queued') return 'queued';
  if (call === 'in_progress') return 'in_progress';
  if (call === 'canceled') return 'canceled';

  if (code.includes('busy')) return 'busy';
  if (
    code.includes('no_answer') ||
    code.includes('noanswer') ||
    code.includes('no-answer') ||
    code.includes('voicemail') ||
    code.includes('machine')
  ) {
    return 'no_answer';
  }

  if (call === 'failed') return 'failed';

  if (call === 'completed') {
    return input.anyHumanSpeech ? 'completed' : 'no_answer';
  }

  return 'queued';
}

interface RawTurn {
  speaker?: unknown;
  text?: unknown;
  offset_seconds?: unknown;
  offsetSeconds?: unknown;
}

/**
 * `bot` is our agent, `user` is the person we rang, and `unknown` stays
 * unknown. Collapsing `unknown` into either side would be inventing evidence:
 * called `user`, it could confirm a booking nobody made; called `bot`, it could
 * convict the agent of a leak it did not cause. It is carried through as-is,
 * and the verdict logic refuses to let it confirm anything.
 */
export function normalizeTurns(raw: unknown[]): Turn[] {
  const turns: Turn[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as RawTurn;

    const text = typeof e.text === 'string' ? e.text.trim() : '';
    if (!text) continue;

    const speakerRaw = String(e.speaker ?? '').toLowerCase();
    const speaker: Turn['speaker'] =
      speakerRaw === 'bot'
        ? 'caller'
        : speakerRaw === 'user'
          ? 'callee'
          : 'unknown';

    const offset = e.offsetSeconds ?? e.offset_seconds;
    const at =
      typeof offset === 'number' && Number.isFinite(offset) ? offset : undefined;

    turns.push(at === undefined ? { speaker, text } : { speaker, text, at });
  }

  return turns;
}

export function normalizeClaims(result: unknown): ProviderClaim[] {
  if (!result || typeof result !== 'object') return [];
  return Object.entries(result as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'string' && v.trim().length > 0)
    .map(([question_id, v]) => ({ question_id, answer: String(v).trim() }));
}
