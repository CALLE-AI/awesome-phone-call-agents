import { randomUUID } from "crypto";

import { CalleClient } from "@call-e/calle";

import { maskPhoneNumber } from "@/lib/privacy";

// Lazily constructed, same pattern as lib/openrouter.ts's OpenAI client:
// avoid throwing at module load time just because CALLE_API_KEY is missing.
let calleClient: CalleClient | undefined;

function getCalleClient(): CalleClient {
  if (!calleClient) {
    const apiKey = process.env.CALLE_API_KEY;
    if (!apiKey) {
      throw new Error("CALLE_API_KEY environment variable is not set");
    }
    calleClient = new CalleClient({ apiKey });
  }
  return calleClient;
}

// Public deployments must leave this unset or "false". Real outbound CALL-E
// calls are only possible when an operator explicitly sets
// ALLOW_REAL_CALLS=true. Anything else forces fake/dry-run behavior, even
// if CALLE_DRY_RUN is "false" — so a publicly reachable demo cannot place
// real calls to arbitrary submitted numbers.
export const ALLOW_REAL_CALLS = process.env.ALLOW_REAL_CALLS === "true";

// Effective dry-run flag used everywhere we decide whether to call CALL-E.
// Forced on unless ALLOW_REAL_CALLS is exactly "true"; when real calls are
// allowed, this still defaults to true unless CALLE_DRY_RUN is the string
// "false".
export const CALLE_DRY_RUN =
  !ALLOW_REAL_CALLS || process.env.CALLE_DRY_RUN !== "false";

/**
 * True when a CALL-E result is good enough to apply side effects (email
 * decisions, reminder firing). Failed or ambiguous results must not be
 * treated as "still pending" — callers should mark them unresolved so the
 * next cron tick does not silently retry.
 */
export function isCalleResultResolved(call: {
  status: string;
  taskCompleted: boolean | null;
}): boolean {
  return call.status === "completed" && call.taskCompleted === true;
}

const URGENCY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

export interface DigestEmailInput {
  id: string;
  sender: string;
  subject: string;
  summary: string;
  category: string;
  urgency: string;
  dueDate: string | null;
}

export type DigestAction = "none" | "remind" | "followup";

export interface DigestDecision {
  emailId: string;
  action: DigestAction;
  // CALL-E's schema validator doesn't support nullable union types
  // (["string", "null"]), so these are declared as plain optional strings in
  // RESULT_SCHEMA below and the model omits them entirely when not
  // applicable — they may come back as `undefined` at runtime even though
  // dry-run results always set them explicitly to `null`.
  reminderDate?: string | null;
  followupInstruction?: string | null;
}

export interface DigestStructuredResult {
  decisions: DigestDecision[];
}

export interface DigestCallResult {
  id: string | null;
  status: string;
  taskCompleted: boolean | null;
  structuredResult: DigestStructuredResult | null;
  evidence: string[];
}

function sortByUrgency<T extends { urgency: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      (URGENCY_ORDER[a.urgency] ?? Number.MAX_SAFE_INTEGER) -
      (URGENCY_ORDER[b.urgency] ?? Number.MAX_SAFE_INTEGER)
  );
}

function buildTask(sortedEmails: DigestEmailInput[]): string {
  const todayIso = new Date().toISOString();

  const emailList = sortedEmails
    .map(
      (email, index) =>
        `${index + 1}. id: ${email.id}\n   sender: ${email.sender}\n   subject: ${email.subject}\n   summary: ${email.summary}\n   urgency: ${email.urgency}\n   dueDate: ${email.dueDate ?? "none"}`
    )
    .join("\n\n");

  const countAcknowledgement =
    sortedEmails.length === 1
      ? "there is 1 important email today"
      : `there are ${sortedEmails.length} important ones today`;

  return `Call the person and go through their important emails for today, one at a time, in this priority order. For each email, read the sender and a plain-language summary, then ask if they want to do anything about it: nothing, a reminder (and when), or a follow-up with the sender (and what to ask). Wait for their answer before moving to the next email. Be warm and unhurried, and acknowledge if there are many emails today ("${countAcknowledgement}, let's go through them"). Today's actual date is ${todayIso} — use this as the reference point for any relative time the person gives. If they say something relative like "in 2 days," "next week," "tomorrow," or "this Friday," calculate the actual calendar date from today's date and report that calculated date as reminderDate in ISO format (YYYY-MM-DD), not the relative phrase itself. Here are today's emails:\n\n${emailList}`;
}

const RESULT_SCHEMA = {
  type: "object",
  required: ["decisions"],
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        required: ["emailId", "action"],
        properties: {
          emailId: { type: "string" },
          action: {
            type: "string",
            enum: ["none", "remind", "followup"],
          },
          reminderDate: {
            type: "string",
            description:
              "ISO date string for the reminder, when action is 'remind'. Omit this field if not applicable.",
          },
          followupInstruction: {
            type: "string",
            description:
              "What to ask the sender about, when action is 'followup'. Omit this field if not applicable.",
          },
        },
      },
    },
  },
} as const;

/**
 * Builds plausible dummy decisions for CALLE_DRY_RUN so the rest of the
 * pipeline (callLogs + email status updates) can be exercised without
 * spending a real call.
 */
