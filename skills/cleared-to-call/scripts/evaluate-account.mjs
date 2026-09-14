#!/usr/bin/env node
// Run the pre-dial gate on one account and print the decision as JSON.
//
//   node scripts/evaluate-account.mjs --account-json '{"account_id":"A-1001", ...}'
//   node scripts/evaluate-account.mjs --file accounts.json --account-id A-1001 \
//     --suppression suppression.jsonl --now 2026-08-28T13:30:00Z
//
// Exit code 0 means ALLOW, 2 means BLOCK, 1 means the input could not be read.
// Nothing here dials, schedules, or contacts a provider.

import {
  evaluateAccount,
  loadPolicy,
  loadSuppression,
  parseArgs,
  readAccountArgument,
  validateAccount,
} from "./gate-core.mjs";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const policy = loadPolicy(args.policy);

  let account;
  try {
    account = readAccountArgument(args);
  } catch (error) {
    console.error(`error: ${error.message}`);
    return 1;
  }
  if (Array.isArray(account)) {
    console.error("error: --file holds a batch. Pass --account-id to choose one account.");
    return 1;
  }

  const problems = validateAccount(account);
  if (problems.length > 0) {
    console.log(
      JSON.stringify(
        {
          account_id: account.account_id ?? null,
          decision: "block",
          block_reason: "INVALID_INPUT",
          problems,
        },
        null,
        2,
      ),
    );
    return 1;
  }

  const now = args.now ? new Date(args.now) : new Date();
  if (Number.isNaN(now.getTime())) {
    console.error(`error: --now is not a valid timestamp: ${args.now}`);
    return 1;
  }

  const decision = evaluateAccount(account, {
    now,
    policy,
    suppressed: loadSuppression(args.suppression),
    scriptText: args.script ?? null,
  });

  console.log(JSON.stringify(decision, null, 2));
  return decision.decision === "allow" ? 0 : 2;
}

process.exitCode = main();
