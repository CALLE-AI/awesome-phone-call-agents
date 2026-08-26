import { describe, expect, it } from "vitest";
import { frameFromNppes } from "../src/core/frame";

const runLive = process.env.OPENINGS_LIVE_TESTS === "1";

describe.skipIf(!runLive)("live NPPES framing (opt-in network)", () => {
  it("frames psychiatry candidates for Philadelphia with usable numbers", async () => {
    const cands = await frameFromNppes(
      { city: "Philadelphia", state: "PA", taxonomy: "Psychiatry", limit: 10 },
      { fetch: globalThis.fetch },
    );
    expect(cands.length).toBeGreaterThan(0);
    expect(cands[0]!.phoneE164).toMatch(/^\+1/);
    expect(cands[0]!.provenance.kind).toBe("nppes");
  });
});
