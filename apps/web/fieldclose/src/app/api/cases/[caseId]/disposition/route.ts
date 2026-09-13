import { NextResponse } from "next/server";
import { z } from "zod";

import {
  readBoundedJson,
  unauthorizedResponse,
  workflowErrorResponse,
} from "@/app/api/workflow-http";
import { readAuthenticatedActor } from "@/application/authentication";
import {
  recordHumanDisposition,
  type HumanDispositionInput,
} from "@/application/human-disposition";
import { humanDispositionOutcomeValues } from "@/domain/enums";
import { getDatabase } from "@/persistence/database";

export const runtime = "nodejs";

const pathSchema = z.uuid();
const requestSchema = z
  .object({
    workspaceId: z.uuid(),
    expectedCaseVersion: z.number().int().positive(),
    taskId: z.uuid(),
    outcome: z.enum(humanDispositionOutcomeValues),
    resolutionNote: z.string().trim().min(1).max(1_000).nullable(),
  })
  .strict();

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
    const body = requestSchema.parse(await readBoundedJson(request));
    const { workspaceId, ...disposition } = body;
    const result = await recordHumanDisposition(
      getDatabase().db,
      actor.userId,
      workspaceId,
      caseId,
      disposition as HumanDispositionInput,
    );

    return NextResponse.json(result);
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
