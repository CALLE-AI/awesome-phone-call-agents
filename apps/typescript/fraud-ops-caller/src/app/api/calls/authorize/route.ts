import { NextResponse } from "next/server";
import { getCase } from "@/lib/cases";
import { authorizeOpsRequest, signLiveGrant } from "@/lib/ops-auth";
import { maskE164 } from "@/lib/plan-view";
import { liveDialAllowlist } from "@/lib/run-call";

export async function POST(req: Request) {
  const auth = authorizeOpsRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const caseId = typeof rec.caseId === "string" ? rec.caseId : "";
  const fraudCase = getCase(caseId);
  if (!fraudCase) {
    return NextResponse.json({ error: "unknown caseId" }, { status: 404 });
  }
  const approved = fraudCase.contact.phone_e164;
  const requested = typeof rec.to === "string" ? rec.to : undefined;
  if (requested !== undefined && requested !== approved) {
    return NextResponse.json({ error: "destination does not match approved phone" }, { status: 403 });
  }
  const allow = liveDialAllowlist();
  if (allow && !allow.includes(approved)) {
    return NextResponse.json({ error: "destination not on server allowlist" }, { status: 403 });
  }
  const grant = signLiveGrant(fraudCase.case_id, approved);
  return NextResponse.json({
    liveGrant: grant.token,
    maskedTo: maskE164(approved),
    exp: grant.exp,
  });
}
