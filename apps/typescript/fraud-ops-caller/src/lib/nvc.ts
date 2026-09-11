import type { Disposition, FraudOpsCase, Intent } from "./types";

/** NVC four-part frame: Observation → Feeling → Need → Request */
export type NvcFrame = {
  observation: string;
  feeling: string;
  need: string;
  request: string;
};

export type NvcState =
  | "intake"
  | "deescalation"
  | "deep_validation"
  | "solution_mapping"
  | "execution"
  | "resolution_close";

export type SlaRow = {
  disposition: string;
  followUpHours: number;
  sentimentCheck: boolean;
  advocateOnHandoff: boolean;
};

/** Forbidden coercive / blame / policy-speak tokens (case-insensitive whole-ish phrases). */
export const FORBIDDEN_PHRASES = [
  "you failed to",
  "you missed your payment",
  "it is company policy",
  "company policy",
  "you must",
  "you are required",
  "as per our terms",
  "pay now or else",
  "or we will suspend",
  "account suspension",
  "being difficult",
  "please refrain from",
  "foul language",
  "profanity is not",
  "maintain professional language",
  "speak to me that way",
  "i won't help you if",
  "watch your language",
] as const;

export const PREFERRED_OPENERS = [
  "our records show",
  "our system shows",
  "i notice",
  "i recognize",
  "i know",
  "we want to ensure",
  "would you be open",
] as const;

/** Follow-up SLA by open disposition (hours from call end). */
export const SLA_MATRIX: Record<Intent, SlaRow[]> = {
  collections: [
    { disposition: "ptp", followUpHours: 24, sentimentCheck: false, advocateOnHandoff: false },
    { disposition: "handoff", followUpHours: 4, sentimentCheck: true, advocateOnHandoff: true },
    { disposition: "refuse", followUpHours: 48, sentimentCheck: false, advocateOnHandoff: false },
  ],
  kyc_chase: [
    { disposition: "uploading_now", followUpHours: 24, sentimentCheck: false, advocateOnHandoff: false },
    { disposition: "callback", followUpHours: 4, sentimentCheck: false, advocateOnHandoff: false },
    { disposition: "confused", followUpHours: 8, sentimentCheck: true, advocateOnHandoff: false },
    { disposition: "handoff", followUpHours: 4, sentimentCheck: true, advocateOnHandoff: true },
  ],
  merchant_outreach: [
    { disposition: "docs_promised", followUpHours: 24, sentimentCheck: false, advocateOnHandoff: false },
    { disposition: "reached", followUpHours: 48, sentimentCheck: false, advocateOnHandoff: false },
    { disposition: "handoff", followUpHours: 4, sentimentCheck: true, advocateOnHandoff: true },
  ],
  evidence_collection: [
    { disposition: "will_upload", followUpHours: 24, sentimentCheck: false, advocateOnHandoff: false },
    { disposition: "statement_taken", followUpHours: 48, sentimentCheck: true, advocateOnHandoff: false },
    { disposition: "unsafe_escalate", followUpHours: 1, sentimentCheck: true, advocateOnHandoff: true },
    { disposition: "handoff", followUpHours: 2, sentimentCheck: true, advocateOnHandoff: true },
  ],
};

export function scanForbiddenLanguage(text: string): string[] {
  const lower = text.toLowerCase();
  return FORBIDDEN_PHRASES.filter((p) => lower.includes(p));
}

export function assertNvcSafe(text: string): void {
  const hits = scanForbiddenLanguage(text);
  if (hits.length) {
    throw new Error(`NVC guardrail blocked phrasing: ${hits.join(", ")}`);
  }
}

