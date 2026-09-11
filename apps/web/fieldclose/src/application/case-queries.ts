import { and, asc, desc, eq } from "drizzle-orm";

import { findWorkspaceAccess } from "@/application/workspaces";
import type { FieldCloseDatabase } from "@/persistence/database";
import {
  auditEvents,
  callApprovals,
  callAttempts,
  callResults,
  closeoutCases,
  contacts,
  followUpTasks,
  humanDispositions,
} from "@/persistence/schema";

export class CaseQueryError extends Error {
  constructor(
    public readonly code: "workspace_access_denied" | "case_not_found",
    message: string,
  ) {
    super(message);
    this.name = "CaseQueryError";
  }
}

export async function listCloseoutCases(
  db: FieldCloseDatabase,
  userId: string,
  workspaceId: string,
) {
  await requireWorkspaceAccess(db, userId, workspaceId);

  return db
    .select({
      id: closeoutCases.id,
      workspaceId: closeoutCases.workspaceId,
      version: closeoutCases.version,
      status: closeoutCases.status,
      workOrderRef: closeoutCases.workOrderRef,
      contractorDisplayName: closeoutCases.contractorDisplayName,
      siteLabel: closeoutCases.siteLabel,
      timezone: closeoutCases.timezone,
      contactRole: contacts.role,
      phoneMasked: contacts.phoneMasked,
      currentAttemptId: closeoutCases.currentAttemptId,
      providerTaskStatus: callAttempts.providerTaskStatus,
      attemptOutcome: callAttempts.attemptOutcome,
      creationDisposition: callAttempts.creationDisposition,
      createdAt: closeoutCases.createdAt,
      updatedAt: closeoutCases.updatedAt,
    })
    .from(closeoutCases)
    .innerJoin(
      contacts,
      and(
        eq(contacts.id, closeoutCases.contactId),
        eq(contacts.workspaceId, closeoutCases.workspaceId),
      ),
    )
    .leftJoin(callAttempts, eq(callAttempts.id, closeoutCases.currentAttemptId))
    .where(eq(closeoutCases.workspaceId, workspaceId))
    .orderBy(desc(closeoutCases.updatedAt), desc(closeoutCases.createdAt))
    .limit(100);
}