function buildFakeDecisions(
  sortedEmails: DigestEmailInput[]
): DigestDecision[] {
  return sortedEmails.map((email, index) => {
    if (index === 0) {
      return {
        emailId: email.id,
        action: "remind" as const,
        reminderDate:
          email.dueDate ??
          new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        followupInstruction: null,
      };
    }

    if (index === 1) {
      return {
        emailId: email.id,
        action: "followup" as const,
        reminderDate: null,
        followupInstruction: `Ask ${email.sender} for more detail about "${email.subject}".`,
      };
    }

    return {
      emailId: email.id,
      action: "none" as const,
      reminderDate: null,
      followupInstruction: null,
    };
  });
}

/**
 * Places (or simulates, if CALLE_DRY_RUN) a CALL-E call that walks the
 * recipient through their pending emails in priority order, capturing what
 * they want to do about each one.
 */
export async function runDigestCall(
  phoneNumber: string,
  emailsInput: DigestEmailInput[]
): Promise<DigestCallResult> {
  const sortedEmails = sortByUrgency(emailsInput);
  const task = buildTask(sortedEmails);

  if (CALLE_DRY_RUN) {
    console.log("[calle] dry-run digest call — not placing a real call", {
      phoneNumber: maskPhoneNumber(phoneNumber),
      emailCount: sortedEmails.length,
      schema: "digest-decisions",
      allowRealCalls: ALLOW_REAL_CALLS,
    });

    return {
      id: `dry-run-${randomUUID()}`,
      status: "completed",
      taskCompleted: true,
      structuredResult: { decisions: buildFakeDecisions(sortedEmails) },
      evidence: ["CALLE_DRY_RUN=true — no real call was placed."],
    };
  }

  const client = getCalleClient();

  console.log("[calle] placing digest call", {
    phoneNumber: maskPhoneNumber(phoneNumber),
    emailCount: sortedEmails.length,
  });

  const call = await client.calls.createAndWait({
    task,
    resultSchema: RESULT_SCHEMA,
    recipients: [{ phones: [phoneNumber] }],
  });

  const structuredResult =
    call.structuredResult as DigestStructuredResult | null;

  console.log("[calle] digest call finished", {
    callId: call.id,
    status: call.status,
    taskCompleted: call.taskCompleted,
    decisionCount: structuredResult?.decisions?.length ?? 0,
  });

  return {
    id: call.id,
    status: call.status,
    taskCompleted: call.taskCompleted,
    structuredResult,
    evidence: call.evidence,
  };
}

// --- Standalone reminder calls (short, single-email, used by cron's
// remindAt sweep — distinct from the multi-email digest call above). ---

export interface ReminderCallEmailInput {
  sender: string;
  subject: string;
  summary: string;
}

export interface ReminderCallResult {
  id: string | null;
  status: string;
  taskCompleted: boolean | null;
  acknowledged: boolean | null;
  evidence: string[];
}

const REMINDER_RESULT_SCHEMA = {
  type: "object",
  required: ["acknowledged"],
  properties: {
    acknowledged: {
      type: "boolean",
      description: "Whether the person acknowledged hearing the reminder.",
    },
  },
} as const;

function buildReminderTask(email: ReminderCallEmailInput): string {
  return `Call the person with a short, single-purpose reminder — this is not the full daily digest, just a quick nudge about one email. Say who it's from, give a one-sentence plain-language summary, and confirm they heard it. Sender: ${email.sender}. Subject: ${email.subject}. Summary: ${email.summary}. Keep the call brief and warm.`;
}

/**
 * Places (or simulates, if CALLE_DRY_RUN) a short single-email reminder
 * call — used when a scheduled reminder's remindAt time arrives (see
 * app/api/cron/route.ts), as opposed to the full multi-email digest call.
 */
export async function runReminderCall(
  phoneNumber: string,
  email: ReminderCallEmailInput
): Promise<ReminderCallResult> {
  const task = buildReminderTask(email);

  if (CALLE_DRY_RUN) {
    console.log("[calle] dry-run reminder call — not placing a real call", {
      phoneNumber: maskPhoneNumber(phoneNumber),
      schema: "reminder-acknowledged",
      allowRealCalls: ALLOW_REAL_CALLS,
    });

    return {
      id: `dry-run-${randomUUID()}`,
      status: "completed",
      taskCompleted: true,
      acknowledged: true,
      evidence: ["CALLE_DRY_RUN=true — no real call was placed."],
    };
  }

  const client = getCalleClient();

  console.log("[calle] placing reminder call", {
    phoneNumber: maskPhoneNumber(phoneNumber),
  });

  const call = await client.calls.createAndWait({
    task,
    resultSchema: REMINDER_RESULT_SCHEMA,
    recipients: [{ phones: [phoneNumber] }],
  });

  const structured = call.structuredResult as { acknowledged?: boolean } | null;

  console.log("[calle] reminder call finished", {
    callId: call.id,
    status: call.status,
    taskCompleted: call.taskCompleted,
    acknowledged: structured?.acknowledged ?? null,
  });

  return {
    id: call.id,
    status: call.status,
    taskCompleted: call.taskCompleted,
    acknowledged: structured?.acknowledged ?? null,
    evidence: call.evidence,
  };
}
