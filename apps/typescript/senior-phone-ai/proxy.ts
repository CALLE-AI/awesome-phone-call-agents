import type { NextRequest } from "next/server";

import { updateSupabaseSession } from "@/lib/db/proxy";

export async function proxy(request: NextRequest) {
  return updateSupabaseSession(request);
}

export const config = {
  matcher: ["/family/:path*"],
};
