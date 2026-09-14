import { maskPhone } from "../../domain/redact";
import type { CaseState } from "../../domain/types";
import {
  getAuditEvents,
  getCase,
  getChangeRequest,
  getIntent,
  getSnapshotsForIntent,
  getTrustedContact,
  listChangeRequests,
  type Db,
} from "../../infrastructure/db";
import { buildCallTask } from "../../domain/build-call-task";
import { BUYER_ORG_NAME, SEED_EVENTS } from "../../fixtures/seed-data";
import { SCHEMA_VERSION, TASK_VERSION } from "../../domain/schemas";

export interface InboxRow {
  caseId: string;
  safeCaseCode: string;
  vendorName: string;
  vendorCode: string;
  requestedAt: string;
  sourceReference: string;
  state: CaseState;
  requestPhoneMasked: string;
  newDestinationLabel: string;
}

export function listInbox(db: Db): InboxRow[] {
  return listChangeRequests(db).map((r) => {
    const vendor = db
      .prepare("SELECT vendor_code FROM vendors WHERE id = ?")
      .get(r.vendorId) as { vendor_code: string };
    return {
      caseId: r.caseId,
      safeCaseCode: r.safeCaseCode,
      vendorName: r.vendorName,
      vendorCode: vendor.vendor_code,
      requestedAt: r.requestedAt,
      sourceReference: r.sourceReference,
      state: r.caseState,
      requestPhoneMasked: r.requestContactPhoneMasked,
      newDestinationLabel: r.newDestinationLabel,
    };
  });
}

export interface CaseDetail {
  caseId: string;
  safeCaseCode: string;
  state: CaseState;
  createdAt: string;
  vendor: { displayName: string; vendorCode: string };
  request: {
    externalEventId: string;
    requestedAt: string;
    sourceSystem: string;
    sourceReference: string;
    contactName: string;
    contactPhoneMasked: string;
    newDestinationLabel: string;
    status: "held";
  };
  trustedContact: {
    name: string;
    role: string;
    maskedPhone: string;
    source: string;
    verifiedAt: string;
  } | null;
  taskText: string;
  taskVersion: string;
  schemaVersion: string;
  suggestedScenario: string | null;
  intents: {
    id: string;
    version: number;
    status: string;
    providerCallId: string | null;
    providerMode: string;
    expiresAt: string;
    snapshots: {
      providerStatus: string;
      confidenceScore: number | null;
      structuredResult: Record<string, string> | null;
      evidence: string[];
      receivedAt: string;
      verificationMode: string;
    }[];
  }[];
  audit: {
    type: string;
    actor: string;
    createdAt: string;
    payload: Record<string, unknown>;
    eventHash: string;
  }[];
}

export function getCaseDetail(db: Db, caseId: string): CaseDetail | null {
  const kase = getCase(db, caseId);
  if (!kase) return null;
  const request = getChangeRequest(db, kase.changeRequestId);
  if (!request) return null;
  const vendor = db
    .prepare("SELECT display_name, vendor_code FROM vendors WHERE id = ?")
    .get(request.vendorId) as { display_name: string; vendor_code: string };
  const contact = db
    .prepare("SELECT id FROM trusted_contacts WHERE vendor_id = ? AND active = 1")
    .get(request.vendorId) as { id: string } | undefined;
  const trusted = contact ? getTrustedContact(db, contact.id) : null;

  const intentRows = db
    .prepare("SELECT id FROM call_intents WHERE case_id = ? ORDER BY version")
    .all(kase.id) as { id: string }[];

  return {
    caseId: kase.id,
    safeCaseCode: kase.safeCaseCode,
    state: kase.state,
    createdAt: kase.createdAt,
    vendor: { displayName: vendor.display_name, vendorCode: vendor.vendor_code },
    request: {
      externalEventId: request.externalEventId,
      requestedAt: request.requestedAt,
      sourceSystem: request.sourceSystem,
      sourceReference: request.sourceReference,
      contactName: request.requestContactName,
      contactPhoneMasked: request.requestContactPhoneMasked,
      newDestinationLabel: request.newDestinationLabel,
      status: request.status,
    },
    trustedContact: trusted
      ? {
          name: trusted.name,
          role: trusted.role,
          maskedPhone: maskPhone(trusted.phoneE164),
          source: trusted.source,
          verifiedAt: trusted.verifiedAt,
        }
      : null,
    taskText: buildCallTask({
      vendorDisplayName: vendor.display_name,
      buyerOrgName: BUYER_ORG_NAME,
      safeCaseCode: kase.safeCaseCode,
    }),
    taskVersion: TASK_VERSION,
    schemaVersion: SCHEMA_VERSION,
    suggestedScenario:
      SEED_EVENTS.find((e) => e.externalEventId === request.externalEventId)?.scenario ?? null,
    intents: intentRows.map((r) => {
      const intent = getIntent(db, r.id)!;
      return {
        id: intent.id,
        version: intent.version,
        status: intent.status,
        providerCallId: intent.providerCallId,
        providerMode: intent.providerMode,
        expiresAt: intent.expiresAt,
        snapshots: getSnapshotsForIntent(db, intent.id).map((s) => ({
          providerStatus: s.providerStatus,
          confidenceScore: s.confidenceScore,
          structuredResult: s.structuredResultJson
            ? (JSON.parse(s.structuredResultJson) as Record<string, string>)
            : null,
          evidence: JSON.parse(s.evidenceJson) as string[],
          receivedAt: s.receivedAt,
          verificationMode: s.verificationMode,
        })),
      };
    }),
    audit: getAuditEvents(db, kase.id).map((e) => ({
      type: e.type,
      actor: e.actor,
      createdAt: e.createdAt,
      payload: JSON.parse(e.safePayloadJson) as Record<string, unknown>,
      eventHash: e.eventHash,
    })),
  };
}
