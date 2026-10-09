import "server-only";
import { getRuntimeMode } from "../config/server";
import { prepareDueBriefings } from "./store";

const state = globalThis as typeof globalThis & { seniorBriefingTimer?: ReturnType<typeof setInterval> };
export function startBriefingWorker() {
  if (state.seniorBriefingTimer || getRuntimeMode() !== "live") return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await prepareDueBriefings(); }
    catch { console.error("Morning briefing worker did not complete; inspect local configuration or preparation lock"); }
    finally { running = false; }
  };
  state.seniorBriefingTimer = setInterval(() => { void tick(); }, 60_000);
  state.seniorBriefingTimer.unref();
  void tick();
}
