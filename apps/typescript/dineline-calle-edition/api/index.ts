import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { createDineLineRequestHandler } from "../src/server.js";

const fixtureEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  DINELINE_CALL_MODE: "fixture",
  DINELINE_ALLOW_REAL_CALLS: "false",
  DINELINE_ALLOW_REAL_INTAKE_CALLS: "false",
};

const handleDineLineRequest = createDineLineRequestHandler({
  environment: fixtureEnvironment,
  journalRoot: path.join(tmpdir(), "dineline-calle-edition", "public-demo"),
});

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const incomingUrl = new URL(request.url ?? "/", "http://localhost");
  const route = incomingUrl.searchParams.get("route") ?? "";
  request.url = `/api/${route.replace(/^\/+/, "")}`;
  await handleDineLineRequest(request, response);
}
