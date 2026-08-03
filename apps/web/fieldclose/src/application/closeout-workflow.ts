import { createHash, randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { normalizeProviderSnapshot } from "@/application/result-normalizer";
import { findWorkspaceAccess } from "@/application/workspaces";
import { e164PhoneSchema } from "@/domain/phone-number";
import type { FieldCloseDatabase } from "@/persistence/database";
import {
  auditEvents,
  callApprovals,
  callAttempts,
  callResults,
  closeoutCases,
  contacts,
  followUpTasks,
  workspaceMemberships,
  workspaces,
} from "@/persistence/schema";
import type {
  ApprovedCallBrief,
  CallProvider,
  ProviderCallSnapshot,
} from "@/providers/types";
import {
  protectPhoneNumber,
  revealPhoneNumber,
  type PhoneProtectionKeys,
} from "@/security/phone-protection";

const approvedQuestionValues = [
  "observed_operating_status",
  "unresolved_issue",
  "return_visit_request",
  "preferred_return_window",
] as const;

const requiredAttestations = [
  "contact_authorized",
  "brief_reviewed",
  "fictional_demo_only",
] as const;

const prohibitedActions = [
  "diagnose_equipment",
  "quote_or_negotiate",
  "approve_work",
  "promise_arrival_time",
  "authorize_payment",
  "collect_sensitive_credentials",
] as const;

const demoCaseInputSchema = z.object({
  workOrderRef: z.string().trim().min(1).max(80),
  contractorDisplayName: z.string().trim().min(1).max(120),
  siteLabel: z.string().trim().min(1).max(160),
  timezone: z.string().trim().min(1).max(100).refine(isIanaTimezone, {
    message: "timezone must be a recognized IANA timezone",
  }),
  contact: z.object({
    displayName: z.string().trim().min(1).max(120).nullable(),
    role: z.string().trim().min(1).max(64),
    phoneE164: e164PhoneSchema,
  }),
  requestedFields: z
    .array(z.enum(approvedQuestionValues))
    .min(1)
    .max(approvedQuestionValues.length)
    .refine((values) => new Set(values).size === values.length, {
      message: "requested fields must be unique",
    }),
  visitContext: z.object({
    serviceDate: z.iso.date(),
    equipmentLabel: z.string().trim().min(1).max(160),
    technicianCompletionNote: z.string().trim().min(1).max(500),
    allowedReferenceText: z.string().trim().min(1).max(500),
  }),
});

const approvalInputSchema = z.object({
  expectedCaseVersion: z.number().int().positive(),
  expectedBriefHash: z.string().regex(/^[a-f0-9]{64}$/u),
  callingWindow: z.object({
    timezone: z.string().trim().min(1).max(100).refine(isIanaTimezone),
    startLocal: z.string().trim().min(1).max(40),
    endLocal: z.string().trim().min(1).max(40),
    evaluatedAt: z.iso.datetime({ offset: true }),
  }),
  operatorAttestations: z
    .array(z.enum(requiredAttestations))
    .length(requiredAttestations.length)
    .refine(
      (values) => requiredAttestations.every((value) => values.includes(value)),
      { message: "all demo approval attestations are required" },
    ),
});

export type DemoCloseoutCaseInput = z.input<typeof demoCaseInputSchema>;
export type FakeAttemptApprovalInput = z.input<typeof approvalInputSchema>;

export type SafeAttemptView = {
  id: string;
  caseId: string;
  providerCallId: string | null;
  providerTaskStatus: string;
  attemptOutcome: string;
  creationDisposition: string;
  errorCode: string | null;
};

export type CallExecutionResult =
  | {
      state: "completed";
      attempt: SafeAttemptView;
      result: {
        id: string;
        route: string;
        summary: string;
        validationFailed: boolean;
      };
    }
  | {
      state: "in_progress" | "reconciliation_required" | "failed";
      attempt: SafeAttemptView;
      result: null;
    };

export type FakeExecutionResult = CallExecutionResult;

export class WorkflowPolicyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkflowPolicyError";
  }
}

