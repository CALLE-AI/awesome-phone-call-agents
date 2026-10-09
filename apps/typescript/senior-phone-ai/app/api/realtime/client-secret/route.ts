import { NextResponse } from "next/server";

import { getRuntimeMode } from "@/lib/config/server";
import {
  authorizeRealtimeSessionRequest,
  FixedWindowRateLimiter,
  readRealtimeAccessConfig,
} from "@/lib/realtime/access";
import { createBrowserRealtimeCredential } from "@/lib/realtime/client-secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = new FixedWindowRateLimiter(6, 60_000);
const noStoreHeaders = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (getRuntimeMode() !== "live") {
    return NextResponse.json(
      { error: "The realtime harness is disabled in preview mode" },
      { status: 503, headers: noStoreHeaders },
    );
  }

  let config;
  try {
    config = readRealtimeAccessConfig();
  } catch {
    return NextResponse.json(
      { error: "The realtime harness is not configured" },
      { status: 503, headers: noStoreHeaders },
    );
  }

  const access = authorizeRealtimeSessionRequest(request.headers);
  if (!access.allowed) {
    return NextResponse.json(
      { error: access.message },
      { status: access.status, headers: noStoreHeaders },
    );
  }

  if (!limiter.consume()) {
    return NextResponse.json(
      { error: "Too many session requests; wait before trying again" },
      { status: 429, headers: { ...noStoreHeaders, "Retry-After": "60" } },
    );
  }

  try {
    const credential = await createBrowserRealtimeCredential(config.apiKey);
    return NextResponse.json(credential, { headers: noStoreHeaders });
  } catch {
    return NextResponse.json(
      { error: "OpenAI did not create a realtime session credential" },
      { status: 502, headers: noStoreHeaders },
    );
  }
}
