import { NextResponse } from "next/server";

import { liveCallsEnabled } from "@/lib/calle";
import { createBatchWithCandidates, createDemoBatch, deactivateAll, listBatches } from "@/lib/db";
import { parseWorkbook } from "@/lib/parse-workbook";
import { publicPayload } from "@/lib/public-payload";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;

export async function GET() {
  return NextResponse.json({ ...(await listBatches()), liveCallsEnabled: liveCallsEnabled() });
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as {
      demo?: boolean;
      phone?: string;
      name?: string;
      jobRole?: string;
    };
    if (!body.demo) {
      return NextResponse.json({ error: "Set demo true to create a judge test batch." }, { status: 400 });
    }
    if (typeof body.phone !== "string" || !body.phone.trim()) {
      return NextResponse.json({ error: "Enter a phone number with a country code." }, { status: 400 });
    }
    try {
      const created = await createDemoBatch({
        phone: body.phone,
        name: typeof body.name === "string" ? body.name : undefined,
        jobRole: typeof body.jobRole === "string" ? body.jobRole : undefined,
      });
      return NextResponse.json(
        publicPayload({
          imported: 1,
          skipped: 0,
          issues: [],
          batch: created.batch,
          candidates: created.candidates,
          ...(await listBatches()),
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create the judge test.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

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

  const created = await createBatchWithCandidates(parsed.candidates, file.name);
  return NextResponse.json({
    imported: created.candidates.length,
    skipped: parsed.skipped,
    issues: parsed.issues,
    batch: created.batch,
    ...(await listBatches()),
  });
}

export async function DELETE() {
  const removed = await deactivateAll();
  return NextResponse.json({ removed, ...(await listBatches()) });
}
