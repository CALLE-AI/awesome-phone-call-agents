import { NextResponse } from "next/server";
import { authenticatedUser, adminSupabase } from "../../../../lib/supabase";
import { buildTask, fingerprint, maskPhone, modeConfig, previewInputSchema, supportedCalleRegions } from "../../../../lib/callbacks";
import { approvedCallContext, fingerprintInput, recipientQuietHours, type PreviewCore } from "../../../../lib/call-safety";

export async function POST(request: Request) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({ message: "Sign in again before preparing a callback." }, { status: 401 });
    const parsed = previewInputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ message: "The callback request is invalid." }, { status: 400 });

    const supabase = adminSupabase();
    const { data: caller } = await supabase.from("company_members").select("id").eq("company_id", parsed.data.companyId).eq("user_id", user.id).eq("status", "active").maybeSingle();
    if (!caller) return NextResponse.json({ message: "You are not an active member of this company." }, { status: 403 });
    if (caller.id !== parsed.data.memberId) return NextResponse.json({ message: "Callbacks are self-recipient only. Start the call from the recipient's own account." }, { status: 403 });

    const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const { count: recentRequests, error: rateError } = await supabase.from("call_sessions").select("id", { count: "exact", head: true }).eq("requested_by", user.id).gte("requested_at", hourAgo);
    if (rateError) throw rateError;
    if ((recentRequests ?? 0) >= 12) return NextResponse.json({ message: "Callback limit reached. Try again in an hour." }, { status: 429, headers: { "Retry-After": "3600" } });

    const [companyResult, memberResult] = await Promise.all([
      supabase.from("companies").select("id,name,current_version").eq("id", parsed.data.companyId).single(),
      supabase.from("company_members").select("id,display_name,region,locale,timezone,phone_e164,phone_last_four,call_consent,status,quiet_hours_start,quiet_hours_end,last_briefed_version").eq("id", parsed.data.memberId).eq("company_id", parsed.data.companyId).single(),
    ]);
    const queryError = [companyResult, memberResult].find((result) => result.error)?.error;
    if (queryError) throw queryError;
    const company = companyResult.data;
    const member = memberResult.data;
    if (!company || !member || member.status !== "active") return NextResponse.json({ message: "That founder is not an active company member." }, { status: 404 });
    if (!member.call_consent || !member.phone_e164 || !member.phone_last_four) return NextResponse.json({ message: `${member.display_name} has not enabled AI callbacks.` }, { status: 422 });
    if (!supportedCalleRegions.has(member.region)) return NextResponse.json({ message: `CALL-E does not currently support ${member.region}. Their workspace access is unaffected.` }, { status: 422 });

    let memoryQuery = supabase.from("memory_items").select("version,kind,title,body,status,confidence,source_excerpt").eq("company_id", parsed.data.companyId);
    memoryQuery = parsed.data.mode === "catchup"
      ? memoryQuery.gt("version", member.last_briefed_version).order("version", { ascending: true }).limit(30)
      : memoryQuery.order("version", { ascending: false }).limit(80);
    const { data: memories, error: memoryError } = await memoryQuery;
    if (memoryError) throw memoryError;

    const quiet = recipientQuietHours({ timezone: member.timezone, start: member.quiet_hours_start, end: member.quiet_hours_end });
    if (quiet.quiet) return NextResponse.json({ message: `This founder is in quiet hours${quiet.localTime ? ` (local time ${quiet.localTime})` : ""}. Prepare the call after quiet hours end.` }, { status: 422 });

    const context = approvedCallContext(parsed.data.mode, memories ?? [], member.last_briefed_version);
    if (context.reason) return NextResponse.json({ message: context.reason }, { status: 422 });
    const task = buildTask({ companyName: company.name, memberName: member.display_name, mode: parsed.data.mode, briefing: context.briefing ?? undefined });

    const live = process.env.CALLE_LIVE_CALLS_ENABLED === "true" && Boolean(process.env.CALLE_API_KEY);
    const demo = process.env.CALLE_DEMO_MODE === "true";
    if (!live && !demo) return NextResponse.json({ message: "Calling is not configured for this deployment." }, { status: 503 });

    const previewId = crypto.randomUUID();
    const provider = live ? "calle" : "demo";
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const metadata = { workflow: "asyncfounders" as const, company_id: company.id, session_id: previewId, schema_version: "async-memory-v3" as const };
    const core: PreviewCore = {
      previewId, companyId: company.id, companyVersion: Number(company.current_version), companyName: company.name,
      memberId: member.id, mode: parsed.data.mode, provider, requestedBy: user.id, createdAt, expiresAt, task,
      contextVersion: context.contextVersion,
      recipient: { displayName: member.display_name, region: member.region, locale: member.locale, timezone: member.timezone, quietHoursStart: member.quiet_hours_start, quietHoursEnd: member.quiet_hours_end, phoneLastFour: member.phone_last_four },
      metadata,
    };
    const payloadFingerprint = await fingerprint(fingerprintInput(core, member.phone_e164));
    const preview = { ...core, fingerprint: payloadFingerprint, maskedPhone: maskPhone(member.phone_e164, member.phone_last_four), purpose: modeConfig[parsed.data.mode].purpose, questions: modeConfig[parsed.data.mode].questions, duration: modeConfig[parsed.data.mode].duration };
    const { data: creation, error } = await supabase.rpc("create_call_preview", { target_session: previewId, target_company: company.id, target_member: member.id, target_user: user.id, target_mode: parsed.data.mode, target_provider: provider, target_fingerprint: payloadFingerprint, target_preview: preview });
    if (error) throw error;
    const result = creation as { created?: boolean; previewId?: string; status?: string; providerCallId?: string | null } | null;
    if (!result?.created) return NextResponse.json({ message: result?.status === "dispatching" && !result.providerCallId ? "A previous call dispatch has an ambiguous result. Confirm that same preview again to reconcile it before creating another." : "A callback for you is already unresolved. Finish or expire it before creating another preview.", previewId: result?.previewId, status: result?.status }, { status: 409 });
    return NextResponse.json({ previewId, companyVersion: core.companyVersion, contextVersion: core.contextVersion, memberId: member.id, mode: parsed.data.mode, provider, requestedBy: user.id, createdAt, expiresAt, fingerprint: payloadFingerprint, recipient: member.display_name, maskedPhone: preview.maskedPhone, purpose: preview.purpose, questions: preview.questions, duration: preview.duration, task, warning: live ? "Review the exact script below. This company version and masked destination will place a real outbound call after confirmation." : "Review the exact script below. Safe demo mode is active; no phone will be dialled." });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Could not prepare the callback." }, { status: 500 });
  }
}
