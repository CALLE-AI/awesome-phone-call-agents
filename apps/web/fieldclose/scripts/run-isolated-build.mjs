import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const nextCli = require.resolve("next/dist/bin/next");
const generatedTypeFiles = ["next-env.d.ts", "tsconfig.json"].map((file) =>
  resolve(process.cwd(), file),
);
const originalTypeFiles = generatedTypeFiles.map((file) => readFileSync(file));
let restored = false;
let stopping = false;

function restoreGeneratedTypeFiles() {
  if (restored) {
    return;
  }

  restored = true;
  generatedTypeFiles.forEach((file, index) => {
    writeFileSync(file, originalTypeFiles[index]);
  });
}

const child = spawn(process.execPath, [nextCli, "build"], {
  env: {
    ...process.env,
    FIELDCLOSE_NEXT_DIST_DIR: ".next-verify",
  },
  stdio: "inherit",
});

function stop(signal) {
  if (stopping) {
    return;
  }

  stopping = true;
  child.kill(signal);
}

process.on("exit", restoreGeneratedTypeFiles);
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

child.on("error", (error) => {
  console.error(error);
  restoreGeneratedTypeFiles();
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  restoreGeneratedTypeFiles();

  if (signal && !stopping) {
    process.exitCode = 1;
    return;
  }

  process.exitCode = code ?? 0;
});
