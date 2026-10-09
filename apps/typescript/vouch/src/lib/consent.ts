export type ConsentRow = {
  id: string;
  candidateName: string;
  employer: string;
  employerId: string;
  jurisdiction: string;
  requestedJson: string;
  consentFieldsJson: string;
  signedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  requestingOrg: string;
  employerCode: string;
  phoneMasked: string;
  scriptId: string;
};

export type ConsentReason = "missing" | "revoked" | "expired";

export type ConsentBlock = { ok: true } | { ok: false; reason: ConsentReason };

export function consentGate(consent: ConsentRow | null | undefined, today = new Date().toISOString().slice(0, 10)): ConsentBlock {
  if (!consent) return { ok: false, reason: "missing" };
  if (consent.revokedAt) return { ok: false, reason: "revoked" };
  if (consent.expiresAt < today) return { ok: false, reason: "expired" };
  return { ok: true };
}

export function blockCopy(reason: ConsentReason | undefined) {
  if (reason === "missing") return "No consent artifact on file. No dial.";
  if (reason === "revoked") return "Consent was revoked. No override.";
  if (reason === "expired") return "Consent expired. No override.";
  return "Consent is not valid. No dial.";
}