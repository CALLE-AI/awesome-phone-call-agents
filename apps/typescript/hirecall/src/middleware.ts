import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { operatorTokenAccepted } from "@/lib/operator-auth";

export async function middleware(request: NextRequest) {
  const allowed = await operatorTokenAccepted(request.headers.get("authorization"));
  if (allowed) return NextResponse.next();
  return NextResponse.json(
    { error: "Enter the operator token from HIRECALL_OPERATOR_TOKEN in .env." },
    { status: 401 },
  );
}

export const config = {
  matcher: ["/api/:path*"],
};
