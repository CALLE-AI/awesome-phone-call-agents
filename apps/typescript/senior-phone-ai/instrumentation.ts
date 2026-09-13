export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startBriefingWorker } = await import("./lib/briefings/worker");
    startBriefingWorker();
    const { startCalleFollowupWorker } = await import("./lib/calle/followup-server");
    startCalleFollowupWorker();
  }
}
