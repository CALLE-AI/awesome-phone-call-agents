import { NextResponse } from "next/server";
import { isLiveAvailable } from "@/lib/run-call";

export function GET() {
  return NextResponse.json({ liveAvailable: isLiveAvailable() });
}
