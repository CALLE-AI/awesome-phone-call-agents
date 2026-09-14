import { randomUUID } from "node:crypto";

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  buildApprovalBrief,
  executionFromAttempt,
  hashCanonical,
  loadCaseContext,
  persistAcceptedCallRetrievalFailure,
  persistAmbiguousCreation,
  persistFailedCreation,
  persistProviderSnapshot,
  readAttemptCurrentState,
  type CallExecutionResult,
  type SafeAttemptView,
  WorkflowPolicyError,
} from "@/application/closeout-workflow";
import {
  authorizeLiveCall,
  evaluateLiveCallGate,
} from "@/application/live-call-gate";
import { lockAndCheckRecipientSuppression } from "@/application/recipient-suppression";
import type { ServerEnvironment } from "@/config/environment";
import { usE164PhoneSchema } from "@/domain/phone-number";
import type { FieldCloseDatabase } from "@/persistence/database";
import {
  auditEvents,
  callApprovals,
  callAttempts,
  callResults,
  closeoutCases,
  contacts,
  systemSettings,
  workspaceMemberships,
  workspaces,
} from "@/persistence/schema";
import type {
  ApprovedCallBrief,
  CallProvider,
} from "@/providers/types";
import {
  protectPhoneNumber,
  type PhoneProtectionKeys,
} from "@/security/phone-protection";

const liveRequiredAttestations = [
  "contact_authorized",
  "brief_reviewed",
  "live_call_authorized",
  "recipient_consent_confirmed",
] as const;
const localDateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/u;
const approvedQuestionValues = [
  "observed_operating_status",
  "unresolved_issue",
  "return_visit_request",
  "preferred_return_window",
] as const;
const liveAuthorizationBasisValues = [
  "existing_service_contact",
  "contact_requested_follow_up",
  "contractor_provided_authorized_contact",
] as const;
export const liveStatusPollIntervalMs = 5_000;
export const liveStatusPollTimeoutMs = 600_000;
export const liveCreationClaimLeaseMs = 60_000;

