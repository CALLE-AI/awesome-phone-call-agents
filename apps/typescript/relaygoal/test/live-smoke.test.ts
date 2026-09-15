// Opt-in live smoke test: places ONE real CALL-E call through the same core the app
// uses (loadLiveCalle -> runVerifiedGoal -> verifyOutcome) and checks the shape of
// what comes back. It is SKIPPED unless RELAYGOAL_LIVE=1 and CALLE_API_KEY are set, so
// the default test run stays credential-free and dials nothing.
//
// Target defaults to CALL-E's own outbound test hotline. Override with
// RELAYGOAL_SMOKE_PHONE (E.164) only for a number you own or are permitted to call.
// The raw result is written OUTSIDE the repo (RELAYGOAL_SMOKE_OUT) so no transcript
// ever lands in git.

import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadLiveCalle } from "../src/core/livecalle";
import { runVerifiedGoal } from "../src/core/runGoal";
import { maskPhone } from "../src/core/phone";

const live = process.env.RELAYGOAL_LIVE === "1" && !!process.env.CALLE_API_KEY;
const TEST_HOTLINE = "+12763229632";

describe.skipIf(!live)("live CALL-E smoke (opt-in, places one real call)", () => {
  it(
    "runs the verified-phone-outcome core against a real call and returns a grounded outcome",
    async () => {
      const phone = process.env.RELAYGOAL_SMOKE_PHONE ?? TEST_HOTLINE;
      const timeoutMs = Number(process.env.RELAYGOAL_CALL_TIMEOUT_MS ?? 240_000);

      const client = await loadLiveCalle({
        apiKey: process.env.CALLE_API_KEY!,
        ...(process.env.CALLE_BASE_URL ? { baseUrl: process.env.CALLE_BASE_URL } : {}),
        wait: { timeoutMs, intervalMs: Number(process.env.RELAYGOAL_CALL_POLL_MS ?? 4_000) },
      });

      const started = Date.now();
      const outcome = await runVerifiedGoal(client, {
        task:
          "You are an assistant placing a call on behalf of a person who is Deaf and cannot take the call themselves. " +
          "Disclose that you are an assistant calling on their behalf. Politely ask what this phone line is for and " +
          "what hours it is available, then thank them and end the call. Report exactly what was said.",
        phone,
        resultSchema: {
          type: "object",
          properties: {
            line_purpose: { type: "string", description: "What the person said this phone line is for" },
            hours: { type: "string", description: "The hours the line is available, as stated" },
          },
          required: ["line_purpose", "hours"],
        },
        requestedKeys: ["line_purpose", "hours"],
        idempotencyKey: `relaygoal-smoke-${new Date().toISOString().slice(0, 13)}`,
      });
      const elapsedMs = Date.now() - started;

      // Persist the raw outcome outside the repo for inspection; never commit it.
      const out = process.env.RELAYGOAL_SMOKE_OUT;
      if (out) {
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, JSON.stringify({ phoneMasked: maskPhone(phone), elapsedMs, outcome }, null, 2));
      }

      // Shape assertions only: a real line may or may not answer, and the core must fail
      // closed either way. What we prove is that the live path produces a well-formed,
      // fail-closed VerifiedOutcome, not that the hotline said anything in particular.
      expect(["verified", "partial", "unverified"]).toContain(outcome.overall);
      expect(outcome.fields.map((f) => f.key).sort()).toEqual(["hours", "line_purpose"]);
      for (const f of outcome.fields) {
        expect(["verified", "unverified"]).toContain(f.status);
        if (f.status === "verified") {
          expect(f.quotes.length).toBeGreaterThan(0);
          for (const q of f.quotes) expect(outcome.transcript.some((t) => t.text === q.text)).toBe(true);
        }
      }
      if (outcome.unreachable) expect(outcome.overall).toBe("unverified");
      if (outcome.transcript.length === 0) expect(outcome.overall).toBe("unverified");
    },
    { timeout: 300_000 },
  );
});
