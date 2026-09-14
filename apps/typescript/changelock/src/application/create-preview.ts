import { buildCallTask } from "../domain/build-call-task";
import { computeRequestHash, idempotencyKeyFor, phoneFingerprint } from "../domain/fingerprint";
import { maskPhone } from "../domain/redact";
import {
  recipientResultSchema,
  SCHEMA_VERSION,
  TASK_VERSION,
} from "../domain/schemas";
import { assertTransition } from "../domain/case-state";
import { BUYER_ORG_NAME } from "../fixtures/seed-data";
import {
  appendAudit,
  getActiveTrustedContact,
  getCase,
  getChangeRequest,
  getVendorByCode,
  setPreviewExpiry,
  updateCaseState,
  type Db,
} from "../infrastructure/db";

export interface CallPreview {
  caseId: string;
  vendorName: string;
  trustedContactName: string;
  trustedContactRole: string;
  trustedContactSource: string;
  trustedContactVerifiedAt: string;
  maskedDestination: string;
  taskText: string;
  taskVersion: string;
  schemaVersion: string;
  recipientResultSchema: typeof recipientResultSchema;
  requestHash: string;
  idempotencyKey: string;
  expiresAt: string;
}

const PREVIEW_TTL_MS = 30 * 60 * 1000;

export function createPreview(db: Db, caseId: string): CallPreview {
  const kase = getCase(db, caseId);
  if (!kase) throw new Error("case not found");
  if (kase.state !== "needs_review" && kase.state !== "preview_ready") {
    throw new Error(`cannot preview in state ${kase.state}`);
  }
  const request = getChangeRequest(db, kase.changeRequestId);
  if (!request) throw new Error("change request missing");
  const vendor = db
    .prepare("SELECT vendor_code FROM vendors WHERE id = ?")
    .get(request.vendorId) as { vendor_code: string } | undefined;
  if (!vendor) throw new Error("vendor missing");
  const vendorRow = getVendorByCode(db, vendor.vendor_code);
  const contact = getActiveTrustedContact(db, request.vendorId);
  if (!contact) throw new Error("no trusted contact on vendor record");

  const taskText = buildCallTask({
    vendorDisplayName: vendorRow!.displayName,
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
  const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS).toISOString();

  db.transaction(() => {
    if (kase.state === "needs_review") {
      assertTransition(kase.state, "preview_ready");
      updateCaseState(db, kase.id, "preview_ready");
    }
    setPreviewExpiry(db, kase.id, expiresAt);
    appendAudit(db, {
      caseId: kase.id,
      type: "preview.created",
      actor: "operator",
      payload: {
        maskedDestination: maskPhone(contact.phoneE164),
        trustedContactId: contact.id,
        trustedContactSource: contact.source,
        requestHash,
        idempotencyKey: idempotencyKeyFor(requestHash),
        expiresAt,
        taskVersion: TASK_VERSION,
        schemaVersion: SCHEMA_VERSION,
      },
    });
  })();

  return {
    caseId: kase.id,
    vendorName: vendorRow!.displayName,
    trustedContactName: contact.name,
    trustedContactRole: contact.role,
    trustedContactSource: contact.source,
    trustedContactVerifiedAt: contact.verifiedAt,
    maskedDestination: maskPhone(contact.phoneE164),
    taskText,
    taskVersion: TASK_VERSION,
    schemaVersion: SCHEMA_VERSION,
    recipientResultSchema,
    requestHash,
    idempotencyKey: idempotencyKeyFor(requestHash),
    expiresAt,
  };
}
