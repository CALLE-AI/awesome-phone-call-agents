import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  followUpTaskTypeValues,
  humanDispositionOutcomeValues,
  resultRouteValues,
  type HumanDispositionOutcome,
} from "@/domain/enums";
import type { FieldCloseDatabase } from "@/persistence/database";
import {
  auditEvents,
  callResults,
  closeoutCases,
  followUpTasks,
  humanDispositions,
  workspaceMemberships,
} from "@/persistence/schema";

const handoffOutcomes = new Set<HumanDispositionOutcome>([
  "return_visit_handoff",
  "manual_follow_up_handoff",
]);

const humanDispositionInputSchema = z
  .object({
    expectedCaseVersion: z.number().int().positive(),
    taskId: z.uuid(),
    outcome: z.enum(humanDispositionOutcomeValues),
    resolutionNote: z.string().trim().min(1).max(1_000).nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    if (handoffOutcomes.has(input.outcome) && input.resolutionNote === null) {
      context.addIssue({
        code: "custom",
        path: ["resolutionNote"],
        message: "A handoff disposition requires a resolution note",
      });
    }
  });

export type HumanDispositionInput = z.input<
  typeof humanDispositionInputSchema
>;

type FollowUpTaskType = (typeof followUpTaskTypeValues)[number];
type ResultRoute = (typeof resultRouteValues)[number];

export class HumanDispositionPolicyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HumanDispositionPolicyError";
  }
}

export function parseHumanDispositionInput(input: HumanDispositionInput) {
  return humanDispositionInputSchema.parse(input);
}

export function isHumanDispositionAllowed(input: {
  taskType: FollowUpTaskType;
  resultRoute: ResultRoute | null;
  outcome: HumanDispositionOutcome;
}) {
  if (input.outcome === "no_further_automated_action") {
    return true;
  }

  if (input.outcome === "closeout_accepted") {
    return (
      input.taskType === "closeout_review" &&
      input.resultRoute === "ready_for_closeout_review"
    );
  }

  if (input.outcome === "return_visit_handoff") {
    return (
      input.taskType === "return_visit_review" &&
      input.resultRoute === "return_visit_review"
    );
  }

  return input.taskType !== "closeout_review";
}

