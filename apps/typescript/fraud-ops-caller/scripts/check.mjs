#!/usr/bin/env node
/**
 * Smallest check that fails if case/outcome contracts break.
 * Run: npm run check
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const caseSchema = JSON.parse(
  readFileSync(join(root, "schemas/case.schema.json"), "utf8")
);
const outcomeSchema = JSON.parse(
  readFileSync(join(root, "schemas/outcome.schema.json"), "utf8")
);

const cases = JSON.parse(readFileSync(join(root, "data/cases.json"), "utf8"));

const DISPOSITIONS = {
  collections: [
    "paid",
    "ptp",
    "refuse",
    "wrong_party",
    "voicemail",
    "no_answer",
    "handoff",
  ],
  kyc_chase: [
    "uploading_now",
    "callback",
    "confused",
    "refuse",
    "voicemail",
    "no_answer",
    "handoff",
  ],
  merchant_outreach: [
    "reached",
    "docs_promised",
    "wrong_contact",
    "voicemail",
    "no_answer",
    "handoff",
  ],
  evidence_collection: [
    "statement_taken",
    "will_upload",
    "refused",
    "unsafe_escalate",
    "wrong_party",
    "voicemail",
    "no_answer",
    "handoff",
  ],
};

const DEMO_DISPOSITION = {
  case_demo_kyc_001: "uploading_now",
  case_demo_col_001: "ptp",
  case_demo_mer_001: "docs_promised",
  case_demo_ev_001a: "statement_taken",
  case_demo_ev_001b: "will_upload",
};

function fail(msg) {
  console.error(`check failed: ${msg}`);
  process.exit(1);
}

if (!Array.isArray(cases) || cases.length !== 5) {
  fail("data/cases.json must have exactly 5 mock cases");
}

const ids = cases.map((c) => c.case_id).sort().join(",");
if (
  ids !==
  "case_demo_col_001,case_demo_ev_001a,case_demo_ev_001b,case_demo_kyc_001,case_demo_mer_001"
) {
  fail(`unexpected case ids: ${ids}`);
}

if (cases[0]?.intent !== "kyc_chase") {
  fail("KYC must remain the first case (demo lead)");
}

for (const key of caseSchema.required) {
  for (const item of cases) {
    if (!(key in item)) fail(`case ${item.case_id} missing ${key}`);
  }
}

for (const item of cases) {
  if (!caseSchema.properties.intent.enum.includes(item.intent)) {
    fail(`${item.case_id} bad intent`);
  }
  if (!item.contact?.phone_e164?.startsWith("+")) {
    fail(`${item.case_id} phone is not E.164`);
  }
  if (!/^\+121255501\d{2}$/.test(item.contact.phone_e164)) {
    fail(`${item.case_id} must use NANP reserved fiction NPA-555-01xx`);
  }
  if (!/Example|Placeholder/.test(item.contact.name)) {
    fail(`${item.case_id} contact.name must be clearly fictional`);
  }
}

const ev = cases.filter((c) => c.intent === "evidence_collection");
if (ev.length !== 2) fail("need linked evidence pair");
if (ev[0].counterpart_case_id !== ev[1].case_id || ev[1].counterpart_case_id !== ev[0].case_id) {
  fail("evidence cases must point at each other");
}
for (const item of ev) {
  if (!item.safety_sensitive) fail(`${item.case_id} must be safety_sensitive`);
  if (!item.incident_summary_plain) fail(`${item.case_id} missing incident_summary_plain`);
  if (!item.deep_links?.evidence_share) fail(`${item.case_id} missing evidence_share`);
}

const now = new Date("2026-09-09T04:00:00.000Z");
for (const item of cases) {
  const disposition = DEMO_DISPOSITION[item.case_id];
  if (!DISPOSITIONS[item.intent].includes(disposition)) {
    fail(`demo disposition ${disposition} illegal for ${item.intent}`);
  }
  const outcome = {
    case_id: item.case_id,
    intent: item.intent,
    call_id: `call_demo_${item.case_id}_${now.getTime()}`,
    recording_id: "rec_pending_calle_swap",
    disposition,
    quotes: ["demo quote"],
    next_action: "demo next action",
    fields: { contact_role: item.contact.role },
    transcript_snippet: "demo transcript",
    ended_at: now.toISOString(),
  };
  for (const key of outcomeSchema.required) {
    if (!(key in outcome)) fail(`outcome missing ${key}`);
  }
}

if (DISPOSITIONS.kyc_chase.includes("paid")) fail("kyc disposition list drifted");
if (DISPOSITIONS.evidence_collection.includes("ptp")) {
  fail("evidence disposition list drifted");
}

const BANNED_PUBLIC_VIDEO = [
  ["FHa4", "QgJPgj4"].join(""),
  ["fraud-ops-caller-demo", "tight.mp4"].join("-"),
];
function scanBannedVideo(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      scanBannedVideo(full);
      continue;
    }
    if (!/\.(md|json|ts|tsx|mjs|cjs|js|example|yml|yaml|txt|html)$/i.test(name)) continue;
    const text = readFileSync(full, "utf8");
    for (const token of BANNED_PUBLIC_VIDEO) {
      if (text.includes(token)) fail(`${full} must not reference leaked demo video`);
    }
  }
}
scanBannedVideo(root);

console.log("ok: 5 cases + 4 intents + linked evidence pair match schemas");
