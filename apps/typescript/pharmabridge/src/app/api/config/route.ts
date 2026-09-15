import { NextResponse } from "next/server";
import { appConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(appConfig());
}
