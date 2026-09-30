import { NextResponse } from "next/server";
import { drugIntel } from "@/lib/drugs";

export async function GET(_request: Request, { params }: { params: Promise<{ rxcui: string }> }) {
  const { rxcui } = await params;
  const intel = await drugIntel(rxcui);
  if (!intel) return NextResponse.json({ error: "Unknown RxNorm concept." }, { status: 404 });
  return NextResponse.json(intel);
}
