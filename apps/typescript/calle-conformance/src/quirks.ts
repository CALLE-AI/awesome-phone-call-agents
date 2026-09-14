/**
 * The quirk manifest.
 *
 * Each entry is a behaviour observed in a real CALL-E response that a fake
 * server written from the documentation would not reproduce. A quirk is a
 * predicate over a payload, so the same definition serves three purposes: it
 * labels the corpus, it proves the masking did not destroy what the fixture is
 * for, and it scores a fake server against reality.
 *
 * Adding a quirk means adding a predicate, not prose.
 */

export type CallPayload = {
  id: string;
  object: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  taskCompleted: boolean;
  failureCode: string | null;
  structuredResult: unknown;
  evidence?: string[] | null;
  recipients: Array<{
    id: string;
    phones: string[];
    region: string;
    locale: string;
    status: string;
    structuredResult: Record<string, unknown> | null;
    summary: string | null;
    attempts: Array<{
      id: string;
      phone: string;
      status: string;
      startedAt: string;
      completedAt: string;
      providerCallId: string | null;
      failureCode: string | null;
      failureMessage: string | null;
      transcriptTurns: Array<{ speaker: string; text: string; offset_seconds: number | null }>;
    }>;
  }>;
};

export type Quirk = {
  id: string;
  title: string;
  /** What breaks in caller code that assumes the documented shape. */
  consequence: string;
  holds: (call: CallPayload) => boolean;
};

/**
 * These predicates run over payloads from other codebases, which arrive with
 * fields missing, so every accessor below tolerates absence. A predicate that
 * throws on an unfamiliar payload is not a predicate, it is a crash.
 */
const recipientsOf = (c: CallPayload) => (Array.isArray(c?.recipients) ? c.recipients : []);
const attemptsOf = (c: CallPayload) =>
  recipientsOf(c).flatMap((r) => (Array.isArray(r?.attempts) ? r.attempts : []));
const turnsOf = (a: { transcriptTurns?: unknown }) =>
  Array.isArray(a?.transcriptTurns) ? a.transcriptTurns : [];
const hasZone = (s: unknown) => typeof s === "string" && /(?:Z|[+-]\d{2}:?\d{2})$/.test(s);
const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

export const QUIRKS: Quirk[] = [
  {
    id: "failed-attempt-timestamp-has-no-zone",
    title: "On a failed attempt, startedAt carries no timezone designator while createdAt does",
    consequence:
      "A parser reads the string as local time. Every duration and retry decision derived from it is wrong by the reader's own offset plus the platform's.",
    holds: (c) =>
      attemptsOf(c).some((a) => a.failureCode != null && a.startedAt != null && !hasZone(a.startedAt)) &&
      hasZone(c.createdAt),
  },
  {
    id: "failed-attempt-timestamp-lags-four-hours",
    title: "On a failed attempt, startedAt is about four hours behind createdAt",
    consequence:
      "An attempt appears to have started before the call it belongs to was created, so ordering by startedAt scrambles the timeline.",
    holds: (c) =>
      attemptsOf(c).some((a) => {
        if (a.failureCode == null || a.startedAt == null || c.createdAt == null) return false;
        const started = new Date(hasZone(a.startedAt) ? a.startedAt : `${a.startedAt}Z`).getTime();
        const created = new Date(c.createdAt).getTime();
        const hours = (started - created) / 3_600_000;
        return hours < -3 && hours > -5;
      }),
  },
  {
    id: "raw-sip-code-as-failure-code",
    title: "attempt.failureCode carries a bare SIP status number, outside the documented enum",
    consequence:
      "Code branching on the documented failure codes falls through to its default branch for every real failure.",
    holds: (c) => attemptsOf(c).some((a) => typeof a.failureCode === "string" && /^\d{3}$/.test(a.failureCode)),
  },
  {
    id: "structured-result-without-conversation",
    title: "structuredResult is populated on an attempt with zero transcript turns",
    consequence:
      "A caller reading structuredResult first records an answer from a person who was never reached.",
    holds: (c) =>
      recipientsOf(c).some((r) => {
        const attempts = Array.isArray(r?.attempts) ? r.attempts : [];
        return (
          isObject(r?.structuredResult) &&
          Object.keys(r.structuredResult).length > 0 &&
          attempts.length > 0 &&
          attempts.every((a) => turnsOf(a).length === 0)
        );
      }),
  },
  {
    id: "summary-suggests-retry-for-unreachable-destination",
    title: "The summary proposes a retry window for a destination that cannot be reached at all",
    consequence:
      "An automated retry loop keeps dialling a number that will never connect, spending quota on every pass.",
    holds: (c) =>
      recipientsOf(c).some((r) => {
        const attempts = Array.isArray(r?.attempts) ? r.attempts : [];
        return (
          typeof r?.summary === "string" &&
          /retry|retrying/i.test(r.summary) &&
          attempts.length > 0 &&
          attempts.every((a) => turnsOf(a).length === 0)
        );
      }),
  },
  {
    id: "single-attempt-reported",
    title: "The recipient reports exactly one attempt for a call the carrier logged as many dials",
    consequence:
      "Dial volume, and anything metered by it, cannot be derived from the API response.",
    holds: (c) => recipientsOf(c).some((r) => Array.isArray(r?.attempts) && r.attempts.length === 1 && r.attempts[0]?.failureCode != null),
  },
  {
    id: "connected-call-timestamps-are-well-formed",
    title: "On a call that connected, startedAt carries Z and agrees with createdAt",
    consequence:
      "This is the control. A fake that formats every timestamp the same way cannot reproduce the split between the success and failure paths.",
    holds: (c) =>
      attemptsOf(c).some(
        (a) => a.failureCode == null && hasZone(a.startedAt) && turnsOf(a).length > 0,
      ),
  },
  {
    id: "recipient-speaks-after-the-agent-stops",
    title: "The transcript continues after the agent's last turn",
    consequence:
      "Reading the answer as the turn that follows the question can take a fragment the recipient was still speaking, while the real answer arrives after the agent has already said goodbye.",
    holds: (c) =>
      attemptsOf(c).some((a) => {
        const turns = turnsOf(a) as Array<{ speaker?: unknown }>;
        const last = turns.map((t) => t?.speaker).lastIndexOf("bot");
        return last !== -1 && turns.slice(last + 1).some((t) => t?.speaker === "user");
      }),
  },
];

/** Which quirks a payload exhibits. */
export function quirksIn(call: CallPayload): string[] {
  return QUIRKS.filter((q) => {
    try {
      return q.holds(call);
    } catch {
      return false;
    }
  }).map((q) => q.id);
}
