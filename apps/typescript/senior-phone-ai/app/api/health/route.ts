import { NextResponse } from "next/server";
import { getRuntimeMode } from "@/lib/config/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { status: "ok", mode: getRuntimeMode(), sideEffectsEnabled: false },
    { headers: { "Cache-Control": "no-store" } },
  );
}
