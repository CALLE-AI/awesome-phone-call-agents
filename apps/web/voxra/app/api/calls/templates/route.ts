import { NextRequest, NextResponse } from "next/server";
import { getUsableCalleSession } from "@/lib/auth";
import { getTemplates, saveTemplate, type CallTemplate } from "@/lib/templates";
import { checkRateLimit } from "@/lib/rate-limit";
import { getRequestId, logError } from "@/lib/observability";

// GET /api/calls/templates — list templates for the current user
export async function GET(req: NextRequest) {
  const rl = await checkRateLimit(req, "templates-get", 60, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } }
    );
  }

  const session = await getUsableCalleSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.email) return NextResponse.json({ templates: [] });

  try {
    const templates = await getTemplates(session.email);
    return NextResponse.json({ templates });
  } catch (err) {
    logError("Failed to load templates", err, { route: "/api/calls/templates" });
    return NextResponse.json({ templates: [] });
  }
}

// POST /api/calls/templates — create a new template
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req);
  const rl = await checkRateLimit(req, "templates-post", 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } }
    );
  }

  const session = await getUsableCalleSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.email) return NextResponse.json({ error: "Session missing email" }, { status: 400 });

  let body: { name?: string; phone?: string; goal?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  const goal = (body.goal ?? "").trim();
  const phone = (body.phone ?? "").trim();

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 422 });
  if (!goal) return NextResponse.json({ error: "goal is required" }, { status: 422 });
  if (phone && !/^\+\d{7,15}$/.test(phone)) {
    return NextResponse.json({ error: "phone must be E.164 format" }, { status: 422 });
  }

  const template: CallTemplate = {
    id: crypto.randomUUID(),
    name,
    goal,
    phone: phone || undefined,
    createdAt: new Date().toISOString(),
  };

  try {
    await saveTemplate(session.email, template);
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    logError("Failed to save template", err, { route: "/api/calls/templates", requestId });
    const msg = err instanceof Error ? err.message : "Failed to save template";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
