/**
 * Switchboard CLI entrypoint.
 *
 *   npm run reachback   -> fan-out welfare-check demo
 *   npm run runaround   -> chain referral-runaround demo
 *
 * Uses the mock CALL-E by default (USE_MOCK=true). Set USE_MOCK=false and
 * provide CALLE_API_KEY to place real calls once the real SDK wrapper is added.
 */

// Must be the FIRST import: loads .env (override:true) before anything reads it.
import "./env.js";
import { MockCalleClient } from "../mock/calle-mock.js";
import type { CalleClient } from "./calle/client.js";
import { RealCalleClient } from "./calle/real-client.js";
import { executeGraph, type ExecutorEvent } from "./graph/executor.js";
import type { CallGraph, CallNode } from "./graph/types.js";
import { buildReachbackGraph, RESIDENT_NAMES } from "./scenarios/reachback.js";
import { buildRunaroundGraph } from "./scenarios/runaround.js";
import { redactPhones } from "./util/phone.js";

const URGENCY_RANK: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3,
};

const STATUS_ICON: Record<string, string> = {
  done: "✓",
  needs_review: "⚠",
  needs_user: "⛔",
  failed: "✗",
  running: "…",
  pending: "·",
  blocked: "·",
};

function getClient(): { client: CalleClient; mock: boolean } {
  // CALL_MODE takes precedence; fall back to the legacy USE_MOCK toggle.
  const callMode = (process.env.CALL_MODE ?? "").toLowerCase();
  const useMock =
    callMode === "mock" ||
    (callMode === "" &&
      (process.env.USE_MOCK ?? "true").toLowerCase() !== "false");
  if (useMock) {
    return {
      client: new MockCalleClient({
        minDelayMs: Number(process.env.MOCK_MIN_DELAY_MS ?? "300"),
        maxDelayMs: Number(process.env.MOCK_MAX_DELAY_MS ?? "500"),
      }),
      mock: true,
    };
  }

  const apiKey = process.env.CALLE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Live mode but CALLE_API_KEY is not set. Set CALL_MODE=mock to run " +
        "against the mock."
    );
  }
  return {
    client: new RealCalleClient({
      apiKey,
      baseUrl: process.env.CALLE_BASE_URL,
    }),
    mock: false,
  };
}

function logEvent(e: ExecutorEvent): void {
  switch (e.type) {
    case "node_start":
      console.log(`  → calling ${e.node.id} (${e.node.locale})`);
      break;
    case "node_retry_language":
      console.log(
        `  ↻ language barrier on ${e.node.id}: retrying ${e.from} → ${e.to}`
      );
      break;
    case "node_spawned":
      console.log(`  + ${e.node.id} spawned by ${e.parentId}`);
      break;
    case "node_done":
      console.log(
        `  ${STATUS_ICON[e.node.status] ?? "?"} ${e.node.id} → ${e.node.status}` +
          (e.node.confidence !== undefined
            ? ` (conf ${e.node.confidence.toFixed(2)})`
            : "")
      );
      break;
    case "graph_done":
      break;
  }
}

function printReachbackTriage(graph: CallGraph): void {
  console.log("\n=== Reachback triage (sorted by urgency) ===");
  const rows = [...graph.nodes].sort((a, b) => {
    const ua = URGENCY_RANK[String(a.result?.["urgency"] ?? "none")] ?? 3;
    const ub = URGENCY_RANK[String(b.result?.["urgency"] ?? "none")] ?? 3;
    return ua - ub;
  });

  console.log(
    ["", "STATUS", "URGENCY", "NAME", "NEEDS", "NOTE"].join("\t")
  );
  for (const n of rows) {
    const name = RESIDENT_NAMES[n.id] ?? n.id;
    const urgency = String(n.result?.["urgency"] ?? "-");
    const needs = Array.isArray(n.result?.["needs"])
      ? (n.result!["needs"] as string[]).join(",") || "-"
      : "-";
    const note = redactPhones(n.verification?.notes.slice(-1)[0] ?? "");
    console.log(
      [
        STATUS_ICON[n.status] ?? "?",
        n.status,
        urgency,
        name,
        redactPhones(needs),
        note,
      ].join("\t")
    );
  }

  const actionNow = rows.filter(
    (n) => String(n.result?.["urgency"]) === "high" || n.status === "needs_user"
  );
  const review = rows.filter((n) => n.status === "needs_review");
  console.log(
    `\nSummary: called ${graph.nodes.length}, ` +
      `${actionNow.length} need attention now, ${review.length} need review.`
  );
  if (actionNow.length) {
    console.log(
      "Attention now: " +
        actionNow.map((n) => RESIDENT_NAMES[n.id] ?? n.id).join(", ")
    );
  }
}

function printRunaroundChain(graph: CallGraph): void {
  console.log("\n=== Referral runaround chain ===");
  for (const n of graph.nodes) {
    const parent = n.spawnedBy ? ` (from ${n.spawnedBy})` : " (start)";
    console.log(
      `  ${STATUS_ICON[n.status] ?? "?"} ${n.id}${parent} → ${n.status}`
    );
    const note = n.result?.["note"];
    if (note) console.log(`      ${redactPhones(String(note))}`);
    for (const flag of n.verification?.policyFlags ?? []) {
      console.log(`      ⛔ ${redactPhones(flag)}`);
    }
  }
  const booked = graph.nodes.find((n) => n.result?.["confirmation_number"]);
  if (booked) {
    console.log(
      `\nOutcome: booked with confirmation ${redactPhones(
        String(booked.result!["confirmation_number"])
      )}.`
    );
  }
}

async function main(): Promise<void> {
  const scenario = process.argv[2] ?? "reachback";
  const { client, mock } = getClient();
  const maxConcurrency = Number(process.env.MAX_CONCURRENCY ?? "4");

  console.log(
    `Switchboard — scenario="${scenario}" mode=${mock ? "MOCK" : "LIVE"} concurrency=${maxConcurrency}\n`
  );

  let graph: CallGraph;
  if (scenario === "reachback") graph = buildReachbackGraph();
  else if (scenario === "runaround") graph = buildRunaroundGraph();
  else {
    console.error(`Unknown scenario "${scenario}". Use reachback or runaround.`);
    process.exit(1);
    return;
  }

  const started = Date.now();
  await executeGraph(graph, {
    client,
    maxConcurrency,
    languageRetry: true,
    onEvent: logEvent,
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (scenario === "reachback") printReachbackTriage(graph);
  else printRunaroundChain(graph);

  console.log(`\nDone in ${elapsed}s.`);
}

main().catch((err) => {
  // Error text may include a number (e.g. a rejected E.164); mask before print.
  const msg = err instanceof Error ? err.message : String(err);
  console.error(redactPhones(msg));
  process.exit(1);
});
