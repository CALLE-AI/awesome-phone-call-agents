import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app/app";
import { __resetConfig } from "../src/app/config";
import { LiveCaller } from "../src/core/calle";
import { frameFromNppes } from "../src/core/frame";
import type { SearchSpec } from "../src/core/types";
import { SqliteStore } from "../src/store/sqlite";

// Full-app live verification: real NPPES framing, real CALL-E calls through
// the app's wave engine, real classification persisted to SQLite. Opt-in ONLY.
// Spends credits — run deliberately, in business hours for best signal.
//
// After a successful run, view the report:
//   OPENINGS_STORE=sqlite OPENINGS_DB_PATH=<db> OPENINGS_CALL_MODE=live pnpm dev
//   then open /watch/<watch-id> and /reports.
const runLive = process.env.OPENINGS_LIVE_TESTS === "1" && !!process.env.CALLE_API_KEY;

// Candidate count for the report. Business-hours runs want a bigger sample;
// keep it small here to control credit spend.
const SAMPLE_SIZE = Number(process.env.OPENINGS_SAMPLE_SIZE ?? 5);
const DB_PATH = process.env.OPENINGS_DB_PATH ?? "/tmp/openings-live.db";

const SPEC: SearchSpec = {
  plan: process.env.OPENINGS_PLAN ?? "Aetna PPO",
  modality: "either",
  location: process.env.OPENINGS_LOCATION ?? "Philadelphia, PA",
  need: process.env.OPENINGS_NEED ?? "adult ADHD evaluation",
  specialty: "psychiatry",
};

describe.skipIf(!runLive)("full-app live verification (n credits)", () => {
  it(
    "frames, dispatches waves, classifies, and persists real call results",
    async () => {
      const caller = new LiveCaller({ apiKey: process.env.CALLE_API_KEY! });
      const store = new SqliteStore(DB_PATH);
      const app = createApp({ store, caller });

      const candidates = await frameFromNppes(
        { city: "Philadelphia", state: "PA", taxonomy: "Psychiatry", limit: SAMPLE_SIZE },
        { fetch: globalThis.fetch },
      );
      expect(candidates.length).toBeGreaterThan(0);

      const watch = app.startWatch({
        spec: SPEC,
        candidates,
        targetOpen: 3,
        maxCallsPerRun: SAMPLE_SIZE,
      });

      console.log(`[verify] watch id=${watch.id}`);
      console.log(`[verify] candidates=${candidates.length} db=${DB_PATH}`);
      console.log(
        `[verify] target open=${watch.targetOpen} maxCallsPerRun=${watch.maxCallsPerRun} sequential caller is LIVE — credits will be spent`,
      );

      const dispatch = await app.runWatch(watch.id, 1);

      // The pipeline must classify every candidate (never crash), even when
      // the office is closed and the structured result is null.
      expect(dispatch.results.length).toBe(candidates.length);
      for (const r of dispatch.results) {
        expect(
          ["open", "waitlist", "not_accepting", "ghost", "unreachable", "inconclusive", "declined", "error", "blocked"],
        ).toContain(r.verdict);
      }

      // Print a per-candidate report line for the console/CI.
      const byId = new Map(candidates.map((c) => [c.id, c]));
      for (const r of dispatch.results) {
        const c = byId.get(r.candidateId);
        console.log(
          `[verify] ${r.verdict.padEnd(14)} ${c?.name ?? r.candidateId} ${c?.phoneE164 ?? ""} — ${r.evidence || r.summary || "no evidence"}`,
        );
      }

      const facts = app.listFacts();
      console.log(`[verify] ghosts recorded=${facts.length}`);

      app.stopWatch(watch.id);
      store.close();
    },
    30 * 60_000,
  );
});

afterAll(() => {
  __resetConfig();
});