export async function createDemoCloseoutCase(
  db: FieldCloseDatabase,
  userId: string,
  workspaceId: string,
  input: DemoCloseoutCaseInput,
  phoneKeys: PhoneProtectionKeys,
) {
  const parsed = demoCaseInputSchema.parse(input);
  const access = await requireDemoOperator(db, userId, workspaceId);

  if (access.role === "auditor") {
    throw new WorkflowPolicyError(
      "operator_role_forbidden",
      "An auditor cannot create closeout cases",
    );
  }

  const protectedPhone = protectPhoneNumber(
    parsed.contact.phoneE164,
    phoneKeys,
  );

  return db.transaction(async (transaction) => {
    await requireDemoTransactionAccess(
      transaction,
      userId,
      workspaceId,
      false,
    );

    const [contact] = await transaction
      .insert(contacts)
      .values({
        workspaceId,
        displayName: parsed.contact.displayName,
        role: parsed.contact.role,
        ...protectedPhone,
        authorizationBasis: "demo_fixture",
        authorizationNote:
          "Fictional demo fixture. It is never authorized for a live call.",
      })
      .returning({
        id: contacts.id,
        displayName: contacts.displayName,
        role: contacts.role,
        phoneMasked: contacts.phoneMasked,
        authorizationBasis: contacts.authorizationBasis,
        doNotCallAt: contacts.doNotCallAt,
      });

    if (!contact) {
      throw new Error("The demo contact could not be created");
    }

    const [closeoutCase] = await transaction
      .insert(closeoutCases)
      .values({
        workspaceId,
        workOrderRef: parsed.workOrderRef,
        contractorDisplayName: parsed.contractorDisplayName,
        siteLabel: parsed.siteLabel,
        timezone: parsed.timezone,
        contactId: contact.id,
        requestedFields: parsed.requestedFields,
        visitContext: parsed.visitContext,
        createdBy: userId,
      })
      .returning({
        id: closeoutCases.id,
        workspaceId: closeoutCases.workspaceId,
        version: closeoutCases.version,
        status: closeoutCases.status,
        workOrderRef: closeoutCases.workOrderRef,
        contractorDisplayName: closeoutCases.contractorDisplayName,
        siteLabel: closeoutCases.siteLabel,
        timezone: closeoutCases.timezone,
        contactId: closeoutCases.contactId,
        requestedFields: closeoutCases.requestedFields,
        visitContext: closeoutCases.visitContext,
        currentAttemptId: closeoutCases.currentAttemptId,
      });

    if (!closeoutCase) {
      throw new Error("The demo closeout case could not be created");
    }

    await transaction.insert(auditEvents).values({
      caseId: closeoutCase.id,
      actorType: "operator",
      actorId: userId,
      eventType: "case.created",
      metadata: {
        workspaceId,
        source: "fictional_demo",
        workOrderRef: closeoutCase.workOrderRef,
      },
    });

    return { case: closeoutCase, contact };
  });
}

export async function previewFakeCallBrief(
  db: FieldCloseDatabase,
  userId: string,
  workspaceId: string,
  caseId: string,
  phoneKeys: PhoneProtectionKeys,
) {
  await requireDemoOperator(db, userId, workspaceId);
  const context = await loadCaseContext(db, workspaceId, caseId);
  const approvalBrief = buildApprovalBrief(context, phoneKeys);

  return {
    caseId: context.closeoutCase.id,
    caseVersion: context.closeoutCase.version,
    mode: "fake" as const,
    provider: "fake" as const,
    briefHash: hashCanonical(approvalBrief),
    brief: {
      caseId: approvalBrief.caseId,
      contractorDisplayName: approvalBrief.contractorDisplayName,
      workOrderRef: approvalBrief.workOrderRef,
      recipient: {
        nameOrRole: approvalBrief.recipient.nameOrRole,
        phoneMasked: context.contact.phoneMasked,
        timezone: approvalBrief.recipient.timezone,
      },
      disclosure: approvalBrief.disclosure,
      objective: approvalBrief.objective,
      allowedReferenceText: approvalBrief.allowedReferenceText,
      questions: approvalBrief.questions,
      prohibitedActions: approvalBrief.prohibitedActions,
      voicemailPolicy: approvalBrief.voicemailPolicy,
      maxBoundedClarificationsPerQuestion:
        approvalBrief.maxBoundedClarificationsPerQuestion,
    },
  };
}

