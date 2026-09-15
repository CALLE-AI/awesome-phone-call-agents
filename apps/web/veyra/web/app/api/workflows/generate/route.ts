import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { EngineError, generateWorkflow } from "@/lib/engine-client";
import { campaignNameFromGoal } from "@/lib/campaigns/compile";
import { workflows } from "@/lib/db/schema";
import { withRLS } from "@/lib/db/with-rls";
import { requireUser } from "@/lib/supabase/auth";
import type { Workflow } from "@/types/workflow";

/**
 * Prompt in, saved workflow out. The engine (engine/, FastAPI) generates and validates
 * the Workflow but never persists anything — this route owns turning that into a row
 * the requesting user actually owns.
 *
 * Auth: requireUser() gates the whole route (that part is unchanged — it still verifies
 * the session via Supabase Auth). The insert itself runs through withRLS(), which
 * impersonates this user for one transaction so the same `workflows_insert_own` RLS
 * policy that used to run under PostgREST still runs here: a request without a valid
 * session never reaches the insert, and one with a valid session cannot write a row it
 * doesn't own — Postgres enforces that, not this route's code.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const body = await request.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }
  const nameMode = body?.nameMode ?? "ai";
  if (nameMode !== "ai" && nameMode !== "manual") {
    return NextResponse.json(
      { error: 'nameMode must be either "ai" or "manual"' },
      { status: 400 },
    );
  }
  const requestedName =
    typeof body?.name === "string" ? body.name.replace(/\s+/g, " ").trim() : "";
  if (nameMode === "manual" && (requestedName.length < 3 || requestedName.length > 48)) {
    return NextResponse.json(
      { error: "A manual workflow name must contain 3 to 48 characters" },
      { status: 400 },
    );
  }

  let generated;
  try {
    generated = await generateWorkflow(prompt);
  } catch (err) {
    if (err instanceof EngineError) {
      return NextResponse.json(
        { error: "Workflow generation failed", detail: err.message },
        { status: err.status === 503 ? 503 : 502 },
      );
    }
    throw err;
  }

  // The engine assigns a placeholder id; the Postgres row's id is the one every other
  // route (load, edit, compile) will address this workflow by, so it replaces the
  // placeholder rather than living alongside it.
  const workflowId = randomUUID();
  const workflow: Workflow = {
    ...generated.workflow,
    id: workflowId,
    name:
      nameMode === "manual"
        ? requestedName
        : campaignNameFromGoal(generated.workflow.name ?? generated.workflow.goal),
  };

  let saved;
  try {
    [saved] = await withRLS(user.id, (tx) =>
      tx
        .insert(workflows)
        .values({
          id: workflowId,
          userId: user.id,
          goal: workflow.goal,
          sourcePrompt: prompt,
          schema: workflow,
        })
        .returning({ schema: workflows.schema }),
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Workflow was generated but could not be saved", detail: (err as Error).message },
      { status: 500 },
    );
  }

  if (!saved) {
    return NextResponse.json(
      { error: "Workflow was generated but could not be saved" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { workflow: saved.schema as Workflow, errors: generated.errors, warnings: generated.warnings },
    { status: 201 },
  );
}