export async function recordHumanDisposition(
  db: FieldCloseDatabase,
  userId: string,
  workspaceId: string,
  caseId: string,
  input: HumanDispositionInput,
) {
  const parsed = parseHumanDispositionInput(input);

  return db.transaction(async (transaction) => {
    const [membership] = await transaction
      .select({ role: workspaceMemberships.role })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, workspaceId),
          eq(workspaceMemberships.userId, userId),
        ),
      )
      .limit(1);

    if (!membership) {
      throw new HumanDispositionPolicyError(
        "workspace_access_denied",
        "Workspace access is required",
      );
    }

    if (membership.role === "auditor") {
      throw new HumanDispositionPolicyError(
        "operator_role_forbidden",
        "An auditor cannot record a human disposition",
      );
    }

    const [closeoutCase] = await transaction
      .select({
        id: closeoutCases.id,
        version: closeoutCases.version,
        status: closeoutCases.status,
        currentAttemptId: closeoutCases.currentAttemptId,
      })
      .from(closeoutCases)
      .where(
        and(
          eq(closeoutCases.id, caseId),
          eq(closeoutCases.workspaceId, workspaceId),
        ),
      )
      .limit(1)
      .for("update");

    if (!closeoutCase) {
      throw new HumanDispositionPolicyError(
        "case_not_found",
        "The closeout case was not found",
      );
    }

    const [existing] = await transaction
      .select()
      .from(humanDispositions)
      .where(eq(humanDispositions.caseId, caseId))
      .limit(1);

    if (existing) {
      if (
        existing.taskId === parsed.taskId &&
        existing.outcome === parsed.outcome &&
        existing.resolutionNote === parsed.resolutionNote
      ) {
        return loadDispositionResponse(transaction, existing, true);
      }

      throw new HumanDispositionPolicyError(
        "human_disposition_conflict",
        "A different final disposition is already recorded",
      );
    }

    if (closeoutCase.version !== parsed.expectedCaseVersion) {
      throw new HumanDispositionPolicyError(
        "stale_case_version",
        "The case changed after the disposition form was loaded",
      );
    }

    if (
      !["completed", "needs_attention", "failed"].includes(
        closeoutCase.status,
      )
    ) {
      throw new HumanDispositionPolicyError(
        "case_not_ready_for_disposition",
        "The case does not have a human-review outcome",
      );
    }

    const openTasks = await transaction
      .select({
        id: followUpTasks.id,
        type: followUpTasks.type,
        status: followUpTasks.status,
      })
      .from(followUpTasks)
      .where(
        and(
          eq(followUpTasks.caseId, caseId),
          eq(followUpTasks.status, "open"),
        ),
      )
      .for("update");

    if (openTasks.length !== 1 || openTasks[0]?.id !== parsed.taskId) {
      throw new HumanDispositionPolicyError(
        "disposition_task_mismatch",
        "The submitted task is not the single current human action",
      );
    }

    const task = openTasks[0];
    const [result] = await transaction
      .select({ route: callResults.route })
      .from(callResults)
      .where(eq(callResults.caseId, caseId))
      .orderBy(desc(callResults.normalizedAt))
      .limit(1);

    if (
      !isHumanDispositionAllowed({
        taskType: task.type,
        resultRoute: result?.route ?? null,
        outcome: parsed.outcome,
      })
    ) {
      throw new HumanDispositionPolicyError(
        "disposition_outcome_not_allowed",
        "The disposition is not permitted for the current result and task",
      );
    }

    const now = new Date();
    const [disposition] = await transaction
      .insert(humanDispositions)
      .values({
        caseId,
        taskId: task.id,
        outcome: parsed.outcome,
        resolutionNote: parsed.resolutionNote,
        recordedBy: userId,
        recordedAt: now,
      })
      .returning();

    const taskStatus =
      parsed.outcome === "no_further_automated_action"
        ? ("cancelled" as const)
        : ("resolved" as const);
    const [updatedTask] = await transaction
      .update(followUpTasks)
      .set({
        status: taskStatus,
        assignedTo: userId,
        resolvedAt: now,
        resolutionNote: parsed.resolutionNote,
      })
      .where(
        and(
          eq(followUpTasks.id, task.id),
          eq(followUpTasks.caseId, caseId),
          eq(followUpTasks.status, "open"),
        ),
      )
      .returning();

    const [updatedCase] = await transaction
      .update(closeoutCases)
      .set({
        status: "closed",
        version: sql`${closeoutCases.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(closeoutCases.id, caseId),
          eq(closeoutCases.workspaceId, workspaceId),
          eq(closeoutCases.version, parsed.expectedCaseVersion),
        ),
      )
      .returning({
        id: closeoutCases.id,
        status: closeoutCases.status,
        version: closeoutCases.version,
        updatedAt: closeoutCases.updatedAt,
      });

    if (!disposition || !updatedTask || !updatedCase) {
      throw new HumanDispositionPolicyError(
        "human_disposition_write_failed",
        "The human disposition could not be stored atomically",
      );
    }

    const [audit] = await transaction
      .insert(auditEvents)
      .values({
        caseId,
        attemptId: closeoutCase.currentAttemptId,
        actorType: "operator",
        actorId: userId,
        eventType: "case.human_disposition_recorded",
        metadata: {
          outcome: disposition.outcome,
          taskId: disposition.taskId,
          previousCaseStatus: closeoutCase.status,
          taskStatus,
          resolutionNoteRecorded: disposition.resolutionNote !== null,
        },
        occurredAt: now,
      })
      .returning({
        id: auditEvents.id,
        eventType: auditEvents.eventType,
        occurredAt: auditEvents.occurredAt,
      });

    if (!audit) {
      throw new HumanDispositionPolicyError(
        "human_disposition_write_failed",
        "The human disposition audit event could not be stored",
      );
    }

    return {
      disposition,
      case: updatedCase,
      task: updatedTask,
      audit,
      reused: false,
    };
  });
}

type DispositionTransaction = Parameters<
  Parameters<FieldCloseDatabase["transaction"]>[0]
>[0];

async function loadDispositionResponse(
  transaction: DispositionTransaction,
  disposition: typeof humanDispositions.$inferSelect,
  reused: boolean,
) {
  const [[closeoutCase], [task], [audit]] = await Promise.all([
    transaction
      .select({
        id: closeoutCases.id,
        status: closeoutCases.status,
        version: closeoutCases.version,
        updatedAt: closeoutCases.updatedAt,
      })
      .from(closeoutCases)
      .where(eq(closeoutCases.id, disposition.caseId))
      .limit(1),
    transaction
      .select()
      .from(followUpTasks)
      .where(eq(followUpTasks.id, disposition.taskId))
      .limit(1),
    transaction
      .select({
        id: auditEvents.id,
        eventType: auditEvents.eventType,
        occurredAt: auditEvents.occurredAt,
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.caseId, disposition.caseId),
          eq(auditEvents.eventType, "case.human_disposition_recorded"),
        ),
      )
      .orderBy(desc(auditEvents.occurredAt))
      .limit(1),
  ]);

  if (!closeoutCase || !task || !audit) {
    throw new HumanDispositionPolicyError(
      "human_disposition_state_incomplete",
      "The stored human disposition is incomplete",
    );
  }

  return { disposition, case: closeoutCase, task, audit, reused };
}
