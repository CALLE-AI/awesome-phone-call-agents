import { readFile } from "node:fs/promises";
import { createPlan } from "./calle.js";
import { compileCallback, type CallbackInput } from "./core.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const command = process.argv[2];
  const inputPath = argument("--input");
  if (!inputPath) throw new Error("Pass --input <callback.json>.");
  const input = JSON.parse(await readFile(inputPath, "utf8")) as CallbackInput;
  const compiled = compileCallback(input);

  if (command === "preview") {
    console.log(JSON.stringify({
      object: compiled.object,
      workflow_hash: compiled.workflow_hash,
      idempotency_key: compiled.idempotency_key,
      recipient: compiled.masked_phone,
      approval_phrase: compiled.approval_phrase,
      call_task: compiled.call_task.replaceAll(input.recipient.phone, compiled.masked_phone),
      side_effect: "none; preview does not contact CALL-E or place a call"
    }, null, 2));
    return;
  }

  if (command === "plan") {
    const plan = await createPlan(compiled);
    console.log(JSON.stringify({
      plan_id: plan.plan_id,
      ready_to_run: plan.ready_to_run,
      summary: plan.summary,
      workflow_hash: plan.workflow_hash,
      recipient: plan.masked_phone,
      approval_phrase: plan.approval_phrase,
      expires_at: plan.expires_at,
      warning: "Plan created; no call placed. Keep the confirm token server-side."
    }, null, 2));
    return;
  }

  throw new Error("Use preview or plan. The reusable CLI intentionally does not expose live dispatch; hosts must add their own server-side action-time gate before calling runPlan().");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
