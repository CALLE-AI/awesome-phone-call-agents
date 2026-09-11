/**
 * Build the standalone scheduler process with esbuild.
 *
 * The scheduler runs outside Next.js (see README "Scheduler"), so it is
 * bundled into a single JS file that Docker and local dev both run directly.
 * better-sqlite3 and @call-e/calle stay external (resolved from node_modules
 * at runtime) because esbuild cannot bundle the native addon.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [join(root, "scripts/scheduler-entry.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: join(root, "dist-scheduler/scheduler.js"),
  external: ["better-sqlite3", "@call-e/calle"],
  banner: {
    // esbuild emits ESM with no extension hints; the runtime import of the
    // native modules is resolved by node_modules, which is fine.
    js: "",
  },
  logLevel: "info",
});

console.log("built dist-scheduler/scheduler.js");
