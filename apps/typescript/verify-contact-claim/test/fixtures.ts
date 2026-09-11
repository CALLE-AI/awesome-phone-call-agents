/**
 * Shared fixtures. Every number is from the reserved 555-01xx range that is kept
 * aside for examples, so nothing here can ring a real handset.
 */

import { parseClaim } from "../src/config.js";
import { questionText } from "../src/script.js";
import type { CallSnapshot, Claim, ClaimInput, TranscriptTurn } from "../src/types.js";

/** The number printed on the customer's card. The only number this app dials. */
export const TRUSTED = "+14155550100";
/** The number the message came from. Never dialled. */
export const SHOWN = "+14155550188";
/** The customer's own number, given out on the call for the responsible party. */
export const CALLBACK = "+14155550199";

export function claimInput(overrides: Partial<ClaimInput> = {}): ClaimInput {
  return {
    claim_id: "northgate-voicemail-0912",
    customer: { name: "Dana Whitfield", callback_number: CALLBACK },
    contact: {
      claimed_to_be: "Northgate Credit Union",
      channel: "voicemail",
      arrived_at: "2026-07-31T09:12:00-07:00",
      claimed_about: "a card that had been blocked",
      number_shown: SHOWN,
      asked_for: "ring back on that number and read out the card number to unblock the card",
    },
    trusted_number: {
      phone: TRUSTED,
      printed_on: "the back of the debit card",
      region: "US",
    },
    policy: {
      per_call_timeout_seconds: 240,
      recent_window_minutes: 60,
      language: "en-US",
      min_confidence: 0.5,
    },
    ...overrides,
  };
}

export function claim(overrides: Partial<ClaimInput> = {}): Claim {
  return parseClaim(claimInput(overrides));
}

/** A claim with one field of `contact` replaced, which is where most refusals live. */
export function withContact(overrides: Partial<ClaimInput["contact"]>): ClaimInput {
  return claimInput({ contact: { ...claimInput().contact, ...overrides } });
}

/** The question as the app puts it, so no fixture can drift from the script. */
export function question(subject: Claim = claim()): string {
  return questionText(subject);
}

export const GREETING =
  "Hello, I am an automated assistant calling on behalf of Dana Whitfield. I am not a person.";
export const PICK_UP = "Northgate Credit Union, how can I help?";

/** Caller turns and callee turns, interleaved the way a real transcript arrives. */
export function turns(bot: string[], callee: string[]): TranscriptTurn[] {
  const output: TranscriptTurn[] = [];
  let offset = 0;
  for (let index = 0; index < Math.max(bot.length, callee.length); index += 1) {
    if (bot[index] !== undefined) {
      output.push({ offset_seconds: offset, speaker: "bot", text: bot[index]! });
      offset += 6;
    }
    if (callee[index] !== undefined) {
      output.push({ offset_seconds: offset, speaker: "user", text: callee[index]! });
      offset += 7;
    }
  }
  return output;
}

/** The question asked once, then answered. The shape every outcome test starts from. */
export function answered(answer: string, subject: Claim = claim()): TranscriptTurn[] {
  return turns([GREETING, question(subject)], [PICK_UP, answer]);
}

export interface SnapshotOptions {
  status?: string;
  turns?: TranscriptTurn[];
  structured?: Record<string, unknown> | null;
  confidence?: { score: number; label: string } | null;
  failureCode?: string | null;
  /** Unknown on purpose, because a provider can put anything in a JSON field. */
  completedAt?: unknown;
}

export function snapshot(options: SnapshotOptions = {}): CallSnapshot {
  const transcript = options.turns ?? answered("No, we have no record of contacting her today.");
  const structured = options.structured === undefined ? null : options.structured;
  const completedAt = (
    options.completedAt === undefined ? "2026-07-31T16:20:00Z" : options.completedAt
  ) as string | null;
  return {
    id: "call_test1",
    status: options.status ?? "completed",
    recipients: [
      {
        id: "rcp_1",
        phones: [TRUSTED],
        status: "completed",
        structuredResult: structured,
        summary: "Call finished.",
        attempts: [
          {
            id: "att_1",
            phone: TRUSTED,
            status: options.status ?? "completed",
            startedAt: "2026-07-31T16:19:00Z",
            completedAt,
            summary: null,
            transcriptTurns: transcript,
            providerCallId: "provider_1",
            failureCode: options.failureCode ?? null,
            failureMessage: null,
          },
        ],
      },
    ],
    structuredResult: structured,
    summary: "Call finished.",
    taskCompleted: true,
    completionConfidence: options.confidence === undefined ? { score: 0.92, label: "high" } : options.confidence,
    evidence: [],
    failureCode: options.failureCode ?? null,
    failureMessage: null,
    createdAt: "2026-07-31T16:18:00Z",
    completedAt,
  };
}
