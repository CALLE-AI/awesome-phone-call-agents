/**
 * Local demo — exercises primary-unavailable-backup-success and exits cleanly.
 */

import { runLocalDemo } from "./demo-flow.js";

try {
  await runLocalDemo();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