export async function approveFakeAttempt(
  db: FieldCloseDatabase,
  userId: string,
  workspaceId: string,
  caseId: string,
  input: FakeAttemptApprovalInput,
  phoneKeys: PhoneProtectionKeys,
) {
  const approvalInput = approvalInputSchema.parse(input);
  const access = await requireDemoOperator(db, userId, workspaceId);

  if (access.role === "auditor") {
    throw new WorkflowPolicyError(
      "operator_role_forbidden",
      "An auditor cannot approve a call attempt",
    );
  }

  return db.transaction(async (transaction) => {
    await requireDemoTransactionAccess(
      transaction,
      userId,
      workspaceId,
      false,
    );

    const [closeoutCase] = await transaction
      .select()
      .from(closeoutCases)
      .where(
        and(
          eq(closeoutCases.id, caseId),
          eq(closeoutCases.workspaceId, workspaceId),
        ),
      )
      .for("update")
      .limit(1);

    if (!closeoutCase) {
      throw new WorkflowPolicyError("case_not_found", "Case was not found");
    }

    const [contact] = await transaction
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.id, closeoutCase.contactId),
          eq(contacts.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    if (!contact) {
      throw new WorkflowPolicyError(
        "contact_not_found",
        "The case contact was not found",
      );
    }

    if (closeoutCase.cancelledAt || closeoutCase.status === "cancelled") {
      throw new WorkflowPolicyError(
        "case_cancelled",
        "A cancelled case cannot be approved",
      );
    }

    if (contact.doNotCallAt) {
      throw new WorkflowPolicyError(
        "contact_do_not_call",
        "The contact has requested no further automated calls",
      );
    }

    const approvalBrief = buildApprovalBrief(
      { closeoutCase, contact },
      phoneKeys,
    );
    const currentBriefHash = hashCanonical(approvalBrief);

    if (closeoutCase.version !== approvalInput.expectedCaseVersion) {
      throw new WorkflowPolicyError(
        "stale_case_version",
        "The case changed after it was reviewed",
      );
    }

    if (currentBriefHash !== approvalInput.expectedBriefHash) {
      throw new WorkflowPolicyError(
        "brief_hash_mismatch",
        "The approved call brief no longer matches the case",
      );
    }

    if (approvalInput.callingWindow.timezone !== closeoutCase.timezone) {
      throw new WorkflowPolicyError(
        "calling_window_timezone_mismatch",
        "The calling window must use the case timezone",
      );
    }

    if (closeoutCase.currentAttemptId) {
      const existing = await loadApprovedAttempt(
        transaction,
        closeoutCase.currentAttemptId,
        caseId,
      );

      if (
        existing &&
        existing.approval.caseVersion === closeoutCase.version &&
        existing.approval.briefHash === currentBriefHash
      ) {
        return { ...existing, reused: true };
      }

      throw new WorkflowPolicyError(
        "attempt_already_exists",
        "This case already has an attempt that requires human review",
      );
    }

    const attemptId = randomUUID();
    const providerBrief: ApprovedCallBrief = {
      ...approvalBrief,
      attemptId,
    };
    const idempotencyKey = `fieldclose:attempt:${attemptId}`;
    const requestFingerprint = hashCanonical(providerBrief);

    const [attempt] = await transaction
      .insert(callAttempts)
      .values({
        id: attemptId,
        caseId,
        mode: "fake",
        idempotencyKey,
        requestFingerprint,
        provider: "fake",
      })
      .returning();

    if (!attempt) {
      throw new Error("The approved attempt could not be created");
    }

    const [approval] = await transaction
      .insert(callApprovals)
      .values({
        caseId,
        caseVersion: closeoutCase.version,
        approvedAttemptId: attemptId,
        approvedBy: userId,
        briefHash: currentBriefHash,
        liveCallApproved: false,
        callingWindow: approvalInput.callingWindow,
        operatorAttestations: approvalInput.operatorAttestations,
      })
      .returning();

    if (!approval) {
      throw new Error("The approval could not be recorded");
    }

    const now = new Date();
    const [approvedAttempt] = await transaction
      .update(callAttempts)
      .set({ approvalId: approval.id, updatedAt: now })
      .where(eq(callAttempts.id, attemptId))
      .returning();

    await transaction
      .update(closeoutCases)
      .set({
        currentAttemptId: attemptId,
        status: "approved",
        updatedAt: now,
      })
      .where(eq(closeoutCases.id, caseId));

    await transaction.insert(auditEvents).values({
      caseId,
      attemptId,
      actorType: "operator",
      actorId: userId,
      eventType: "attempt.approved",
      metadata: {
        mode: "fake",
        provider: "fake",
        caseVersion: closeoutCase.version,
        briefHash: currentBriefHash,
      },
    });

    if (!approvedAttempt) {
      throw new Error("The attempt could not be bound to its approval");
    }

    return { attempt: approvedAttempt, approval, reused: false };
  });
}

export async function executeApprovedFakeAttempt(
  db: FieldCloseDatabase,
  userId: string,
  workspaceId: string,
  attemptId: string,
  provider: CallProvider,
  phoneKeys: PhoneProtectionKeys,
): Promise<FakeExecutionResult> {
  const access = await requireDemoOperator(db, userId, workspaceId);

  if (provider.providerName !== "fake") {
    throw new WorkflowPolicyError(
      "fake_provider_required",
      "A demo attempt can execute only through the fake provider",
    );
  }

  if (access.role === "auditor") {
    throw new WorkflowPolicyError(
      "operator_role_forbidden",
      "An auditor cannot execute a call attempt",
    );
  }

  const preparation = await prepareProviderRequest(
    db,
    userId,
    workspaceId,
    attemptId,
    phoneKeys,
  );

  if (preparation.kind === "existing") {
    return preparation.result;
  }

  if (preparation.kind === "poll") {
    return retrieveAndPersistResult(
      db,
      preparation.caseId,
      preparation.attemptId,
      preparation.providerCallId,
      provider,
    );
  }

  let creation;

  try {
    creation = await provider.createCall(preparation.request);
  } catch {
    return persistAmbiguousCreation(
      db,
      preparation.caseId,
      preparation.attemptId,
      "provider_creation_exception",
    );
  }

  if (creation.disposition === "ambiguous_requires_reconciliation") {
    return persistAmbiguousCreation(
      db,
      preparation.caseId,
      preparation.attemptId,
      creation.errorCode,
    );
  }

  if (creation.disposition === "failed_before_acceptance") {
    return persistFailedCreation(
      db,
      preparation.caseId,
      preparation.attemptId,
      creation.errorCode,
    );
  }

  await db.transaction(async (transaction) => {
    const now = new Date();

    await transaction
      .update(callAttempts)
      .set({
        providerCallId: creation.providerCallId,
        providerTaskStatus: creation.taskStatus,
        creationDisposition: creation.disposition,
        acceptedAt: now,
        lastCheckedAt: now,
        updatedAt: now,
      })
      .where(eq(callAttempts.id, preparation.attemptId));

    await transaction.insert(auditEvents).values({
      caseId: preparation.caseId,
      attemptId: preparation.attemptId,
      actorType: "provider",
      actorId: "fake",
      eventType: "attempt.accepted",
      metadata: {
        provider: "fake",
        creationDisposition: creation.disposition,
        providerTaskStatus: creation.taskStatus,
      },
    });
  });

  return retrieveAndPersistResult(
    db,
    preparation.caseId,
    preparation.attemptId,
    creation.providerCallId,
    provider,
  );
}

