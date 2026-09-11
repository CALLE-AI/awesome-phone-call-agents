/**
 * Preloaded (via `tsx --require`) before scripts/dispatch-worker.ts. Files shared with
 * the Next.js app (lib/db/client.ts, lib/campaigns/dispatch.ts, etc.) import
 * "server-only" to stop them from accidentally ending up in a client bundle — Next's
 * compiler intercepts that import specifier at the webpack/SWC layer, but a standalone
 * script run outside Next never goes through that compiler, and the real "server-only"
 * package throws unconditionally when actually executed (see node_modules/server-only).
 * The worker process is never a browser bundle, so the check does not apply here —
 * this makes the import a no-op for this process only, without touching the app files.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS preload script loaded via `tsx --require`, which only accepts CommonJS.
const Module = require("module");
const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "server-only" || request === "client-only") {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};
