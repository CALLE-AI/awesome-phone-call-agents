// =============================================================================
// synthetic_auth_cache.mjs
// =============================================================================
//
// Public-bridge helper for the ParcelBridge offline official CALL-E runtime
// proof. Builds a temporary, **synthetic** CALL-E OAuth token cache document
// that satisfies the official `@call-e/core` cache loader's schema while
// never containing a real credential.
//
// What this module does
// ---------------------
//   1. Allocates a private (mode 0700) temporary directory on the local
//      filesystem.
//   2. Writes a token document at `<cacheRoot>/<serverHash(serverUrl)>/token.json`
//      using the exact path layout that `@call-e/core/lib/cache.js` expects
//      (`serverHash` is the same md5 hex digest the official module uses).
//   3. The access_token field is a clearly-labeled public canary string
//      (`PUBLIC_OFFLINE_CANARY_DO_NOT_USE_AS_REAL_CREDENTIAL`) so any code
//      path that reads it can never mistake it for a real OAuth credential.
//   4. The file is mode 0600. No real OAuth tokens, real phone numbers,
//      real plan_ids, or real confirm_tokens are ever written.
//   5. Returns a `cleanup()` function that the caller MUST invoke to remove
//      the temporary directory. The cleanup is best-effort and idempotent.
//
// What this module does NOT do
// ----------------------------
//   * Does NOT read `~/.cache/calle` or any other persistent CALL-E cache.
//   * Does NOT read environment variables for tokens.
//   * Does NOT contact the network.
//   * Does NOT shell out or spawn subprocesses.
//   * Does NOT touch the user's HOME for anything other than `os.tmpdir()`.
//
// Caller contract
// ---------------
//   const ctx = await createTempSyntheticCache({
//     serverUrl: 'https://offline.invalid',
//     parentDir: '/tmp/parcelbridge-bridge',
//   });
//   // ctx.cacheRoot, ctx.tokenFilePath, ctx.accessTokenCanary
//   try {
//     await runBridge({ cacheRoot: ctx.cacheRoot, ... });
//   } finally {
//     await ctx.cleanup();
//   }

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Mirror of @call-e/core/lib/cache.js serverHash. Kept inline (not imported)
// to make the public bridge hermetic against any future upstream API churn.
function serverHash(serverUrl) {
  return crypto.createHash("md5").update(serverUrl, "utf8").digest("hex");
}

export const PUBLIC_OFFLINE_CANARY =
  "PUBLIC_OFFLINE_CANARY_DO_NOT_USE_AS_REAL_CREDENTIAL";

function mkPrivateDirSync(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    /* best effort */
  }
}

export async function createTempSyntheticCache({
  serverUrl,
  parentDir = path.join(os.tmpdir(), "parcelbridge-bridge"),
} = {}) {
  if (typeof serverUrl !== "string" || !serverUrl) {
    throw new Error("createTempSyntheticCache: serverUrl is required");
  }

  // parent dir: 0700 root; per-run subdir: 0700 as well
  mkPrivateDirSync(parentDir);
  const runId = `run-${Date.now()}-${process.pid}-${crypto
    .createHash("sha1")
    .update(crypto.randomBytes(8))
    .digest("hex")
    .slice(0, 8)}`;
  const cacheRoot = path.join(parentDir, runId);
  mkPrivateDirSync(cacheRoot);

  // Mirror official serverHash layout.
  const serverHashDir = path.join(cacheRoot, serverHash(serverUrl));
  mkPrivateDirSync(serverHashDir);

  const tokenFilePath = path.join(serverHashDir, "token.json");
  // Token document MUST match @call-e/core tokenIsUsable schema:
  //   { token: { access_token: <non-empty string> }, expires_at?: <iso> }
  // We deliberately omit expires_at so tokenIsUsable considers it always
  // usable without ever carrying a real expiry timestamp.
  const tokenDocument = {
    token: {
      access_token: PUBLIC_OFFLINE_CANARY,
    },
    // Explicitly labeled marker for forensic auditing.
    _synthetic_marker: PUBLIC_OFFLINE_CANARY,
    _origin: "OFFLINE_SYNTHETIC_FETCH",
    _created_at: new Date().toISOString(),
  };

  fs.writeFileSync(tokenFilePath, `${JSON.stringify(tokenDocument, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(tokenFilePath, 0o600);
  } catch {
    /* best effort */
  }

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try {
      // Best-effort recursive removal of the per-run directory.
      fs.rmSync(cacheRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };

  return {
    cacheRoot,
    tokenFilePath,
    accessTokenCanary: PUBLIC_OFFLINE_CANARY,
    syntheticMarker: PUBLIC_OFFLINE_CANARY,
    cleanup,
  };
}

export const __synthetic_auth_cache_metadata__ = Object.freeze({
  origin: "OFFLINE_SYNTHETIC_FETCH",
  live_endpoint_accessed: false,
  real_oauth_cache_read: false,
  canary_labeled: true,
  cleanup_required: true,
});