/**
 * Standalone scheduler process.
 *
 * The host owns scheduling (Design Principle 1): this long-running process
 * ticks the standing watches and triggers CALL-E calls, while the Next.js
 * server handles the UI and server actions. Both share the same SQLite file
 * (WAL mode supports concurrent processes safely).
 *
 * Built with esbuild (see build:scheduler) and run with:
 *   node dist-scheduler/scheduler.js
 *
 * Env (same as the app):
 *   OPENINGS_CALL_MODE=live + CALLE_API_KEY (scheduler only calls in live mode)
 *   OPENINGS_STORE=sqlite, OPENINGS_DB_PATH=...
 *   OPENINGS_SCHEDULER_INTERVAL_MS (default 60000)
 *   OPENINGS_DISABLE_SCHEDULER=1 to no-op
 */
import { createApp } from "../src/app/app";
import { getConfig } from "../src/app/config";
import { createScheduler } from "../src/app/scheduler";

function main(): void {
  if (process.env.OPENINGS_DISABLE_SCHEDULER === "1") {
    console.log("[scheduler] disabled via OPENINGS_DISABLE_SCHEDULER=1");
    return;
  }

  const config = getConfig();
  if (config.callMode !== "live") {
    console.log(`[scheduler] callMode=${config.callMode} — scheduler only runs in live mode`);
    return;
  }

  const intervalMs = Number(process.env.OPENINGS_SCHEDULER_INTERVAL_MS ?? 60_000);
  const app = createApp({ store: config.store, caller: config.caller });
  const scheduler = createScheduler(app, { intervalMs });

  scheduler.start();
  console.log(
    `[scheduler] started: callMode=live store=${config.storeKind} interval=${intervalMs}ms`,
  );

  // Keep the process alive; graceful shutdown on SIGTERM.
  const onSignal = (signal: string): void => {
    console.log(`[scheduler] ${signal} — shutting down`);
    scheduler.stop();
    config.store.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));
}

void main();
