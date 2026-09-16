import { isValidPhone, normalizePhone } from "./live-call-security.ts";

export type CallStage = "readiness" | "resolution";

export type ExpectedCallBinding = {
  callId: string;
  eventId: string;
  stage: CallStage;
  operationId: string;
};

export type RecipientBindingInput = {
  vendorId: string;
  phone: string;
};

export type CallRecipientSnapshot = {
  phones: string[];
  status: string;
  structuredResult: Record<string, unknown> | null;
  summary: string | null;
};

export type CallSnapshot = {
  id: string;
  status: string;
  taskCompleted: boolean | null;
  metadata: Record<string, unknown>;
  recipients: CallRecipientSnapshot[];
};

export type VerifiedRecipient = {
  vendorId: string;
  status: string;
  structuredResult: Record<string, unknown> | null;
  summary: string | null;
};

type StoredRecipientBinding = {
  vendor_id: string;
  phone_fingerprint: string;
};

type VerificationResult =
  | { ok: true; recipients: VerifiedRecipient[] }
  | { ok: false; error: string };

const vendorIdPattern = /^[a-z0-9-]{3,80}$/;
const fingerprintPattern = /^[a-f0-9]{64}$/;

function toHex(value: ArrayBuffer) {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function fingerprintPhone(phone: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(
    await crypto.subtle.sign("HMAC", key, encoder.encode(normalizePhone(phone))),
  );
}

export async function buildRecipientBindings(
  recipients: RecipientBindingInput[],
  secret: string,
): Promise<StoredRecipientBinding[]> {
  return Promise.all(
    recipients.map(async (recipient) => ({
      vendor_id: recipient.vendorId,
      phone_fingerprint: await fingerprintPhone(recipient.phone, secret),
    })),
  );
}

function parseStoredBindings(value: unknown): StoredRecipientBinding[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) return null;
  const bindings: StoredRecipientBinding[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.vendor_id !== "string" ||
      !vendorIdPattern.test(candidate.vendor_id) ||
      typeof candidate.phone_fingerprint !== "string" ||
      !fingerprintPattern.test(candidate.phone_fingerprint)
    ) {
      return null;
    }
    bindings.push({
      vendor_id: candidate.vendor_id,
      phone_fingerprint: candidate.phone_fingerprint,
    });
  }
  if (
    new Set(bindings.map((binding) => binding.vendor_id)).size !== bindings.length ||
    new Set(bindings.map((binding) => binding.phone_fingerprint)).size !== bindings.length
  ) {
    return null;
  }
  return bindings;
}

export async function verifyCallBinding(
  call: CallSnapshot,
  expected: ExpectedCallBinding,
  secret: string,
): Promise<VerificationResult> {
  if (call.id !== expected.callId) return { ok: false, error: "call_id_mismatch" };
  if (
    call.metadata.product !== "readyline" ||
    call.metadata.event_id !== expected.eventId ||
    call.metadata.stage !== expected.stage ||
    call.metadata.operation_id !== expected.operationId
  ) {
    return { ok: false, error: "call_metadata_mismatch" };
  }

  const bindings = parseStoredBindings(call.metadata.recipient_bindings);
  if (!bindings || call.recipients.length !== bindings.length) {
    return { ok: false, error: "recipient_binding_mismatch" };
  }

  const bindingByFingerprint = new Map(
    bindings.map((binding) => [binding.phone_fingerprint, binding]),
  );
  const matchedFingerprints = new Set<string>();
  const recipients: VerifiedRecipient[] = [];

  for (const recipient of call.recipients) {
    if (
      !Array.isArray(recipient.phones) ||
      recipient.phones.length !== 1 ||
      !isValidPhone(normalizePhone(recipient.phones[0] ?? ""))
    ) {
      return { ok: false, error: "recipient_phone_mismatch" };
    }
    const phoneFingerprint = await fingerprintPhone(recipient.phones[0], secret);
    const binding = bindingByFingerprint.get(phoneFingerprint);
    if (!binding || matchedFingerprints.has(phoneFingerprint)) {
      return { ok: false, error: "recipient_phone_mismatch" };
    }
    if (call.status === "completed" && recipient.status !== "completed") {
      return { ok: false, error: "recipient_not_completed" };
    }
    matchedFingerprints.add(phoneFingerprint);
    recipients.push({
      vendorId: binding.vendor_id,
      status: recipient.status,
      structuredResult: recipient.structuredResult,
      summary: recipient.summary,
    });
  }

  if (matchedFingerprints.size !== bindings.length) {
    return { ok: false, error: "recipient_binding_mismatch" };
  }
  if (call.status === "completed" && call.taskCompleted !== true) {
    return { ok: false, error: "call_task_not_completed" };
  }

  return { ok: true, recipients };
}
