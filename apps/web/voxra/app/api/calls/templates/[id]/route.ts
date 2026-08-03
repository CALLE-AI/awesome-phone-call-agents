import { NextRequest, NextResponse } from "next/server";
import { getUsableCalleSession } from "@/lib/auth";
import { deleteTemplate } from "@/lib/templates";
import { checkRateLimit } from "@/lib/rate-limit";
import { getRequestId, logError } from "@/lib/observability";

// DELETE /api/calls/templates/[id] — delete a template
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req);
  const rl = await checkRateLimit(req, "templates-delete", 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } }
    );
  }

  const session = await getUsableCalleSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.email) return NextResponse.json({ error: "Session missing email" }, { status: 400 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 422 });

  try {
    await deleteTemplate(session.email, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("Failed to delete template", err, { route: "/api/calls/templates/[id]", requestId });
    const msg = err instanceof Error ? err.message : "Failed to delete template";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
