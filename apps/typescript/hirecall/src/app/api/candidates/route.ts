import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    { error: "Use GET /api/batches. Each Excel is listed as its own batch." },
    { status: 410 },
  );
}

export async function POST() {
  return NextResponse.json(
    { error: "Upload to /api/batches. Each Excel becomes its own batch." },
    { status: 410 },
  );
}

export async function DELETE() {
  return NextResponse.json(
    { error: "Clear batches with DELETE /api/batches." },
    { status: 410 },
  );
}
