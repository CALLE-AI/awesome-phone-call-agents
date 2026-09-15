import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { campaigns, workflows } from "@/lib/db/schema";
import { withRLS } from "@/lib/db/with-rls";
import { requireUser } from "@/lib/supabase/auth";
import type { Workflow } from "@/types/workflow";

type Params = { params: Promise<{ id: string }> };
const ACTIVE_CAMPAIGN_STATUSES = [
  "scheduled",
  "launching",
  "launched",
  "reconciliation_required",
];

/**
 * Load one workflow. RLS (`workflows_select_own`) is what actually enforces that the
 * row belongs to the caller — a request for another user's workflow id comes back as
 * "no rows", which this route reports as 404, not as a distinguishable "forbidden".
 * withRLS() is what makes that policy apply to this direct Postgres connection at all;
 * see lib/db/with-rls.ts.
 */
export async function GET(_request: Request, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;
  const { id } = await params;

  let rows;
  try {
    rows = await withRLS(user.id, (tx) =>
      tx
        .select({ schema: workflows.schema, updatedAt: workflows.updatedAt })
        .from(workflows)
        .where(eq(workflows.id, id))
        .limit(1),
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to load workflow", detail: (err as Error).message },
      { status: 500 },
    );
  }

  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  return NextResponse.json({ workflow: row.schema as Workflow, updatedAt: row.updatedAt });
}

/**
 * Save graph edits made in the visual editor (WorkflowEditor's "Save" action, once
 * wired up — see components/WorkflowGraph.tsx / NodeInspector.tsx). Takes the full
 * Workflow object rather than a patch: the editor already holds the complete edited
 * state client side, and round-tripping a diff format buys nothing for a two-person
 * hackathon build.
 */
export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const workflow = body?.workflow as Workflow | undefined;
  if (!workflow || typeof workflow.goal !== "string") {
    return NextResponse.json({ error: "workflow is required" }, { status: 400 });
  }

  let rows;
  try {
    // `workflows_update_own`'s `with check` still governs this — the row-selecting
    // `eq(workflows.id, id)` below is convenience, not the security boundary. A request
    // for a workflow id this user does not own updates zero rows, not someone else's row.
    rows = await withRLS(user.id, (tx) =>
      tx
        .update(workflows)
        .set({ goal: workflow.goal, schema: { ...workflow, id }, updatedAt: new Date() })
        .where(eq(workflows.id, id))
        .returning({ schema: workflows.schema, updatedAt: workflows.updatedAt }),
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to save workflow", detail: (err as Error).message },
      { status: 500 },
    );
  }

  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  return NextResponse.json({ workflow: row.schema as Workflow, updatedAt: row.updatedAt });
}

/**
 * Permanently remove an owned workflow and its cascaded campaign history. A campaign
 * that is scheduled or may still receive CALL-E events blocks deletion, because removing
 * its correlation rows would make dispatch/webhook handling unsafe. The selected campaign
 * rows are locked so a concurrent launch cannot slip between the state check and delete.
 */
export async function DELETE(_request: Request, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const outcome = await withRLS(auth.user.id, async (tx) => {
      const [owned] = await tx
        .select({ id: workflows.id })
        .from(workflows)
        .where(eq(workflows.id, id))
        .limit(1);
      if (!owned) return "not_found" as const;

      const workflowCampaigns = await tx
        .select({ status: campaigns.status })
        .from(campaigns)
        .where(eq(campaigns.workflowId, id))
        .for("update");
      if (workflowCampaigns.some((campaign) => ACTIVE_CAMPAIGN_STATUSES.includes(campaign.status))) {
        return "active_campaign" as const;
      }

      const [deleted] = await tx
        .delete(workflows)
        .where(eq(workflows.id, id))
        .returning({ id: workflows.id });
      return deleted ? ("deleted" as const) : ("not_found" as const);
    });

    if (outcome === "not_found") {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }
    if (outcome === "active_campaign") {
      return NextResponse.json(
        { error: "This workflow has a scheduled or active campaign and cannot be deleted yet" },
        { status: 409 },
      );
    }
    return new Response(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Failed to delete workflow" }, { status: 500 });
  }
}
