import { z } from "zod";
import {
  appendAudit,
  getCaseByRequestId,
  getChangeRequestByExternalEventId,
  getVendorByCode,
  insertCase,
  insertChangeRequest,
  newId,
  now,
  type Db,
} from "../infrastructure/db";
import { changeFingerprint, generateSafeCaseCode } from "../domain/fingerprint";
import { isE164, maskPhone } from "../domain/redact";
import type { ChangeRequest, VerificationCase } from "../domain/types";

const erpEventSchema = z
  .object({
    externalEventId: z.string().min(1).max(128),
    vendorCode: z.string().min(1).max(64),
    requestedAt: z.string().min(4).max(64),
    sourceSystem: z.string().min(1).max(64),
    sourceReference: z.string().min(1).max(128),
    requestContactName: z.string().min(1).max(120),
    requestContactPhone: z.string().min(1).max(64),
    newDestinationLabel: z.string().min(1).max(120),
  })
  .strict();

export interface ImportResult {
  changeRequest: ChangeRequest;
  verificationCase: VerificationCase;
  duplicate: boolean;
}

export function importChangeRequest(db: Db, raw: unknown): ImportResult {
  const event = erpEventSchema.parse(raw);
  const vendor = getVendorByCode(db, event.vendorCode);
  if (!vendor || vendor.status !== "active") {
    throw new Error("unknown or inactive vendor code");
  }

  const existing = getChangeRequestByExternalEventId(db, event.externalEventId);
  if (existing) {
    const verificationCase = getCaseByRequestId(db, existing.id);
    if (!verificationCase) throw new Error("orphaned change request");
    return { changeRequest: existing, verificationCase, duplicate: true };
  }

  const request: ChangeRequest = {
    id: newId("cr"),
    externalEventId: event.externalEventId,
    vendorId: vendor.id,
    requestedAt: event.requestedAt,
    sourceSystem: event.sourceSystem,
    sourceReference: event.sourceReference,
    requestContactName: event.requestContactName,
    requestContactPhoneMasked: isE164(event.requestContactPhone)
      ? maskPhone(event.requestContactPhone)
      : "(not a phone number)",
    newDestinationLabel: event.newDestinationLabel,
    changeFingerprint: changeFingerprint({
      vendorId: vendor.id,
      destinationDescriptor: event.newDestinationLabel,
    }),
    status: "held",
  };
  const verificationCase: VerificationCase = {
    id: newId("case"),
    changeRequestId: request.id,
    state: "needs_review",
    safeCaseCode: generateSafeCaseCode(),
    currentIntentId: null,
    createdAt: now(),
    updatedAt: now(),
  };

  db.transaction(() => {
    insertChangeRequest(db, request);
    insertCase(db, verificationCase);
    appendAudit(db, {
      caseId: verificationCase.id,
      type: "change_request.imported",
      actor: "erp_import",
      payload: {
        externalEventId: event.externalEventId,
        vendorCode: vendor.vendorCode,
        sourceSystem: event.sourceSystem,
        sourceReference: event.sourceReference,
        requestContactPhone: request.requestContactPhoneMasked,
        requestContactTrusted: false,
        changeFingerprint: request.changeFingerprint,
        status: "held",
      },
    });
    appendAudit(db, {
      caseId: verificationCase.id,
      type: "case.created",
      actor: "system",
      payload: { safeCaseCode: verificationCase.safeCaseCode, state: "needs_review" },
    });
  })();

  return { changeRequest: request, verificationCase, duplicate: false };
}
