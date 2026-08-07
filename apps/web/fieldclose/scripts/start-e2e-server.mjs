import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextCli = require.resolve("next/dist/bin/next");
const e2eDataKey = Buffer.alloc(32, 31).toString("base64");
const e2eLookupKey = Buffer.alloc(32, 32).toString("base64");
const child = spawn(
  process.execPath,
  [
    nextCli,
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3100",
  ],
  {
    env: {
      ...process.env,
      FIELDCLOSE_NEXT_DIST_DIR: ".next-e2e",
      FIELDCLOSE_DATA_KEY: e2eDataKey,
      FIELDCLOSE_LOOKUP_KEY: e2eLookupKey,
      FIELDCLOSE_PHONE_KEY_VERSION: "e2e-v1",
    },
    stdio: "inherit",
  },
);

let stopping = false;

function stop(signal) {
  if (stopping) {
    return;
  }

  stopping = true;
  child.kill(signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal && !stopping) {
    process.exitCode = 1;
    return;
  }

  process.exitCode = code ?? 0;
});