export function nextNvcState(
  current: NvcState,
  signal: "accept" | "resist" | "anger" | "hostility" | "execute" | "close"
): NvcState {
  if (current === "intake") return "deescalation";
  if (current === "deescalation") {
    if (signal === "resist" || signal === "anger" || signal === "hostility") return "deep_validation";
    if (signal === "accept") return "solution_mapping";
    return current;
  }
  if (current === "deep_validation") {
    if (signal === "accept") return "solution_mapping";
    if (signal === "resist" || signal === "anger" || signal === "hostility") return "deep_validation";
    return current;
  }
  if (current === "solution_mapping") {
    if (signal === "execute") return "execution";
    if (signal === "resist" || signal === "anger") return "deep_validation";
    return current;
  }
  if (current === "execution") {
    if (signal === "close") return "resolution_close";
    return current;
  }
  return current;
}

/** After two consecutive resists/anger → senior specialist (implementation checklist #2). */
export function shouldHandoffAfterRejects(rejectCount: number): boolean {
  return rejectCount >= 2;
}

export function slaFor(
  intent: Intent,
  disposition: Disposition | string
): SlaRow | null {
  const rows = SLA_MATRIX[intent] ?? [];
  return rows.find((r) => r.disposition === disposition) ?? null;
}

export function followUpAtIso(endedAt: string, hours: number): string {
  const t = new Date(endedAt);
  t.setUTCHours(t.getUTCHours() + hours);
  return t.toISOString();
}

export function nvcFrameForCase(fraudCase: FraudOpsCase): NvcFrame {
  const amount =
    fraudCase.context.amount_due !== undefined && fraudCase.context.currency
      ? `${fraudCase.context.currency} ${fraudCase.context.amount_due}`
      : null;

  if (fraudCase.intent === "collections") {
    return {
      observation: amount
        ? `Our records show ${amount} that has not cleared yet${
            fraudCase.context.days_late
              ? ` (${fraudCase.context.days_late} days past the scheduled date)`
              : ""
          }.`
        : `Our records show a scheduled payment that has not cleared yet.`,
      feeling:
        "I recognize that money timing can create real stress, and none of that says anything about your character.",
      need: "We want to keep your account stable and find a plan that is actually doable for you.",
      request:
        "Would you be open to a short promise-to-pay date, a split plan, or a temporary pause — whichever feels sustainable?",
    };
  }

  if (fraudCase.intent === "evidence_collection" || fraudCase.safety_sensitive) {
    const incident =
      fraudCase.incident_summary_plain ??
      fraudCase.reason_plain ??
      "this case";
    return {
      observation: `I am taking this report about ${incident} extremely seriously, and I am the point of contact for this call.`,
      feeling:
        "I know how unsettling it is when safety or trust feels uncertain.",
      need: "Your protection and peace of mind come first — we will not rush past that.",
      request:
        "Would it help if I send your own secure evidence link, or would you rather I connect you to a specialist advocate right now?",
    };
  }

  if (fraudCase.intent === "kyc_chase") {
    const docs = (fraudCase.context.missing_docs ?? []).join(" and ") || "documents";
    return {
      observation: `Our system shows ${docs} still needed to finish verification — no judgment on why.`,
      feeling: "I know document chasing is friction you did not ask for.",
      need: "We want your account review to stay on track without collecting card numbers or full ID digits on this call.",
      request:
        "Would you be open to using the secure upload link now, or picking a callback time that works better?",
    };
  }

  // merchant_outreach
  return {
    observation: `I am calling about a review on ${
      fraudCase.context.merchant_name ?? "your merchant account"
    } — this is fact-finding, not an accusation.`,
    feeling: "I recognize reviews can feel disruptive to operations.",
    need: "We want continuity for your account while gathering what the case needs.",
    request:
      "Would you be open to uploading the requested statements via the secure link, or naming a better authorized contact?",
  };
}

