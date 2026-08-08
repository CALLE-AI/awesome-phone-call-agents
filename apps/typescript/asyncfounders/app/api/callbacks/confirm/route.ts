import { CalleClient } from "@call-e/calle";
import { NextResponse } from "next/server";
import { authenticatedUser, adminSupabase } from "../../../../lib/supabase";
import { buildTask, confirmInputSchema, recipientResultSchema } from "../../../../lib/callbacks";

export async function POST(request: Request) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({ message: "Sign in again before confirming a callback." }, { status: 401 });
    const parsed = confirmInputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ message: "The callback confirmation is invalid." }, { status: 400 });
    const supabase = adminSupabase();
    const { data: session } = await supabase.from("call_sessions").select("*").eq("id", parsed.data.previewId).eq("requested_by", user.id).single();
    if (!session) return NextResponse.json({ message: "This callback preview was not found." }, { status: 404 });
    if (session.status !== "previewed") return NextResponse.json({ ok: true, previewId: session.id, status: session.status, callId: session.provider_call_id, replayed: true });
    const preview = session.preview as { expiresAt?: string };
    if (!preview.expiresAt || new Date(preview.expiresAt).getTime() < Date.now()) {
      await supabase.from("call_sessions").update({ status: "expired" }).eq("id", session.id);
      return NextResponse.json({ message: "The preview expired. Review the call again." }, { status: 409 });
    }
    const [{ data: company }, { data: member }] = await Promise.all([
      supabase.from("companies").select("name").eq("id", session.company_id).single(),
      supabase.from("company_members").select("display_name,region,locale,phone_e164,call_consent,status").eq("id", session.member_id).single(),
    ]);
    if (!company || !member || !member.call_consent || member.status !== "active" || !member.phone_e164) return NextResponse.json({ message: "The recipient is no longer callable." }, { status: 422 });
    if (session.provider === "demo") {
      await supabase.from("call_sessions").update({ status: "completed", confirmed_at: new Date().toISOString(), completed_at: new Date().toISOString(), result: { simulated: true } }).eq("id", session.id).eq("status", "previewed");
      return NextResponse.json({ ok: true, previewId: session.id, status: "completed", provider: "demo", summary: "Demo lifecycle completed without dialling a phone." });
    }
    if (process.env.CALLE_LIVE_CALLS_ENABLED !== "true" || !process.env.CALLE_API_KEY) return NextResponse.json({ message: "Live CALL-E is not configured." }, { status: 503 });
    const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY, baseUrl: "https://api.heycall-e.com" });
    const call = await client.calls.create({
      task: buildTask({ companyName: company.name, memberName: member.display_name, mode: session.mode }),
      recipient: { phone: member.phone_e164, region: member.region, locale: member.locale },
      recipientResultSchema,
      metadata: { workflow: "asyncfounders", company_id: session.company_id, session_id: session.id, schema_version: "async-memory-v2" },
    }, { idempotencyKey: `asyn:${session.id}:${session.payload_fingerprint.slice(0, 20)}` });
    await supabase.from("call_sessions").update({ status: call.status, provider_call_id: call.id, confirmed_at: new Date().toISOString() }).eq("id", session.id).eq("status", "previewed");
    return NextResponse.json({ ok: true, previewId: session.id, status: call.status, provider: "calle", callId: call.id });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "CALL-E could not start this callback." }, { status: 502 });
  }
}
