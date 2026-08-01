#!/usr/bin/env node
/**
 * CLI for the COD confirmation gate.
 *
 *   npm run gate -- preview --order examples/order-cod.json
 *   npm run gate -- run     --order examples/order-cod.json
 *
 * `preview` never places a call and never needs credentials, which is both the
 * safe default for a merchant and the zero-setup path for a reviewer.
 */

import { readFile } from "node:fs/promises";
import { CalleClient } from "./calle.mjs";
import { ShopifyClient } from "./shopify.mjs";
import { createGate } from "./gate.mjs";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return { command, flags };
}

function usage() {
  console.log(`cod-gate - Shopify cash-on-delivery confirmation gate

Usage:
  node src/cli.mjs preview --order <order.json> [--merchant "Name"]
  node src/cli.mjs run     --order <order.json> [--merchant "Name"] [--max-attempts 2]

preview  Prints the exact call script, masked phone and idempotency key.
         Places no call. Requires no credentials.
run      Places one CALL-E call, polls until terminal, writes the verdict back
         to Shopify. Requires CALL_E_API_KEY. Shopify writeback additionally
         requires SHOPIFY_SHOP_DOMAIN and SHOPIFY_ACCESS_TOKEN.

Environment:
  CALL_E_API_KEY          CALL-E API key
  CALL_E_BASE_URL         override for testing against a fake server
  SHOPIFY_SHOP_DOMAIN     my-store.myshopify.com
  SHOPIFY_ACCESS_TOKEN    Admin API access token (orders read/write)
`);
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (!command || command === "help" || flags.help) {
    usage();
    process.exit(command ? 0 : 1);
  }
  if (!flags.order) {
    console.error("Missing --order <path to order json>.");
    process.exit(2);
  }

  const order = JSON.parse(await readFile(flags.order, "utf8"));
  const merchantName = flags.merchant || process.env.MERCHANT_NAME || "the store";
  const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN || "example.myshopify.com";
  const dryRun = command === "preview";

  const apiKey = process.env.CALL_E_API_KEY;
  if (!dryRun && !apiKey) {
    console.error("CALL_E_API_KEY is required for `run`. Use `preview` for the no-call path.");
    process.exit(2);
  }

  const calle = dryRun
    ? null
    : new CalleClient({ apiKey, baseUrl: process.env.CALL_E_BASE_URL || undefined });

  const shopify =
    !dryRun && process.env.SHOPIFY_ACCESS_TOKEN
      ? new ShopifyClient({
          shopDomain,
          accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
        })
      : null;

  const gate = createGate({
    calle,
    shopify,
    log: (event) => console.error(`[cod-gate] ${JSON.stringify(event)}`),
  });

  const result = await gate.run({
    order,
    shopDomain,
    merchantName,
    dryRun,
    maxAttempts: Number(flags["max-attempts"] || 2),
  });

  console.log(JSON.stringify(result, null, 2));
  // Exit code is the contract for a workflow step: 0 ship, 3 hold, 4 skip.
  if (result.decision === "hold") process.exit(3);
  if (result.decision === "skip") process.exit(4);
  process.exit(0);
}

main().catch((error) => {
  console.error(`cod-gate failed: ${error.message}`);
  process.exit(1);
});
