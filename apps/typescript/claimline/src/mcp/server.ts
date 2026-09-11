import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ClaimLineApp } from "../app.js";
import { buildTools } from "./tools.js";

/** Build an MCP server exposing ClaimLine's tools over the given app context. */
export function buildMcpServer(app: ClaimLineApp): McpServer {
  const server = new McpServer({
    name: "claimline",
    version: "0.1.0",
  });

  for (const tool of buildTools(app)) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      // The uniform loop erases per-tool arg types; the Zod inputSchema still
      // validates at the boundary, so cast the callback to satisfy the SDK.
      (async (args: Record<string, unknown>) => {
        const result = await tool.handler(args);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      }) as never,
    );
  }

  return server;
}

/** Run the MCP server over stdio. Logs go to stderr; stdout is the protocol. */
export async function runStdio(app: ClaimLineApp): Promise<void> {
  const server = buildMcpServer(app);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
