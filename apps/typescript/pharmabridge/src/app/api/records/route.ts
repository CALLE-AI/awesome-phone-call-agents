import { NextResponse } from "next/server";
import { recordsAccessAllowed } from "@/lib/config";
import { listLedger } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!recordsAccessAllowed(request.headers.get("x-pharmabridge-operator-code"))) {
    return NextResponse.json({ error: { code: "forbidden", message: "Call records hold transcripts, so they need the operator code (PHARMABRIDGE_OPERATOR_CODE) in every environment." } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ records: await listLedger() });
}
