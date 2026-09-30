import { maskPhone } from "../../domain/redact";
import type { CaseState } from "../../domain/types";
import {
  getActiveTrustedContact,
  getAuditEvents,
  getCase,
  getChangeRequest,
  getSnapshotsForIntent,
  getVendor,
  listChangeRequests,
  listIntentsForCase,
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

export async function listInbox(db: Db): Promise<InboxRow[]> {
  const rows = await listChangeRequests(db);
  const result: InboxRow[] = [];
  for (const r of rows) {
    const vendor = await getVendor(db, r.vendorId);
    if (!vendor) throw new Error("vendor missing for inbox row");
    result.push({
      caseId: r.caseId,
      safeCaseCode: r.safeCaseCode,
      vendorName: r.vendorName,
      vendorCode: vendor.vendorCode,
      requestedAt: r.requestedAt,
      sourceReference: r.sourceReference,
      state: r.caseState,
      requestPhoneMasked: r.requestContactPhoneMasked,
      newDestinationLabel: r.newDestinationLabel,
    });
  }
  return result;
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

export async function getCaseDetail(db: Db, caseId: string): Promise<CaseDetail | null> {
  const kase = await getCase(db, caseId);
  if (!kase) return null;
  const request = await getChangeRequest(db, kase.changeRequestId);
  if (!request) return null;
  const vendor = await getVendor(db, request.vendorId);
  if (!vendor) return null;
  const trusted = await getActiveTrustedContact(db, request.vendorId);
  const intents = await listIntentsForCase(db, kase.id);
  const audit = await getAuditEvents(db, kase.id);

  const intentDetails = [];
  for (const intent of intents) {
    const snapshots = await getSnapshotsForIntent(db, intent.id);
    intentDetails.push({
      id: intent.id,
      version: intent.version,
      status: intent.status,
      providerCallId: intent.providerCallId,
      providerMode: intent.providerMode,
      expiresAt: intent.expiresAt,
      snapshots: snapshots.map((s) => ({
        providerStatus: s.providerStatus,
        confidenceScore: s.confidenceScore,
        structuredResult: s.structuredResultJson
          ? (JSON.parse(s.structuredResultJson) as Record<string, string>)
          : null,
        evidence: JSON.parse(s.evidenceJson) as string[],
        receivedAt: s.receivedAt,
        verificationMode: s.verificationMode,
      })),
    });
  }

  return {
    caseId: kase.id,
    safeCaseCode: kase.safeCaseCode,
    state: kase.state,
    createdAt: kase.createdAt,
    vendor: { displayName: vendor.displayName, vendorCode: vendor.vendorCode },
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
      vendorDisplayName: vendor.displayName,
      buyerOrgName: BUYER_ORG_NAME,
      safeCaseCode: kase.safeCaseCode,
    }),
    taskVersion: TASK_VERSION,
    schemaVersion: SCHEMA_VERSION,
    suggestedScenario:
      SEED_EVENTS.find((e) => e.externalEventId === request.externalEventId)?.scenario ?? null,
    intents: intentDetails,
    audit: audit.map((e) => ({
      type: e.type,
      actor: e.actor,
      createdAt: e.createdAt,
      payload: JSON.parse(e.safePayloadJson) as Record<string, unknown>,
      eventHash: e.eventHash,
    })),
  };
}
