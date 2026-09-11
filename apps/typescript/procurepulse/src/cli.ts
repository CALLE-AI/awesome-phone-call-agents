/**
 * ProcurePulse CLI. Preview is the default and needs no key; nothing dials without
 * --execute, --i-have-consent and an allowlisted E.164 destination.
 *
 *   tsx src/cli.ts preview [--request examples/request.json]     exact POST /v1/calls bodies, no network
 *   tsx src/cli.ts demo                                           whole race against a loopback fake CALL-E
 *   tsx src/cli.ts replay examples/fictional_completed_call.json  validate + rank a saved snapshot offline
 *   tsx src/cli.ts check                                          key check with GET /v1/goals (side-effect free)
 *   tsx src/cli.ts start --execute --i-have-consent [--wait]      place the quote calls (real side effects)
 *   tsx src/cli.ts sync | board                                   poll open calls / print the board
 *   tsx src/cli.ts approve <vendor-id> --i-approve                internal decision only, no call
 *   tsx src/cli.ts hold --execute --i-have-consent --i-approve-hold [--wait]
 *   tsx src/cli.ts serve-webhook [--port 8788]                    unsigned-webhook receiver on a path token
 */
import fs from "node:fs";
import path from "node:path";
import { CALLE_ORIGIN, CalleClient, providerResult } from "./calle.ts";
import { FAKE_KEY, FakeCalle, type Outcome } from "./fake-calle.ts";
import { Ledger, taskId } from "./ledger.ts";
import { mask, parseAllowlist } from "./phone.ts";
import { analyzeQuote, completeness } from "./ranking.ts";
import { approveVendor, board, planRace, requestHold, startRace, syncRace, waitForRace } from "./race.ts";
import { validateQuoteResult } from "./schema.ts";
import type { QuoteRequest } from "./task.ts";
import { createWebhookServer } from "./webhook.ts";

const APP = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith("--") ? args[0] : "preview";
const flag = (name: string) => args.includes(name);
const option = (name: string, fallback: string) => (args.includes(name) ? args[args.indexOf(name) + 1] ?? fallback : fallback);

// .env next to the app, never printed. Real environment variables win.
const envFile = path.join(APP, ".env");
if (fs.existsSync(envFile))
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2];
  }

const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(path.resolve(file), "utf8")) as T;
const requestFile = option("--request", path.join(APP, "examples", "request.json"));
const ledgerFile = option("--ledger", path.join(APP, ".procurepulse", "ledger.json"));
const webhookOrigin = process.env.PUBLIC_BASE_URL?.trim().replace(/\/$/, "") ?? "";
const webhookToken = process.env.PROCUREPULSE_WEBHOOK_TOKEN?.trim() ?? "";
const webhookUrl = webhookOrigin.startsWith("https://") && webhookToken ? `${webhookOrigin}/calle/webhook/${webhookToken}` : null;
const RULE = "─".repeat(72);

function liveClient(): CalleClient {
  const key = process.env.CALLE_API_KEY?.trim();
  if (!key) throw new Error("CALLE_API_KEY is not set (see .env.example)");
  return new CalleClient(key, CALLE_ORIGIN);
}

function requireExecute(what: string) {
  if (!flag("--execute") || !flag("--i-have-consent"))
    throw new Error(`${what} places real phone calls. Re-run with --execute --i-have-consent once every supplier has agreed to be called.`);
}

