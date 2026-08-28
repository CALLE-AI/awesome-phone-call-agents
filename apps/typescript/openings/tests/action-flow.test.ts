import { afterAll, describe, expect, it } from "vitest";
import { runWatchOnce, startWatch, stopWatch } from "../src/app/actions";
import { __resetConfig } from "../src/app/config";
import { parseCity, parseState } from "../src/core/location";

// The action tests exercise the exact server-action boundary the browser
// calls, but they hit the NPPES registry, so they are opt-in like the live
// framing test.
const runLive = process.env.OPENINGS_LIVE_TESTS === "1";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

afterAll(() => {
  __resetConfig();
});

describe.skipIf(!runLive)("startWatch server action (opt-in network)", () => {
  it("creates a watch from the form, runs it, and stops it", async () => {
    process.env.OPENINGS_CALL_MODE = "fake";
    process.env.OPENINGS_STORE = "memory";
    __resetConfig();

    const res = await startWatch(
      { ok: false, error: "" },
      form({
        need: "adult ADHD evaluation",
        plan: "Aetna PPO",
        location: "Philadelphia, PA",
        modality: "either",
        specialty: "psychiatry",
        targetOpen: "3",
        maxCallsPerRun: "10",
        authorizeRecipients: "on",
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.simulated).toBe(true);
    expect(res.watch.candidates.length).toBeGreaterThan(0);
    expect(res.watch.candidates[0]!.provenance.kind).toBe("nppes");

    const run = await runWatchOnce(res.watch.id);
    expect(run.ok).toBe(true);

    expect((await stopWatch(res.watch.id)).ok).toBe(true);
  });

  it("blocks crisis language and PHI before anything runs", async () => {
    process.env.OPENINGS_CALL_MODE = "fake";
    process.env.OPENINGS_STORE = "memory";
    __resetConfig();

    const crisis = await startWatch(
      { ok: false, error: "" },
      form({
        need: "thinking about suicide",
        plan: "Aetna PPO",
        location: "Philadelphia, PA",
        specialty: "psychiatry",
        authorizeRecipients: "on",
      }),
    );
    expect(crisis.ok).toBe(false);
    if (crisis.ok) return;
    expect(crisis.reason).toBe("crisis");

    const phi = await startWatch(
      { ok: false, error: "" },
      form({
        need: "my diagnosis is depression",
        plan: "Aetna PPO",
        location: "Philadelphia, PA",
        specialty: "psychiatry",
        authorizeRecipients: "on",
      }),
    );
    expect(phi.ok).toBe(false);
    if (phi.ok) return;
    expect(phi.reason).toBe("phi");
  });
});

describe("startWatch server action (offline)", () => {
  it("rejects a location without a state before any network call", async () => {
    process.env.OPENINGS_CALL_MODE = "dry-run";
    process.env.OPENINGS_STORE = "memory";
    __resetConfig();

    const res = await startWatch(
      { ok: false, error: "" },
      form({
        need: "adult ADHD evaluation",
        plan: "Aetna PPO",
        location: "Austin",
        modality: "either",
        specialty: "psychiatry",
        targetOpen: "1",
        maxCallsPerRun: "5",
        authorizeRecipients: "on",
      }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("validation");
    expect(res.error).toContain("state");
  });
});

describe("location parsing", () => {
  it("parses a city and state code", () => {
    expect(parseCity("Philadelphia, PA")).toBe("Philadelphia");
    expect(parseState("Philadelphia, PA")).toBe("PA");
  });

  it("parses a full state name", () => {
    expect(parseCity("Philadelphia, Pennsylvania")).toBe("Philadelphia");
    expect(parseState("Philadelphia, Pennsylvania")).toBe("PA");
  });

  it("returns null instead of guessing when the state is missing", () => {
    expect(parseCity("Austin")).toBe("Austin");
    expect(parseState("Austin")).toBeNull();
    expect(parseState("")).toBeNull();
  });

  it("rejects a bare state as a location", () => {
    expect(parseCity("PA")).toBeNull();
    expect(parseState("PA")).toBe("PA");
    expect(parseCity("Texas")).toBeNull();
  });
});
