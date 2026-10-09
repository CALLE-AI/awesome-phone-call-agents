import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCallPlan, createSdkPort, callFromFixture } from "./calle.js";
import { DemoCommerce } from "./commerce.js";
import { ConversactOrchestrator } from "./orchestrator.js";
import { DemoPayment } from "./payment.js";
import { assertE164, assertUsableConsent, maskPhone, redactDisplay } from "./safety.js";
import type { CallConsent, Product, PurchaseIntent, WorkflowOutcome } from "./types.js";

const FIXTURES = new Set(["confirmed-order", "ambiguous-result", "declined-result", "incomplete-result", "unavailable-product", "insufficient-stock"]);

function writeDisplay(text: string, stream: { write(text: string): unknown } = process.stdout): void {
  stream.write(redactDisplay(text, [process.env.CALLE_API_KEY ?? ""]));
}

function usage(): string {
  return `Conversact — Conversational Commerce Reference

  npm run preview
      Prints the masked call plan. No network request, call, or payment.

  npm run simulate -- --fixture <confirmed-order|ambiguous-result|declined-result|incomplete-result|unavailable-product|insufficient-stock>
      Runs deterministic local CALL-E evidence through commerce validation and a synthetic checkout handoff.

  CONVERSACT_LIVE_CALLS=true CALLE_API_KEY=... npm run live -- --phone +14155550100 --session cv_example_001 --confirm-place-real-call
      Places one explicitly authorized real CALL-E call. The recipient must have authorized this run.
      A submitted call may not be cancellable. An ambiguous submission is never redialed automatically.`;
}

function fixturePath(name: string): string {
  return resolve(import.meta.dirname, `../fixtures/${name}.json`);
}

function readCatalog(): Product[] {
  return JSON.parse(readFileSync(fixturePath("catalog"), "utf8")) as Product[];
}

function readFixture(name: string): PurchaseIntent | null {
  return JSON.parse(readFileSync(fixturePath(name), "utf8")) as PurchaseIntent | null;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function consent(sessionId: string, recipientPhone: string): CallConsent {
  return { sessionId, recipientPhone, purpose: "conversational_checkout", authorizedAt: "2026-01-01T00:00:00.000Z" };
}

function printOutcome(outcome: WorkflowOutcome, noSideEffects: boolean): void {
  writeDisplay("Conversact — Conversational Commerce Reference\n\n");
  writeDisplay(`Session: ${outcome.sessionId}\nState: ${outcome.state}\n`);
  if (outcome.reason !== undefined) writeDisplay(`Reason: ${outcome.reason}\n`);
  if (outcome.intent !== undefined) {
    writeDisplay(`CALL-E outcome: ${outcome.intent.outcome}\n`);
    for (const item of outcome.intent.items) writeDisplay(`  ${item.quantity} × ${item.product_id}\n`);
  }
  if (outcome.quote !== undefined) {
    writeDisplay(`Authoritative total: $${(outcome.quote.totalMinor / 100).toFixed(2)}\n`);
    writeDisplay("Prices and availability were loaded by the commerce adapter.\n");
  }
  if (outcome.payment !== undefined) writeDisplay(`Payment: synthetic handoff ready (${outcome.payment.reference})\n`);
  if (noSideEffects) writeDisplay("\nNo real phone call or payment was made.\n");
}

async function preview(): Promise<void> {
  const sessionId = "cv_preview_001";
  const phone = "+14155550100";
  const plan = buildCallPlan({ sessionId, recipientPhone: phone, catalog: readCatalog() });
  writeDisplay("Conversact — Preview (no call)\n\n");
  writeDisplay(`Session: ${sessionId}\nRecipient: ${maskPhone(phone)}\nIdempotency: ${plan.idempotencyKey}\n`);
  writeDisplay("Side effects: no network request, telephone call, or payment.\n\n");
  writeDisplay(`Task:\n${plan.task}\n\nResult schema:\n${JSON.stringify(plan.resultSchema, null, 2)}\n`);
}

async function simulate(): Promise<void> {
  // npm on some Windows shells removes `--fixture` but retains its value as the
  // first positional argument. Supporting both keeps the documented no-call
  // fixture command deterministic without broadening live inputs.
  const name = argument("--fixture") ?? process.argv[3] ?? "confirmed-order";
  if (!FIXTURES.has(name)) throw new Error(`Unknown fixture ${name}. Run with one of: ${[...FIXTURES].join(", ")}.`);
  const sessionId = "cv_demo_001";
  const phone = "+14155550100";
  const workflow = new ConversactOrchestrator(new DemoCommerce(readCatalog()), new DemoPayment());
  const outcome = await workflow.reconcile(consent(sessionId, phone), callFromFixture(sessionId, phone, readFixture(name)));
  printOutcome(outcome, true);
}

async function live(): Promise<void> {
  if (process.env.CONVERSACT_LIVE_CALLS !== "true") {
    throw new Error("Live calls are disabled. Set CONVERSACT_LIVE_CALLS=true only after the recipient has authorized this one call.");
  }
  if (!hasFlag("--confirm-place-real-call")) {
    throw new Error("Live calls need --confirm-place-real-call for this specific run.");
  }
  const phone = assertE164(argument("--phone") ?? "");
  const sessionId = argument("--session") ?? "";
  const authorization = consent(sessionId, phone);
  assertUsableConsent(authorization, phone);
  const apiKey = process.env.CALLE_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) throw new Error("CALLE_API_KEY is required for live mode and is never read from CLI arguments.");
  const plan = buildCallPlan({ sessionId, recipientPhone: phone, catalog: readCatalog() });
  const workflow = new ConversactOrchestrator(new DemoCommerce(readCatalog()), new DemoPayment());
  writeDisplay(`[conversact] session=${sessionId} call=submitting recipient=${maskPhone(phone)}\n`, process.stderr);
  const outcome = await workflow.startLive(authorization, plan, await createSdkPort(apiKey, process.env.CALLE_BASE_URL));
  printOutcome(outcome, false);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "help";
  if (command === "help" || command === "--help") {
    writeDisplay(`${usage()}\n`);
    return;
  }
  if (command === "preview") return preview();
  if (command === "simulate") return simulate();
  if (command === "live") return live();
  throw new Error(`Unknown command ${command}.\n\n${usage()}`);
}

main().catch((error: unknown) => {
  writeDisplay(`${error instanceof Error ? error.message : String(error)}\n`, process.stderr);
  process.exitCode = 1;
});
