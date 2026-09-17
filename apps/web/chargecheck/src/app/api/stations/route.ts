import { NextRequest, NextResponse } from "next/server";
import { DEMO_STATIONS, LIVE_US_STATIONS } from "@/lib/stations";

function maskPhone(phone: string): string {
  return phone.slice(0, -4).replace(/\d/g, "•") + phone.slice(-4);
}

export async function GET(req: NextRequest) {
  const set = req.nextUrl.searchParams.get("set") === "us" ? LIVE_US_STATIONS : DEMO_STATIONS;
  // Phone numbers are never sent to the browser in full — CALL-E is
  // instructed with the real number server-side only.
  const stations = set.map((s) => ({
    ...s,
    phone: maskPhone(s.phone),
  }));
  return NextResponse.json({ stations });
}
