import { createHash, timingSafeEqual } from "node:crypto";
import type { FailedVisitCase, VisitWindow } from "./case.js";

export const ALLOWED_QUESTIONS = [
  "Is the side gate now unlocked for the technician?",
  "Will the dog be securely contained for the whole visit?",
  "Has the obstruction at the meter been removed?",
  "Can an adult be present if the visit requires access through the property?",
  "Which one of the approved visit windows works?",
  "Do you want us to stop automated calls about this case?",
] as const;

export interface CallPreviewContent {
  caseSnapshot: FailedVisitCase;
  recipient: {
    role: "AUTHORIZED_SERVICE_CONTACT";
    phoneE164: string;
  };
  objective: string;
  allowedQuestions: readonly string[];
  visitWindows: VisitWindow[];
  guardrails: readonly string[];
}

export interface CallPreview {
  content: CallPreviewContent;
  digest: string;
}

export interface ApprovalReceipt {
  previewDigest: string;
  approvedAt: string;
  approvedBy: string;
  statement: "I approve this exact single-call preview";
}

export function createCallPreview(failedVisit: FailedVisitCase): CallPreview {
  const content: CallPreviewContent = {
    caseSnapshot: structuredClone(failedVisit),
    recipient: {
      role: failedVisit.recipient.role,
      phoneE164: failedVisit.recipient.phoneE164,
    },
    objective: "Confirm only whether the documented access blockers are resolved and select one approved visit window for human rebook review.",
    allowedQuestions: [...ALLOWED_QUESTIONS],
    visitWindows: structuredClone(failedVisit.visitWindows),
    guardrails: [
      "Do not collect names, addresses, account numbers, gate or security codes, passwords, banking or payment data, medical data, photos, or free-form personal narratives.",
      "Do not diagnose technical conditions, promise a booking, or contact another person.",
      "Use DO_NOT_CONTACT only when the recipient explicitly asks to stop automated calls; then stop asking questions.",
      "For DO_NOT_CONTACT or UNREACHED, record UNKNOWN for every access answer and NONE for the visit window.",
      "Record only the closed structured result schema supplied in the call goal.",
    ],
  };
  return { content, digest: digestPreviewContent(content) };
}

export function createApprovalReceipt(preview: CallPreview, approvedBy: string, now: Date): ApprovalReceipt {
  if (approvedBy.trim().length === 0) throw new Error("approvedBy is required");
  return {
    previewDigest: preview.digest,
    approvedAt: now.toISOString(),
    approvedBy: approvedBy.trim(),
    statement: "I approve this exact single-call preview",
  };
}

export function isApprovalValid(receipt: ApprovalReceipt, currentPreview: CallPreview): boolean {
  if (receipt.statement !== "I approve this exact single-call preview") return false;
  if (!/\S/.test(receipt.approvedBy) || !Number.isFinite(Date.parse(receipt.approvedAt))) return false;
  const approved = Buffer.from(receipt.previewDigest, "hex");
  const current = Buffer.from(currentPreview.digest, "hex");
  return approved.length === current.length && approved.length === 32 && timingSafeEqual(approved, current);
}

export function digestPreviewContent(content: CallPreviewContent): string {
  return createHash("sha256").update(canonicalJson(content)).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const objectValue = value as Record<string, unknown>;
  return `{${Object.keys(objectValue).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(objectValue[key])}`).join(",")}}`;
}
