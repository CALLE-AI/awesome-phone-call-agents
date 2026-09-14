/**
 * A stub CALL-E port for the failures a local fake server cannot express.
 *
 * The fake server in `fake/` speaks the real wire contract over http, which is
 * what the end to end tests use. It cannot drop a connection halfway, answer a
 * create twice or hand back a call it has not finished with. Those are exactly
 * the states a coordinator has to survive, so they are injected here instead.
 */

import { CalleCallError, CalleWaitTimeout, type CallePort } from "../src/calle.js";
import type { CallSnapshot, TranscriptTurn } from "../src/types.js";

/** What the caller says, so a confirm transcript carries the question a yes binds to. */
const BOT_LINES: Record<string, string[]> = {
  gather: [
    "This is an automated scheduling call. Nothing is booked yet.",
    "Which of those could you do? You can say more than one option number or say none of them.",
  ],
  confirm: [
    "This is an automated scheduling call. I am confirming one appointment.",
    "Can I confirm that time? Please say confirm or say no if it does not work.",
  ],
  release: [
    "This is an automated scheduling call. This is a short update, no action needed.",
    "The appointment we discussed is not going ahead and nothing is booked.",
  ],
};

export interface StubScript {
  phase: string;
  phone: string;
  /**
   * Which attempt at that call this script answers. Omitted answers any attempt the
   * list has nothing more specific for, which is what almost every test wants.
   */
  attempt?: number;
  /** Thrown from `createCall`, one per attempt, in order. */
  createErrors?: unknown[];
  /** Thrown from `waitForResult` when the create got through. */
  waitError?: unknown;
  /** Thrown from `getCall`, which is where a failed wait is read back. */
  readError?: unknown;
  /** The status CALL-E reports once it answers. Not always terminal. */
  status?: string;
  /**
   * What CALL-E reports as the completion time. Omitted means the stub's own
   * stamp. Null is a finished call the API gave no readable completion time for,
   * which the window check has to refuse on its own terms.
   */
  completedAt?: string | null;
  userLines?: string[];
  structured?: Record<string, unknown> | null;
}

export interface StubCall {
  key: string;
  phase: string;
  phone: string;
  /** Which attempt at that call this create was, as the stub counted it. */
  attempt: number;
}

export interface StubPort extends CallePort {
  /** Every create attempt, including the ones that threw. */
  creates: StubCall[];
  /** Every call the stub actually created, in order, so a replay is not counted as one. */
  created: string[];
}

export const STUB_COMPLETED_AT = "2026-08-04T17:01:20Z";

function turnsOf(script: StubScript): TranscriptTurn[] {
  const bot = BOT_LINES[script.phase] ?? [];
  const user = script.userLines ?? [];
  const turns: TranscriptTurn[] = [];
  let offset = 0;
  for (let index = 0; index < Math.max(bot.length, user.length); index += 1) {
    const botLine = bot[index];
    if (botLine !== undefined) {
      turns.push({ offset_seconds: offset, speaker: "bot", text: botLine });
      offset += 4;
    }
    const userLine = user[index];
    if (userLine !== undefined) {
      turns.push({ offset_seconds: offset, speaker: "user", text: userLine });
      offset += 4;
    }
  }
  return turns;
}

export function stubSnapshot(id: string, script: StubScript, answered: boolean): CallSnapshot {
  const status = answered ? (script.status ?? "completed") : "queued";
  const terminal = status === "completed" || status === "failed" || status === "canceled";
  const structured = terminal ? (script.structured ?? null) : null;
  const completedAt = script.completedAt === undefined ? STUB_COMPLETED_AT : script.completedAt;
  return {
    id,
    status,
    recipients: [
      {
        id: `rcp_${id}`,
        phones: [script.phone],
        status,
        structuredResult: structured,
        summary: null,
        attempts: [
          {
            id: `att_${id}`,
            phone: script.phone,
            status,
            startedAt: "2026-08-04T17:00:05Z",
            completedAt: terminal ? completedAt : null,
            summary: null,
            transcriptTurns: terminal ? turnsOf(script) : [],
            providerCallId: `provider_${id}`,
            failureCode: null,
            failureMessage: null,
          },
        ],
      },
    ],
    structuredResult: structured,
    summary: null,
    taskCompleted: terminal ? true : null,
    completionConfidence: terminal ? { score: 0.9, label: "high" } : null,
    evidence: [],
    failureCode: null,
    failureMessage: null,
    createdAt: "2026-08-04T17:00:00Z",
    completedAt: terminal ? completedAt : null,
  };
}

function scriptOf(scripts: StubScript[], phase: string, phone: string, attempt: number): StubScript {
  const matching = scripts.filter((script) => script.phase === phase && script.phone === phone);
  const found =
    matching.find((script) => script.attempt === attempt) ??
    matching.find((script) => script.attempt === undefined);
  if (found === undefined) {
    throw new CalleCallError("invalid_recipient", `no stub script for ${phone} in ${phase} attempt ${attempt}`, 400);
  }
  return found;
}

/**
 * A port that answers from `scripts` and throws exactly what they ask it to.
 *
 * The idempotency key is honoured the way the API honours it, because that is the
 * whole difference between a retry and a replay. A key the stub has already answered
 * hands back the same call, id included. A key it has not seen is a new call with a
 * new id. `created` counts the second kind only, so a test can tell a second call
 * from a second attempt at the first one.
 */
export function stubPort(scripts: StubScript[]): StubPort {
  const creates: StubCall[] = [];
  const created: string[] = [];
  const tries = new Map<string, number>();
  const calls = new Map<string, StubScript>();
  const byKey = new Map<string, string>();
  const attemptOfCall = new Map<string, number>();
  const placed = new Map<string, number>();
  let counter = 0;

  return {
    creates,
    created,
    async createCall(input, idempotencyKey) {
      const phase = String(input.metadata.phase ?? "");
      const phone = input.recipients[0]?.phones[0] ?? "";
      const held = byKey.get(idempotencyKey);
      // A key the provider has seen is that call again, so it is the attempt that key
      // already belongs to. A key it has not seen is the next attempt at the call.
      const attempt = held === undefined ? (placed.get(`${phase}:${phone}`) ?? 0) + 1 : (attemptOfCall.get(held) ?? 1);
      const script = scriptOf(scripts, phase, phone, attempt);
      creates.push({ key: idempotencyKey, phase, phone, attempt });
      const tried = tries.get(idempotencyKey) ?? 0;
      tries.set(idempotencyKey, tried + 1);
      const failure = script.createErrors?.[tried];
      if (failure !== undefined) {
        throw failure;
      }
      if (held !== undefined) {
        return stubSnapshot(held, script, false);
      }
      counter += 1;
      const id = `call_stub${counter}`;
      calls.set(id, script);
      byKey.set(idempotencyKey, id);
      attemptOfCall.set(id, attempt);
      placed.set(`${phase}:${phone}`, attempt);
      created.push(id);
      return stubSnapshot(id, script, false);
    },
    async waitForResult(callId) {
      const script = calls.get(callId);
      if (script === undefined) {
        throw new CalleCallError("not_found", `unknown call ${callId}`, 404);
      }
      if (script.waitError !== undefined) {
        throw script.waitError;
      }
      return stubSnapshot(callId, script, true);
    },
    async getCall(callId) {
      const script = calls.get(callId);
      if (script === undefined) {
        throw new CalleCallError("not_found", `unknown call ${callId}`, 404);
      }
      if (script.readError !== undefined) {
        throw script.readError;
      }
      return stubSnapshot(callId, script, true);
    },
  };
}

export { CalleCallError, CalleWaitTimeout };
