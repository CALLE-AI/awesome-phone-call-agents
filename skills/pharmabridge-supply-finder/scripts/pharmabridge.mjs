#!/usr/bin/env node
// PharmaBridge supply finder: a dependency-free CLI over a running PharmaBridge server, for agent
// environments such as Claude Code, Codex, and Cursor. `drug`, `discover`, `pulse`, and `plan` never
// dial. `call` dials only through the server's own safety gate: simulation by default, and live routing
// needs the operator code (plus --consent for direct calls to real businesses). Operator codes and call
// tokens go only to a loopback server or an approved https origin, redirects are refused, and phone
// numbers are masked in everything this CLI prints or saves.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const FACILITIES_FILE = "pharmabridge-facilities.json";
const CALLS_FILE = "pharmabridge-calls.json";
const RESULTS_FILE = "pharmabridge-results.json";
const TERMINAL = ["completed", "failed", "canceled"];

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
let origin = null;
const base = () => (origin ??= serverOrigin(process.env.PHARMABRIDGE_URL || "http://localhost:3000"));

function parseArgs(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    if (!list[i].startsWith("--")) continue;
    const key = list[i].slice(2);
    const next = list[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

/** Masks phone numbers inside free text, keeping the last two digits. */
function redact(text) {
  return String(text ?? "").replace(/\+\s?\d[\d\s().-]{6,}\d|\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|(?<![\w/:.-])\d{9,}(?!\w)/g, (match) => {
    const digits = match.replace(/\D/g, "");
    return digits.length >= 7 ? `••• ••• ••${digits.slice(-2)}` : match;
  });
}

function redactDeep(value) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item)]));
  return value;
}

function fail(message) {
  console.error(`✖ ${redact(message)}`);
  process.exit(1);
}

/** Credentials go only to a loopback server or an https origin the user listed in PHARMABRIDGE_APPROVED_ORIGINS. */
function serverOrigin(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("PHARMABRIDGE_URL is not a valid URL.");
  }
  if (url.username || url.password) fail("PHARMABRIDGE_URL must not contain credentials.");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const approved = (process.env.PHARMABRIDGE_APPROVED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (loopback && (url.protocol === "http:" || url.protocol === "https:")) return url.origin;
  if (url.protocol === "https:" && approved.includes(url.origin)) return url.origin;
  fail(`Refusing to send operator codes or call tokens to ${url.origin}. Use a loopback URL, or list this https origin in PHARMABRIDGE_APPROVED_ORIGINS.`);
}

async function api(path, init = {}) {
  let res;
  try {
    res = await fetch(`${base()}${path}`, { ...init, redirect: "error" });
  } catch {
    fail(`Cannot reach PharmaBridge at ${base()} (redirects are refused). Start it with "npm run dev" or set PHARMABRIDGE_URL.`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) fail(json?.error?.message ?? json?.error ?? `HTTP ${res.status}`);
  return json;
}

const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);
const pad = (value, width) => String(value).padEnd(width).slice(0, width);
const kindArg = () => (args.kind === "blood_bank" ? "blood_bank" : "pharmacy");

async function buildNeed() {
  const kind = kindArg();
  if (kind === "blood_bank") {
    if (!args.group || !args.hospital) fail("Blood requests need --group (for example O-) and --hospital; --component and --units are optional.");
    return {
      kind,
      blood: {
        group: String(args.group),
        component: String(args.component ?? "packed_red_cells"),
        units: Number(args.units ?? 1),
        hospital: String(args.hospital),
        urgency: String(args.urgency ?? "today"),
      },
    };
  }
  if (!args.rxcui) fail('Pharmacy requests need --rxcui (find it with: drug --query "...") and --quantity.');
  const intel = await api(`/api/drugs/${encodeURIComponent(args.rxcui)}`);
  return {
    kind,
    medication: {
      rxcui: intel.rxcui,
      name: intel.displayName,
      ingredient: intel.ingredient,
      brandNames: intel.brands,
      quantity: String(args.quantity ?? "a 30-day supply"),
      alternatives: intel.alternatives.slice(0, 2),
      controlled: Boolean(intel.deaSchedule),
      deaSchedule: intel.deaSchedule,
      urgency: String(args.urgency ?? "today"),
    },
  };
}

