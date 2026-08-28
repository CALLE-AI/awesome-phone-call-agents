import type { ScreeningResult } from "@/lib/call-result-schema";
import { maskE164InText, maskPhone } from "@/lib/phone";
import type { CallResponse, Candidate } from "@/lib/types";

function publicResult(result: ScreeningResult | null): ScreeningResult | null {
  if (!result) return null;
  return {
    ...result,
    education: maskE164InText(result.education),
    projects: maskE164InText(result.projects),
    work_or_internship: maskE164InText(result.work_or_internship),
    off_script: maskE164InText(result.off_script),
    recruiter_follow_up: maskE164InText(result.recruiter_follow_up),
    callee_quote: maskE164InText(result.callee_quote),
  };
}

function publicCallResponse(response: CallResponse | null): CallResponse | null {
  if (!response) return null;
  return {
    ...response,
    result: publicResult(response.result),
  };
}

export function publicCandidate(row: Candidate): Candidate {
  return {
    ...row,
    phone: maskPhone(row.phone),
    resumeText: maskE164InText(row.resumeText),
    callPrompt: maskE164InText(row.callPrompt),
    callResponse: publicCallResponse(row.callResponse),
  };
}

export function publicPayload<T>(payload: T): T {
  return maskUnknown(payload) as T;
}

function isCandidateShape(value: Record<string, unknown>): boolean {
  return (
    typeof value.phone === "string" &&
    typeof value.name === "string" &&
    typeof value.id === "string" &&
    "callStatus" in value
  );
}

function maskUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskUnknown);
  if (typeof value === "string") return maskE164InText(value);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (isCandidateShape(record)) {
    return publicCandidate(record as unknown as Candidate);
  }
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(record)) {
    if (key === "raw" || key === "raw_json") continue;
    out[key] = maskUnknown(nested);
  }
  return out;
}