type CaseContext = Awaited<ReturnType<typeof loadCaseContext>>;
export type ApprovalBrief = Omit<ApprovedCallBrief, "attemptId">;

export function buildApprovalBrief(
  context: CaseContext,
  phoneKeys: PhoneProtectionKeys,
): ApprovalBrief {
  const nameOrRole = context.contact.displayName?.trim()
    ? context.contact.displayName
    : humanizeRole(context.contact.role);

  return {
    caseId: context.closeoutCase.id,
    contractorDisplayName: context.closeoutCase.contractorDisplayName,
    workOrderRef: context.closeoutCase.workOrderRef,
    recipient: {
      nameOrRole,
      phoneE164: revealPhoneNumber(context.contact, phoneKeys),
      timezone: context.closeoutCase.timezone,
    },
    disclosure: `I am an AI assistant calling on behalf of ${context.closeoutCase.contractorDisplayName}.`,
    objective: `Collect approved closeout information for work order ${context.closeoutCase.workOrderRef}.`,
    allowedReferenceText:
      context.closeoutCase.visitContext.allowedReferenceText,
    questions: context.closeoutCase.requestedFields,
    prohibitedActions: [...prohibitedActions],
    voicemailPolicy: "do_not_leave",
    maxBoundedClarificationsPerQuestion: 1,
  };
}

