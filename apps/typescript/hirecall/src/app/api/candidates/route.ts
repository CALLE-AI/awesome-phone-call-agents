import { NextResponse } from "next/server";

import { clearCandidates, insertCandidates, listCandidates } from "@/lib/db";
import { parseWorkbook } from "@/lib/parse-workbook";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;

export async function GET() {
  const candidates = await listCandidates();
  return NextResponse.json({ candidates });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose an Excel or CSV file." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File must be 5 MB or smaller." }, { status: 400 });
  }

  const name = file.name.toLowerCase();
  if (!name.endsWith(".xlsx") && !name.endsWith(".xls") && !name.endsWith(".csv")) {
    return NextResponse.json(
      { error: "Upload an .xlsx, .xls, or .csv file." },
      { status: 400 },
    );
  }

  const buffer = await file.arrayBuffer();
  const parsed = parseWorkbook(buffer);

  if (parsed.candidates.length === 0) {
    return NextResponse.json(
      {
        error: "No candidate rows could be imported.",
        issues: parsed.issues,
      },
      { status: 400 },
    );
  }

  const inserted = await insertCandidates(parsed.candidates, file.name);
  return NextResponse.json({
    imported: inserted.length,
    skipped: parsed.skipped,
    issues: parsed.issues,
    candidates: await listCandidates(),
  });
}

export async function DELETE() {
  const removed = await clearCandidates();
  return NextResponse.json({ removed, candidates: [] });
}
