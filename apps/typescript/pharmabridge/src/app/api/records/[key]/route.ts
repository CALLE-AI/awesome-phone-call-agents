import { NextResponse } from "next/server";
import { recordsAccessAllowed } from "@/lib/config";
import { readLedger } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  if (!recordsAccessAllowed(request.headers.get("x-pharmabridge-operator-code"))) {
    return NextResponse.json({ error: { code: "forbidden", message: "Call records need the operator code." } }, { status: 401 });
  }
  const { key } = await params;
  const record = await readLedger(key);
  return record
    ? NextResponse.json({ record })
    : NextResponse.json({ error: { code: "not_found", message: "No such call record." } }, { status: 404 });
}
