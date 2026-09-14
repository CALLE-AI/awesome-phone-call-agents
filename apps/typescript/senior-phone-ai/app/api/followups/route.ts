import { createHash } from "node:crypto";
import { z } from "zod";
import { getRuntimeMode } from "@/lib/config/server";
import { listRegisteredCallIds } from "@/lib/calle/registry";
import { calleFollowupsEnabled, createCalleFollowups, createCalleFollowupHistory, calleFollowupsPreview } from "@/lib/calle/followup-server";
import { authorizeRealtimeSessionRequest, FixedWindowRateLimiter } from "@/lib/realtime/access";
import { readBoundedJson } from "@/lib/http/read-bounded-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const limiter = new FixedWindowRateLimiter(60, 60_000);
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }).strict(),
  z.object({ action: z.literal("register"), reference: z.string().regex(/^[a-f0-9]{64}$/), destination: z.string().max(40), authorized: z.literal(true) }).strict(),
  z.object({ action: z.literal("run") }).strict(),
  z.object({ action: z.literal("retry"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("cancel"), id: z.string().uuid() }).strict(),
]);
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const reference = (id: string) => createHash("sha256").update(id).digest("hex");

export async function POST(request: Request) {
  const access = authorizeRealtimeSessionRequest(request.headers);
  if (!access.allowed) return reply({ error: access.message }, 403);
  if (!limiter.consume()) return reply({ error: "Too many requests. Try again shortly." }, 429);
  try {
    const input = action.parse(await readBoundedJson(request));
    const enabled = calleFollowupsEnabled();
    if (!enabled && input.action !== "list") return reply({ error: "CALL-E follow-ups are disabled. Complete the local setup first." }, 503);
    const ids = getRuntimeMode() === "live" ? await listRegisteredCallIds(process.env.CALLE_MONITORED_CALL_IDS) : [];
    const service = enabled ? createCalleFollowups()
      : getRuntimeMode() === "live" && process.env.CALLE_FOLLOWUP_STORAGE_KEY ? createCalleFollowupHistory() : undefined;
    if (input.action === "register") {
      const id = ids.find((item) => reference(item) === input.reference);
      if (!id) return reply({ error: "Choose a registered CALL-E call." }, 400);
      await service!.register(id, input.destination, input.authorized);
    }
    if (input.action === "run") await service!.runOnce();
    if (input.action === "retry") { await service!.retry(input.id); await service!.runOnce(); }
    if (input.action === "cancel") await service!.cancel(input.id);
    return reply({ enabled, preview: calleFollowupsPreview(), calls: service ? await service.list() : [], available: ids.map((id) => ({ reference: reference(id), label: id.slice(0, 14) + "…" })) });
  } catch {
    return reply({ error: "Could not apply the request. Check local CALL-E/Twilio configuration, the enabled recipient and current follow-up state." }, 400);
  }
}
