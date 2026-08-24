import { NextResponse } from "next/server";
import { z } from "zod";

import {
  readBoundedJson,
  requirePhoneProtectionKeys,
  unauthorizedResponse,
  workflowErrorResponse,
} from "@/app/api/workflow-http";
import { readAuthenticatedActor } from "@/application/authentication";
import { listCloseoutCases } from "@/application/case-queries";
import {
  createDemoCloseoutCase,
  type DemoCloseoutCaseInput,
} from "@/application/closeout-workflow";
import {
  createProtectedCloseoutCase,
  type ProtectedCloseoutCaseInput,
} from "@/application/live-closeout-workflow";
import { getDatabase } from "@/persistence/database";

export const runtime = "nodejs";

const workspaceQuerySchema = z.uuid();
const createRequestSchema = z.object({
  workspaceId: z.uuid(),
  mode: z.enum(["fake", "live"]).default("fake"),
  case: z.unknown(),
});

export async function GET(request: Request) {
  const actor = await readAuthenticatedActor(request.headers);

  if (!actor) {
    return unauthorizedResponse();
  }

  try {
    const workspaceId = workspaceQuerySchema.parse(
      new URL(request.url).searchParams.get("workspaceId"),
    );
    const cases = await listCloseoutCases(
      getDatabase().db,
      actor.userId,
      workspaceId,
    );
    return NextResponse.json({ cases });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const actor = await readAuthenticatedActor(request.headers);

  if (!actor) {
    return unauthorizedResponse();
  }

  try {
    const body = createRequestSchema.parse(await readBoundedJson(request));
    const created =
      body.mode === "live"
        ? await createProtectedCloseoutCase(
            getDatabase().db,
            actor.userId,
            body.workspaceId,
            body.case as ProtectedCloseoutCaseInput,
            requirePhoneProtectionKeys(),
          )
        : await createDemoCloseoutCase(
            getDatabase().db,
            actor.userId,
            body.workspaceId,
            body.case as DemoCloseoutCaseInput,
            requirePhoneProtectionKeys(),
          );
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