function pickFacilities() {
  const saved = readJson(FACILITIES_FILE);
  if (!saved) fail(`Run "discover" first; it saves ${FACILITIES_FILE}.`);
  const which = String(args.facility ?? "1");
  if (which === "all") return saved.facilities;
  const chosen = which
    .split(",")
    .map((pick) => pick.trim())
    .map((pick) => saved.facilities.find((f, i) => String(i + 1) === pick || f.id === pick))
    .filter(Boolean);
  if (!chosen.length) fail(`No facility matches --facility ${which}.`);
  return chosen;
}

function callBody(need, facility, extra) {
  return {
    kind: need.kind === "pharmacy" ? "inquiry" : "blood_inquiry",
    facility,
    ...(need.kind === "pharmacy" ? { medication: need.medication } : { blood: need.blood }),
    ...extra,
  };
}

const commands = {
  async drug() {
    if (args.rxcui) {
      console.log(JSON.stringify(await api(`/api/drugs/${encodeURIComponent(args.rxcui)}`), null, 2));
      return;
    }
    if (!args.query) fail('Pass --query "drug strength form".');
    const data = await api(`/api/drugs/search?q=${encodeURIComponent(args.query)}`);
    if (!data.products.length) {
      console.log(`No match. Did you mean: ${data.suggestions.join(", ") || "no suggestions"}`);
      return;
    }
    for (const p of data.products.slice(0, 8)) console.log(`${pad(p.rxcui, 9)} ${p.tty === "SCD" ? "generic" : "brand  "} ${p.displayName}`);
  },

  async discover() {
    if (!args.near) fail('Pass --near "<city or address>".');
    const kind = kindArg();
    const params = new URLSearchParams({ kind, q: String(args.near), radiusKm: String(args.radius ?? 5), synthetic: args.synthetic ? "1" : "0" });
    const data = await api(`/api/facilities?${params}`);
    // Dispatch needs each facility's signed number, so this local cache keeps it; it is never printed.
    writeFileSync(FACILITIES_FILE, JSON.stringify(data, null, 2));
    console.log(
      `${data.facilities.length} ${kind === "pharmacy" ? "pharmacies" : "blood banks"} with a listed phone near ${data.center.label} (sources: ${data.sources.join(", ")}). Saved to ${FACILITIES_FILE}.`,
    );
    if (data.warning) console.log(`⚠ ${data.warning}`);
    data.facilities.forEach((f, i) => console.log(`${pad(i + 1, 3)} ${pad(f.name, 46)} ${pad(`${f.distanceKm.toFixed(1)} km`, 9)} ${f.phoneMasked}`));
  },

  async pulse() {
    const need = args.rxcui || args.group ? await buildNeed() : null;
    const saved = readJson(FACILITIES_FILE);
    const params = new URLSearchParams();
    if (need) {
      params.set("kind", need.kind);
      params.set("item", need.kind === "pharmacy" ? `rx:${need.medication.rxcui}` : `blood:${need.blood.group}:${need.blood.component}`);
    }
    if (saved?.center) {
      params.set("lat", String(saved.center.lat));
      params.set("lon", String(saved.center.lon));
      params.set("radiusKm", String(args.radius ?? 5));
    }
    const data = await api(`/api/pulse?${params}`);
    const s = data.summary;
    console.log(
      `${s.answers} fresh answer(s) from earlier PharmaBridge calls: ${s.available + s.partial} had it, ${s.out} out, ${s.refused} won't say by phone${s.withheld ? `, ${s.withheld} shown by area only (controlled medication)` : ""}.`,
    );
    for (const x of data.sightings.slice(0, 20)) {
      console.log(`${pad(x.facilityName ?? "(name withheld)", 40)} ${pad(x.status, 12)} ${pad(x.item.label, 44)} ${x.observedAt}`);
    }
    const skip = new Set(data.sightings.filter((x) => x.facilityId && ["out", "refused"].includes(x.status)).map((x) => x.facilityId));
    const numbers = (saved?.facilities ?? []).flatMap((f, i) => (skip.has(f.id) ? [i + 1] : []));
    if (numbers.length) console.log(`\nSkip facilities ${numbers.join(",")}: they answered recently (out of stock or won't say by phone).`);
  },

  async plan() {
    const need = await buildNeed();
    const [facility] = pickFacilities();
    const data = await post("/api/calls", callBody(need, facility, { missionId: "plan-preview", routing: "simulation", dryRun: true }));
    console.log(`Dry run, nothing dialed. Brief for ${facility.name}:\n`);
    console.log(redact(data.plan.task));
    console.log(`\nCALL-E must return: ${Object.keys(data.plan.resultSchema.properties).join(", ")}`);
  },

  async call() {
    const need = await buildNeed();
    const facilities = pickFacilities();
    const routing = String(args.routing ?? "simulation");
    if (!["simulation", "test_line", "direct"].includes(routing)) fail("--routing must be simulation, test_line, or direct.");
    if (routing !== "simulation" && !args["operator-code"]) fail("Live routing needs --operator-code. Ask the user for it; never guess.");
    if (routing === "direct" && !args.consent) fail("Direct calls reach real businesses. Get the user's explicit approval, then pass --consent.");

    const missionId = `m-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
    const calls = [];
    for (const [i, facility] of facilities.entries()) {
      const data = await post(
        "/api/calls",
        callBody(need, facility, {
          missionId,
          routing,
          seed: i,
          testLineIndex: i,
          operatorCode: args["operator-code"] ? String(args["operator-code"]) : undefined,
          directConsent: Boolean(args.consent),
          locale: args.locale ? String(args.locale) : undefined,
        }),
      );
      calls.push({ facility: facility.name, callId: data.call.id, token: data.accessToken, mode: data.mode, dialTarget: data.dialTarget, recordKey: data.recordKey });
      console.log(`✔ ${data.mode === "live" ? `LIVE → ${data.dialTarget}` : "simulated"} · ${facility.name}`);
    }
    writeFileSync(CALLS_FILE, JSON.stringify({ missionId, need, calls }, null, 2));
    console.log(`\n${calls.length} call(s) placed. Run "wait" to collect the results.`);
  },

  async wait() {
    const saved = readJson(CALLS_FILE);
    if (!saved) fail('Nothing to wait for; run "call" first.');
    const live = saved.calls.some((c) => c.mode === "live");
    const deadline = Date.now() + Number(args.timeout ?? 600) * 1000;
    const pending = new Map(saved.calls.map((c) => [c.callId, c]));
    const results = [];
    while (pending.size && Date.now() < deadline) {
      for (const c of [...pending.values()]) {
        const { call } = await api(`/api/calls/${c.callId}`, { headers: { "x-pharmabridge-call-token": c.token } });
        if (!TERMINAL.includes(call.status)) continue;
        pending.delete(c.callId);
        results.push(redactDeep({ facility: c.facility, mode: c.mode, status: call.status, summary: call.summary, confidence: call.completionConfidence, result: call.structuredResult }));
        console.log(`• ${c.facility}: ${redact(call.summary ?? call.failureMessage ?? call.status)}`);
      }
      if (pending.size) await new Promise((resolve) => setTimeout(resolve, live ? 5000 : 1500));
    }
    writeFileSync(RESULTS_FILE, JSON.stringify({ missionId: saved.missionId, need: saved.need, results }, null, 2));
    console.log(`\n${pad("Facility", 40)} ${pad("Answer", 20)} Evidence`);
    for (const r of results) {
      console.log(`${pad(r.facility, 40)} ${pad(r.result?.stock_status ?? r.status, 20)} ${r.result?.evidence_quote ? `"${r.result.evidence_quote}"` : ""}`);
    }
    console.log(`\nSaved to ${RESULTS_FILE}.${pending.size ? ` ${pending.size} call(s) still running; run "wait" again.` : ""}`);
  },
};

if (!commands[command]) {
  console.log("Usage: node scripts/pharmabridge.mjs <drug|discover|pulse|plan|call|wait> [options]  (see SKILL.md)");
  process.exit(command ? 1 : 0);
}
await commands[command]();
