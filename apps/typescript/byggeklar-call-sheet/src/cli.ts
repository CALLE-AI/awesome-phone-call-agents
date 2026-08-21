import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildPreview, DEMO_RESULT, renderPreview, validateRequest } from "./workflow.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function loadRequest(path: string) {
  return validateRequest(JSON.parse(await readFile(resolve(path), "utf8")));
}

function renderResult(result: Record<string, unknown>): string {
  return [
    "BYGGEKLAR EVIDENCE PACKET",
    `Status       ${String(result.status)}`,
    `Completed    ${String(result.taskCompleted ?? result.task_completed)}`,
    "",
    "Structured result",
    JSON.stringify(result.structuredResult ?? result.structured_result, null, 2),
    "",
    "Evidence",
    ...((result.evidence as unknown[] | undefined) ?? []).map((line) => `- ${String(line)}`),
    "",
    "Decision: HUMAN REVIEW REQUIRED. No order or supplier commitment was created.",
  ].join("\n");
}

async function main() {
  const command = process.argv[2];
  const requestPath = arg("--request");
  if (!requestPath) throw new Error("Use --request <file.json>");
  const preview = buildPreview(await loadRequest(requestPath));

  if (command === "preview") {
    console.log(renderPreview(preview));
    return;
  }
  if (command === "demo") {
    console.log(renderPreview(preview));
    console.log("\n--- FIXTURE RESULT; NO CALL PLACED ---\n");
    console.log(renderResult(DEMO_RESULT));
    return;
  }
  if (command !== "call") throw new Error("Command must be preview, demo or call");

  const receipt = arg("--confirm");
  if (receipt !== preview.receipt) throw new Error("Refusing call: --confirm must match the current preview receipt");
  const apiKey = process.env.CALLE_API_KEY;
  if (!apiKey) throw new Error("CALLE_API_KEY is required for a live call");
  const baseUrl = process.env.CALLE_BASE_URL ?? "https://api.heycall-e.com";
  if (new URL(baseUrl).hostname !== "api.heycall-e.com" || new URL(baseUrl).protocol !== "https:") {
    throw new Error("Refusing to send the API key anywhere except https://api.heycall-e.com");
  }
  const { CalleClient } = await import("@call-e/calle");
  const client = new CalleClient({ apiKey, baseUrl });
  const call = await client.calls.create(
    {
      task: preview.task,
      recipients: [{ phones: [preview.request.phone], region: preview.request.region, locale: preview.request.locale }],
      resultSchema: preview.resultSchema,
      metadata: { workflow: "byggeklar-call-sheet", request_id: preview.request.request_id },
    },
    { idempotencyKey: `byggeklar:${preview.request.request_id}:${preview.receipt.slice(0, 16)}` },
  );
  const final = await client.calls.waitForResult(call.id, { timeoutMs: 300_000, intervalMs: 7_500 });
  const output = arg("--output") ?? `reports/${preview.request.request_id}.json`;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(final, null, 2)}\n`, { mode: 0o600 });
  console.log(renderResult(final as unknown as Record<string, unknown>));
  console.log(`\nSaved private report: ${output}`);
}

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
