import { loadFixture } from "@caller-ai/sim/fixtures";
import type { PersonaId } from "@caller-ai/sim/types";
import type { TranscriptTurn } from "@caller-ai/core/evidence";

export type CallScript = {
  disposition: string;
  result: Record<string, unknown>;
  turns: TranscriptTurn[];
  evidence: string[];
  confidence: number;
};

const LOCAL: Record<string, CallScript> = {
  no_answer: {
    disposition: "no_answer",
    result: {
      safety_status: "unknown",
      evacuation: "unknown",
      has_power: "unknown",
      has_water: "unknown",
      medication: "unknown",
      household: "unknown",
      needs_human: "unknown",
    },
    evidence: ["The line rang out. No one answered."],
    confidence: 0.95,
    turns: [
      {
        offset_seconds: 0,
        speaker: "bot",
        text: "This is an automated AI assistant from Sonoma County Emergency Management.",
      },
      {
        offset_seconds: 24,
        speaker: "bot",
        text: "No answer. Ending this attempt. Voicemail was not available.",
      },
    ],
  },
  invalid_number: {
    disposition: "invalid_number",
    result: {
      safety_status: "unknown",
      evacuation: "unknown",
      has_power: "unknown",
      has_water: "unknown",
      medication: "unknown",
      household: "unknown",
      needs_human: "unknown",
    },
    evidence: ["The carrier reported the number as invalid."],
    confidence: 0.99,
    turns: [
      {
        offset_seconds: 0,
        speaker: "bot",
        text: "This is an automated AI assistant from Sonoma County Emergency Management.",
      },
      {
        offset_seconds: 3,
        speaker: "bot",
        text: "The number is not in service. Recording as invalid.",
      },
    ],
  },
  evacuated: {
    disposition: "answered_confirmed",
    result: {
      safety_status: "safe",
      evacuation: "evacuated",
      has_power: "unknown",
      has_water: "yes",
      medication: "none_needed",
      household: "all_accounted",
      needs_human: "no",
    },
    evidence: ["The household evacuated and everyone is accounted for."],
    confidence: 0.9,
    turns: [
      {
        offset_seconds: 0,
        speaker: "bot",
        text: "This is an automated AI assistant from Sonoma County Emergency Management. This is a safety and needs check.",
      },
      { offset_seconds: 8, speaker: "user", text: "We already left." },
      { offset_seconds: 11, speaker: "bot", text: "Is everyone in the household safe and accounted for?" },
      { offset_seconds: 15, speaker: "user", text: "Yes, everyone is safe. We evacuated this morning." },
      { offset_seconds: 20, speaker: "bot", text: "Do you have running water where you are? Any medication you cannot get?" },
      { offset_seconds: 26, speaker: "user", text: "Water is fine. Nobody needs medication. We're okay." },
    ],
  },
  medication: {
    disposition: "answered_confirmed",
    result: {
      safety_status: "safe",
      evacuation: "sheltering_in_place",
      has_power: "yes",
      has_water: "yes",
      medication: "running_low",
      household: "all_accounted",
      needs_human: "no",
    },
    evidence: ["The household is safe but running low on prescription medication."],
    confidence: 0.86,
    turns: [
      {
        offset_seconds: 0,
        speaker: "bot",
        text: "This is an automated AI assistant from Sonoma County Emergency Management.",
      },
      { offset_seconds: 7, speaker: "user", text: "Hi." },
      { offset_seconds: 9, speaker: "bot", text: "Is everyone in the household safe and accounted for?" },
      { offset_seconds: 13, speaker: "user", text: "Yes, everyone is here and safe. Sheltering in place." },
      { offset_seconds: 18, speaker: "bot", text: "Do you have electricity right now? Running water?" },
      { offset_seconds: 22, speaker: "user", text: "We have electricity and running water." },
      { offset_seconds: 26, speaker: "bot", text: "Does anyone need prescription medication you cannot get?" },
      { offset_seconds: 31, speaker: "user", text: "We are running low on a prescription. Not out yet. We're okay otherwise." },
    ],
  },
};

export type ScriptId = PersonaId | keyof typeof LOCAL;

export const ROSTER_SCRIPTS: Record<string, ScriptId> = {
  rst_01: "cooperative",
  rst_02: "voicemail",
  rst_03: "partial",
  rst_04: "emergency",
  rst_05: "wrong_person",
  rst_06: "hostile",
  rst_07: "unsupported_claim",
  rst_08: "no_answer",
  rst_09: "evacuated",
  rst_10: "voicemail",
  rst_11: "invalid_number",
  rst_12: "medication",
};

export function loadCallScript(id: ScriptId): CallScript {
  const local = LOCAL[id];
  if (local) return local;
  const fixture = loadFixture(id as PersonaId);
  return {
    disposition: fixture.disposition,
    result: fixture.recipient_structured_result,
    turns: fixture.transcript_turns,
    evidence: fixture.evidence,
    confidence: fixture.completion_confidence.score,
  };
}

export function scriptForWaveTwo(previous: ScriptId): ScriptId {
  if (previous === "voicemail" || previous === "no_answer") return "cooperative";
  return previous;
}