/** CALL-E agent task text — NVC system + domain blueprint. */
export function buildCalleTaskPrompt(fraudCase: FraudOpsCase): string {
  const frame = nvcFrameForCase(fraudCase);
  const domain =
    fraudCase.intent === "collections"
      ? "Collections (collaborative recovery)"
      : fraudCase.intent === "evidence_collection" || fraudCase.safety_sensitive
        ? "Safety / evidence (containment & trust)"
        : fraudCase.intent === "kyc_chase"
          ? "KYC chase (document continuity)"
          : "Merchant outreach (review, not guilt)";

  return [
    "# Role",
    "You are Fraud Ops Caller on CALL-E. Priority: de-escalation, dignity, co-created solutions.",
    "",
    "# NVC Directive (every spoken turn)",
    "1. OBSERVE — objective facts only; no moralizing.",
    "2. FEEL — name stress/friction without diagnosing character.",
    "3. NEED — shared positive outcome (stability, safety, continuity).",
    "4. REQUEST — open, non-coercive next step (\"Would you be open to…\").",
    "",
    "# Forbidden",
    "Never say: blame framing, policy-speak, mandatory tone, contractual obligation quotes, threats, invented fees, PAN/CVV/full national ID on call.",
    "",
    `# Domain: ${domain}`,
    `Case: ${fraudCase.case_id}`,
    `Reason: ${fraudCase.reason_plain}`,
    "",
    "# Opening blueprint (adapt, keep O-F-N-R order)",
    `Observation: ${frame.observation}`,
    `Feeling: ${frame.feeling}`,
    `Need: ${frame.need}`,
    `Request: ${frame.request}`,
    "",
    "# State machine",
    "intake → deescalation → (resist/anger/hostility → deep_validation) → solution_mapping → execution → resolution_close.",
    "On hostile tone or swearing: NEVER scold or police language.",
    "Use Absorb → Separate → Pivot → Bound (de-escalation override).",
    "Strike 1 hostility: absorb + separate worth from delivery + pivot to need + binary low-friction request.",
    "Strike 2 continued hostility after reset: dignified handoff (assign_human_spoc) — stop debating.",
    "Two consecutive rejects of options → warm handoff to a senior specialist with full history (never force re-tell).",
    "Safety: ongoing harm → stop probing → unsafe_escalate / human immediately.",
    "",
    "# Tools (narrate only — do not claim a core-system write)",
    `Allowed: ${toolsForIntentLocal(fraudCase).join(", ")}.`,
    "On strike-2 hostility or two consecutive rejects: assign_human_spoc. Spoken: senior specialist.",
    "Safety / ongoing harm: execute_emergency_containment then assign_human_spoc. Stop probing.",
    "Collections hardship choice: generate_hardship_plan (pause / split / PTP). Never invent fees.",
    "Never make them re-tell; fetch_previous_context is already on the case.",
    "",
    "# Close",
    "Confirm they feel heard; set follow-up SLA on open dispositions; do not invent root-cause claims.",
  ].join("\n");
}

export function formatNvcOpening(fraudCase: FraudOpsCase): string {
  const f = nvcFrameForCase(fraudCase);
  const text = `${f.observation} ${f.feeling} ${f.need} ${f.request}`;
  assertNvcSafe(text);
  return text;
}


// --- Hostility: Absorb → Separate → Pivot → Bound ---

/** Lightweight hostility / foul-language detector (symptom of distress, not a lecture cue). */
const HOSTILITY_RE =
  /\b(fuck|fucking|shit|bullshit|asshole|idiot|stupid|useless|harassing|scam|hate you)\b|!\s*$/i;

export type HostilityHit = {
  hostile: boolean;
  deescalationOverride: boolean;
  matched: string[];
};

export function detectHostility(userUtterance: string): HostilityHit {
  const matched: string[] = [];
  const re = new RegExp(HOSTILITY_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(userUtterance)) !== null) {
    matched.push(m[0].toLowerCase());
  }
  const hostile = matched.length > 0;
  return { hostile, deescalationOverride: hostile, matched };
}

export type DeescalationTurn = {
  absorb: string;
  separate: string;
  pivot: string;
  bound: string;
  /** Spoken turn: Absorb+Separate+Pivot+Bound without scolding. */
  spoken: string;
};

