//  tadah-calls preview | demo | call <request.json>
//
//  Nothing is dialled unless `call` gets --live, CALLE_API_KEY is set, and the
//  number's last four digits are typed back with --confirm-last4.

import { readFileSync } from "node:fs";
import {
  type ActionRecord,
  CALLE_BASE_URL,
  type CallRequest,
  CallService,
  createCallBody,
  dryRunProvider,
  FakeCalle,
  httpProvider,
  maskPhone,
  normalizePhone,
  prepareCall,
  type Refusal,
} from "./calls.js";

const USER = "cli-operator";

function refused(result: Refusal): number {
  console.error(`Refused (${result.error}). ${result.message}`);
  return 1;
}

function show(action: ActionRecord): void {
  const result = action.structured ?? {};
  const rows: Array<[string, unknown]> = [
    ["Status", action.status],
    ["Outcome", result.outcome],
    ["What they said", result.detail ?? action.summary],
    ["Agreed", result.agreed],
    ["Next step", result.next_step],
    ["Needs the user", result.needs_user_action],
    ["Failure", action.failureCode],
  ];
  for (const [label, value] of rows) {
    if (value !== undefined && value !== null && value !== "") console.log(`  ${label.padEnd(15)} ${String(value)}`);
  }
  if (action.transcript) console.log(`\n  Transcript\n${action.transcript.replace(/^/gm, "    ")}`);
}

function preview(request: CallRequest): number {
  const prepared = prepareCall(USER, request);
  if (!prepared.ok) return refused(prepared);
  const body = createCallBody("(assigned when the call is placed)", prepared.task, maskPhone(prepared.phone));
  console.log("PREVIEW: nothing is dialled and nothing leaves this machine.\n");
  console.log(`  Tadah will call  ${maskPhone(prepared.phone)}`);
  console.log(`  May agree to     ${prepared.mayAgreeTo || "nothing (Tadah only asks)"}`);
  console.log(`  Idempotency-Key  ${prepared.idempotencyKey}\n`);
  console.log(`POST ${CALLE_BASE_URL}/v1/calls\n${JSON.stringify(body, null, 2)}`);
  return 0;
}

async function demo(request: CallRequest): Promise<number> {
  const calle = new FakeCalle();
  const secret = "local-demo-secret";
  const service = new CallService({ provider: calle, webhook: { baseUrl: "https://tadah.example", secret } });
  console.log("DEMO: an in-process fake CALL-E. No credentials, no network, synthetic results.\n");

  console.log("1. Place the call");
  const first = await service.placeCall(USER, request);
  if (!first.ok) return refused(first);
  const call = calle.created[0]!;
  console.log(`   CALL-E call ${call.id} to ${maskPhone(call.body.recipients[0]!.phones[0]!)}, key ${call.idempotencyKey}`);

  console.log("2. Ask for the same call again while it is live");
  const again = await service.placeCall(USER, request);
  console.log(`   ${again.ok ? "A second call was placed (unexpected)" : `Refused: ${again.error}`}; calls created: ${calle.created.length}`);

  console.log("3. The call ends and CALL-E sends its webhook");
  calle.complete(call.id);
  const event = calle.webhookEvent(call.id, "evt_demo_1");
  const delivered = await service.handleWebhook({ pathSecret: secret, eventId: "evt_demo_1", body: event });
  console.log(`   HTTP ${delivered.status}; the result was re-read from CALL-E (reads: ${calle.reads})`);

  console.log("4. The same webhook is delivered again");
  const duplicate = await service.handleWebhook({ pathSecret: secret, eventId: "evt_demo_1", body: event });
  console.log(`   HTTP ${duplicate.status}, ignored as a duplicate (reads: ${calle.reads})`);

  console.log("5. A webhook arrives with the wrong secret");
  const forged = await service.handleWebhook({ pathSecret: "wrong-secret", eventId: "evt_forged", body: event });
  console.log(`   Refused with HTTP ${forged.status}`);

  console.log("\n6. What lands on the to-do");
  const action = await service.refreshStatus(USER, first.actionId);
  if (action) show(action);
  return 0;
}

async function call(request: CallRequest, flags: string[]): Promise<number> {
  if (!flags.includes("--live")) {
    const service = new CallService({ provider: dryRunProvider() });
    const result = await service.placeCall(USER, request);
    if (!result.ok) return refused(result);
    console.log("DRY RUN: the call path ran and nothing was dialled. For one real call, add --live --confirm-last4 NNNN.\n");
    const action = await service.refreshStatus(USER, result.actionId);
    if (action) show(action);
    return 0;
  }

  const apiKey = process.env.CALLE_API_KEY ?? "";
  if (!apiKey) {
    console.error("CALLE_API_KEY is not set, so no call was placed.");
    return 2;
  }
  const phone = normalizePhone(request.phone);
  const at = flags.indexOf("--confirm-last4");
  if (!phone || at < 0 || flags[at + 1] !== phone.slice(-4)) {
    const target = phone ? ` (${maskPhone(phone)})` : "";
    console.error(`A live call needs --confirm-last4 with the last four digits of the number${target}. No call was placed.`);
    return 2;
  }

  const service = new CallService({ provider: httpProvider(apiKey, process.env.CALLE_BASE_URL || CALLE_BASE_URL) });
  console.log(`LIVE: one call to ${maskPhone(phone)}.`);
  console.log("Ctrl+C stops watching but does not end the call. CALL-E has no cancel endpoint; end a running call from the CALL-E dashboard.");
  const result = await service.placeCall(USER, request);
  if (!result.ok) return refused(result);

  for (let waited = 0; waited < 10 * 60_000; waited += 10_000) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    const action = await service.refreshStatus(USER, result.actionId);
    if (action && action.status !== "queued" && action.status !== "in_progress") {
      console.log("");
      show(action);
      return action.status === "completed" ? 0 : 1;
    }
    process.stdout.write(".");
  }
  console.log("\nStopped watching after 10 minutes. The call may still finish; check the CALL-E dashboard.");
  return 1;
}

async function main(): Promise<number> {
  const [command, file, ...flags] = process.argv.slice(2);
  if (!file || (command !== "preview" && command !== "demo" && command !== "call")) {
    console.error("Usage: tadah-calls preview|demo|call <request.json> [--live --confirm-last4 NNNN]");
    return 2;
  }
  const request = JSON.parse(readFileSync(file, "utf8")) as CallRequest;
  if (command === "preview") return preview(request);
  if (command === "demo") return demo(request);
  return call(request, flags);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
