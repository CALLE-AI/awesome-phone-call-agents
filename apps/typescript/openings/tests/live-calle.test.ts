import { describe, expect, it } from "vitest";
import { LiveCaller } from "../src/core/calle";
import { frameFromNppes } from "../src/core/frame";
import type { Candidate, SearchSpec } from "../src/core/types";

// Live CALL-E verification. Opt-in ONLY (OPENINGS_LIVE_TESTS=1) and requires
// CALLE_API_KEY. Places real calls and spends credits — never run casually.
const runLive = process.env.OPENINGS_LIVE_TESTS === "1" && !!process.env.CALLE_API_KEY;

const SPEC: SearchSpec = {
  plan: "Aetna PPO",
  modality: "either",
  location: "Philadelphia, PA",
  need: "adult ADHD evaluation",
  specialty: "psychiatry",
};

describe.skipIf(!runLive)("live CALL-E call (1 credit)", () => {
  it(
    "dials a real NPPES number and returns a schema-valid structured result",
    async () => {
      const candidates = await frameFromNppes(
        { city: "Philadelphia", state: "PA", taxonomy: "Psychiatry", limit: 3 },
        { fetch: globalThis.fetch },
      );
      expect(candidates.length).toBeGreaterThan(0);
      const target = candidates[0]!;

      const caller = new LiveCaller({ apiKey: process.env.CALLE_API_KEY! });
      const output = await caller.placeCall({
        candidate: target,
        spec: SPEC,
        idempotencyKey: `verify-${Date.now()}`,
        watchId: "live-verify",
      });

      // This is the core thesis test: did the call complete and did we get a
      // parseable structured result (or a clean null that we can classify)?
      expect(output.completed).toBe(true);
      if (output.result) {
        expect(output.result.line_outcome).toBeDefined();
        expect(typeof output.result.evidence_quote).toBe("string");
      }
      console.log(
        `[verify] called ${target.name} ${target.phoneE164} -> status=${output.calleStatus} result=${JSON.stringify(output.result)}`,
      );
    },
    8 * 60_000,
  );
});
