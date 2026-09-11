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
  PROVISION_PROTECTED_WORKSPACE_CONFIRMATION,
  provisionProtectedWorkspace,
} from "@/application/protected-workspaces";
import { getDatabase } from "@/persistence/database";

export const runtime = "nodejs";

const requestSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  displayName: z.string().trim().min(3).max(120),
  confirmation: z.literal(PROVISION_PROTECTED_WORKSPACE_CONFIRMATION),
});

export async function POST(request: Request) {
  const actor = await readAuthenticatedActor(request.headers);

  if (!actor) {
    return unauthorizedResponse();
  }

  try {
    const input = requestSchema.parse(await readBoundedJson(request));
    const result = await provisionProtectedWorkspace(
      getDatabase().db,
      requireServerEnvironment(),
      actor,
      input,
    );

    return NextResponse.json(result, {
      status: result.created ? 201 : 200,
    });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
