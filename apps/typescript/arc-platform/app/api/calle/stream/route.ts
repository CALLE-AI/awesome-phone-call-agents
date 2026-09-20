import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { calleGetCall } from "@/lib/calle";

/**
 * One call's state, pushed as server-sent events.
 *
 * The card polled: a POST to /api/calle/status every four seconds, each one a
 * full round trip, and a single slow read used to end the whole card. One
 * connection that pushes is both cheaper and easier to reason about - the
 * client holds an EventSource and reacts, rather than driving a loop.
 *
 * The POLLING MOVES SERVER-SIDE rather than disappearing: CALL-E has no
 * webhook we subscribe to here and no stream of its own, so something has to
 * ask it. Doing that once per connection beats doing it once per client tick,
 * and it keeps the deadline handling in one place.
 *
 * Vercel's Hobby ceiling is 60 seconds, and our calls run to five minutes, so
 * this stream WILL be cut mid-call. That is survivable and deliberate:
 * EventSource reconnects on its own, and every event carries the whole
 * snapshot rather than a delta, so a reconnect loses nothing. A client that
 * needed deltas stitched back together would be broken by exactly this.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** How often we ask CALL-E. Their reads are fast; the calls are not. */
const TICK_MS = 3000;

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const callId = req.nextUrl.searchParams.get("callId");
  if (!callId) return new Response("callId is required", { status: 400 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      /* The client goes away when the tab closes or the stream is cut. Without
         this the loop keeps asking CALL-E about a call nobody is watching. */
      req.signal.addEventListener("abort", () => {
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      });

      while (!closed) {
        try {
          const state = await calleGetCall(callId);
          send("state", {
            callId,
            status: state.status,
            done: state.done,
            failed: state.failed,
            transcriptTurns: state.transcriptTurns,
            structuredResult: state.structuredResult,
            failure: state.failure,
            confidence: state.confidence,
            evidence: state.evidence,
          });
          if (state.done) {
            send("done", { callId, status: state.status });
            break;
          }
        } catch (e) {
          /* A read that did not come back says nothing about the call. The
             client is told we are waiting, NOT that anything failed - the
             distinction the card gets wrong is exactly this one. */
          send("waiting", {
            callId,
            reason: e instanceof Error ? e.message : String(e),
          });
        }
        await new Promise((r) => setTimeout(r, TICK_MS));
      }

      closed = true;
      try { controller.close(); } catch { /* already closed */ }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      /* Nginx and friends buffer by default, which turns a stream into one
         long wait followed by everything at once. */
      "X-Accel-Buffering": "no",
    },
  });
}
