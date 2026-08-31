import cron from "node-cron";
import { env } from "../config/env.js";
import { runConfirmSweep } from "../flows/confirm/confirmFlow.js";

export function startScheduler(): void {
  if (!env.CONFIRM_CRON_ENABLED) {
    console.log("[cron] confirmation sweep disabled (CONFIRM_CRON_ENABLED=false)");
    return;
  }
  cron.schedule(env.CONFIRM_CRON, () => {
    console.log("[cron] running confirmation sweep");
    runConfirmSweep().catch((error) => console.error("[cron] sweep failed:", error));
  });
  console.log(`[cron] confirmation sweep scheduled: "${env.CONFIRM_CRON}"`);
}
