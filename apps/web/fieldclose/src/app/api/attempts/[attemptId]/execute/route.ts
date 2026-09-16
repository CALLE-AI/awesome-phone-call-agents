import { NextResponse } from "next/server";
import { z } from "zod";

import {
  readBoundedJson,
  requireCallEConfiguration,
  requirePhoneProtectionKeys,
  unauthorizedResponse,
  workflowErrorResponse,
} from "@/app/api/workflow-http";
import { readAuthenticatedActor } from "@/application/authentication";
import { executeApprovedFakeAttempt } from "@/application/closeout-workflow";
import { executeApprovedLiveAttempt } from "@/application/live-closeout-workflow";
import { getDatabase } from "@/persistence/database";
import { CallECallProvider } from "@/providers/call-e/call-e-call-provider";
import { FakeCallProvider } from "@/providers/fake/fake-call-provider";
import { fakeScenarioIdValues } from "@/providers/fake/scenarios";

export const runtime = "nodejs";

const pathSchema = z.uuid();
const executeRequestSchema = z.union([
  z.object({
    workspaceId: z.uuid(),
    mode: z.literal("live"),
  }),
  z.object({
    workspaceId: z.uuid(),
    mode: z.literal("fake").optional(),
    scenarioId: z.enum(fakeScenarioIdValues),
  }),
]);

type RouteContext = {
  params: Promise<{ attemptId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const actor = await readAuthenticatedActor(request.headers);

  if (!actor) {
    return unauthorizedResponse();
  }

  try {
    const attemptId = pathSchema.parse((await context.params).attemptId);
    const body = executeRequestSchema.parse(await readBoundedJson(request));
    const execution =
      body.mode === "live"
        ? await executeLiveAttempt(
            actor.userId,
            body.workspaceId,
            attemptId,
          )
        : await executeApprovedFakeAttempt(
            getDatabase().db,
            actor.userId,
            body.workspaceId,
            attemptId,
            new FakeCallProvider(body.scenarioId),
            requirePhoneProtectionKeys(),
          );
    return NextResponse.json({ execution });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}

async function executeLiveAttempt(
  userId: string,
  workspaceId: string,
  attemptId: string,
) {
  const { environment, callE } = requireCallEConfiguration();

  return executeApprovedLiveAttempt(
    getDatabase().db,
    environment,
    userId,
    workspaceId,
    attemptId,
    new CallECallProvider(callE),
    requirePhoneProtectionKeys(),
  );
}