/** Strike 1 spoken reply — never lecture about language. */
export function buildHostilityDeescalation(
  fraudCase: FraudOpsCase
): DeescalationTurn {
  if (fraudCase.intent === "collections") {
    const absorb =
      "I can hear how much stress and anger this is causing, and I don't blame you for being upset.";
    const separate =
      "You've had a real headache here, and things clearly have not gone the way they should have.";
    const pivot =
      "My priority right now is to take collections pressure off and find something doable — not to corner you.";
    const bound =
      "Would you prefer a zero-fee pause so you can catch your breath, or should I connect you to a senior specialist right now?";
    const spoken = `${absorb} ${separate} ${pivot} ${bound}`;
    assertNvcSafe(spoken);
    return { absorb, separate, pivot, bound, spoken };
  }

  if (fraudCase.intent === "evidence_collection" || fraudCase.safety_sensitive) {
    const absorb =
      "I hear how furious this feels, and I am taking your safety concern extremely seriously.";
    const separate =
      "Being locked out or left unprotected when you need help most is a massive disruption — that frustration is valid.";
    const pivot =
      "Your protection comes first. I am not going to argue about tone; I am going to contain this.";
    const bound =
      "I can freeze the affected path and stay with you, or connect you to a specialist advocate immediately — which helps more right now?";
    const spoken = `${absorb} ${separate} ${pivot} ${bound}`;
    assertNvcSafe(spoken);
    return { absorb, separate, pivot, bound, spoken };
  }

  const absorb =
    "I can hear how frustrated you are, and I am not going to lecture you about it.";
  const separate =
    "You have been dealing with friction you did not ask for, and that is enough without a power struggle.";
  const pivot =
    "My job is to fix the blocked need — access, clarity, or a senior specialist who can decide.";
  const bound =
    "Would you like me to take the next concrete step on this case now, or connect you to a senior specialist?";
  const spoken = `${absorb} ${separate} ${pivot} ${bound}`;
  assertNvcSafe(spoken);
  return { absorb, separate, pivot, bound, spoken };
}

/** Strike 2 — dignified handoff; stop debating. */
export const HOSTILITY_HANDOFF_SCRIPT =
  "I can see I am not bringing the resolution you need through this channel, and I want you taken care of properly. I am transferring you to a senior specialist who can act on this immediately — please hold a moment.";

export type HostilityTurnResult = {
  strike: 1 | 2;
  deescalationOverride: true;
  handoff: boolean;
  spoken: string;
  handoffReason?: string;
  nvcState: NvcState;
};

/**
 * Two-strike rule:
 * Strike 1 → Absorb/Separate/Pivot/Bound NVC reset + low-friction choice.
 * Strike 2 (continued hostility after reset) → assign_human_spoc / handoff.
 */
export function handleHostilityTurn(
  fraudCase: FraudOpsCase,
  userUtterance: string,
  priorHostilityStrikes: number
): HostilityTurnResult | null {
  const hit = detectHostility(userUtterance);
  if (!hit.hostile) return null;

  const nextStrike = (priorHostilityStrikes + 1) as 1 | 2 | number;
  if (nextStrike >= 2) {
    assertNvcSafe(HOSTILITY_HANDOFF_SCRIPT);
    return {
      strike: 2,
      deescalationOverride: true,
      handoff: true,
      spoken: HOSTILITY_HANDOFF_SCRIPT,
      handoffReason: "hostility_two_strike",
      nvcState: "resolution_close",
    };
  }

  const turn = buildHostilityDeescalation(fraudCase);
  return {
    strike: 1,
    deescalationOverride: true,
    handoff: false,
    spoken: turn.spoken,
    nvcState: "deep_validation",
  };
}

function toolsForIntentLocal(fraudCase: FraudOpsCase): string[] {
  if (fraudCase.intent === "collections") {
    return ["check_payment_eligibility", "generate_hardship_plan", "assign_human_spoc"];
  }
  if (fraudCase.intent === "evidence_collection" || fraudCase.safety_sensitive) {
    return ["execute_emergency_containment", "assign_human_spoc"];
  }
  return ["fetch_previous_context", "assign_human_spoc"];
}