export async function getCloseoutCaseDetail(
  db: FieldCloseDatabase,
  userId: string,
  workspaceId: string,
  caseId: string,
) {
  await requireWorkspaceAccess(db, userId, workspaceId);

  const [closeoutCase] = await db
    .select({
      id: closeoutCases.id,
      workspaceId: closeoutCases.workspaceId,
      version: closeoutCases.version,
      status: closeoutCases.status,
      workOrderRef: closeoutCases.workOrderRef,
      contractorDisplayName: closeoutCases.contractorDisplayName,
      siteLabel: closeoutCases.siteLabel,
      timezone: closeoutCases.timezone,
      requestedFields: closeoutCases.requestedFields,
      visitContext: closeoutCases.visitContext,
      currentAttemptId: closeoutCases.currentAttemptId,
      createdBy: closeoutCases.createdBy,
      createdAt: closeoutCases.createdAt,
      updatedAt: closeoutCases.updatedAt,
      cancelledAt: closeoutCases.cancelledAt,
      contact: {
        id: contacts.id,
        displayName: contacts.displayName,
        role: contacts.role,
        phoneMasked: contacts.phoneMasked,
        authorizationBasis: contacts.authorizationBasis,
        authorizationNote: contacts.authorizationNote,
        doNotCallAt: contacts.doNotCallAt,
      },
    })
    .from(closeoutCases)
    .innerJoin(
      contacts,
      and(
        eq(contacts.id, closeoutCases.contactId),
        eq(contacts.workspaceId, closeoutCases.workspaceId),
      ),
    )
    .where(
      and(
        eq(closeoutCases.id, caseId),
        eq(closeoutCases.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!closeoutCase) {
    throw new CaseQueryError("case_not_found", "Case was not found");
  }

  const [attempt, result, tasks, disposition, audit] = await Promise.all([
    closeoutCase.currentAttemptId
      ? loadAttemptWithApproval(db, closeoutCase.currentAttemptId, caseId)
      : Promise.resolve(null),
    db
      .select({
        id: callResults.id,
        attemptId: callResults.attemptId,
        providerCallId: callResults.providerCallId,
        providerTaskStatus: callResults.providerTaskStatus,
        contactVerification: callResults.contactVerification,
        observedOperatingStatus: callResults.observedOperatingStatus,
        unresolvedIssue: callResults.unresolvedIssue,
        returnVisitRequested: callResults.returnVisitRequested,
        preferredWindows: callResults.preferredWindows,
        administrativeResults: callResults.administrativeResults,
        outOfScopeTopics: callResults.outOfScopeTopics,
        escalationReasons: callResults.escalationReasons,
        summary: callResults.summary,
        evidenceRefs: callResults.evidenceRefs,
        route: callResults.route,
        normalizerVersion: callResults.normalizerVersion,
        normalizedAt: callResults.normalizedAt,
      })
      .from(callResults)
      .where(eq(callResults.caseId, caseId))
      .orderBy(desc(callResults.normalizedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        id: followUpTasks.id,
        type: followUpTasks.type,
        reasonCodes: followUpTasks.reasonCodes,
        status: followUpTasks.status,
        assignedTo: followUpTasks.assignedTo,
        createdAt: followUpTasks.createdAt,
        resolvedAt: followUpTasks.resolvedAt,
        resolutionNote: followUpTasks.resolutionNote,
      })
      .from(followUpTasks)
      .where(eq(followUpTasks.caseId, caseId))
      .orderBy(desc(followUpTasks.createdAt)),
    db
      .select({
        id: humanDispositions.id,
        taskId: humanDispositions.taskId,
        outcome: humanDispositions.outcome,
        resolutionNote: humanDispositions.resolutionNote,
        recordedBy: humanDispositions.recordedBy,
        recordedAt: humanDispositions.recordedAt,
      })
      .from(humanDispositions)
      .where(eq(humanDispositions.caseId, caseId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        id: auditEvents.id,
        attemptId: auditEvents.attemptId,
        actorType: auditEvents.actorType,
        actorId: auditEvents.actorId,
        eventType: auditEvents.eventType,
        occurredAt: auditEvents.occurredAt,
        metadata: auditEvents.metadata,
      })
      .from(auditEvents)
      .where(eq(auditEvents.caseId, caseId))
      .orderBy(asc(auditEvents.occurredAt)),
  ]);

  return { case: closeoutCase, attempt, result, tasks, disposition, audit };
}

async function loadAttemptWithApproval(
  db: FieldCloseDatabase,
  attemptId: string,
  caseId: string,
) {
  const [attempt] = await db
    .select({
      id: callAttempts.id,
      caseId: callAttempts.caseId,
      mode: callAttempts.mode,
      provider: callAttempts.provider,
      providerCallId: callAttempts.providerCallId,
      providerTaskStatus: callAttempts.providerTaskStatus,
      attemptOutcome: callAttempts.attemptOutcome,
      creationDisposition: callAttempts.creationDisposition,
      requestedAt: callAttempts.requestedAt,
      acceptedAt: callAttempts.acceptedAt,
      connectedAt: callAttempts.connectedAt,
      endedAt: callAttempts.endedAt,
      lastCheckedAt: callAttempts.lastCheckedAt,
      errorCode: callAttempts.errorCode,
      createdAt: callAttempts.createdAt,
      updatedAt: callAttempts.updatedAt,
      approval: {
        id: callApprovals.id,
        caseVersion: callApprovals.caseVersion,
        approvedBy: callApprovals.approvedBy,
        approvedAt: callApprovals.approvedAt,
        briefHash: callApprovals.briefHash,
        liveCallApproved: callApprovals.liveCallApproved,
        callingWindow: callApprovals.callingWindow,
        operatorAttestations: callApprovals.operatorAttestations,
      },
    })
    .from(callAttempts)
    .leftJoin(callApprovals, eq(callApprovals.id, callAttempts.approvalId))
    .where(
      and(eq(callAttempts.id, attemptId), eq(callAttempts.caseId, caseId)),
    )
    .limit(1);

  return attempt ?? null;
}

async function requireWorkspaceAccess(
  db: FieldCloseDatabase,
  userId: string,
  workspaceId: string,
) {
  const access = await findWorkspaceAccess(db, userId, workspaceId);

  if (!access) {
    throw new CaseQueryError(
      "workspace_access_denied",
      "Workspace access is required",
    );
  }

  return access;
}
