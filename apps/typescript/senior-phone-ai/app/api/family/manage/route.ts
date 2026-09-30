import { NextResponse } from "next/server";
import { requireVerifiedPrincipal } from "@/lib/db/auth";
import { createSupabaseServerClient } from "@/lib/db/server";
import { parseFamilyMutation } from "@/lib/dashboard/mutations";

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) {
      return NextResponse.json({ error: "A same-origin request is required" }, { status: 403 });
    }
    const client = await createSupabaseServerClient();
    await requireVerifiedPrincipal(client);
    const input = parseFamilyMutation(await request.json());
    const result = input.action === "update_profile"
      ? await client.rpc("manage_senior_profile", { p_senior_id: input.seniorId, p_display_name: input.displayName, p_timezone: input.timezone, p_approximate_location: input.approximateLocation })
      : input.action === "update_preferences"
        ? await client.rpc("manage_senior_preferences", { p_senior_id: input.seniorId, p_store_transcripts: input.storeTranscripts, p_store_summaries: input.storeSummaries, p_retention_days: input.retentionDays })
        : await client.rpc("cancel_family_reminder", { p_senior_id: input.seniorId, p_reminder_id: input.reminderId });
    if (result.error) throw new Error("The requested change was denied or could not be saved");
    return NextResponse.json({ ok: true });
  } catch (cause) {
    const unauthorized = cause instanceof Error && /session|required|denied/iu.test(cause.message);
    const unavailable = cause instanceof Error && /Supabase|configuration|configured|environment/iu.test(cause.message);
    return NextResponse.json(
      { error: unauthorized ? "A verified authorized session is required" : unavailable ? "The family data service is not configured" : "The requested change is invalid or unavailable" },
      { status: unauthorized ? 403 : unavailable ? 503 : 400 },
    );
  }
}
