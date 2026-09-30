/**
 * Mint operator tokens on the machine that holds the secret.
 *
 * The app never hands these out. Whoever runs this has ASHEARD_OPERATOR_SECRET,
 * which is the same thing as being the operator.
 *
 *   npm run operator-token -- dial +13035550100
 *     prints the token that lets /live dial exactly that number, and nothing else
 *
 *   npm run operator-token -- inbox
 *     prints a fresh webhook path to give a sender, and the separate token that
 *     reads the inbox back
 */

import { randomBytes } from "node:crypto";

import { mint, operatorSecret } from "../src/lib/operator.ts";

const secret = operatorSecret();
if (secret === null) {
  console.error("Set ASHEARD_OPERATOR_SECRET (32 characters or more) first.");
  process.exit(1);
}

const [kind, subject] = process.argv.slice(2);

if (kind === "dial" && subject && /^\+[1-9]\d{6,14}$/.test(subject)) {
  console.log(mint("dial", subject, secret));
} else if (kind === "inbox") {
  const id = randomBytes(16).toString("hex");
  console.log(`webhook path   /api/hook/${id}.${mint("inbox-post", id, secret)}`);
  console.log(`read token     ${mint("inbox-read", id, secret)}`);
} else {
  console.error("Usage: operator-token dial <E.164>  |  operator-token inbox");
  process.exit(1);
}
