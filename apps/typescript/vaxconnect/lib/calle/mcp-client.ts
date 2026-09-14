import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import fs from "fs";

const CALLE_MCP_URL =
    "https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth";

const CALLE_TOKEN_PATH =
    process.env.CALLE_MCP_TOKEN_PATH ||
    `${process.env.USERPROFILE}\\.calle-mcp\\cli\\4811f3e50259ff50339bb2feef40c0e9\\token.json`;

let client: Client | null = null;

export async function getCalleMcpClient() {
    if (client) {
        return client;
    }

    if (!fs.existsSync(CALLE_TOKEN_PATH)) {
        throw new Error(
            `CALL-E MCP token not found at ${CALLE_TOKEN_PATH}`
        );
    }

    const tokenData = JSON.parse(
        fs.readFileSync(CALLE_TOKEN_PATH, "utf8")
    );

    const accessToken = tokenData.token;

    if (!accessToken) {
        throw new Error("CALL-E MCP token not found");
    }

    client = new Client({
        name: "vaxconnect",
        version: "1.0.0",
    });

    const transport = new StreamableHTTPClientTransport(
        new URL(CALLE_MCP_URL),
        {
            requestInit: {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            },
        }
    );

    await client.connect(transport);

    return client;
}