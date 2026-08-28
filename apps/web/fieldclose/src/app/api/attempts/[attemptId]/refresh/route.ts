import { NextResponse } from "next/server";
import { z } from "zod";

import {
  readBoundedJson,
  requireCallEConfiguration,
  unauthorizedResponse,
  workflowErrorResponse,
} from "@/app/api/workflow-http";
import { readAuthenticatedActor } from "@/application/authentication";
import { refreshAcceptedLiveAttempt } from "@/application/live-closeout-workflow";
import { getDatabase } from "@/persistence/database";
import { CallECallProvider } from "@/providers/call-e/call-e-call-provider";

export const runtime = "nodejs";

const pathSchema = z.uuid();
const refreshRequestSchema = z
  .object({
    workspaceId: z.uuid(),
  })
  .strict();

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
    const body = refreshRequestSchema.parse(await readBoundedJson(request));
    const { callE } = requireCallEConfiguration();
    const execution = await refreshAcceptedLiveAttempt(
      getDatabase().db,
      actor.userId,
      body.workspaceId,
      attemptId,
      new CallECallProvider(callE),
    );

    return NextResponse.json({ execution });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
