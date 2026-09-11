import type { SourcingCallPlan } from "./contracts.ts";

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function keyFor(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signApproval(plan: SourcingCallPlan, secret: string): Promise<string> {
  if (secret.length < 24) throw new Error("The approval secret must be at least 24 characters.");
  const browserSafePlan: SourcingCallPlan = {
    ...plan,
    request: {
      ...plan.request,
      suppliers: plan.request.suppliers.map((supplier) => ({ ...supplier, phone: "[server-held]" })),
    },
  };
  const payload = toBase64Url(encoder.encode(JSON.stringify(browserSafePlan)));
  const signature = await crypto.subtle.sign("HMAC", await keyFor(secret), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyApproval(token: string, secret: string, now = new Date()): Promise<SourcingCallPlan> {
  const [payload, encodedSignature, extra] = token.split(".");
  if (!payload || !encodedSignature || extra) throw new Error("The approval token is invalid.");
  const valid = await crypto.subtle.verify(
    "HMAC",
    await keyFor(secret),
    fromBase64Url(encodedSignature),
    encoder.encode(payload),
  );
  if (!valid) throw new Error("The approval token is invalid.");

  const plan = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as SourcingCallPlan;
  if (!plan.id || !plan.expiresAt || new Date(plan.expiresAt).getTime() <= now.getTime()) {
    throw new Error("The call plan has expired. Review a new plan before calling.");
  }
  return plan;
}

export async function approvalFingerprint(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return toBase64Url(new Uint8Array(digest)).slice(0, 32);
}
