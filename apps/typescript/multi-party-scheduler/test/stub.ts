/**
 * A stub CALL-E port for the failures a local fake server cannot express.
 *
 * The fake server in `fake/` speaks the real wire contract over http, which is
 * what the end to end tests use. It cannot drop a connection halfway, answer a
 * create twice or hand back a call it has not finished with. Those are exactly
 * the states a coordinator has to survive, so they are injected here instead.
 */

import { CalleCallError, CalleWaitTimeout, type CallePort, type CreateCallInput } from "../src/calle.js";
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
  /** Thrown from `createCall`, one per attempt, in order. */
  createErrors?: unknown[];
  /** Thrown from `waitForResult` when the create got through. */
  waitError?: unknown;
  /** Thrown from `getCall`, which is where a failed wait is read back. */
  readError?: unknown;
  /** The status CALL-E reports once it answers. Not always terminal. */
  status?: string;
  userLines?: string[];
  structured?: Record<string, unknown> | null;
}

export interface StubCall {
  key: string;
  phase: string;
  phone: string;
}

export interface StubPort extends CallePort {
  /** Every create attempt, including the ones that threw. */
  creates: StubCall[];
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
            completedAt: terminal ? STUB_COMPLETED_AT : null,
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
    completedAt: terminal ? STUB_COMPLETED_AT : null,
  };
}

function scriptOf(scripts: StubScript[], input: CreateCallInput): StubScript {
  const phase = String(input.metadata.phase ?? "");
  const phone = input.recipients[0]?.phones[0] ?? "";
  const found = scripts.find((script) => script.phase === phase && script.phone === phone);
  if (found === undefined) {
    throw new CalleCallError("invalid_recipient", `no stub script for ${phone} in ${phase}`, 400);
  }
  return found;
}

/** A port that answers from `scripts` and throws exactly what they ask it to. */
export function stubPort(scripts: StubScript[]): StubPort {
  const creates: StubCall[] = [];
  const attempts = new Map<string, number>();
  const calls = new Map<string, StubScript>();
  let counter = 0;

  return {
    creates,
    async createCall(input, idempotencyKey) {
      const script = scriptOf(scripts, input);
      creates.push({ key: idempotencyKey, phase: script.phase, phone: script.phone });
      const attempt = attempts.get(idempotencyKey) ?? 0;
      attempts.set(idempotencyKey, attempt + 1);
      const failure = script.createErrors?.[attempt];
      if (failure !== undefined) {
        throw failure;
      }
      // The same key answers with the same call, the way CALL-E does.
      const existing = [...calls.entries()].find(([, held]) => held === script);
      if (existing !== undefined) {
        return stubSnapshot(existing[0], script, false);
      }
      counter += 1;
      const id = `call_stub${counter}`;
      calls.set(id, script);
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
