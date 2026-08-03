import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "call-e-web",
    timestamp: new Date().toISOString(),
  });
}
