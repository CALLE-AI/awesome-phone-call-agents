import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { CallHttpError, readCallJson } from "@/lib/calle/http";
import { SafeCallInputError } from "@/lib/calle/safety";
import { CampaignInputError } from "@/lib/campaigns/compile";
import { compileWorkflowForCampaign } from "@/lib/campaigns/create";
import { campaigns, contacts, workflows } from "@/lib/db/schema";
import { withRLS } from "@/lib/db/with-rls";
import { EngineError } from "@/lib/engine-client";
import { requireUser } from "@/lib/supabase/auth";
import type { Workflow } from "@/types/workflow";

export const runtime = "nodejs";

interface NewCampaignInput {
  workflowId: string;
  name?: string;
}

function parseInput(value: unknown): NewCampaignInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CampaignInputError(["request body must be a JSON object"]);
  }
  const body = value as Record<string, unknown>;
  const unknown = Object.keys(body).filter((key) => key !== "workflowId" && key !== "name");
  if (unknown.length) {
    throw new CampaignInputError([`request contains unknown field(s): ${unknown.join(", ")}`]);
  }
  if (typeof body.workflowId !== "string" || !body.workflowId) {
    throw new CampaignInputError(["workflowId is required"]);
  }
  if (body.name !== undefined && typeof body.name !== "string") {
    throw new CampaignInputError(["name must be a string"]);
  }
  return {
    workflowId: body.workflowId,
    ...(typeof body.name === "string" ? { name: body.name } : {}),
  };
}

/**
 * The second campaign-creation entry point (the first is
 * POST /api/workflows/[id]/compile, triggered from the workflow editor). This one is for
 * the campaigns list's "New Campaign" flow, where there's no live editor state to send —
 * just a saved workflow id — so it loads the already-saved workflow instead of accepting
 * one in the body. See lib/campaigns/create.ts for the shared compile/validate logic.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const input = parseInput(await readCallJson(request));
    const [owned] = await withRLS(auth.user.id, (tx) =>
      tx
        .select({ schema: workflows.schema })
        .from(workflows)
        .where(eq(workflows.id, input.workflowId))
        .limit(1),
    );
    if (!owned) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }
    const workflow = owned.schema as Workflow;

    const campaignId = randomUUID();
    const { compiled, name, contact, draft } = await compileWorkflowForCampaign({
      workflow,
      campaignId,
      ...(input.name ? { name: input.name } : {}),
    });
    const compiledAt = new Date();

    await withRLS(auth.user.id, async (tx) => {
      await tx.insert(campaigns).values({
        id: campaignId,
        userId: auth.user.id,
        workflowId: input.workflowId,
        compiledRequest: compiled,
        name,
        status: "compiled",
        locale: "en-IN",
      });
      await tx.insert(contacts).values({
        id: contact.id,
        campaignId,
        name: contact.name,
        phoneNumber: contact.phoneNumber,
        metadata: contact.metadata,
      });
    });

    return NextResponse.json(
      { campaignId, workflow, contact, draft, compiledAt: compiledAt.toISOString() },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof CallHttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof CampaignInputError || error instanceof SafeCallInputError) {
      return NextResponse.json(
        { error: "Campaign could not be created", issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof EngineError) {
      return NextResponse.json(
        { error: "Workflow compilation failed", detail: error.message },
        { status: error.status === 422 ? 422 : error.status === 503 ? 503 : 502 },
      );
    }
    return NextResponse.json({ error: "Campaign could not be created" }, { status: 500 });
  }
}
