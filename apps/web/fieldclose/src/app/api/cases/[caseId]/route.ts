import { NextResponse } from "next/server";
import { z } from "zod";

import {
  unauthorizedResponse,
  workflowErrorResponse,
} from "@/app/api/workflow-http";
import { readAuthenticatedActor } from "@/application/authentication";
import { getCloseoutCaseDetail } from "@/application/case-queries";
import { getDatabase } from "@/persistence/database";

export const runtime = "nodejs";

const requestSchema = z.object({
  caseId: z.uuid(),
  workspaceId: z.uuid(),
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
    });
    const detail = await getCloseoutCaseDetail(
      getDatabase().db,
      actor.userId,
      parsed.workspaceId,
      parsed.caseId,
    );
    return NextResponse.json(detail);
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
