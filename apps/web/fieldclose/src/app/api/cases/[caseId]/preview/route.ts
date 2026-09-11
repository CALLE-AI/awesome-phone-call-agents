import { NextResponse } from "next/server";
import { z } from "zod";

import {
  requirePhoneProtectionKeys,
  requireServerEnvironment,
  unauthorizedResponse,
  workflowErrorResponse,
} from "@/app/api/workflow-http";
import { readAuthenticatedActor } from "@/application/authentication";
import { previewFakeCallBrief } from "@/application/closeout-workflow";
import { previewLiveCallBrief } from "@/application/live-closeout-workflow";
import { getDatabase } from "@/persistence/database";

export const runtime = "nodejs";

const requestSchema = z.object({
  caseId: z.uuid(),
  workspaceId: z.uuid(),
  mode: z.enum(["fake", "live"]).default("fake"),
});

type RouteContext = {
  params: Promise<{ caseId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const actor = await readAuthenticatedActor(request.headers);

  if (!actor) {
    return unauthorizedResponse();
  }

  try {
    const parameters = await context.params;
    const parsed = requestSchema.parse({
      caseId: parameters.caseId,
      workspaceId: new URL(request.url).searchParams.get("workspaceId"),
      mode: new URL(request.url).searchParams.get("mode") ?? "fake",
    });
    const preview =
      parsed.mode === "live"
        ? await previewLiveCallBrief(
            getDatabase().db,
            requireServerEnvironment(),
            actor.userId,
            parsed.workspaceId,
            parsed.caseId,
            requirePhoneProtectionKeys(),
          )
        : await previewFakeCallBrief(
            getDatabase().db,
            actor.userId,
            parsed.workspaceId,
            parsed.caseId,
            requirePhoneProtectionKeys(),
          );
    return NextResponse.json({ preview });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