async function prepareProviderRequest(
  db: FieldCloseDatabase,
  userId: string,
  workspaceId: string,
  attemptId: string,
  phoneKeys: PhoneProtectionKeys,
) {
  return db.transaction(async (transaction) => {
    await requireDemoTransactionAccess(
      transaction,
      userId,
      workspaceId,
      false,
    );

    const [attempt] = await transaction
      .select()
      .from(callAttempts)
      .where(eq(callAttempts.id, attemptId))
      .for("update")
      .limit(1);

    if (!attempt) {
      throw new WorkflowPolicyError(
        "attempt_not_found",
        "The approved attempt was not found",
      );
    }

    const [closeoutCase] = await transaction
      .select()
      .from(closeoutCases)
      .where(
        and(
          eq(closeoutCases.id, attempt.caseId),
          eq(closeoutCases.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    if (!closeoutCase || closeoutCase.currentAttemptId !== attempt.id) {
      throw new WorkflowPolicyError(
        "attempt_scope_mismatch",
        "The attempt is not current for this workspace case",
      );
    }

    const [existingResult] = await transaction
      .select()
      .from(callResults)
      .where(eq(callResults.attemptId, attempt.id))
      .limit(1);

    if (existingResult) {
      return {
        kind: "existing" as const,
        result: completedExecution(attempt, existingResult),
      };
    }

    if (attempt.creationDisposition === "ambiguous_requires_reconciliation") {
      return {
        kind: "existing" as const,
        result: incompleteExecution("reconciliation_required", attempt),
      };
    }

    if (attempt.creationDisposition === "failed_before_acceptance") {
      return {
        kind: "existing" as const,
        result: incompleteExecution("failed", attempt),
      };
    }

    if (attempt.providerCallId) {
      return {
        kind: "poll" as const,
        caseId: attempt.caseId,
        attemptId: attempt.id,
        providerCallId: attempt.providerCallId,
      };
    }

    if (attempt.requestedAt) {
      return {
        kind: "existing" as const,
        result: incompleteExecution("in_progress", attempt),
      };
    }

    if (
      attempt.mode !== "fake" ||
      attempt.provider !== "fake" ||
      closeoutCase.status !== "approved" ||
      closeoutCase.cancelledAt
    ) {
      throw new WorkflowPolicyError(
        "attempt_not_executable",
        "The attempt is not an executable approved fake call",
      );
    }

    if (!attempt.approvalId) {
      throw new WorkflowPolicyError(
        "approval_missing",
        "The attempt is not bound to an approval",
      );
    }

    const [approval] = await transaction
      .select()
      .from(callApprovals)
      .where(
        and(
          eq(callApprovals.id, attempt.approvalId),
          eq(callApprovals.caseId, attempt.caseId),
          eq(callApprovals.approvedAttemptId, attempt.id),
        ),
      )
      .limit(1);

    const [contact] = await transaction
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.id, closeoutCase.contactId),
          eq(contacts.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    if (!approval || approval.invalidatedAt || !contact) {
      throw new WorkflowPolicyError(
        "approval_invalid",
        "The attempt approval is missing or invalid",
      );
    }

    if (approval.liveCallApproved) {
      throw new WorkflowPolicyError(
        "live_approval_forbidden",
        "A live-call approval cannot execute through the fake workflow",
      );
    }

    if (contact.doNotCallAt) {
      throw new WorkflowPolicyError(
        "contact_do_not_call",
        "The contact has requested no further automated calls",
      );
    }

    const approvalBrief = buildApprovalBrief(
      { closeoutCase, contact },
      phoneKeys,
    );

    if (
      approval.caseVersion !== closeoutCase.version ||
      approval.briefHash !== hashCanonical(approvalBrief)
    ) {
      throw new WorkflowPolicyError(
        "approval_stale",
        "The approval no longer matches the current case and contact",
      );
    }

    const providerBrief: ApprovedCallBrief = {
      ...approvalBrief,
      attemptId: attempt.id,
    };

    if (hashCanonical(providerBrief) !== attempt.requestFingerprint) {
      throw new WorkflowPolicyError(
        "request_fingerprint_mismatch",
        "The provider request no longer matches the approved attempt",
      );
    }

    const now = new Date();
    const [claimedAttempt] = await transaction
      .update(callAttempts)
      .set({ requestedAt: now, updatedAt: now })
      .where(eq(callAttempts.id, attempt.id))
      .returning();

    await transaction
      .update(closeoutCases)
      .set({ status: "calling", updatedAt: now })
      .where(eq(closeoutCases.id, closeoutCase.id));

    await transaction.insert(auditEvents).values({
      caseId: closeoutCase.id,
      attemptId: attempt.id,
      actorType: "operator",
      actorId: userId,
      eventType: "attempt.requested",
      metadata: {
        mode: "fake",
        provider: "fake",
        idempotencyKey: attempt.idempotencyKey,
      },
    });

    if (!claimedAttempt) {
      throw new Error("The approved attempt could not be claimed");
    }

    return {
      kind: "invoke" as const,
      caseId: attempt.caseId,
      attemptId: attempt.id,
      request: {
        attemptId: attempt.id,
        idempotencyKey: attempt.idempotencyKey,
        brief: providerBrief,
      },
    };
  });
}

async function retrieveAndPersistResult(
  db: FieldCloseDatabase,
  caseId: string,
  attemptId: string,
  providerCallId: string,
  provider: CallProvider,
): Promise<FakeExecutionResult> {
  let snapshot;

  try {
    snapshot = await provider.getCall(providerCallId);
  } catch {
    return persistAcceptedCallRetrievalFailure(db, caseId, attemptId);
  }

  if (snapshot.providerCallId !== providerCallId) {
    return persistAcceptedCallRetrievalFailure(
      db,
      caseId,
      attemptId,
      "provider_call_id_mismatch",
    );
  }

  return persistProviderSnapshot(
    db,
    caseId,
    attemptId,
    snapshot,
    provider.providerName,
  );
}

export async function persistProviderSnapshot(
  db: FieldCloseDatabase,
  caseId: string,
  attemptId: string,
  snapshot: ProviderCallSnapshot,
  providerActorId: "fake" | "call_e",
  now = new Date(),
): Promise<CallExecutionResult> {
  const terminal = ["completed", "failed", "canceled"].includes(
    snapshot.taskStatus,
  );
  const normalized = terminal ? normalizeProviderSnapshot(snapshot) : null;

  return db.transaction(async (transaction) => {
    const [attempt] = await transaction
      .select()
      .from(callAttempts)
      .where(eq(callAttempts.id, attemptId))
      .for("update")
      .limit(1);

    if (!attempt || attempt.caseId !== caseId) {
      throw new WorkflowPolicyError(
        "attempt_scope_mismatch",
        "The provider result does not match the stored attempt",
      );
    }

    const [existingResult] = await transaction
      .select()
      .from(callResults)
      .where(eq(callResults.attemptId, attemptId))
      .limit(1);

    if (existingResult) {
      return completedExecution(attempt, existingResult);
    }

    if (!terminal) {
      const [updatedAttempt] = await transaction
        .update(callAttempts)
        .set({
          providerTaskStatus: snapshot.taskStatus,
          attemptOutcome: snapshot.attemptOutcome,
          lastCheckedAt: now,
          errorCode: null,
          updatedAt: now,
        })
        .where(eq(callAttempts.id, attemptId))
        .returning();

      if (!updatedAttempt) {
        throw new Error("The provider status could not be stored");
      }

      return incompleteExecution("in_progress", updatedAttempt);
    }

    if (!normalized) {
      throw new Error("The terminal provider result could not be normalized");
    }

    const [updatedAttempt] = await transaction
      .update(callAttempts)
      .set({
        providerTaskStatus: snapshot.taskStatus,
        attemptOutcome: snapshot.attemptOutcome,
        connectedAt:
          snapshot.attemptOutcome === "answered" ||
          snapshot.attemptOutcome === "partial_answer"
            ? now
            : attempt.connectedAt,
        endedAt: now,
        lastCheckedAt: now,
        errorCode: normalized.validationFailed
          ? "result_validation_failed"
          : null,
        updatedAt: now,
      })
      .where(eq(callAttempts.id, attemptId))
      .returning();

    const [result] = await transaction
      .insert(callResults)
      .values({
        caseId,
        attemptId,
        providerCallId: snapshot.providerCallId,
        providerTaskStatus: normalized.providerTaskStatus,
        contactVerification: normalized.contactVerification,
        observedOperatingStatus: normalized.observedOperatingStatus,
        unresolvedIssue: normalized.unresolvedIssue,
        returnVisitRequested: normalized.returnVisitRequested,
        preferredWindows: normalized.preferredWindows,
        administrativeResults: normalized.administrativeResults,
        outOfScopeTopics: normalized.outOfScopeTopics,
        escalationReasons: normalized.escalationReasons,
        summary: normalized.summary,
        evidenceRefs: normalized.evidenceRefs,
        route: normalized.route,
        normalizerVersion: normalized.normalizerVersion,
        normalizedAt: now,
      })
      .returning();

    if (!updatedAttempt || !result) {
      throw new Error("The normalized provider result could not be stored");
    }

    if (normalized.doNotCallRequested) {
      const [closeoutCase] = await transaction
        .select({ contactId: closeoutCases.contactId })
        .from(closeoutCases)
        .where(eq(closeoutCases.id, caseId))
        .limit(1);

      if (!closeoutCase) {
        throw new Error("The result case could not be loaded");
      }

      await transaction
        .update(contacts)
        .set({ doNotCallAt: now, updatedAt: now })
        .where(eq(contacts.id, closeoutCase.contactId));

      await transaction.insert(auditEvents).values({
        caseId,
        attemptId,
        actorType: "provider",
        actorId: providerActorId,
        eventType: "contact.do_not_call_recorded",
        metadata: { source: "validated_provider_result" },
      });
    }

    await transaction
      .update(followUpTasks)
      .set({
        status: "resolved",
        resolvedAt: now,
        resolutionNote: "CALL-E terminal status was retrieved.",
      })
      .where(
        and(
          eq(followUpTasks.caseId, caseId),
          eq(followUpTasks.type, "provider_reconciliation"),
          eq(followUpTasks.status, "open"),
        ),
      );

    const task = selectFollowUpTask(normalized);
    await transaction.insert(followUpTasks).values({
      caseId,
      type: task.type,
      reasonCodes: task.reasonCodes,
    });

    await transaction
      .update(closeoutCases)
      .set({ status: selectCaseStatus(normalized.route), updatedAt: now })
      .where(eq(closeoutCases.id, caseId));

    await transaction.insert(auditEvents).values({
      caseId,
      attemptId,
      actorType: "system",
      actorId: "result-normalizer",
      eventType: "result.normalized",
      metadata: {
        route: normalized.route,
        normalizerVersion: normalized.normalizerVersion,
        validationFailed: normalized.validationFailed,
        providerTaskStatus: normalized.providerTaskStatus,
      },
    });

    return completedExecution(updatedAttempt, result, normalized.validationFailed);
  });
}

export async function persistAmbiguousCreation(
  db: FieldCloseDatabase,
  caseId: string,
  attemptId: string,
  errorCode: string,
): Promise<FakeExecutionResult> {
  return db.transaction(async (transaction) => {
    const now = new Date();
    const [attempt] = await transaction
      .update(callAttempts)
      .set({
        providerTaskStatus: "unknown",
        attemptOutcome: "unknown",
        creationDisposition: "ambiguous_requires_reconciliation",
        lastCheckedAt: now,
        errorCode: safeErrorCode(errorCode),
        updatedAt: now,
      })
      .where(eq(callAttempts.id, attemptId))
      .returning();

    if (!attempt || attempt.caseId !== caseId) {
      throw new WorkflowPolicyError(
        "attempt_scope_mismatch",
        "The ambiguous creation outcome did not match the attempt",
      );
    }

    await transaction
      .update(closeoutCases)
      .set({ status: "needs_attention", updatedAt: now })
      .where(eq(closeoutCases.id, caseId));

    await transaction.insert(followUpTasks).values({
      caseId,
      type: "provider_reconciliation",
      reasonCodes: [safeErrorCode(errorCode)],
    });

    await transaction.insert(auditEvents).values({
      caseId,
      attemptId,
      actorType: "system",
      actorId: "provider-boundary",
      eventType: "attempt.creation_ambiguous",
      metadata: { errorCode: safeErrorCode(errorCode), retryFrozen: true },
    });

    return incompleteExecution("reconciliation_required", attempt);
  });
}

export async function persistFailedCreation(
  db: FieldCloseDatabase,
  caseId: string,
  attemptId: string,
  errorCode: string,
): Promise<FakeExecutionResult> {
  return db.transaction(async (transaction) => {
    const now = new Date();
    const [attempt] = await transaction
      .update(callAttempts)
      .set({
        providerTaskStatus: "failed",
        attemptOutcome: "unknown",
        creationDisposition: "failed_before_acceptance",
        endedAt: now,
        lastCheckedAt: now,
        errorCode: safeErrorCode(errorCode),
        updatedAt: now,
      })
      .where(eq(callAttempts.id, attemptId))
      .returning();

    if (!attempt || attempt.caseId !== caseId) {
      throw new WorkflowPolicyError(
        "attempt_scope_mismatch",
        "The creation failure did not match the attempt",
      );
    }

    await transaction
      .update(closeoutCases)
      .set({ status: "failed", updatedAt: now })
      .where(eq(closeoutCases.id, caseId));

    await transaction.insert(followUpTasks).values({
      caseId,
      type: "technical_review",
      reasonCodes: [safeErrorCode(errorCode)],
    });

    await transaction.insert(auditEvents).values({
      caseId,
      attemptId,
      actorType: "system",
      actorId: "provider-boundary",
      eventType: "attempt.creation_failed",
      metadata: { errorCode: safeErrorCode(errorCode), accepted: false },
    });

    return incompleteExecution("failed", attempt);
  });
}

export async function persistAcceptedCallRetrievalFailure(
  db: FieldCloseDatabase,
  caseId: string,
  attemptId: string,
  errorCode = "provider_result_unavailable",
  lastSnapshot?: Pick<
    ProviderCallSnapshot,
    "taskStatus" | "attemptOutcome"
  >,
  now = new Date(),
): Promise<FakeExecutionResult> {
  return db.transaction(async (transaction) => {
    const sanitizedErrorCode = safeErrorCode(errorCode);
    const [attempt] = await transaction
      .update(callAttempts)
      .set({
        providerTaskStatus: lastSnapshot?.taskStatus ?? "unknown",
        attemptOutcome: lastSnapshot?.attemptOutcome ?? "unknown",
        lastCheckedAt: now,
        errorCode: sanitizedErrorCode,
        updatedAt: now,
      })
      .where(eq(callAttempts.id, attemptId))
      .returning();

    if (!attempt || attempt.caseId !== caseId) {
      throw new WorkflowPolicyError(
        "attempt_scope_mismatch",
        "The provider retrieval failure did not match the attempt",
      );
    }

    await transaction
      .update(closeoutCases)
      .set({ status: "needs_attention", updatedAt: now })
      .where(eq(closeoutCases.id, caseId));

    const [existingTask] = await transaction
      .select({ id: followUpTasks.id })
      .from(followUpTasks)
      .where(
        and(
          eq(followUpTasks.caseId, caseId),
          eq(followUpTasks.type, "provider_reconciliation"),
          eq(followUpTasks.status, "open"),
        ),
      )
      .limit(1);

    if (!existingTask) {
      await transaction.insert(followUpTasks).values({
        caseId,
        type: "provider_reconciliation",
        reasonCodes: [sanitizedErrorCode],
      });
    }

    await transaction.insert(auditEvents).values({
      caseId,
      attemptId,
      actorType: "system",
      actorId: "provider-boundary",
      eventType: "attempt.result_retrieval_failed",
      metadata: {
        errorCode: sanitizedErrorCode,
        creationRetryFrozen: true,
      },
    });

    return incompleteExecution("reconciliation_required", attempt);
  });
}

export async function loadCaseContext(
  db: FieldCloseDatabase,
  workspaceId: string,
  caseId: string,
) {
  const [closeoutCase] = await db
    .select()
    .from(closeoutCases)
    .where(
      and(
        eq(closeoutCases.id, caseId),
        eq(closeoutCases.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!closeoutCase) {
    throw new WorkflowPolicyError("case_not_found", "Case was not found");
  }

  const [contact] = await db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.id, closeoutCase.contactId),
        eq(contacts.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!contact) {
    throw new WorkflowPolicyError(
      "contact_not_found",
      "The case contact was not found",
    );
  }

  return { closeoutCase, contact };
}

async function requireDemoOperator(
  db: FieldCloseDatabase,
  userId: string,
  workspaceId: string,
) {
  const access = await findWorkspaceAccess(db, userId, workspaceId);

  if (!access) {
    throw new WorkflowPolicyError(
      "workspace_access_denied",
      "Workspace access is required",
    );
  }

  if (
    access.kind !== "demo" ||
    access.provider !== "fake" ||
    access.liveCallsAllowed
  ) {
    throw new WorkflowPolicyError(
      "fake_workspace_required",
      "This workflow is restricted to a fake-only demo workspace",
    );
  }

  return access;
}

async function loadApprovedAttempt(
  db: Parameters<Parameters<FieldCloseDatabase["transaction"]>[0]>[0],
  attemptId: string,
  caseId: string,
) {
  const [attempt] = await db
    .select()
    .from(callAttempts)
    .where(
      and(eq(callAttempts.id, attemptId), eq(callAttempts.caseId, caseId)),
    )
    .limit(1);

  if (!attempt?.approvalId) {
    return null;
  }

  const [approval] = await db
    .select()
    .from(callApprovals)
    .where(
      and(
        eq(callApprovals.id, attempt.approvalId),
        eq(callApprovals.approvedAttemptId, attempt.id),
        eq(callApprovals.caseId, caseId),
      ),
    )
    .limit(1);

  return approval ? { attempt, approval } : null;
}

type WorkflowTransaction = Parameters<
  Parameters<FieldCloseDatabase["transaction"]>[0]
>[0];

async function requireDemoTransactionAccess(
  transaction: WorkflowTransaction,
  userId: string,
  workspaceId: string,
  allowAuditor: boolean,
) {
  const [access] = await transaction
    .select({
      kind: workspaces.kind,
      provider: workspaces.provider,
      liveCallsAllowed: workspaces.liveCallsAllowed,
      role: workspaceMemberships.role,
    })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaceMemberships.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceMemberships.userId, userId),
        eq(workspaceMemberships.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!access) {
    throw new WorkflowPolicyError(
      "workspace_access_denied",
      "Workspace access is required",
    );
  }

  if (
    access.kind !== "demo" ||
    access.provider !== "fake" ||
    access.liveCallsAllowed
  ) {
    throw new WorkflowPolicyError(
      "fake_workspace_required",
      "This workflow is restricted to a fake-only demo workspace",
    );
  }

  if (!allowAuditor && access.role === "auditor") {
    throw new WorkflowPolicyError(
      "operator_role_forbidden",
      "An owner or operator role is required",
    );
  }

  return access;
}

function selectFollowUpTask(normalized: {
  route: string;
  validationFailed: boolean;
  doNotCallRequested: boolean;
  outOfScopeTopics: string[];
  escalationReasons: string[];
}) {
  if (normalized.doNotCallRequested) {
    return {
      type: "privacy_request" as const,
      reasonCodes: ["do_not_call_requested"],
    };
  }

  if (normalized.route === "ready_for_closeout_review") {
    return {
      type: "closeout_review" as const,
      reasonCodes: ["normalized_result_ready"],
    };
  }

  if (normalized.route === "return_visit_review") {
    return {
      type: "return_visit_review" as const,
      reasonCodes: ["return_visit_or_unresolved_issue"],
    };
  }

  if (
    normalized.validationFailed ||
    normalized.outOfScopeTopics.includes("technical_advice")
  ) {
    return {
      type: "technical_review" as const,
      reasonCodes: normalized.escalationReasons.length
        ? normalized.escalationReasons
        : ["result_validation_failed"],
    };
  }

  return {
    type: "contact_review" as const,
    reasonCodes: normalized.escalationReasons.length
      ? normalized.escalationReasons
      : [`route_${normalized.route}`],
  };
}

function selectCaseStatus(route: string) {
  if (
    route === "ready_for_closeout_review" ||
    route === "return_visit_review"
  ) {
    return "completed" as const;
  }

  if (route === "failed") {
    return "failed" as const;
  }

  return "needs_attention" as const;
}

function completedExecution(
  attempt: typeof callAttempts.$inferSelect,
  result: typeof callResults.$inferSelect,
  validationFailed = attempt.errorCode === "result_validation_failed",
): FakeExecutionResult {
  return {
    state: "completed",
    attempt: safeAttempt(attempt),
    result: {
      id: result.id,
      route: result.route,
      summary: result.summary,
      validationFailed,
    },
  };
}

function incompleteExecution(
  state: "in_progress" | "reconciliation_required" | "failed",
  attempt: typeof callAttempts.$inferSelect,
): FakeExecutionResult {
  return { state, attempt: safeAttempt(attempt), result: null };
}

function safeAttempt(
  attempt: typeof callAttempts.$inferSelect,
): SafeAttemptView {
  return {
    id: attempt.id,
    caseId: attempt.caseId,
    providerCallId: attempt.providerCallId,
    providerTaskStatus: attempt.providerTaskStatus,
    attemptOutcome: attempt.attemptOutcome,
    creationDisposition: attempt.creationDisposition,
    errorCode: attempt.errorCode,
  };
}

export function hashCanonical(value: object) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeErrorCode(errorCode: string) {
  const safe = errorCode
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 80);

  return safe || "provider_error";
}

function humanizeRole(role: string) {
  return role.replaceAll("_", " ");
}

function isIanaTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}
