import { CalleClient } from "@call-e/calle";
import { NextResponse } from "next/server";
import { authenticatedUser, adminSupabase } from "../../../../lib/supabase";
import { confirmInputSchema, fingerprint, recipientResultSchema } from "../../../../lib/callbacks";
import { fingerprintInput, recipientQuietHours, storedPreviewSchema, type PreviewCore } from "../../../../lib/call-safety";

export async function POST(request: Request) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({ message: "Sign in again before confirming a callback." }, { status: 401 });
    const parsed = confirmInputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ message: "The callback confirmation is invalid." }, { status: 400 });

    const supabase = adminSupabase();
    const { data: session } = await supabase.from("call_sessions").select("*").eq("id", parsed.data.previewId).eq("requested_by", user.id).maybeSingle();
    if (!session) return NextResponse.json({ message: "This callback preview was not found." }, { status: 404 });

    const { data: caller } = await supabase.from("company_members").select("id").eq("company_id", session.company_id).eq("user_id", user.id).eq("status", "active").maybeSingle();
    if (!caller) return NextResponse.json({ message: "You are no longer an active member of this company." }, { status: 403 });

    const stored = storedPreviewSchema.safeParse(session.preview);
    if (!stored.success) return NextResponse.json({ message: "This preview is malformed. Prepare a new callback." }, { status: 409 });
    const preview = stored.data;
    if (
      preview.previewId !== session.id || preview.companyId !== session.company_id || preview.memberId !== session.member_id ||
      preview.requestedBy !== user.id || preview.mode !== session.mode || preview.provider !== session.provider ||
      preview.fingerprint !== session.payload_fingerprint || parsed.data.fingerprint !== session.payload_fingerprint
    ) return NextResponse.json({ message: "The reviewed callback payload does not match this confirmation." }, { status: 409 });

    if (session.status !== "previewed" && session.status !== "dispatching") {
      return NextResponse.json({ ok: true, previewId: session.id, status: session.status, callId: session.provider_call_id, replayed: true });
    }
    if (session.status === "dispatching" && session.provider_call_id) {
      return NextResponse.json({ ok: true, previewId: session.id, status: session.status, callId: session.provider_call_id, replayed: true });
    }
    if (session.status === "previewed" && new Date(preview.expiresAt).getTime() < Date.now()) {
      await supabase.from("call_sessions").update({ status: "expired" }).eq("id", session.id).eq("status", "previewed");
      return NextResponse.json({ message: "The preview expired. Review the call again." }, { status: 409 });
    }

    const [{ data: company }, { data: member }] = await Promise.all([
      supabase.from("companies").select("id,name,current_version").eq("id", session.company_id).single(),
      supabase.from("company_members").select("id,display_name,region,locale,timezone,phone_e164,phone_last_four,call_consent,status,quiet_hours_start,quiet_hours_end").eq("id", session.member_id).eq("company_id", session.company_id).single(),
    ]);
    if (!company || !member || !member.call_consent || member.status !== "active" || !member.phone_e164 || !member.phone_last_four) {
      return NextResponse.json({ message: "The recipient is no longer callable." }, { status: 422 });
    }

    const currentCore: PreviewCore = {
      previewId: preview.previewId,
      companyId: preview.companyId,
      companyName: company.name,
      companyVersion: Number(company.current_version),
      memberId: preview.memberId,
      mode: preview.mode,
      provider: preview.provider,
      requestedBy: preview.requestedBy,
      createdAt: preview.createdAt,
      expiresAt: preview.expiresAt,
      task: preview.task,
      contextVersion: preview.contextVersion,
      recipient: {
        displayName: member.display_name,
        region: member.region,
        locale: member.locale,
        timezone: member.timezone,
        quietHoursStart: member.quiet_hours_start,
        quietHoursEnd: member.quiet_hours_end,
        phoneLastFour: member.phone_last_four,
      },
      metadata: preview.metadata,
    };
    const currentFingerprint = await fingerprint(fingerprintInput(currentCore, member.phone_e164));
    if (currentFingerprint !== session.payload_fingerprint) {
      return NextResponse.json({ message: "The company, task, or recipient details changed after review. Prepare and approve a new preview." }, { status: 409 });
    }

    const quiet = recipientQuietHours({ timezone: member.timezone, start: member.quiet_hours_start, end: member.quiet_hours_end });
    if (quiet.quiet) return NextResponse.json({ message: `This founder is in quiet hours${quiet.localTime ? ` (local time ${quiet.localTime})` : ""}. Call after quiet hours end.` }, { status: 422 });

    if (session.provider === "calle" && (process.env.CALLE_LIVE_CALLS_ENABLED !== "true" || !process.env.CALLE_API_KEY)) {
      return NextResponse.json({ message: "Live CALL-E is not configured." }, { status: 503 });
    }

    const { data: claimed, error: claimError } = await supabase.rpc("claim_call_session", {
      target_session: session.id,
      target_user: user.id,
      expected_fingerprint: parsed.data.fingerprint,
    });
    if (claimError) return NextResponse.json({ message: claimError.message }, { status: 409 });
    if (!claimed) return NextResponse.json({ message: "The callback could not be claimed safely." }, { status: 409 });

    if (session.provider === "demo") {
      await supabase.from("call_sessions").update({ status: "completed", completed_at: new Date().toISOString(), result: { simulated: true } }).eq("id", session.id).eq("status", "dispatching");
      return NextResponse.json({ ok: true, previewId: session.id, status: "completed", provider: "demo", summary: "Demo lifecycle completed without dialling a phone." });
    }

    try {
      const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY!, baseUrl: "https://api.heycall-e.com" });
      const call = await client.calls.create({
        task: preview.task,
        recipient: { phone: member.phone_e164, region: member.region, locale: member.locale },
        recipientResultSchema,
        metadata: preview.metadata,
      }, { idempotencyKey: `asyn:${session.id}:${session.payload_fingerprint.slice(0, 20)}` });
      await supabase.from("call_sessions").update({ status: call.status, provider_call_id: call.id, dispatch_last_error: null }).eq("id", session.id).eq("status", "dispatching");
      return NextResponse.json({ ok: true, previewId: session.id, status: call.status, provider: "calle", callId: call.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : "CALL-E returned an ambiguous create result.";
      await supabase.from("call_sessions").update({ dispatch_last_error: message }).eq("id", session.id).eq("status", "dispatching");
      return NextResponse.json({ message: "The provider response was lost or ambiguous. Do not create another preview; confirm this same preview again to reconcile the idempotent request.", previewId: session.id, status: "dispatching" }, { status: 502 });
    }
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "CALL-E could not start this callback." }, { status: 502 });
  }
}
