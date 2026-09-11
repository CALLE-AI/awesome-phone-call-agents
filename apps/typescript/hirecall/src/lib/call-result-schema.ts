export type YesNoUnclear = "yes" | "no" | "unclear";
export type GoodTime = "yes" | "callback" | "declined";
export type EndReason = "completed" | "no_answer" | "wrong_person" | "declined" | "failed";

export type ScreeningResult = {
  identity_confirmed: YesNoUnclear;
  good_time: GoodTime;
  education: string;
  projects: string;
  work_or_internship: string;
  off_script: string;
  end_reason: EndReason;
  recruiter_follow_up: string;
  callee_quote: string;
};

export function emptyScreeningResult(endReason: EndReason = "failed"): ScreeningResult {
  return {
    identity_confirmed: "unclear",
    good_time: "declined",
    education: "",
    projects: "",
    work_or_internship: "",
    off_script: "",
    end_reason: endReason,
    recruiter_follow_up: "",
    callee_quote: "",
  };
}

export const SCREENING_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "identity_confirmed",
    "good_time",
    "education",
    "projects",
    "work_or_internship",
    "off_script",
    "end_reason",
    "recruiter_follow_up",
    "callee_quote",
  ],
  properties: {
    identity_confirmed: {
      type: "string",
      enum: ["yes", "no", "unclear"],
      description: "Whether the person on the line is the named candidate.",
    },
    good_time: {
      type: "string",
      enum: ["yes", "callback", "declined"],
      description: "Whether they could take the screening now, asked to be called back, or declined.",
    },
    education: {
      type: "string",
      description: "What they said about education from the resume. Empty if not discussed.",
    },
    projects: {
      type: "string",
      description: "What they said about projects from the resume. Empty if not discussed.",
    },
    work_or_internship: {
      type: "string",
      description: "What they said about internships or work from the resume. Empty if not discussed.",
    },
    off_script: {
      type: "string",
      description: "Short note if they asked about salary, a human, or anything off-script. Empty otherwise.",
    },
    end_reason: {
      type: "string",
      enum: ["completed", "no_answer", "wrong_person", "declined", "failed"],
      description: "How the call ended.",
    },
    recruiter_follow_up: {
      type: "string",
      description: "One line the recruiter should know next.",
    },
    callee_quote: {
      type: "string",
      description: "One short quote the person actually said. Empty if none.",
    },
  },
} as const;

const YES_NO_UNCLEAR = new Set(["yes", "no", "unclear"]);
const GOOD_TIME = new Set(["yes", "callback", "declined"]);
const END_REASON = new Set(["completed", "no_answer", "wrong_person", "declined", "failed"]);

function asEnum<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T {
  const text = String(value ?? "").trim();
  return allowed.has(text) ? (text as T) : fallback;
}

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function parseScreeningResult(value: unknown): ScreeningResult | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return {
    identity_confirmed: asEnum<YesNoUnclear>(row.identity_confirmed, YES_NO_UNCLEAR, "unclear"),
    good_time: asEnum<GoodTime>(row.good_time, GOOD_TIME, "declined"),
    education: asText(row.education),
    projects: asText(row.projects),
    work_or_internship: asText(row.work_or_internship),
    off_script: asText(row.off_script),
    end_reason: asEnum<EndReason>(row.end_reason, END_REASON, "failed"),
    recruiter_follow_up: asText(row.recruiter_follow_up),
    callee_quote: asText(row.callee_quote),
  };
}
