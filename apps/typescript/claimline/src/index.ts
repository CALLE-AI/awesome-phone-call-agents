import { ClaimLineApp } from "./app.js";
import { buildServer } from "./server/app.js";

const RECONCILE_INTERVAL_MS = 8000;

async function main(): Promise<void> {
  const app = new ClaimLineApp();
  const server = buildServer(app);

  // Populate demo data on first boot so a fresh (possibly ephemeral) hosted
  // instance is immediately usable. Idempotent + opt-out via CLAIMLINE_AUTOSEED=false.
  if (process.env.CLAIMLINE_AUTOSEED !== "false" && app.listCustomers().length === 0) {
    app.seedDemo();
    console.log("Auto-seeded demo customers and claims (database was empty).");
  }

  // Background reconciliation: progress in-flight calls even without webhooks.
  // Uses the server key, so it only advances owner/fixture calls; guest calls
  // (placed with a guest's own key) reconcile on-demand when a guest views them.
  const timer = setInterval(() => {
    app.reconciler
      .pollOnce({ placedBy: ["owner", "fixture"] })
      .then(() => app.processAutopilotReports())
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("reconcile error:", err instanceof Error ? err.message : err);
      });
  }, RECONCILE_INTERVAL_MS);
  timer.unref?.();

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n${signal} received, shutting down...`);
    clearInterval(timer);
    await server.close();
    app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await server.listen({ port: app.config.port, host: "0.0.0.0" });
  console.log(
    `ClaimLine [mode=${app.config.mode}] listening on http://localhost:${app.config.port}`,
  );
  if (app.config.mode === "fixture") {
    console.log("Fixture mode: no real calls are placed. Open the URL and click “Seed demo claims”.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
