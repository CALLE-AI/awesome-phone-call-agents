import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import LiveCallCard from "@/app/_components/LiveCallCard";

/**
 * The elapsed counter is driven by a 1s setInterval. It used to be cleared
 * only on unmount, which meant it kept firing after a call finished and that
 * every "Call again" stacked another one on top of the last. These tests pin
 * both behaviours: the interval must be gone when the call completes, and
 * gone when the card unmounts mid-call.
 *
 * Interval bookkeeping is asserted by counting real setInterval/clearInterval
 * calls rather than by reading component internals, so the test says nothing
 * about how the fix is implemented.
 */

let container: HTMLDivElement;
let root: Root;
let live = 0;

function trackTimers() {
  live = 0;
  const realSet = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  vi.stubGlobal("setInterval", ((fn: TimerHandler, ms?: number) => {
    live++;
    return realSet(fn, ms);
  }) as typeof setInterval);
  vi.stubGlobal("clearInterval", ((id: Parameters<typeof clearInterval>[0]) => {
    if (id !== undefined && id !== null) live--;
    return realClear(id);
  }) as typeof clearInterval);
}

/** A response shaped like the real thing. The card reads content-type before
 *  parsing - see lib/read-json.ts - so a mock without headers no longer
 *  stands in for a Response. */
function jsonRes(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** /confirm returns a live callId; /status returns `done` on the Nth poll. */
function mockCalle(pollsBeforeDone: number) {
  let polls = 0;
  return vi.fn(async (url: string) => {
    if (String(url).includes("/api/calle/confirm")) {
      return jsonRes({ done: false, live: true, callId: "call_1" });
    }
    polls++;
    if (polls < pollsBeforeDone) {
      return jsonRes({ done: false, status: "in_progress" });
    }
    return jsonRes({
        done: true,
        failed: false,
        status: "completed",
        row: { name: "City FM 89", type: "station", channel: "radio", verdict: "yes",
               price: 148000, reach: 2100000, detail: "12 spots", notes: "", score: 100 },
    });
  }) as unknown as typeof fetch;
}

async function clickCta() {
  const button = Array.from(container.querySelectorAll("button")).find(b =>
    /avails|confirm booking|call again|try again/i.test(b.textContent ?? "")
  );
  expect(button, "CTA button should be rendered").toBeTruthy();
  await act(async () => {
    button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  trackTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  container.remove();
});

describe("LiveCallCard elapsed-timer lifecycle", () => {
  it("clears the interval when the call completes", async () => {
    vi.stubGlobal("fetch", mockCalle(1));
    await act(async () => {
      root.render(<LiveCallCard target={{ name: "City FM 89", type: "station" }} />);
    });

    await clickCta();
    // Let the poll chain settle.
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });

    expect(container.textContent).toContain("148,000");
    expect(live, "no interval should still be running after completion").toBe(0);

    await act(async () => { root.unmount(); });
    expect(live).toBe(0);
  });

  it("clears the interval when the card unmounts mid-call", async () => {
    vi.stubGlobal("fetch", mockCalle(99)); // never completes
    await act(async () => {
      root.render(<LiveCallCard target={{ name: "City FM 89", type: "station" }} />);
    });

    await clickCta();
    expect(live, "the ticker should be running during the call").toBe(1);

    await act(async () => { root.unmount(); });
    expect(live, "unmount must clear the running interval").toBe(0);
  });

  it("does not stack a second interval when the call is retried", async () => {
    vi.stubGlobal("fetch", mockCalle(1));
    await act(async () => {
      root.render(<LiveCallCard target={{ name: "City FM 89", type: "station" }} />);
    });

    for (let i = 0; i < 3; i++) {
      await clickCta();
      await act(async () => { await new Promise(r => setTimeout(r, 0)); });
      expect(live, `no interval should survive attempt ${i + 1}`).toBe(0);
    }

    await act(async () => { root.unmount(); });
    expect(live).toBe(0);
  });
});
