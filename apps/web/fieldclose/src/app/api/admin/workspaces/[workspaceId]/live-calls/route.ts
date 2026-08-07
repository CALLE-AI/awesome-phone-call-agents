import { NextResponse } from "next/server";
import { z } from "zod";

import {
  readBoundedJson,
  requireServerEnvironment,
  unauthorizedResponse,
  workflowErrorResponse,
} from "@/app/api/workflow-http";
import { readAuthenticatedActor } from "@/application/authentication";
import {
  ENABLE_LIVE_CALLS_CONFIRMATION,
  PAUSE_LIVE_CALLS_CONFIRMATION,
  setProtectedWorkspaceLiveCalls,
} from "@/application/protected-workspaces";
import { getDatabase } from "@/persistence/database";

export const runtime = "nodejs";

const pathSchema = z.uuid();
const requestSchema = z.object({
  enabled: z.boolean(),
  confirmation: z.enum([
    ENABLE_LIVE_CALLS_CONFIRMATION,
    PAUSE_LIVE_CALLS_CONFIRMATION,
  ]),
});

type RouteContext = {
  params: Promise<{ workspaceId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const actor = await readAuthenticatedActor(request.headers);

  if (!actor) {
    return unauthorizedResponse();
  }

  try {
    const workspaceId = pathSchema.parse((await context.params).workspaceId);
    const input = requestSchema.parse(await readBoundedJson(request));
    const result = await setProtectedWorkspaceLiveCalls(
      getDatabase().db,
      requireServerEnvironment(),
      actor,
      workspaceId,
      input,
    );

    return NextResponse.json(result);
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
