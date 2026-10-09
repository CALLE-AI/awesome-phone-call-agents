import { z } from "zod";
import { buildCallTask } from "../domain/build-call-task";
import { computeRequestHash, idempotencyKeyFor, phoneFingerprint } from "../domain/fingerprint";
import { SCHEMA_VERSION, TASK_VERSION } from "../domain/schemas";
import { assertTransition } from "../domain/case-state";
import { livePolicyCheck } from "./live-policy";
import { BUYER_ORG_NAME } from "../fixtures/seed-data";
import {
  appendAudit,
  getActiveTrustedContact,
  getCase,
  getChangeRequest,
  getIntent,
  getPreviewExpiry,
  getUnresolvedIntentForCase,
  getVendor,
  insertIntent,
  nextIntentVersion,
  newId,
  setPreviewExpiry,
  updateCaseState,
  withTransaction,
  type Db,
} from "../infrastructure/db";
import type { CallIntent } from "../domain/types";

export const AUTHORIZATION_TTL_MS = 15 * 60 * 1000;

const authorizationSchema = z
  .object({
    caseId: z.string().min(1),
    typedPhrase: z.string().min(1),
    attestedConsentingContact: z.literal(true),
    preview: z.object({
      caseId: z.string().min(1),
      requestHash: z.string().min(1),
      expiresAt: z.string().min(1),
    }),
  })
  .strict();

export type ProviderMode = "replay" | "live";

export async function authorizeIntent(
  db: Db,
  raw: unknown,
  providerMode: ProviderMode = "replay",
): Promise<CallIntent> {
  const input = authorizationSchema.parse(raw);
  if (providerMode === "live" && process.env.CHANGELOCK_MODE !== "live") {
    throw new Error("live mode is not enabled on this server");
  }
  const kase = await getCase(db, input.caseId);
  if (!kase) throw new Error("case not found");
  if (kase.state !== "preview_ready") {
    throw new Error(`cannot authorize in state ${kase.state}`);
  }
  const previewExpiry = await getPreviewExpiry(db, kase.id);
  const nowMs = Date.now();
  if (
    !previewExpiry ||
    new Date(previewExpiry).getTime() <= nowMs ||
    new Date(input.preview.expiresAt).getTime() <= nowMs ||
    input.preview.caseId !== kase.id
  ) {
    assertTransition(kase.state, "needs_review");
    await updateCaseState(db, kase.id, "needs_review");
    await setPreviewExpiry(db, kase.id, null);
    throw new Error("preview missing or expired; regenerate before authorizing");
  }

  const request = await getChangeRequest(db, kase.changeRequestId);
  if (!request) throw new Error("change request missing");
  const contact = await getActiveTrustedContact(db, request.vendorId);
  if (!contact) throw new Error("no trusted contact on vendor record");
  if (providerMode === "live") {
    const policy = livePolicyCheck({
      phoneE164: contact.phoneE164,
      region: contact.region,
    });
    if (!policy.ok) throw new Error(policy.reason);
  }
  const vendor = await getVendor(db, request.vendorId);
  if (!vendor) throw new Error("vendor missing");

  const taskText = buildCallTask({
    vendorDisplayName: vendor.displayName,
    buyerOrgName: BUYER_ORG_NAME,
    safeCaseCode: kase.safeCaseCode,
  });
  const destinationFingerprint = phoneFingerprint(contact.phoneE164);
  const requestHash = computeRequestHash({
    caseId: kase.id,
    trustedContactId: contact.id,
    taskVersion: TASK_VERSION,
    schemaVersion: SCHEMA_VERSION,
    taskText,
    destinationFingerprint,
  });
  if (input.preview.requestHash !== requestHash) {
    throw new Error("preview is stale; regenerate before authorizing");
  }

  const expected = `VERIFY ${kase.safeCaseCode}`;
  if (input.typedPhrase !== expected) {
    throw new Error(`typed phrase must be exactly "${expected}"`);
  }
  if (await getUnresolvedIntentForCase(db, kase.id)) {
    throw new Error("an intent is already active for this case");
  }

  const version = await nextIntentVersion(db, kase.id);
  const intent: CallIntent = {
    id: newId("intent"),
    caseId: kase.id,
    version,
    trustedContactId: contact.id,
    taskVersion: TASK_VERSION,
    schemaVersion: SCHEMA_VERSION,
    taskText,
    requestHash,
    idempotencyKey: idempotencyKeyFor(`${requestHash}:v${version}`),
    destinationFingerprint,
    expiresAt: new Date(nowMs + AUTHORIZATION_TTL_MS).toISOString(),
    operatorAttestation: true,
    providerCallId: null,
    providerMode,
    status: "reserved",
    createdAt: new Date(nowMs).toISOString(),
  };

  await withTransaction(db, async (tx) => {
    assertTransition(kase.state, "dispatch_reserved");
    await insertIntent(tx, intent);
    await updateCaseState(tx, kase.id, "dispatch_reserved", intent.id);
    await appendAudit(tx, {
      caseId: kase.id,
      type: "intent.reserved",
      actor: "operator",
      payload: {
        intentId: intent.id,
        version: intent.version,
        requestHash: intent.requestHash,
        idempotencyKey: intent.idempotencyKey,
        expiresAt: intent.expiresAt,
        providerMode,
        typedPhraseMatch: true,
        attestedConsentingContact: true,
      },
    });
  });

  const saved = await getIntent(db, intent.id);
  return saved!;
}
