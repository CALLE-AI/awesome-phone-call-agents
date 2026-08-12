import { NextResponse } from "next/server";
import { z } from "zod";

import {
  readBoundedJson,
  requirePhoneProtectionKeys,
  requireServerEnvironment,
  unauthorizedResponse,
  workflowErrorResponse,
} from "@/app/api/workflow-http";
import { readAuthenticatedActor } from "@/application/authentication";
import {
  approveFakeAttempt,
  type FakeAttemptApprovalInput,
} from "@/application/closeout-workflow";
import {
  approveLiveAttempt,
  type LiveAttemptApprovalInput,
} from "@/application/live-closeout-workflow";
import { getDatabase } from "@/persistence/database";

export const runtime = "nodejs";

const pathSchema = z.uuid();
const approveRequestSchema = z.object({
  workspaceId: z.uuid(),
  mode: z.enum(["fake", "live"]).default("fake"),
  approval: z.unknown(),
});

type RouteContext = {
  params: Promise<{ caseId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const actor = await readAuthenticatedActor(request.headers);

  if (!actor) {
    return unauthorizedResponse();
  }

  try {
    const caseId = pathSchema.parse((await context.params).caseId);
    const body = approveRequestSchema.parse(await readBoundedJson(request));
    const approved =
      body.mode === "live"
        ? await approveLiveAttempt(
            getDatabase().db,
            requireServerEnvironment(),
            actor.userId,
            body.workspaceId,
            caseId,
            body.approval as LiveAttemptApprovalInput,
            requirePhoneProtectionKeys(),
          )
        : await approveFakeAttempt(
            getDatabase().db,
            actor.userId,
            body.workspaceId,
            caseId,
            body.approval as FakeAttemptApprovalInput,
            requirePhoneProtectionKeys(),
          );
    return NextResponse.json({
      attempt: {
        id: approved.attempt.id,
        caseId: approved.attempt.caseId,
        providerTaskStatus: approved.attempt.providerTaskStatus,
        attemptOutcome: approved.attempt.attemptOutcome,
        creationDisposition: approved.attempt.creationDisposition,
      },
      approval: {
        id: approved.approval.id,
        caseVersion: approved.approval.caseVersion,
        approvedAt: approved.approval.approvedAt,
        briefHash: approved.approval.briefHash,
        liveCallApproved: approved.approval.liveCallApproved,
      },
      reused: approved.reused,
    });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
