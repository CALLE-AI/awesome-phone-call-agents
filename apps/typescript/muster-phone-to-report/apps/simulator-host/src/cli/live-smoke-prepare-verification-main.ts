import { runProviderFreePrepareVerification } from "./live-smoke-prepare-verification-runtime.js";

const summary = await runProviderFreePrepareVerification();
process.stdout.write(`${JSON.stringify(summary)}\n`);
