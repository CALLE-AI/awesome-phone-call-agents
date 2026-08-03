import { NextRequest, NextResponse } from "next/server";
import { getUsableCalleSession } from "@/lib/auth";
import { getWebhookUrl, setWebhookUrl, deleteWebhookUrl } from "@/lib/webhooks";
import { checkRateLimit } from "@/lib/rate-limit";
import { getRequestId, logError } from "@/lib/observability";

// GET /api/settings/webhook — return masked webhook URL if set
export async function GET(req: NextRequest) {
  const rl = await checkRateLimit(req, "webhook-get", 60, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } }
    );
  }

  const session = await getUsableCalleSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.email) return NextResponse.json({ url: null });

  try {
    const url = await getWebhookUrl(session.email);
    if (!url) return NextResponse.json({ url: null });
    // Mask the URL for display: show scheme + host only
    const masked = (() => {
      try {
        const u = new URL(url);
        return `${u.protocol}//${u.host}/***`;
      } catch {
        return "***";
      }
    })();
    return NextResponse.json({ url: masked, configured: true });
  } catch (err) {
    logError("Failed to get webhook", err, { route: "/api/settings/webhook" });
    return NextResponse.json({ url: null });
  }
}

// POST /api/settings/webhook — set webhook URL
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req);
  const rl = await checkRateLimit(req, "webhook-post", 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } }
    );
  }

  const session = await getUsableCalleSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.email) return NextResponse.json({ error: "Session missing email" }, { status: 400 });

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const url = (body.url ?? "").trim();
  if (!url) return NextResponse.json({ error: "url is required" }, { status: 422 });

  // Validate it's an HTTPS URL
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return NextResponse.json({ error: "Webhook URL must use HTTPS" }, { status: 422 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 422 });
  }

  try {
    await setWebhookUrl(session.email, url);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("Failed to save webhook", err, { route: "/api/settings/webhook", requestId });
    return NextResponse.json({ error: "Failed to save webhook" }, { status: 500 });
  }
}

// DELETE /api/settings/webhook — remove webhook URL
export async function DELETE(req: NextRequest) {
  const rl = await checkRateLimit(req, "webhook-delete", 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } }
    );
  }

  const session = await getUsableCalleSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.email) return NextResponse.json({ ok: true });

  try {
    await deleteWebhookUrl(session.email);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("Failed to delete webhook", err, { route: "/api/settings/webhook" });
    return NextResponse.json({ error: "Failed to delete webhook" }, { status: 500 });
  }
}
