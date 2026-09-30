import { runGuardedLiveSmokeProcessCli } from "./guarded-live-smoke-runtime.js";

await runGuardedLiveSmokeProcessCli(process.argv.slice(2));
