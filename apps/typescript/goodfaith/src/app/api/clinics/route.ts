// File: src/app/api/clinics/route.ts
import { NextRequest, NextResponse } from "next/server";
import { findClinics } from "@/lib/places";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const zip = req.nextUrl.searchParams.get("zip") ?? "78701";
  const query = req.nextUrl.searchParams.get("q") ?? "MRI imaging center";
  const clinics = await findClinics(zip, query);
  return NextResponse.json({ data: { clinics }, error: null });
}
