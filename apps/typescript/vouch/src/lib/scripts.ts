import type { TranscriptTurn } from "@caller-ai/core";

export type VouchScriptId = "hr_confirm" | "third_party";

export type VouchScript = {
  disposition: string;
  result: Record<string, unknown>;
  turns: TranscriptTurn[];
  evidence: string[];
  confidence: number;
};

const SCRIPTS: Record<VouchScriptId, VouchScript> = {
  hr_confirm: {
    disposition: "answered_confirmed",
    confidence: 0.91,
    result: {
      employment_confirmed: "yes",
      title_stated: "Operations Coordinator",
      start_date_stated: "March 2022",
      end_date_stated: "still current",
      eligible_for_rehire: "policy_no_comment",
      verifier_name: "Priya Shah",
      verifier_role: "HR generalist",
      verifier_authority: "yes",
      refusal_reason: "none",
    },
    evidence: [
      "HR confirmed current employment and title, and declined to comment on rehire eligibility as policy.",
    ],
    turns: [
      {
        offset_seconds: 0,
        speaker: "bot",
        text: "This is an automated verification assistant acting for Harbor Lane Staffing. I am calling to verify employment for Alex Rivera, who gave written authorization.",
      },
      {
        offset_seconds: 9,
        speaker: "user",
        text: "This is Priya Shah, HR generalist. Yes, I am authorized to confirm employment.",
      },
      {
        offset_seconds: 16,
        speaker: "bot",
        text: "Is Alex Rivera employed there, and in what title? When did they start?",
      },
      {
        offset_seconds: 22,
        speaker: "user",
        text: "Yes, Alex Rivera is employed here as Operations Coordinator, started March 2022, still current.",
      },
      {
        offset_seconds: 31,
        speaker: "bot",
        text: "Are they eligible for rehire?",
      },
      {
        offset_seconds: 34,
        speaker: "user",
        text: "We don't comment on rehire eligibility as a matter of policy.",
      },
    ],
  },
  third_party: {
    disposition: "gatekeeper_refused",
    confidence: 0.93,
    result: {
      employment_confirmed: "unknown",
      title_stated: null,
      start_date_stated: null,
      end_date_stated: null,
      eligible_for_rehire: "unknown",
      verifier_name: "Desk attendant",
      verifier_role: "receptionist",
      verifier_authority: "no",
      refusal_reason: "third_party_only",
    },
    evidence: [
      "A receptionist said employment verification is only handled through a third-party service and refused to transfer.",
    ],
    turns: [
      {
        offset_seconds: 0,
        speaker: "bot",
        text: "This is an automated verification assistant. I am calling to verify employment for a candidate who gave written authorization.",
      },
      {
        offset_seconds: 8,
        speaker: "user",
        text: "We only verify through a third-party service. I can't transfer you to HR.",
      },
      {
        offset_seconds: 14,
        speaker: "bot",
        text: "Understood. I will record that verification is handled only through a third-party service and end the call.",
      },
    ],
  },
};

export function loadVouchScript(id: string): VouchScript {
  return SCRIPTS[(id as VouchScriptId) in SCRIPTS ? (id as VouchScriptId) : "hr_confirm"];
}