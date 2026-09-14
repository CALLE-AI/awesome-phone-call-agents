import { isValidPhone, normalizePhone } from "./live-security.ts";

export type CallStage = "search" | "tour";
export type RecipientInput = { candidateId: string; phone: string };
export type VerifiedRecipient = {
  candidateId: string;
  status: string;
  structuredResult: Record<string, unknown> | null;
  summary: string | null;
};

type StoredBinding = { candidate_id: string; phone_fingerprint: string };
type CallSnapshot = {
  id: string;
  status: string;
  taskCompleted: boolean | null;
  metadata: Record<string, unknown>;
  recipients: Array<{ phones: string[]; status: string; structuredResult: Record<string, unknown> | null; summary: string | null }>;
};

function toHex(value: ArrayBuffer) {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function fingerprintPhone(phone: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(normalizePhone(phone))));
}

export async function buildRecipientBindings(recipients: RecipientInput[], secret: string): Promise<StoredBinding[]> {
  return Promise.all(recipients.map(async (recipient) => ({
    candidate_id: recipient.candidateId,
    phone_fingerprint: await fingerprintPhone(recipient.phone, secret),
  })));
}

function parseBindings(value: unknown): StoredBinding[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return null;
  const parsed: StoredBinding[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const binding = item as Record<string, unknown>;
    if (typeof binding.candidate_id !== "string" || !/^[a-z0-9-]{3,80}$/.test(binding.candidate_id)) return null;
    if (typeof binding.phone_fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(binding.phone_fingerprint)) return null;
    parsed.push({ candidate_id: binding.candidate_id, phone_fingerprint: binding.phone_fingerprint });
  }
  if (new Set(parsed.map((item) => item.candidate_id)).size !== parsed.length) return null;
  if (new Set(parsed.map((item) => item.phone_fingerprint)).size !== parsed.length) return null;
  return parsed;
}

export async function verifyCallBinding(
  call: CallSnapshot,
  expected: { callId: string; campaignId: string; operationId: string; stage: CallStage },
  secret: string,
): Promise<{ ok: true; recipients: VerifiedRecipient[] } | { ok: false; error: string }> {
  if (call.id !== expected.callId) return { ok: false, error: "call_id_mismatch" };
  if (call.metadata.product !== "tinyslot" || call.metadata.campaign_id !== expected.campaignId || call.metadata.operation_id !== expected.operationId || call.metadata.stage !== expected.stage) {
    return { ok: false, error: "call_metadata_mismatch" };
  }
  const bindings = parseBindings(call.metadata.recipient_bindings);
  if (!bindings || bindings.length !== call.recipients.length) return { ok: false, error: "recipient_binding_mismatch" };
  const byFingerprint = new Map(bindings.map((item) => [item.phone_fingerprint, item]));
  const seen = new Set<string>();
  const recipients: VerifiedRecipient[] = [];
  for (const recipient of call.recipients) {
    if (recipient.phones.length !== 1 || !isValidPhone(normalizePhone(recipient.phones[0] ?? ""))) return { ok: false, error: "recipient_phone_mismatch" };
    const fingerprint = await fingerprintPhone(recipient.phones[0], secret);
    const binding = byFingerprint.get(fingerprint);
    if (!binding || seen.has(fingerprint)) return { ok: false, error: "recipient_phone_mismatch" };
    if (call.status === "completed" && recipient.status !== "completed") return { ok: false, error: "recipient_not_completed" };
    seen.add(fingerprint);
    recipients.push({ candidateId: binding.candidate_id, status: recipient.status, structuredResult: recipient.structuredResult, summary: recipient.summary });
  }
  if (call.status === "completed" && call.taskCompleted !== true) return { ok: false, error: "call_task_not_completed" };
  return { ok: true, recipients };
}
