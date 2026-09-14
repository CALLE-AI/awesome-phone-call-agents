import { NextResponse } from "next/server";
import { recordsAccessAllowed } from "@/lib/config";
import { listLedger } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!recordsAccessAllowed(request.headers.get("x-pharmabridge-operator-code"))) {
    return NextResponse.json({ error: { code: "forbidden", message: "Call records need the operator code." } }, { status: 401 });
  }
  return NextResponse.json({ records: await listLedger() });
}