const money = (n: number | null, currency: string) =>
  n === null ? "Needs review" : new Intl.NumberFormat("en-US", { style: "currency", currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD" }).format(n);

function printBoard(ledger: Ledger) {
  const b = board(ledger);
  console.log(RULE);
  console.log(`${b.request.quantity} · ${b.request.item} · needed ${b.request.deadline}`);
  console.log(RULE);
  for (const t of b.tasks)
    console.log(`${t.vendorName.padEnd(22)} ${t.status.replaceAll("_", " ").padEnd(16)} ${t.providerCallId ?? "no call id"}${t.lastError ? `  (${t.lastError})` : ""}`);
  if (b.quotes.length) console.log(RULE);
  for (const q of b.quotes) {
    const badges = [q.vendorId === b.rankings.cheapest ? "LOWEST COMPLETE TOTAL" : "", q.vendorId === b.rankings.earliest ? "EARLIEST READY" : ""].filter(Boolean).join(", ");
    console.log(`${q.vendorName.padEnd(22)} ${money(q.comparableTotal, q.quote.currency).padEnd(14)} ${q.quote.item_match} · ${q.quote.fulfillment_method} · ready ${q.quote.ready_at || "not supplied"} · ${q.completeness}% complete${badges ? `  [${badges}]` : ""}`);
    for (const w of q.warnings) console.log(`${"".padEnd(23)}! ${w}`);
  }
  if (b.decision) {
    console.log(RULE);
    console.log(`Approved internally: ${b.decision.vendorId}. No purchase has been made.`);
    if (b.hold) {
      const r = b.hold.result;
      console.log(`Hold call: ${b.hold.status.replaceAll("_", " ")}${r ? ` · hold ${r.hold_placed === "yes" ? `confirmed until ${r.hold_expires_at} by ${r.contact_name}` : "not confirmed"} · not a purchase` : ""}`);
    }
  }
  console.log(RULE);
}

async function main() {
  switch (command) {
    case "preview": {
      const request = readJson<QuoteRequest>(requestFile);
      const plan = planRace(request, { webhookUrl });
      console.log(RULE);
      console.log(`Representing  ${plan.representing}`);
      console.log(`Goal          ${plan.goal}`);
      for (const r of plan.recipients) console.log(`Recipient     ${r.vendor} ${r.phone} (${r.authorization})`);
      console.log(`Boundary      ${plan.boundary}`);
      console.log(`Results via   ${plan.delivery}`);
      console.log(RULE);
      const first = plan.calls[0]!;
      const shown = { ...first.body, recipients: first.body.recipients.map((r) => ({ ...r, phones: r.phones.map(mask) })) };
      console.log(`POST ${CALLE_ORIGIN}/v1/calls   Idempotency-Key: ${first.idempotencyKey}`);
      console.log(JSON.stringify(shown, null, 2));
      console.log(RULE);
      console.log(`${plan.calls.length} calls would be created (one per supplier, same questions). Nothing was dialed.`);
      return;
    }
    case "replay": {
      const file = args[1] ?? path.join(APP, "examples", "fictional_completed_call.json");
      const request = readJson<QuoteRequest>(requestFile);
      const quote = validateQuoteResult(providerResult(readJson(file)));
      const analysis = analyzeQuote(quote, request.quantity);
      console.log(`passes the strict schema   yes`);
      console.log(`completeness               ${completeness(quote)}%`);
      console.log(`ranking status             ${analysis.status}`);
      console.log(`comparable total           ${money(analysis.comparableTotal, quote.currency)}`);
      for (const w of analysis.warnings) console.log(`warning                    ${w}`);
      return;
    }
    case "demo": {
      const request = readJson<QuoteRequest>(requestFile);
      const fake = new FakeCalle(readJson<Record<string, Outcome>>(option("--outcomes", path.join(APP, "examples", "fake-outcomes.json"))));
      const client = new CalleClient(FAKE_KEY, await fake.start());
      const ledger = new Ledger(null);
      const allowlist = new Set(request.vendors.map((v) => v.phone));
      try {
        console.log(`Loopback fake CALL-E at ${fake.baseUrl}: nothing is dialed.`);
        await startRace(ledger, client, request, { webhookUrl: null, allowlist });
        for (let step = 0; step < 3; step += 1) {
          for (const call of fake.calls.values()) fake.advance(call);
          await syncRace(ledger, client);
          console.log(`poll ${step + 1}: ${board(ledger).tasks.map((t) => `${t.vendorName} ${t.status.replaceAll("_", " ")}`).join(" | ")}`);
        }
        printBoard(ledger);
        const cheapest = board(ledger).rankings.cheapest;
        if (!cheapest) return;
        console.log(`Demo only: approving ${cheapest} internally (live use requires approve --i-approve).`);
        approveVendor(ledger, cheapest, { humanApproved: true });
        await requestHold(ledger, client, { webhookUrl: null, allowlist, humanApproved: true });
        const holdCall = fake.callFor(cheapest, "hold_request");
        for (let step = 0; step < 3; step += 1) fake.advance(holdCall);
        await syncRace(ledger, client);
        printBoard(ledger);
        console.log(`${fake.requests.length} create-call requests reached the fake server; 0 real calls.`);
      } finally {
        await fake.stop();
      }
      return;
    }
    case "check": {
      const client = liveClient();
      await client.checkKey();
      console.log(`key accepted       GET ${CALLE_ORIGIN}/v1/goals → 200`);
      console.log(`dial allowlist     ${[...parseAllowlist(process.env.PROCUREPULSE_DIAL_ALLOWLIST)].map(mask).join(", ") || "(empty: nothing can be dialed)"}`);
      console.log(`results via        ${webhookUrl ? "webhook + polling" : "polling"}`);
      return;
    }
    case "start": {
      requireExecute("start");
      const ledger = new Ledger(ledgerFile);
      const client = liveClient();
      await startRace(ledger, client, readJson<QuoteRequest>(requestFile), { webhookUrl, allowlist: parseAllowlist(process.env.PROCUREPULSE_DIAL_ALLOWLIST) });
      if (flag("--wait")) await waitForRace(ledger, client, { onChange: (s) => console.log(`  … ${s}`) });
      printBoard(ledger);
      return;
    }
    case "sync": {
      const ledger = new Ledger(ledgerFile);
      await syncRace(ledger, liveClient());
      printBoard(ledger);
      return;
    }
    case "board":
      printBoard(new Ledger(ledgerFile));
      return;
    case "approve": {
      const vendorId = args[1];
      if (!vendorId || vendorId.startsWith("--")) throw new Error("usage: approve <vendor-id> --i-approve");
      const ledger = new Ledger(ledgerFile);
      approveVendor(ledger, vendorId, { humanApproved: flag("--i-approve") });
      printBoard(ledger);
      return;
    }
    case "hold": {
      requireExecute("hold");
      const ledger = new Ledger(ledgerFile);
      const client = liveClient();
      await requestHold(ledger, client, { webhookUrl, allowlist: parseAllowlist(process.env.PROCUREPULSE_DIAL_ALLOWLIST), humanApproved: flag("--i-approve-hold") });
      if (flag("--wait")) await waitForRace(ledger, client, { onChange: (s) => console.log(`  … ${s}`) });
      printBoard(ledger);
      console.log(`Hold task: ${ledger.data.tasks[taskId("hold", ledger.data.decision!.vendorId)]?.status}`);
      return;
    }
    case "serve-webhook": {
      const port = Number(option("--port", "8788"));
      const server = createWebhookServer(webhookToken, { ledger: new Ledger(ledgerFile), client: liveClient() });
      server.listen(port, "127.0.0.1", () => console.log(`webhook receiver on 127.0.0.1:${port}/calle/webhook/<token>; expose it over HTTPS and set PUBLIC_BASE_URL`));
      return;
    }
    default:
      throw new Error(`Unknown command ${command}. Commands: preview, demo, replay, check, start, sync, board, approve, hold, serve-webhook`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
