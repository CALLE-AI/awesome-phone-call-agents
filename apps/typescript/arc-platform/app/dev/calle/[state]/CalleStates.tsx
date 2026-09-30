"use client";

import { useEffect } from "react";

import LiveCallCard from "@/app/_components/LiveCallCard";
import BatchCallPanel from "@/app/_components/BatchCallPanel";

/**
 * Review harness for LiveCallCard - one state per page.
 *
 * The card drives itself from /api/calle/confirm and /api/calle/status, so a
 * state is produced by stubbing those two responses and letting the real state
 * machine run. Nothing is prop-drilled in, so what gets screenshotted is the
 * component actually running, not a mock-up of it.
 *
 * The failed fixture is the message the card genuinely produces for a rejected
 * call - the same wording both real Pakistan calls landed on.
 */
type Mode = "idle" | "dialing" | "queued" | "inprogress" | "done" | "simulated" | "failed" | "batch";

const ROW = {
  verdict: "yes",
  price: 22000,
  reach: 2100000,
  detail: "12 spots available in the 7-9am drive slot",
  notes: "Wants a signed IO before holding inventory.",
  summary:
    "Spoke to the ad sales desk. They confirmed availability across the requested flight and quoted a rate per 30-second spot.",
};

function reply(body: unknown) {
  /* Headers and text() included deliberately: the card reads content-type
     before parsing (lib/read-json.ts), so a bare { ok, json } is no longer a
     faithful stand-in for a Response. */
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response);
}

let batchPoll = 0;

function stub(mode: Mode) {
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes("/api/calle/batch")) {
      /* Shape matches /api/calle/batch's live response exactly:
         { mode, done, items: [{ name, target, callId }] }. */
      return reply({ mode: "live", done: false, items: [
        { name: "City FM 89",  callId: "b1", target: { name: "City FM 89",  type: "station", channel: "radio", audienceSize: 2100000 } },
        { name: "Mast FM 103", callId: "b2", target: { name: "Mast FM 103", type: "station", channel: "radio", audienceSize: 890000 } },
        { name: "Sana Malik",  callId: "b3", target: { name: "Sana Malik",  type: "creator", channel: "instagram", audienceSize: 144000 } },
      ]});
    }
    if (u.includes("/api/calle/confirm")) {
      // Simulated mode is the only path that returns a result from /confirm.
      if (mode === "simulated") return reply({ done: true, mock: true, live: false, row: ROW });
      // Everything else goes live and polls.
      return reply({ done: false, live: mode !== "dialing", callId: "c1" });
    }
    if (u.includes("/api/calle/status")) {
      if (mode === "failed") return reply({ done: true, failed: true, status: "failed" });
      /* The two halves of the old "on the call" label, now distinguishable:
         queued means CALL-E has not dialled yet, in_progress means ringing
         or talking. */
      if (mode === "queued") return reply({ done: false, status: "queued" });
      if (mode === "inprogress") return reply({ done: false, status: "in_progress" });
      if (mode === "done") return reply({ done: true, failed: false, status: "completed", row: ROW });
      if (mode === "batch") {
        batchPoll++;
        const variants = [
          { ...ROW, name: "City FM 89",  type: "station", channel: "radio",     score: 138.4 },
          { ...ROW, name: "Mast FM 103", type: "station", channel: "radio",     verdict: "unknown", price: null, detail: "Left a message with the desk", score: 22 },
          { ...ROW, name: "Sana Malik",  type: "creator", channel: "instagram", price: 82000, detail: "1 reel + 2 stories", score: 96.1 },
        ];
        return reply({ done: true, failed: false, status: "completed", row: variants[(batchPoll - 1) % 3] });
      }
      return new Promise(() => {}) as unknown as Response; // never settles
    }
    return reply({});
  }) as typeof fetch;
}

export default function CalleStates({ state }: { state: Mode }) {
  useEffect(() => {
    if (state === "idle") return;
    stub(state);
    const t = setTimeout(() => {
      const btn = Array.from(document.querySelectorAll("button")).find(b =>
        /avails|confirm booking|call all/i.test(b.textContent ?? "")
      );
      btn?.click();
    }, 30);
    return () => clearTimeout(t);
  }, [state]);

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-h1 text-text">CALL-E card — {state}</h1>
      </header>
      <div className={state === "batch" ? "max-w-3xl" : "max-w-96"}>
        {state === "batch" ? (
          <BatchCallPanel
            targets={[
              { name: "City FM 89", type: "station", channel: "radio", audienceSize: 2100000 },
              { name: "Mast FM 103", type: "station", channel: "radio", audienceSize: 890000 },
              { name: "Sana Malik", type: "creator", channel: "instagram", audienceSize: 144000 },
            ]}
            context={{ advertiser: "Shan Foods", currency: "PKR", budgetTotal: 450000 }}
          />
        ) : (
          <LiveCallCard target={{ name: "City FM 89", type: "station" }} />
        )}
      </div>
    </>
  );
}