const protectedCaseInputSchema = z.object({
  workOrderRef: z.string().trim().min(1).max(80),
  contractorDisplayName: z.string().trim().min(1).max(120),
  siteLabel: z.string().trim().min(1).max(160),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine(isIanaTimezone, {
      message: "timezone must be a recognized IANA timezone",
    }),
  contact: z.object({
    displayName: z.string().trim().min(1).max(120).nullable(),
    role: z.string().trim().min(1).max(64),
    phoneE164: usE164PhoneSchema,
    authorizationBasis: z.enum(liveAuthorizationBasisValues),
    authorizationNote: z.string().trim().min(10).max(500),
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

const liveApprovalInputSchema = z.object({
  expectedCaseVersion: z.number().int().positive(),
  expectedBriefHash: z.string().regex(/^[a-f0-9]{64}$/u),
  callingWindow: z.object({
    timezone: z.string().trim().min(1).max(100),
    startLocal: z.string().regex(localDateTimePattern),
    endLocal: z.string().regex(localDateTimePattern),
    evaluatedAt: z.iso.datetime({ offset: true }),
  }),
  operatorAttestations: z
    .array(z.enum(liveRequiredAttestations))
    .length(liveRequiredAttestations.length)
    .refine(
      (values) =>
        liveRequiredAttestations.every((value) =>
          values.includes(value),
        ),
      { message: "all live-call approval attestations are required" },
    ),
});

export type LiveAttemptApprovalInput = z.input<
  typeof liveApprovalInputSchema
>;
export type ProtectedCloseoutCaseInput = z.input<
  typeof protectedCaseInputSchema
>;

export async function createProtectedCloseoutCase(
  db: FieldCloseDatabase,
  userId: string,
  workspaceId: string,
  input: ProtectedCloseoutCaseInput,
  phoneKeys: PhoneProtectionKeys,
) {
  const parsed = protectedCaseInputSchema.parse(input);
  const protectedPhone = protectPhoneNumber(
    parsed.contact.phoneE164,
    phoneKeys,
  );

  return db.transaction(async (transaction) => {
    await requireProtectedWorkspaceTransactionAccess(
      transaction,
      userId,
      workspaceId,
    );

    if (
      await lockAndCheckRecipientSuppression(
        transaction,
        workspaceId,
        protectedPhone.phoneLookupHash,
      )
    ) {
      throw new WorkflowPolicyError(
        "contact_do_not_call",
        "The contact has requested no further automated calls",
      );
    }

    const [contact] = await transaction
      .insert(contacts)
      .values({
        workspaceId,
        displayName: parsed.contact.displayName,
        role: parsed.contact.role,
        ...protectedPhone,
        authorizationBasis: parsed.contact.authorizationBasis,
        authorizationNote: parsed.contact.authorizationNote,
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
      throw new Error("The protected contact could not be created");
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
      throw new Error("The protected closeout case could not be created");
    }

    await transaction.insert(auditEvents).values({
      caseId: closeoutCase.id,
      actorType: "operator",
      actorId: userId,
      eventType: "case.created",
      metadata: {
        workspaceId,
        source: "protected_workspace",
        workOrderRef: closeoutCase.workOrderRef,
        authorizationBasis: contact.authorizationBasis,
      },
    });

    return { case: closeoutCase, contact };
  });
}

export async function cancelProtectedCloseoutCase(
  db: FieldCloseDatabase,
  userId: string,
  workspaceId: string,
  caseId: string,
): Promise<{ caseId: string; status: "cancelled"; cancelledAt: Date }> {
  return db.transaction(async (transaction) => {
    await requireProtectedOperatorTransactionAccess(
      transaction,
      userId,
      workspaceId,
      "cancel protected cases",
    );

    const [closeoutCase] = await transaction
      .select({
        id: closeoutCases.id,
        status: closeoutCases.status,
        cancelledAt: closeoutCases.cancelledAt,
      })
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

    if (closeoutCase.cancelledAt || closeoutCase.status === "cancelled") {
      return {
        caseId,
        status: "cancelled",
        cancelledAt: closeoutCase.cancelledAt ?? new Date(),
      };
    }

    if (!["draft", "approved"].includes(closeoutCase.status)) {
      throw new WorkflowPolicyError(
        "case_cancellation_not_safe",
        "The case can no longer be cancelled locally because a provider request may exist",
      );
    }

    const now = new Date();

    await transaction
      .update(callApprovals)
      .set({ invalidatedAt: now })
      .where(
        and(
          eq(callApprovals.caseId, caseId),
          isNull(callApprovals.invalidatedAt),
        ),
      );

    await transaction
      .update(closeoutCases)
      .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
      .where(eq(closeoutCases.id, caseId));

    await transaction.insert(auditEvents).values({
      caseId,
      actorType: "operator",
      actorId: userId,
      eventType: "case.cancelled",
      metadata: {
        workspaceId,
        source: "protected_workspace",
        reason: "operator_cancellation",
      },
    });

    return { caseId, status: "cancelled", cancelledAt: now };
  });
}

export async function previewLiveCallBrief(
  db: FieldCloseDatabase,
  environment: ServerEnvironment,
  userId: string,
  workspaceId: string,
  caseId: string,
  phoneKeys: PhoneProtectionKeys,
) {
  await requireLiveCallAuthorized(
    db,
    environment,
    userId,
    workspaceId,
  );
  const context = await loadCaseContext(db, workspaceId, caseId);
  requireLiveContactAuthorization(context.contact);
  const approvalBrief = buildApprovalBrief(context, phoneKeys);

  return {
    caseId: context.closeoutCase.id,
    caseVersion: context.closeoutCase.version,
    mode: "live" as const,
    provider: "call_e" as const,
    briefHash: hashCanonical(approvalBrief),
    requiredAttestations: [...liveRequiredAttestations],
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

export async function approveLiveAttempt(
  db: FieldCloseDatabase,
  environment: ServerEnvironment,
  userId: string,
  workspaceId: string,
  caseId: string,
  input: LiveAttemptApprovalInput,
  phoneKeys: PhoneProtectionKeys,
) {
  const approvalInput = liveApprovalInputSchema.parse(input);
  await requireLiveCallAuthorized(
    db,
    environment,
    userId,
    workspaceId,
  );

  return db.transaction(async (transaction) => {
    await requireProtectedLiveTransactionAccess(
      transaction,
      environment,
      userId,
      workspaceId,
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

    requireLiveContactAuthorization(contact);

    if (closeoutCase.cancelledAt || closeoutCase.status === "cancelled") {
      throw new WorkflowPolicyError(
        "case_cancelled",
        "A cancelled case cannot be approved",
      );
    }

    if (
      await lockAndCheckRecipientSuppression(
        transaction,
        workspaceId,
        contact.phoneLookupHash,
      )
    ) {
      throw new WorkflowPolicyError(
        "contact_do_not_call",
        "The contact has requested no further automated calls",
      );
    }

    if (
      approvalInput.callingWindow.timezone !== closeoutCase.timezone ||
      !isPermittedLiveCallingWindow(approvalInput.callingWindow)
    ) {
      throw new WorkflowPolicyError(
        "calling_window_not_permitted",
        "The live calling window must use the case timezone and remain within one local 08:00-18:00 day",
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

    if (closeoutCase.currentAttemptId) {
      const existing = await loadLiveApprovedAttempt(
        transaction,
        closeoutCase.currentAttemptId,
        caseId,
      );

      if (
        existing &&
        existing.approval.caseVersion === closeoutCase.version &&
        existing.approval.briefHash === currentBriefHash &&
        existing.approval.liveCallApproved
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

    const [provisionalAttempt] = await transaction
      .insert(callAttempts)
      .values({
        id: attemptId,
        caseId,
        mode: "dry_run",
        idempotencyKey,
        requestFingerprint,
        provider: "call_e",
      })
      .returning();

    if (!provisionalAttempt) {
      throw new Error("The live attempt could not be created");
    }

    const [approval] = await transaction
      .insert(callApprovals)
      .values({
        caseId,
        caseVersion: closeoutCase.version,
        approvedAttemptId: attemptId,
        approvedBy: userId,
        briefHash: currentBriefHash,
        liveCallApproved: true,
        callingWindow: approvalInput.callingWindow,
        operatorAttestations: approvalInput.operatorAttestations,
      })
      .returning();

    if (!approval) {
      throw new Error("The live approval could not be recorded");
    }

    const now = new Date();
    const [approvedAttempt] = await transaction
      .update(callAttempts)
      .set({
        mode: "live",
        approvalId: approval.id,
        updatedAt: now,
      })
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
        mode: "live",
        provider: "call_e",
        caseVersion: closeoutCase.version,
        briefHash: currentBriefHash,
        recipientConsentConfirmed: true,
      },
    });

    if (!approvedAttempt) {
      throw new Error("The live attempt could not be bound to its approval");
    }

    return { attempt: approvedAttempt, approval, reused: false };
  });
}

export async function executeApprovedLiveAttempt(
  db: FieldCloseDatabase,
  environment: ServerEnvironment,
  userId: string,
  workspaceId: string,
  attemptId: string,
  provider: CallProvider,
  phoneKeys: PhoneProtectionKeys,
  now = new Date(),
): Promise<CallExecutionResult> {
  if (provider.providerName !== "call_e") {
    throw new WorkflowPolicyError(
      "call_e_provider_required",
      "A live attempt can execute only through the CALL-E provider",
    );
  }

  await requireLiveCallAuthorized(
    db,
    environment,
    userId,
    workspaceId,
  );
  const preparation = await prepareLiveProviderRequest(
    db,
    environment,
    userId,
    workspaceId,
    attemptId,
    phoneKeys,
    now,
  );

  if (preparation.kind === "existing") {
    return preparation.result;
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

  const accepted = await db.transaction(async (transaction) => {
    const acceptedAt = new Date();
    const [attempt] = await transaction
      .update(callAttempts)
      .set({
        providerCallId: creation.providerCallId,
        providerTaskStatus: creation.taskStatus,
        creationDisposition: creation.disposition,
        requestedAt: acceptedAt,
        acceptedAt,
        lastCheckedAt: acceptedAt,
        updatedAt: acceptedAt,
      })
      .where(
        and(
          eq(callAttempts.id, preparation.attemptId),
          isNotNull(callAttempts.requestedAt),
          eq(callAttempts.creationDisposition, "not_requested"),
        ),
      )
      .returning();

    if (!attempt) {
      const current = await readAttemptCurrentState(
        transaction,
        preparation.attemptId,
        preparation.caseId,
        "accepted live attempt",
      );

      return {
        lostRace: true as const,
        result: executionFromAttempt(current),
      };
    }

    await transaction.insert(auditEvents).values({
      caseId: preparation.caseId,
      attemptId: preparation.attemptId,
      actorType: "provider",
      actorId: "call_e",
      eventType: "attempt.accepted",
      metadata: {
        provider: "call_e",
        creationDisposition: creation.disposition,
        providerTaskStatus: creation.taskStatus,
      },
    });

    return {
      lostRace: false as const,
      result: {
        state: "in_progress" as const,
        attempt: safeAttempt(attempt),
        result: null,
      },
    };
  });

  return accepted.result;
}

export async function refreshAcceptedLiveAttempt(
  db: FieldCloseDatabase,
  userId: string,
  workspaceId: string,
  attemptId: string,
  provider: CallProvider,
  now = new Date(),
): Promise<CallExecutionResult> {
  if (provider.providerName !== "call_e") {
    throw new WorkflowPolicyError(
      "call_e_provider_required",
      "A live attempt can refresh only through the CALL-E provider",
    );
  }

  const preparation = await prepareLiveStatusRefresh(
    db,
    userId,
    workspaceId,
    attemptId,
    now,
  );

  if (preparation.kind === "existing") {
    return preparation.result;
  }

  let snapshot;

  try {
    snapshot = await provider.getCall(preparation.providerCallId);
  } catch {
    return preparation.timedOut
      ? persistAcceptedCallRetrievalFailure(
          db,
          preparation.caseId,
          preparation.attemptId,
          "provider_result_timeout",
          undefined,
          now,
        )
      : incompleteExecution("in_progress", preparation.attempt);
  }

  if (snapshot.providerCallId !== preparation.providerCallId) {
    return persistAcceptedCallRetrievalFailure(
      db,
      preparation.caseId,
      preparation.attemptId,
      "provider_call_id_mismatch",
      undefined,
      now,
    );
  }

  const terminal = ["completed", "failed", "canceled"].includes(
    snapshot.taskStatus,
  );

  if (!terminal && preparation.timedOut) {
    return persistAcceptedCallRetrievalFailure(
      db,
      preparation.caseId,
      preparation.attemptId,
      "provider_result_timeout",
      snapshot,
      now,
    );
  }

  return persistProviderSnapshot(
    db,
    preparation.caseId,
    preparation.attemptId,
    snapshot,
    "call_e",
    now,
  );
}

async function prepareLiveStatusRefresh(
  db: FieldCloseDatabase,
  userId: string,
  workspaceId: string,
  attemptId: string,
  now: Date,
) {
  return db.transaction(async (transaction) => {
    await requireProtectedOperatorTransactionAccess(
      transaction,
      userId,
      workspaceId,
      "refresh provider status",
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
        "The accepted live attempt was not found",
      );
    }

    const [closeoutCase] = await transaction
      .select({ currentAttemptId: closeoutCases.currentAttemptId })
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
        "The live attempt is not current for this workspace case",
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

    if (
      attempt.mode !== "live" ||
      attempt.provider !== "call_e" ||
      !attempt.providerCallId ||
      !attempt.acceptedAt
    ) {
      throw new WorkflowPolicyError(
        "attempt_not_refreshable",
        "Only an accepted CALL-E live attempt can refresh provider status",
      );
    }

    if (
      attempt.lastCheckedAt &&
      now.getTime() - attempt.lastCheckedAt.getTime() <
        liveStatusPollIntervalMs
    ) {
      return {
        kind: "existing" as const,
        result: incompleteExecution(
          attempt.errorCode === "provider_result_timeout"
            ? "reconciliation_required"
            : "in_progress",
          attempt,
        ),
      };
    }

    const [claimedAttempt] = await transaction
      .update(callAttempts)
      .set({ lastCheckedAt: now, updatedAt: now })
      .where(eq(callAttempts.id, attempt.id))
      .returning();

    if (!claimedAttempt) {
      throw new Error("The provider status refresh could not be claimed");
    }

    return {
      kind: "lookup" as const,
      caseId: attempt.caseId,
      attemptId: attempt.id,
      providerCallId: attempt.providerCallId,
      timedOut:
        now.getTime() - attempt.acceptedAt.getTime() >=
        liveStatusPollTimeoutMs,
      attempt: claimedAttempt,
    };
  });
}

async function prepareLiveProviderRequest(
  db: FieldCloseDatabase,
  environment: ServerEnvironment,
  userId: string,
  workspaceId: string,
  attemptId: string,
  phoneKeys: PhoneProtectionKeys,
  now: Date,
) {
  return db.transaction(async (transaction) => {
    await requireProtectedLiveTransactionAccess(
      transaction,
      environment,
      userId,
      workspaceId,
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
        "The approved live attempt was not found",
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
        "The live attempt is not current for this workspace case",
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
        kind: "existing" as const,
        result: incompleteExecution("in_progress", attempt),
      };
    }

    if (
      attempt.requestedAt &&
      now.getTime() - attempt.requestedAt.getTime() <
        liveCreationClaimLeaseMs
    ) {
      return {
        kind: "existing" as const,
        result: incompleteExecution("in_progress", attempt),
      };
    }

    if (
      attempt.mode !== "live" ||
      attempt.provider !== "call_e" ||
      !["approved", "calling"].includes(closeoutCase.status) ||
      closeoutCase.cancelledAt
    ) {
      throw new WorkflowPolicyError(
        "attempt_not_executable",
        "The attempt is not an executable approved live call",
      );
    }

    if (!attempt.approvalId) {
      throw new WorkflowPolicyError(
        "approval_missing",
        "The live attempt is not bound to an approval",
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

    if (
      !approval ||
      approval.invalidatedAt ||
      !approval.liveCallApproved ||
      !contact
    ) {
      throw new WorkflowPolicyError(
        "approval_invalid",
        "The live approval is missing, invalid, or not live-authorized",
      );
    }

    requireLiveContactAuthorization(contact);

    if (
      await lockAndCheckRecipientSuppression(
        transaction,
        workspaceId,
        contact.phoneLookupHash,
      )
    ) {
      throw new WorkflowPolicyError(
        "contact_do_not_call",
        "The contact has requested no further automated calls",
      );
    }

    if (approval.expiresAt && approval.expiresAt <= now) {
      throw new WorkflowPolicyError(
        "approval_expired",
        "The live approval has expired",
      );
    }

    if (
      approval.callingWindow.timezone !== closeoutCase.timezone ||
      !isNowInsideCallingWindow(now, approval.callingWindow)
    ) {
      throw new WorkflowPolicyError(
        "outside_calling_window",
        "The live call is outside its exact approved local calling window",
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
        "The live approval no longer matches the current case and contact",
      );
    }

    const providerBrief: ApprovedCallBrief = {
      ...approvalBrief,
      attemptId: attempt.id,
    };

    if (hashCanonical(providerBrief) !== attempt.requestFingerprint) {
      throw new WorkflowPolicyError(
        "request_fingerprint_mismatch",
        "The provider request no longer matches the approved live attempt",
      );
    }

    await transaction
      .update(closeoutCases)
      .set({ status: "calling", updatedAt: now })
      .where(eq(closeoutCases.id, closeoutCase.id));

    const [claimedAttempt] = await transaction
      .update(callAttempts)
      .set({ requestedAt: now, updatedAt: now })
      .where(
        and(
          eq(callAttempts.id, attempt.id),
          eq(callAttempts.creationDisposition, "not_requested"),
        ),
      )
      .returning();

    if (!claimedAttempt) {
      throw new Error("The live attempt could not be claimed");
    }

    await transaction.insert(auditEvents).values({
      caseId: closeoutCase.id,
      attemptId: attempt.id,
      actorType: "operator",
      actorId: userId,
      eventType: "attempt.requested",
      metadata: {
        mode: "live",
        provider: "call_e",
        idempotencyKey: attempt.idempotencyKey,
        serverPreflightPassed: true,
        recovery: Boolean(attempt.requestedAt),
      },
    });

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

async function requireLiveCallAuthorized(
  db: FieldCloseDatabase,
  environment: ServerEnvironment,
  userId: string,
  workspaceId: string,
) {
  const decision = await authorizeLiveCall(
    db,
    environment,
    userId,
    workspaceId,
  );

  if (!decision.allowed) {
    throw new WorkflowPolicyError(
      `live_call_blocked_${decision.reason}`,
      `The live call gate blocked this operation: ${decision.reason}`,
    );
  }
}

type LiveWorkflowTransaction = Parameters<
  Parameters<FieldCloseDatabase["transaction"]>[0]
>[0];

async function requireProtectedLiveTransactionAccess(
  transaction: LiveWorkflowTransaction,
  environment: ServerEnvironment,
  userId: string,
  workspaceId: string,
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
  const [killSwitch] = await transaction
    .select({ paused: systemSettings.booleanValue })
    .from(systemSettings)
    .where(eq(systemSettings.key, "live_calls_paused"))
    .limit(1);

  const decision = access
    ? evaluateLiveCallGate(environment, {
        ...access,
        globalKillSwitchPaused: killSwitch?.paused ?? true,
      })
    : ({ allowed: false, reason: "workspace_access_denied" } as const);

  if (!decision.allowed) {
    throw new WorkflowPolicyError(
      `live_call_blocked_${decision.reason}`,
      `The live call gate blocked this operation: ${decision.reason}`,
    );
  }
}

async function requireProtectedWorkspaceTransactionAccess(
  transaction: LiveWorkflowTransaction,
  userId: string,
  workspaceId: string,
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

  if (
    !access ||
    access.kind !== "protected" ||
    access.provider !== "call_e" ||
    !access.liveCallsAllowed
  ) {
    throw new WorkflowPolicyError(
      "protected_workspace_required",
      "A protected CALL-E workspace is required",
    );
  }

  if (access.role === "auditor") {
    throw new WorkflowPolicyError(
      "operator_role_forbidden",
      "An auditor cannot create protected closeout cases",
    );
  }
}

async function requireProtectedOperatorTransactionAccess(
  transaction: LiveWorkflowTransaction,
  userId: string,
  workspaceId: string,
  action: string,
) {
  const [access] = await transaction
    .select({
      kind: workspaces.kind,
      provider: workspaces.provider,
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

  if (
    !access ||
    access.kind !== "protected" ||
    access.provider !== "call_e"
  ) {
    throw new WorkflowPolicyError(
      "protected_workspace_required",
      "A protected CALL-E workspace is required",
    );
  }

  if (access.role === "auditor") {
    throw new WorkflowPolicyError(
      "operator_role_forbidden",
      `An auditor cannot ${action}`,
    );
  }
}

async function loadLiveApprovedAttempt(
  db: LiveWorkflowTransaction,
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

  if (!attempt?.approvalId || attempt.mode !== "live") {
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

function requireLiveContactAuthorization(contact: {
  authorizationBasis: string;
  authorizationNote: string;
}) {
  if (
    contact.authorizationBasis === "demo_fixture" ||
    contact.authorizationNote.trim().length === 0
  ) {
    throw new WorkflowPolicyError(
      "live_contact_authorization_missing",
      "A live call requires a non-demo authorization basis and note",
    );
  }
}

function isPermittedLiveCallingWindow(window: {
  startLocal: string;
  endLocal: string;
}) {
  const start = normalizeLocalDateTime(window.startLocal);
  const end = normalizeLocalDateTime(window.endLocal);

  return (
    start < end &&
    start.slice(0, 10) === end.slice(0, 10) &&
    start.slice(11) >= "08:00:00" &&
    end.slice(11) <= "18:00:00"
  );
}

function isNowInsideCallingWindow(
  now: Date,
  window: {
    timezone: string;
    startLocal: string;
    endLocal: string;
  },
) {
  const localNow = formatLocalDateTime(now, window.timezone);
  const start = normalizeLocalDateTime(window.startLocal);
  const end = normalizeLocalDateTime(window.endLocal);

  return (
    isPermittedLiveCallingWindow(window) &&
    localNow >= start &&
    localNow <= end
  );
}

function normalizeLocalDateTime(value: string) {
  return value.length === 16 ? `${value}:00` : value;
}

function formatLocalDateTime(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}:${value.second}`;
}

function isIanaTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function completedExecution(
  attempt: typeof callAttempts.$inferSelect,
  result: typeof callResults.$inferSelect,
): CallExecutionResult {
  return {
    state: "completed",
    attempt: safeAttempt(attempt),
    result: {
      id: result.id,
      route: result.route,
      summary: result.summary,
      validationFailed: attempt.errorCode === "result_validation_failed",
    },
  };
}

function incompleteExecution(
  state: "in_progress" | "reconciliation_required" | "failed",
  attempt: typeof callAttempts.$inferSelect,
): CallExecutionResult {
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
