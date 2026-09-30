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
type Params = { params: Promise<{ id: string }> };

function workflowFromBody(value: unknown, id: string): Workflow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CampaignInputError(["request body must be a JSON object"]);
  }
  const body = value as Record<string, unknown>;
  const unknown = Object.keys(body).filter((key) => key !== "workflow");
  if (unknown.length) {
    throw new CampaignInputError([`request contains unknown field(s): ${unknown.join(", ")}`]);
  }
  if (
    typeof body.workflow !== "object" ||
    body.workflow === null ||
    Array.isArray(body.workflow)
  ) {
    throw new CampaignInputError(["workflow is required"]);
  }
  return { ...(body.workflow as Workflow), id };
}

export async function POST(request: Request, context: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  try {
    const workflow = workflowFromBody(await readCallJson(request), id);
    const [owned] = await withRLS(auth.user.id, (tx) =>
      tx.select({ id: workflows.id }).from(workflows).where(eq(workflows.id, id)).limit(1),
    );
    if (!owned) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }

    const campaignId = randomUUID();
    const { compiled, name, contact, draft } = await compileWorkflowForCampaign({
      workflow,
      campaignId,
    });
    const compiledAt = new Date();

    await withRLS(auth.user.id, async (tx) => {
      const [updated] = await tx
        .update(workflows)
        .set({ goal: workflow.goal, schema: workflow, updatedAt: compiledAt })
        .where(eq(workflows.id, id))
        .returning({ id: workflows.id });
      if (!updated) throw new Error("Workflow disappeared while compiling");

      await tx.insert(campaigns).values({
        id: campaignId,
        userId: auth.user.id,
        workflowId: id,
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
        { error: "Workflow could not be compiled", issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof EngineError) {
      return NextResponse.json(
        { error: "Workflow compilation failed", detail: error.message },
        { status: error.status === 422 ? 422 : error.status === 503 ? 503 : 502 },
      );
    }
    return NextResponse.json({ error: "Compiled campaign could not be saved" }, { status: 500 });
  }
}
