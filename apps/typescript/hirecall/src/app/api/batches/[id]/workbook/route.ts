import { NextResponse } from "next/server";

import { getBatch, updateBatchFromWorkbook } from "@/lib/db";
import { parseWorkbook } from "@/lib/parse-workbook";
import { publicPayload } from "@/lib/public-payload";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
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
    return NextResponse.json({ error: "Upload an .xlsx, .xls, or .csv file." }, { status: 400 });
  }

  const parsed = parseWorkbook(await file.arrayBuffer());
  if (parsed.candidates.length === 0) {
    return NextResponse.json(
      { error: "No candidate rows could be imported.", issues: parsed.issues },
      { status: 400 },
    );
  }

  try {
    const summary = await updateBatchFromWorkbook(id, parsed.candidates, file.name);
    const detail = await getBatch(id);
    return NextResponse.json(
      publicPayload({
        ...summary,
        skipped: parsed.skipped,
        issues: parsed.issues,
        ...detail,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update this Excel batch.";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
