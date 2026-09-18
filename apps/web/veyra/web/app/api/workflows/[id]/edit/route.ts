import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { workflows } from "@/lib/db/schema";
import { withRLS } from "@/lib/db/with-rls";
import { EngineError, editWorkflow } from "@/lib/engine-client";
import { requireUser } from "@/lib/supabase/auth";
import type { Workflow } from "@/types/workflow";

type Params = { params: Promise<{ id: string }> };

/**
 * Natural-language editing: "add a question about income after risk tolerance"
 * instead of hand-editing nodes in the graph. Loads the current saved workflow,
 * sends it plus the instruction to the engine, and persists whatever comes back.
 *
 * The load and the save are two separate withRLS() transactions, not one wrapping the
 * engine call in between — a Postgres transaction (and the pooled connection behind it)
 * should never sit open across an outbound HTTP request of unknown duration.
 */
export async function POST(request: Request, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
  if (!instruction) {
    return NextResponse.json({ error: "instruction is required" }, { status: 400 });
  }

  let existingRows;
  try {
    existingRows = await withRLS(user.id, (tx) =>
      tx.select({ schema: workflows.schema }).from(workflows).where(eq(workflows.id, id)).limit(1),
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to load workflow", detail: (err as Error).message },
      { status: 500 },
    );
  }

  const existing = existingRows[0];
  if (!existing) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  let edited;
  try {
    edited = await editWorkflow(existing.schema as Workflow, instruction);
  } catch (err) {
    if (err instanceof EngineError) {
      return NextResponse.json(
        { error: "Workflow edit failed", detail: err.message },
        { status: err.status === 503 ? 503 : 502 },
      );
    }
    throw err;
  }

  const workflow: Workflow = { ...edited.workflow, id };

  let savedRows;
  try {
    savedRows = await withRLS(user.id, (tx) =>
      tx
        .update(workflows)
        .set({ goal: workflow.goal, schema: workflow, updatedAt: new Date() })
        .where(eq(workflows.id, id))
        .returning({ schema: workflows.schema }),
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Workflow was edited but could not be saved", detail: (err as Error).message },
      { status: 500 },
    );
  }

  const saved = savedRows[0];
  if (!saved) {
    return NextResponse.json(
      { error: "Workflow was edited but could not be saved" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    workflow: saved.schema as Workflow,
    errors: edited.errors,
    warnings: edited.warnings,
  });
}
