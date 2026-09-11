import { createVapiSearchHandler } from "@/lib/vapi/search-handler";
import { searchLiveWeb } from "@/lib/tools/search-web-provider";
import { getRuntimeMode } from "@/lib/config/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 40;

export const POST = createVapiSearchHandler(
  (query, correlationId) => searchLiveWeb(query, correlationId, process.env.OPENAI_API_KEY || ""),
  () => ({
    enabled: getRuntimeMode() === "live" && process.env.VAPI_SEARCH_ENABLED === "true" && Boolean(process.env.OPENAI_API_KEY),
    secret: process.env.VAPI_WEBHOOK_SECRET || "",
    assistantId: process.env.VAPI_ASSISTANT_ID || "",
  }),
);
