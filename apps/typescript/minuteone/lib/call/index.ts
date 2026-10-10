import type { CallProvider } from "./provider";
import { FakeCallProvider } from "./fake";
import { CalleCallProvider } from "./calle";

let cached: CallProvider | null = null;

/**
 * Dry-run (fake) is the default everywhere. Real calls require an explicit opt-in via
 * DRY_RUN=false plus CALLE_API_KEY, since only 20 real CALL-E calls are available for the
 * whole build.
 */
export function getCallProvider(): CallProvider {
  if (cached) return cached;

  const dryRun = process.env.DRY_RUN !== "false";
  cached = dryRun ? new FakeCallProvider() : new CalleCallProvider();
  return cached;
}
