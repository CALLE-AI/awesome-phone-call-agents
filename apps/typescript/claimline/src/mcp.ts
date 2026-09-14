import { ClaimLineApp } from "./app.js";
import { runStdio } from "./mcp/server.js";

const app = new ClaimLineApp();

runStdio(app)
  .then(() => {
    // stdout is reserved for the MCP protocol; log to stderr.
    console.error(
      `ClaimLine MCP server running on stdio [mode=${app.config.mode}]`,
    );
  })
  .catch((err) => {
    console.error("Fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
