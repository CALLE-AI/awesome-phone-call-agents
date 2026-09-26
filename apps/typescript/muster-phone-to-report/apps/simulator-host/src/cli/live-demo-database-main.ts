import process from "node:process";
import { fileURLToPath } from "node:url";

import { disposeLiveDemoDatabase } from "./live-demo-database-dispose.js";
import { runLiveDemoDatabaseOperatorCommand } from "./live-demo-database-operator.js";
import { startLiveDemoDatabase } from "./live-demo-database-start.js";
import { createLiveDemoDatabaseOperatorRuntime } from "../composition/live-demo-database-operator-runtime.js";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const runtime = createLiveDemoDatabaseOperatorRuntime(repositoryRoot);

process.exitCode = await runLiveDemoDatabaseOperatorCommand({
  argv: process.argv.slice(2),
  repositoryRoot,
  start: async () => await startLiveDemoDatabase({ repositoryRoot, capabilities: runtime.start }),
  dispose: async () =>
    await disposeLiveDemoDatabase({ repositoryRoot, capabilities: runtime.dispose }),
  writeLine: (line) => process.stdout.write(`${line}\n`),
});
