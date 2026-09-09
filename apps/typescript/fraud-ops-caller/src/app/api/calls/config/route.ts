import { NextResponse } from "next/server";
import { opsRunSecret } from "@/lib/ops-auth";
import { isLiveAvailable } from "@/lib/run-call";

export function GET() {
  return NextResponse.json({
    liveAvailable: isLiveAvailable(),
    authRequired: true,
    authConfigured: Boolean(opsRunSecret()),
  });
}
