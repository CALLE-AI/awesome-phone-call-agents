import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  const calleConfigured = Boolean(
    process.env.CALLE_API_KEY && process.env.CALLE_LIVE_CALLS_ENABLED === "true",
  );

  return NextResponse.json(
    {
      ok: supabaseConfigured,
      service: "asyncfounders",
      supabase: supabaseConfigured ? "configured" : "missing",
      calle: calleConfigured ? "live" : "disabled",
    },
    { status: supabaseConfigured ? 200 : 503 },
  );
}
