#!/usr/bin/env node
// Rule 5. Check whether something the recipient said revokes consent.
//
//   node scripts/check-revocation.mjs --utterance "stop calling me"
//   node scripts/check-revocation.mjs --transcript transcript.json
//
// The transcript file is a JSON array of {"speaker": "...", "text": "..."}.
// Only recipient turns are considered: the agent's own opt-out disclosure is a
// required line, not an opt-out.
//
// Exit code 0 means no revocation, 3 means a revocation was found and the
// number must be suppressed.

import { readFileSync } from "node:fs";

import { detectRevocation, loadPolicy, parseArgs } from "./gate-core.mjs";

const RECIPIENT_SPEAKERS = new Set(["recipient", "user", "customer", "human", "consumer", "callee"]);

function main() {
  const args = parseArgs(process.argv.slice(2));
  const policy = loadPolicy(args.policy);

  if (args.utterance) {
    const matched = detectRevocation(args.utterance, policy);
    console.log(
      JSON.stringify({ revoked: matched !== null, matched_phrase: matched, action: matched ? "end_call_and_suppress" : "continue" }, null, 2),
    );
    return matched ? 3 : 0;
  }

  if (!args.transcript) {
    console.error("error: provide --utterance \"<text>\" or --transcript <path>");
    return 1;
  }

  let turns;
  try {
    turns = JSON.parse(readFileSync(args.transcript, "utf8"));
  } catch (error) {
    console.error(`error: ${error.message}`);
    return 1;
  }
  if (!Array.isArray(turns)) {
    console.error("error: transcript must be a JSON array of {speaker, text} turns");
    return 1;
  }

  for (const [index, turn] of turns.entries()) {
    if (!RECIPIENT_SPEAKERS.has(String(turn?.speaker ?? "").toLowerCase())) continue;
    const matched = detectRevocation(turn?.text, policy);
    if (matched) {
      console.log(
        JSON.stringify(
          {
            revoked: true,
            turn_index: index,
            speaker: turn.speaker,
            text: turn.text,
            matched_phrase: matched,
            action: "end_call_and_suppress",
          },
          null,
          2,
        ),
      );
      return 3;
    }
  }

  console.log(JSON.stringify({ revoked: false, matched_phrase: null, action: "continue" }, null, 2));
  return 0;
}

process.exitCode = main();
