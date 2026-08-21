export const ROLES = [
  "site_supervisor",
  "ready_mix_dispatch",
  "pump_operator",
  "testing_coordinator",
] as const;

export type ContactRole = (typeof ROLES)[number];
export type Region = "AU" | "SG";
export type DisplayCallStatus =
  | "queued"
  | "calling"
  | "completed"
  | "failed"
  | "incomplete";

export const ROLE_LABELS: Record<ContactRole, string> = {
  site_supervisor: "Site supervisor",
  ready_mix_dispatch: "Ready-mix dispatch",
  pump_operator: "Pump operator",
  testing_coordinator: "Testing coordinator",
};

export const REGION_CONFIG: Record<
  Region,
  { locale: string; timezone: string; phonePrefix: string }
> = {
  AU: {
    locale: "en-AU",
    timezone: "Australia/Sydney",
    phonePrefix: "+61",
  },
  SG: {
    locale: "en-SG",
    timezone: "Asia/Singapore",
    phonePrefix: "+65",
  },
};

export type CoordinationResult = {
  contact_outcome:
    | "reached"
    | "voicemail"
    | "wrong_contact"
    | "no_answer"
    | "unknown";
  commitment: "confirmed" | "conditional" | "declined" | "unknown";
  schedule_alignment: "matched" | "conflict" | "unknown";
  scope_alignment: "matched" | "conflict" | "not_applicable" | "unknown";
  reported_time: string;
  blocker: string;
  evidence_summary: string;
};

export type PourPlan = {
  companyName: string;
  projectName: string;
  location: string;
  scheduledDate: string;
  scheduledTime: string;
  volumeM3: string;
  mixReference: string;
  region: Region;
};

export type ContactInput = {
  role: ContactRole;
  name: string;
  phone: string;
};

export type LiveRunInput = {
  runId: string;
  liveConfirmed: true;
  plan: PourPlan;
  contacts: ContactInput[];
};

export type CompletionConfidence = {
  score: number;
  label: string;
} | null;

export type TranscriptTurn = {
  offsetSeconds: number;
  speaker: "bot" | "user" | "unknown";
  text: string;
};

export type CallSnapshot = {
  role: ContactRole;
  callId?: string;
  maskedPhone: string;
  status: DisplayCallStatus;
  result: CoordinationResult | null;
  taskCompleted: boolean | null;
  completionConfidence: CompletionConfidence;
  evidence: string[];
  transcriptTurns: TranscriptTurn[];
  failureCode?: string;
};

export type HumanDecision = {
  choice: "proceed" | "hold";
  at: string;
};

export type ReconciliationState = "aligned" | "conflict" | "incomplete";

export type Reconciliation = {
  state: ReconciliationState;
  headline: string;
  detail: string;
  conflicts: string[];
  incompleteRoles: ContactRole[];
};

const RESULT_KEYS = [
  "contact_outcome",
  "commitment",
  "schedule_alignment",
  "scope_alignment",
  "reported_time",
  "blocker",
  "evidence_summary",
] as const;

const ENUMS = {
  contact_outcome: [
    "reached",
    "voicemail",
    "wrong_contact",
    "no_answer",
    "unknown",
  ],
  commitment: ["confirmed", "conditional", "declined", "unknown"],
  schedule_alignment: ["matched", "conflict", "unknown"],
  scope_alignment: ["matched", "conflict", "not_applicable", "unknown"],
} as const;

export function isRole(value: unknown): value is ContactRole {
  return typeof value === "string" && ROLES.includes(value as ContactRole);
}

export function parseCoordinationResult(
  value: unknown,
): CoordinationResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  if (
    Object.keys(object).length !== RESULT_KEYS.length ||
    !RESULT_KEYS.every((key) => key in object)
  ) {
    return null;
  }

  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (
      typeof object[key] !== "string" ||
      !(allowed as readonly string[]).includes(object[key] as string)
    ) {
      return null;
    }
  }

  if (
    typeof object.reported_time !== "string" ||
    typeof object.blocker !== "string" ||
    typeof object.evidence_summary !== "string"
  ) {
    return null;
  }

  const parsed = object as CoordinationResult;
  if (
    parsed.contact_outcome !== "reached" &&
    (parsed.commitment !== "unknown" ||
      parsed.schedule_alignment !== "unknown" ||
      parsed.scope_alignment !== "unknown")
  ) {
    return null;
  }
  if (!parsed.evidence_summary.trim()) return null;
  if (
    parsed.schedule_alignment === "conflict" &&
    !parsed.reported_time.trim() &&
    !parsed.blocker.trim()
  ) {
    return null;
  }
  return parsed;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : "••••";
}

export function redactText(text: string): string {
  return text
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[redacted phone]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 360);
}
