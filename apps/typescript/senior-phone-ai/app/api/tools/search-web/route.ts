import { NextResponse } from "next/server";
import { searchLiveWeb } from "@/lib/tools/search-web-provider";

import { getRuntimeMode } from "@/lib/config/server";
import { authorizeRealtimeSessionRequest, FixedWindowRateLimiter, readRealtimeAccessConfig } from "@/lib/realtime/access";
import {
  describeWebSearchProviderError,
  parseSearchRequest,
} from "@/lib/tools/search-web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = new FixedWindowRateLimiter(12, 60_000);
const noStoreHeaders = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (getRuntimeMode() !== "live") {
    return NextResponse.json({ error: "Live web search is disabled in preview mode" }, { status: 503, headers: noStoreHeaders });
  }

  let config;
  try {
    config = readRealtimeAccessConfig();
  } catch {
    return NextResponse.json({ error: "Live web search is not configured" }, { status: 503, headers: noStoreHeaders });
  }

  const access = authorizeRealtimeSessionRequest(request.headers);
  if (!access.allowed) {
    return NextResponse.json({ error: access.message }, { status: access.status, headers: noStoreHeaders });
  }
  if (!limiter.consume()) {
    return NextResponse.json({ error: "Too many searches; wait before trying again" }, { status: 429, headers: { ...noStoreHeaders, "Retry-After": "60" } });
  }

  let input;
  try {
    input = parseSearchRequest(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid search request" }, { status: 400, headers: noStoreHeaders });
  }

  try {
    const result = await searchLiveWeb(input.query, input.correlationId, config.apiKey);
    return NextResponse.json(result, { headers: noStoreHeaders });
  } catch (error) {
    console.error("Live web search provider failure", {
      code: describeWebSearchProviderError(error),
    });
    return NextResponse.json({ error: "Live web search did not complete" }, { status: 502, headers: noStoreHeaders });
  }
}
