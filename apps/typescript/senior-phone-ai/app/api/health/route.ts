import { NextResponse } from "next/server";
import { getRuntimeMode } from "@/lib/config/server";

export const dynamic = "force-dynamic";

export function GET() {
  const mode = getRuntimeMode();
  return NextResponse.json(
    { status: "ok", mode, sideEffectsEnabled: mode === "live" && Boolean(process.env.CALLE_API_KEY?.trim()) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
