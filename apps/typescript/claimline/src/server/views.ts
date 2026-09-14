import type {
  CaseView,
  ContactCallView,
  CustomerView,
  PublicClaim,
  PublicCustomer,
  PublicIntentView,
} from "../app.js";
import type { RunMode } from "../config.js";
import { LANGUAGES, LANGUAGE_CODES, languageFor } from "../domain/language.js";
import { maskPhone } from "../domain/phone.js";
import type {
  CallType,
  ContactRole,
  Policy,
  PolicyType,
} from "../domain/types.js";
import type { CallPreview } from "../services/tasks.js";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ---- Human-friendly labels -------------------------------------------------

function humanCallType(type: string): string {
  switch (type) {
    case "status_chase":
      return "Repair status call";
    case "medical_report":
      return "Medical report call";
    case "bill_verification":
      return "Bill verification call";
    case "fnol_intake":
    default:
      return "Claim intake call";
  }
}

function callTypeWho(type: string): string {
  switch (type) {
    case "status_chase":
      return "Calls the repair shop / provider";
    case "medical_report":
      return "Calls the treating doctor / clinic";
    case "bill_verification":
      return "Calls the hospital billing desk";
    case "fnol_intake":
    default:
      return "Calls the claimant";
  }
}

const ROLE_LABELS: Record<ContactRole, string> = {
  claimant: "Claimant / policyholder",
  treating_doctor: "Treating doctor",
  hospital_billing: "Hospital billing",
  repair_shop: "Repair shop",
  witness: "Witness",
  other: "Other contact",
};

function roleLabel(role: ContactRole): string {
  return ROLE_LABELS[role] ?? role;
}

const ROLE_OPTIONS: ContactRole[] = [
  "treating_doctor",
  "hospital_billing",
  "repair_shop",
  "witness",
  "other",
];

interface StatusInfo {
  label: string;
  fg: string;
  bg: string;
  icon: string;
}

/** Map an internal intent state to a friendly status shown to the operator. */
function statusInfo(state: string): StatusInfo {
  switch (state) {
    case "reserved":
      return { label: "Not started", fg: "#475569", bg: "#e2e8f0", icon: "○" };
    case "submission_unknown":
      return { label: "Submitting…", fg: "#b45309", bg: "#fef3c7", icon: "…" };
    case "accepted":
      return { label: "Calling…", fg: "#1d4ed8", bg: "#dbeafe", icon: "📞" };
    case "terminal_unverified":
      return { label: "Checking result…", fg: "#6d28d9", bg: "#ede9fe", icon: "…" };
    case "terminal_verified":
      return { label: "Completed", fg: "#15803d", bg: "#dcfce7", icon: "✓" };
    case "needs_human":
      return { label: "Needs review", fg: "#b45309", bg: "#fef3c7", icon: "⚠" };
    case "applied":
      return { label: "Handled", fg: "#0f766e", bg: "#ccfbf1", icon: "✓✓" };
    case "canceled":
      return { label: "Canceled", fg: "#6b7280", bg: "#f1f5f9", icon: "✕" };
    default:
      return { label: state, fg: "#334155", bg: "#e2e8f0", icon: "•" };
  }
}

/** Turn a machine disposition reason into a plain-English explanation. */
function humanReason(reason: string | null): string {
  if (!reason) return "";
  if (reason.startsWith("voicemail")) {
    return "The call reached voicemail, so no information was collected.";
  }
  if (reason.startsWith("recipient_refused")) {
    return "The person declined to answer questions.";
  }
  if (reason.startsWith("call_not_completed")) {
    return "The call did not connect or complete.";
  }
  if (reason.startsWith("task_not_completed")) {
    return "The call ended before all questions were answered.";
  }
  if (reason.startsWith("low_confidence")) {
    return "The answers weren't clear enough to accept automatically.";
  }
  if (
    reason.startsWith("missing_structured_result") ||
    reason.includes("schema")
  ) {
    return "The result couldn't be read reliably and needs a human check.";
  }
  if (reason.startsWith("preflight_failed")) {
    return "The call couldn't be prepared safely — please check the details.";
  }
  if (reason.startsWith("binding_mismatch")) {
    return "The returned call didn't match what we placed; a human should verify.";
  }
  if (reason.startsWith("submit_error")) {
    return "We couldn't confirm the call was placed. It will be reconciled safely.";
  }
  return reason;
}

const FIELD_LABELS: Record<string, Record<string, string>> = {
  fnol_intake: {
    incident_type: "Incident type",
    incident_datetime: "When it happened",
    incident_location: "Where it happened",
    description: "What happened",
    injuries: "Injuries",
    damaged_items: "Damage",
    other_party_involved: "Other party involved",
    police_report_filed: "Police report filed",
    preferred_callback_window: "Best time to call back",
    consent_recorded: "Consent given",
  },
  status_chase: {
    work_status: "Work status",
    eta_date: "Estimated ready",
    estimated_cost_amount: "Estimated cost",
    estimated_cost_currency: "Currency",
    blockers: "Blockers",
    contact_name: "Spoke with",
  },
  medical_report: {
    injuries_summary: "Injuries",
    treatment_provided: "Treatment provided",
    accident_consistent: "Consistent with accident",
    treatment_ongoing: "Treatment ongoing",
    expected_recovery: "Expected recovery",
    contact_name: "Spoke with",
  },
  bill_verification: {
    total_amount: "Total billed",
    currency: "Currency",
    service_from_date: "Service from",
    service_to_date: "Service to",
    itemized_available: "Itemized bill",
    contact_name: "Spoke with",
  },
};

function fieldLabel(callType: string, key: string): string {
  return (
    FIELD_LABELS[callType]?.[key] ??
    key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function prettyEnum(value: string): string {
  return value.replace(/_/g, " ");
}

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    return value.length ? value.map((v) => escapeHtml(String(v))).join(", ") : "—";
  }
  const str = String(value);
  if (["yes", "no", "unknown"].includes(str.toLowerCase())) {
    return escapeHtml(str.charAt(0).toUpperCase() + str.slice(1));
  }
  if (key.endsWith("_status")) {
    return escapeHtml(prettyEnum(str));
  }
  return escapeHtml(str);
}

// ---- Layout ----------------------------------------------------------------

export interface AuthNav {
  role: "owner" | "guest" | null;
  name?: string | null;
  hasKey: boolean;
}

export interface LayoutOptions {
  currentPath?: string;
  insurerName?: string;
  auth?: AuthNav;
}

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/customers", label: "Customers" },
  { href: "/claims", label: "Claims" },
  { href: "/analytics", label: "Insights" },
  { href: "/submit", label: "New claim" },
  { href: "/how", label: "How it works" },
];

function authArea(auth: AuthNav | undefined, mode: RunMode): string {
  if (!auth || auth.role === null) {
    return `<a href="/login" class="navlink authlink">Log in</a>`;
  }
  const who =
    auth.role === "owner"
      ? `👤 ${escapeHtml(auth.name ?? "owner")}`
      : mode === "live"
        ? auth.hasKey
          ? "🔑 Guest (key set)"
          : "Guest (no key)"
        : "Guest";
  return `<span class="navwho">${who}</span><form method="post" action="/logout" style="margin:0"><button class="navlink authlink" type="submit" style="background:none;border:0;cursor:pointer">Log out</button></form>`;
}

function navBar(currentPath: string, auth: AuthNav | undefined, mode: RunMode): string {
  const items = NAV.map((n) => {
    const active =
      n.href === "/" ? currentPath === "/" : currentPath.startsWith(n.href);
    return `<a href="${n.href}" class="navlink${active ? " active" : ""}">${escapeHtml(
      n.label,
    )}</a>`;
  }).join("");
  return `<nav class="nav"><div class="wrap"><div class="navleft">${items}</div><div class="navright">${authArea(
    auth,
    mode,
  )}</div></div></nav>`;
}

export function layout(
  title: string,
  mode: RunMode,
  body: string,
  opts: LayoutOptions = {},
): string {
  const live = mode === "live";
  const bannerBg = live ? "#fef2f2" : "#ecfdf5";
  const bannerFg = live ? "#b91c1c" : "#047857";
  const bannerBorder = live ? "#fecaca" : "#a7f3d0";
  const bannerText = live
    ? "Live mode — placing a call will ring a real phone."
    : "Demo mode — no real calls are placed. Everything here is simulated.";
  const insurer = opts.insurerName ?? "ClaimLine Insurance";
  const currentPath = opts.currentPath ?? "/";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} · ClaimLine</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
         background:#f8fafc; color:#0f172a; line-height:1.5; }
  a { color:#2563eb; }
  header { background:#0f172a; color:#fff; padding:14px 24px; }
  header .wrap { max-width:1080px; margin:0 auto; display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; }
  header h1 { font-size:19px; margin:0; letter-spacing:.2px; }
  header .tag { color:#94a3b8; font-size:13px; }
  .nav { background:#111827; border-top:1px solid #1f2937; }
  .nav .wrap { max-width:1080px; margin:0 auto; display:flex; gap:4px; padding:0 16px; flex-wrap:wrap; align-items:center; justify-content:space-between; }
  .nav .navleft { display:flex; gap:4px; flex-wrap:wrap; }
  .nav .navright { display:flex; gap:8px; align-items:center; }
  .navwho { color:#93c5fd; font-size:13px; font-weight:600; }
  .navlink { color:#cbd5e1; text-decoration:none; font-size:14px; font-weight:600;
             padding:11px 14px; border-bottom:3px solid transparent; }
  .navlink:hover { color:#fff; }
  .navlink.active { color:#fff; border-bottom-color:#3b82f6; }
  .authlink { color:#93c5fd; }
  .banner { border-bottom:1px solid ${bannerBorder}; background:${bannerBg}; color:${bannerFg};
            font-size:13px; font-weight:600; padding:8px 24px; }
  .banner .wrap { max-width:1080px; margin:0 auto; }
  main { max-width:1080px; margin:0 auto; padding:24px; }
  h1.page, h2.page { margin:0 0 4px; }
  .page-head { margin-bottom:18px; }
  .page-head .sub { color:#64748b; font-size:14px; }
  .toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px;
             flex-wrap:wrap; margin-bottom:18px; }
  .toolbar .left { display:flex; gap:8px; flex-wrap:wrap; }
  .hint { color:#64748b; font-size:13px; }

  .card { background:#fff; border:1px solid #e5e9f0; border-radius:14px;
          box-shadow:0 1px 2px rgba(15,23,42,.04); margin-bottom:18px; overflow:hidden; }
  .card-head { padding:16px 18px; border-bottom:1px solid #eef2f7; }
  .card-head h2 { margin:0; font-size:17px; }
  .card-body { padding:6px 18px 14px; }
  .meta { color:#64748b; font-size:13px; margin-top:4px; }
  .chip { display:inline-block; padding:2px 9px; border-radius:999px; font-size:12px;
          font-weight:600; background:#eef2f7; color:#475569; }
  .chip.lang { background:#eef2ff; color:#4338ca; }

  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:14px; margin-bottom:20px; }
  .stat { background:#fff; border:1px solid #e5e9f0; border-radius:12px; padding:14px 16px; }
  .stat .n { font-size:26px; font-weight:700; }
  .stat .l { color:#64748b; font-size:13px; margin-top:2px; }
  .stat.warn .n { color:#b45309; }
  .stat.good .n { color:#15803d; }

  table.list { width:100%; border-collapse:collapse; background:#fff; }
  table.list th { text-align:left; font-size:12px; color:#64748b; text-transform:uppercase;
                  letter-spacing:.03em; padding:10px 14px; border-bottom:1px solid #eef2f7; }
  table.list td { padding:11px 14px; border-bottom:1px solid #f1f5f9; font-size:14px; vertical-align:middle; }
  table.list tr:last-child td { border-bottom:0; }
  table.list tr:hover td { background:#fafbff; }
  a.rowlink { font-weight:600; text-decoration:none; }

  .call { border:1px solid #eef2f7; border-radius:12px; padding:14px 16px; margin:12px 0; background:#fcfdff; }
  .call-top { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
  .call-title { font-weight:650; font-size:15px; }
  .call-sub { color:#64748b; font-size:12.5px; font-weight:400; }
  .pill { display:inline-flex; align-items:center; gap:6px; padding:3px 11px; border-radius:999px;
          font-size:12.5px; font-weight:650; }
  .summary { margin:10px 0 6px; }

  table.kv { width:100%; border-collapse:collapse; margin:8px 0 4px; }
  table.kv td { padding:6px 8px; border-bottom:1px solid #f1f5f9; vertical-align:top; font-size:14px; }
  table.kv td.k { color:#64748b; width:210px; font-size:13px; }
  table.kv tr:last-child td { border-bottom:0; }

  .callout { border-radius:10px; padding:11px 13px; font-size:13.5px; margin:8px 0; }
  .callout.warn { background:#fffbeb; border:1px solid #fde68a; color:#92400e; }
  .callout.info { background:#eff6ff; border:1px solid #bfdbfe; color:#1e3a8a; }

  details { margin-top:8px; }
  details > summary { cursor:pointer; color:#2563eb; font-size:13px; font-weight:500; list-style:none; }
  details > summary::-webkit-details-marker { display:none; }
  details > summary::before { content:"▸ "; }
  details[open] > summary::before { content:"▾ "; }
  .transcript { margin:8px 0 0; border-left:3px solid #e2e8f0; padding-left:12px; }
  .turn { font-size:13px; margin:4px 0; }
  .turn .who { color:#64748b; font-weight:600; margin-right:6px; text-transform:capitalize; }
  ul.evi { margin:8px 0; padding-left:18px; }
  ul.evi li { font-size:13px; color:#334155; margin:3px 0; }

  .decision { margin-top:12px; padding-top:12px; border-top:1px dashed #e2e8f0; }
  .decision .lbl { font-size:12.5px; color:#475569; font-weight:600; margin-bottom:6px; }
  .field-row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .form-grid { display:grid; grid-template-columns:180px 1fr; gap:10px 14px; align-items:center; max-width:640px; }
  .form-grid label { color:#475569; font-size:13px; font-weight:600; }
  .form-section { margin:18px 0 8px; font-weight:700; font-size:15px; }

  .startcall { margin-top:6px; display:flex; gap:10px; flex-wrap:wrap; align-items:center; }

  button, .btn { font:inherit; border:0; border-radius:9px; padding:9px 15px; font-size:13.5px;
                 font-weight:600; cursor:pointer; text-decoration:none; display:inline-flex;
                 align-items:center; gap:7px; }
  .btn-primary, button.primary { background:#2563eb; color:#fff; }
  .btn-primary:hover, button.primary:hover { background:#1d4ed8; }
  .btn-ghost { background:#eef2f7; color:#334155; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-outline { background:#fff; color:#334155; border:1px solid #cbd5e1; }
  .btn-danger { background:#fff; color:#b91c1c; border:1px solid #fca5a5; }
  .btn-lg { padding:11px 18px; font-size:14.5px; }
  input, select, textarea { font:inherit; padding:8px 10px; border:1px solid #cbd5e1; border-radius:8px;
                  font-size:13.5px; background:#fff; width:100%; }
  input:focus, select:focus, textarea:focus { outline:2px solid #bfdbfe; border-color:#93c5fd; }

  pre.script { background:#0f172a; color:#e2e8f0; border-radius:10px; padding:14px 16px;
               font-size:13px; white-space:pre-wrap; line-height:1.55; }
  .empty { text-align:center; color:#64748b; padding:26px; }
  .diagram { width:100%; border-radius:12px; border:1px solid #e5e9f0; }

  @media (max-width: 720px) {
    header .wrap, .banner .wrap, .nav .wrap { padding-left:0; padding-right:0; }
    main { padding:16px; }
    table.kv td.k { width:130px; }
    .form-grid { grid-template-columns:1fr; }
    .toolbar .hint { display:none; }
  }
</style>
</head>
<body>
<header><div class="wrap"><h1>☎️ ClaimLine</h1>
  <span class="tag">${escapeHtml(insurer)} · claims handled by phone</span></div></header>
${navBar(currentPath, opts.auth, mode)}
<div class="banner"><div class="wrap">${escapeHtml(bannerText)}</div></div>
<main>
${body}
</main>
</body>
</html>`;
}

// ---- Result rendering ------------------------------------------------------

function pill(state: string): string {
  const s = statusInfo(state);
  return `<span class="pill" style="background:${s.bg};color:${s.fg}">${s.icon} ${escapeHtml(
    s.label,
  )}</span>`;
}

function resultTable(callType: CallType, result: PublicIntentView["result"]): string {
  if (!result || !result.structuredResult) return "";
  const sr = result.structuredResult;
  const rows: string[] = [];
  const skip = new Set([
    "estimated_cost_currency",
    "currency",
    "consent_recorded",
  ]);
  for (const [key, value] of Object.entries(sr)) {
    if (skip.has(key)) continue;
    let display = formatValue(key, value);
    if (key === "estimated_cost_amount" && value != null) {
      const cur = sr.estimated_cost_currency ? ` ${String(sr.estimated_cost_currency)}` : "";
      display = `${escapeHtml(String(value))}${escapeHtml(cur)}`;
    }
    if (key === "total_amount" && value != null) {
      const cur = sr.currency ? ` ${String(sr.currency)}` : "";
      display = `<b>${escapeHtml(String(value))}${escapeHtml(cur)}</b>`;
    }
    rows.push(
      `<tr><td class="k">${escapeHtml(fieldLabel(callType, key))}</td><td>${display}</td></tr>`,
    );
  }
  if ("consent_recorded" in sr) {
    rows.push(
      `<tr><td class="k">${escapeHtml(fieldLabel(callType, "consent_recorded"))}</td><td>${
        sr.consent_recorded ? "Yes" : "No"
      }</td></tr>`,
    );
  }
  if (rows.length === 0) return "";
  return `<table class="kv">${rows.join("")}</table>`;
}

function evidenceBlock(result: PublicIntentView["result"]): string {
  if (!result || result.evidence.length === 0) return "";
  const items = result.evidence.map((e) => `<li>${escapeHtml(e)}</li>`).join("");
  return `<details><summary>Evidence from the call (${result.evidence.length})</summary><ul class="evi">${items}</ul></details>`;
}

function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function transcriptBlock(result: PublicIntentView["result"]): string {
  if (!result || result.transcript.length === 0) return "";
  const turns = result.transcript
    .map(
      (t) =>
        `<div class="turn"><span class="who">${escapeHtml(t.speaker)}:</span>${escapeHtml(
          t.text,
        )}</div>`,
    )
    .join("");
  return `<details><summary>Full transcript (${pluralize(
    result.transcript.length,
    "turn",
  )})</summary><div class="transcript">${turns}</div></details>`;
}

function confidenceNote(result: PublicIntentView["result"]): string {
  if (!result || result.confidenceScore === null) return "";
  const pct = Math.round(result.confidenceScore * 100);
  return `<span class="call-sub">Confidence ${pct}%</span>`;
}

function decisionArea(view: PublicIntentView): string {
  const { intent, decision } = view;
  if (decision) {
    return `<div class="decision"><div class="lbl">Decision recorded</div>
      <div>${escapeHtml(decision.decision)} — <span class="hint">by ${escapeHtml(
        decision.decidedBy,
      )}${decision.note ? `, ${escapeHtml(decision.note)}` : ""}</span></div></div>`;
  }
  const canDecide =
    intent.state === "terminal_verified" || intent.state === "needs_human";
  if (!canDecide) return "";
  return `<div class="decision"><div class="lbl">Note on this call (optional)</div>
    <form method="post" action="/ui/intents/${escapeHtml(intent.id)}/decision" class="field-row">
      <input name="decidedBy" placeholder="Your name" value="operator" style="width:130px" />
      <input name="decision" placeholder="e.g. Reviewed, flag for follow-up…" required style="flex:1;min-width:180px" />
      <input name="note" placeholder="Note (optional)" style="flex:1;min-width:140px" />
      <button type="submit" class="btn-ghost">Mark reviewed</button>
    </form></div>`;
}

function callBlock(view: PublicIntentView, title: string, who: string): string {
  const { intent, result } = view;
  const cancel =
    intent.state === "reserved"
      ? `<form method="post" action="/ui/intents/${escapeHtml(
          intent.id,
        )}/cancel" style="margin:0"><button class="btn-danger" type="submit">Cancel</button></form>`
      : "";
  const canRetry =
    intent.state === "needs_human" ||
    intent.state === "submission_unknown" ||
    intent.state === "canceled";
  const retry = canRetry
    ? `<form method="post" action="/ui/intents/${escapeHtml(
        intent.id,
      )}/redial" style="margin:0"><button class="btn-ghost" type="submit" title="Place a fresh call to this contact">↻ Retry call</button></form>`
    : "";

  let bodyInner = "";
  if (result?.summary) {
    bodyInner += `<div class="summary">${escapeHtml(result.summary)}</div>`;
  }
  if (intent.state === "needs_human") {
    const why = humanReason(result?.dispositionReason ?? intent.reason);
    if (why) bodyInner += `<div class="callout warn"><b>Needs a person:</b> ${escapeHtml(why)}</div>`;
  }
  bodyInner += resultTable(intent.callType, result);
  bodyInner += evidenceBlock(result);
  bodyInner += transcriptBlock(result);
  bodyInner += decisionArea(view);

  return `<div class="call">
    <div class="call-top">
      <div>
        <div class="call-title">${escapeHtml(title)}
          <span class="call-sub">· ${escapeHtml(who)}</span></div>
      </div>
      <div class="startcall" style="margin:0">${confidenceNote(result)} ${pill(intent.state)} ${retry} ${cancel}</div>
    </div>
    ${bodyInner}
  </div>`;
}

function contactRow(claimId: string, cv: ContactCallView): string {
  const roleName = roleLabel(cv.contact.role);
  const header = `<div class="call-top">
      <div>
        <div class="call-title">${escapeHtml(cv.contact.name)}
          <span class="call-sub">· ${escapeHtml(roleName)} · ${escapeHtml(cv.contact.phone)}</span></div>
      </div>
    </div>`;

  // No call yet (or a canceled one) -> offer a call button.
  if (!cv.intent || cv.intent.state === "canceled") {
    return `<div class="call">
      ${header}
      <div class="startcall" style="margin-top:8px">
        <a class="btn btn-primary" href="/ui/contacts/${escapeHtml(
          cv.contact.id,
        )}/preview">📞 ${escapeHtml(callActionLabel(cv.defaultCallType))}</a>
        <span class="hint">You'll review the script before dialing.</span>
      </div>
    </div>`;
  }

  const view: PublicIntentView = {
    intent: cv.intent,
    result: cv.result,
    decision: cv.decision,
  };
  return callBlock(
    view,
    `${cv.contact.name} — ${humanCallType(cv.intent.callType)}`,
    roleName,
  );
}

function callActionLabel(callType: CallType): string {
  switch (callType) {
    case "medical_report":
      return "Call doctor";
    case "bill_verification":
      return "Call billing";
    case "status_chase":
      return "Call for status";
    default:
      return "Call";
  }
}

function totalsPanel(view: CaseView): string {
  const t = view.totals;
  const amount =
    t.billedTotal !== null
      ? `<b>${escapeHtml(String(t.billedTotal))}${t.currency ? ` ${escapeHtml(t.currency)}` : ""}</b>`
      : "<span class='hint'>not gathered yet</span>";
  const incomplete = t.incomplete
    ? ` <span class="hint">(some bill calls are still pending or need review)</span>`
    : "";
  return `<div class="callout" style="background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a">
    Total billed gathered so far: ${amount}${incomplete}</div>`;
}

function sanctionPanel(view: CaseView): string {
  const d = view.claimDecision;
  const cur = view.totals.currency ?? "USD";
  const suggested = view.totals.billedTotal ?? "";
  if (d) {
    const label =
      d.decision === "approved"
        ? `✓ Approved${d.sanctionedAmount !== null ? ` — ${d.sanctionedAmount} ${d.currency ?? ""}` : ""}`
        : d.decision === "rejected"
          ? "✕ Rejected"
          : "On hold";
    const color =
      d.decision === "approved" ? "#15803d" : d.decision === "rejected" ? "#b91c1c" : "#b45309";
    return `<div class="decision"><div class="lbl">Claim decision</div>
      <div style="font-weight:650;color:${color}">${escapeHtml(label)}</div>
      <div class="hint">by ${escapeHtml(d.decidedBy)}${d.note ? ` — ${escapeHtml(d.note)}` : ""}</div>
      <form method="post" action="/ui/claims/${escapeHtml(view.claim.id)}/sanction" style="margin-top:8px">
        <input type="hidden" name="decision" value="hold" />
        <button class="btn-ghost" type="submit">Reopen (put on hold)</button>
      </form></div>`;
  }
  return `<div class="decision"><div class="lbl">Verify &amp; sanction this claim</div>
    <form method="post" action="/ui/claims/${escapeHtml(view.claim.id)}/sanction" class="field-row">
      <input name="decidedBy" placeholder="Your name" value="operator" style="width:130px" />
      <input name="sanctionedAmount" placeholder="Amount" value="${escapeHtml(String(suggested))}" style="width:110px" />
      <input name="currency" placeholder="Cur" value="${escapeHtml(cur)}" style="width:70px" />
      <input name="note" placeholder="Note (optional)" style="flex:1;min-width:140px" />
      <button name="decision" value="approved" type="submit" class="btn-primary">Approve</button>
      <button name="decision" value="hold" type="submit" class="btn-ghost">Hold</button>
      <button name="decision" value="rejected" type="submit" class="btn-danger">Reject</button>
    </form>
    <div class="hint" style="margin-top:6px">ClaimLine only gathers facts — approving is your decision.</div></div>`;
}

export function renderCaseCard(view: CaseView): string {
  const c = view.claim;
  const contacts = view.contacts.map((cv) => contactRow(c.id, cv)).join("");
  const otherCalls = view.otherCalls
    .map((iv) =>
      callBlock(
        iv,
        humanCallType(iv.intent.callType),
        callTypeWho(iv.intent.callType),
      ),
    )
    .join("");
  const lang = languageFor(c.language);
  const langChip = `<span class="chip lang">${escapeHtml(lang.label)}</span>`;

  const addContact = `<details style="margin-top:10px">
    <summary>➕ Add a party to call (doctor, billing, witness…)</summary>
    <form method="post" action="/ui/claims/${escapeHtml(c.id)}/contacts" style="margin-top:10px">
      <div class="field-row">
        <select name="role" style="width:auto">
          ${ROLE_OPTIONS.map((r) => `<option value="${r}">${escapeHtml(roleLabel(r))}</option>`).join("")}
        </select>
        <input name="name" placeholder="Name" required style="width:auto;min-width:160px" />
        <input name="phone" placeholder="+12025550000" required style="width:auto;min-width:150px" />
        <select name="language" title="Call language" style="width:auto">
          <option value="">Claim language (${escapeHtml(lang.label)})</option>
          ${LANGUAGE_CODES.map((code) => `<option value="${code}">${escapeHtml(LANGUAGES[code].label)}</option>`).join("")}
        </select>
        <input name="note" placeholder="Note (optional)" style="width:auto;min-width:120px" />
        <button type="submit" class="btn-ghost">Add party</button>
      </div>
    </form></details>`;

  return `<div class="card">
    <div class="card-head">
      <div class="call-top">
        <h2>${escapeHtml(c.reference)} — ${escapeHtml(c.policyholderName)}</h2>
        <div>${langChip} <span class="chip">${escapeHtml(prettyEnum(c.incidentType))}</span></div>
      </div>
      <div class="meta">Claimant <span class="hint">${escapeHtml(
        c.claimantPhone,
      )}</span> · calls in ${escapeHtml(lang.name)} (${escapeHtml(c.region)}/${escapeHtml(c.locale)})${
        c.notes ? ` · ${escapeHtml(c.notes)}` : ""
      }</div>
    </div>
    <div class="card-body">
      <div class="lbl" style="font-size:12.5px;color:#475569;font-weight:600;margin:4px 0 2px">Parties on this claim</div>
      ${contacts}
      ${otherCalls}
      ${addContact}
      <hr style="border:0;border-top:1px solid #eef2f7;margin:14px 0" />
      ${totalsPanel(view)}
      ${sanctionPanel(view)}
    </div>
  </div>`;
}

// ---- Pages -----------------------------------------------------------------

export interface DashboardStats {
  customers: number;
  claims: number;
  openClaims: number;
  needsReview: number;
  sanctioned: number;
  calls: number;
}

function statCard(n: number | string, label: string, cls = ""): string {
  return `<div class="stat ${cls}"><div class="n">${escapeHtml(String(n))}</div><div class="l">${escapeHtml(
    label,
  )}</div></div>`;
}

function claimStatusChip(view: CaseView): string {
  if (view.claimDecision) {
    const d = view.claimDecision.decision;
    const map: Record<string, [string, string]> = {
      approved: ["#dcfce7", "#15803d"],
      rejected: ["#fee2e2", "#b91c1c"],
      hold: ["#fef3c7", "#b45309"],
    };
    const [bg, fg] = map[d] ?? ["#eef2f7", "#475569"];
    return `<span class="pill" style="background:${bg};color:${fg}">${escapeHtml(
      d === "approved" ? "Sanctioned" : d === "rejected" ? "Rejected" : "On hold",
    )}</span>`;
  }
  const anyNeedsReview = [...view.contacts.map((x) => x.intent), ...view.otherCalls.map((x) => x.intent)]
    .some((i) => i && i.state === "needs_human");
  if (anyNeedsReview) {
    return `<span class="pill" style="background:#fef3c7;color:#b45309">Needs review</span>`;
  }
  return `<span class="pill" style="background:#e0f2fe;color:#0369a1">Open</span>`;
}

export function renderHome(
  stats: DashboardStats,
  recent: CaseView[],
  mode: RunMode,
  insurerName: string,
  auth: AuthNav = { role: null, hasKey: false },
): string {
  const rows = recent
    .slice(0, 8)
    .map((v) => {
      const total = v.totals.billedTotal !== null
        ? `${v.totals.billedTotal} ${v.totals.currency ?? ""}`
        : "—";
      return `<tr>
        <td><a class="rowlink" href="/claims/${escapeHtml(v.claim.id)}">${escapeHtml(v.claim.reference)}</a></td>
        <td>${escapeHtml(v.claim.policyholderName)}</td>
        <td>${escapeHtml(prettyEnum(v.claim.incidentType))}</td>
        <td>${escapeHtml(languageFor(v.claim.language).label)}</td>
        <td>${escapeHtml(total)}</td>
        <td>${claimStatusChip(v)}</td>
      </tr>`;
    })
    .join("");
  const table = recent.length
    ? `<table class="list">
        <thead><tr><th>Claim</th><th>Policyholder</th><th>Incident</th><th>Language</th><th>Billed</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody></table>`
    : `<div class="empty">No claims yet. <a href="/submit">Submit a claim</a> or seed demo data.</div>`;

  const body = `
    <div class="page-head"><h1 class="page">Dashboard</h1>
      <div class="sub">${escapeHtml(insurerName)} — an overview of customers, claims, and calls.</div></div>
    <div class="toolbar">
      <div class="left">
        <a class="btn btn-primary" href="/submit">＋ New claim</a>
        <form method="post" action="/ui/seed" style="margin:0"><button type="submit" class="btn-ghost">Seed demo data</button></form>
        <form method="post" action="/ui/reconcile" style="margin:0"><button type="submit" class="btn-ghost">Refresh call results</button></form>
      </div>
    </div>
    <div class="stats">
      ${statCard(stats.customers, "Customers")}
      ${statCard(stats.claims, "Claims")}
      ${statCard(stats.openClaims, "Open claims")}
      ${statCard(stats.needsReview, "Need review", "warn")}
      ${statCard(stats.sanctioned, "Sanctioned", "good")}
      ${statCard(stats.calls, "Calls placed")}
    </div>
    <div class="card">
      <div class="card-head"><h2>Recent claims</h2></div>
      ${table}
    </div>`;
  return layout("Dashboard", mode, body, { currentPath: "/", insurerName, auth });
}

export function renderCustomers(
  customers: { customer: PublicCustomer; policies: number; claims: number }[],
  mode: RunMode,
  insurerName: string,
  auth: AuthNav = { role: null, hasKey: false },
): string {
  const rows = customers
    .map(
      (c) => `<tr>
      <td><a class="rowlink" href="/customers/${escapeHtml(c.customer.id)}">${escapeHtml(c.customer.name)}</a></td>
      <td><span class="hint">${escapeHtml(c.customer.phone)}</span></td>
      <td>${escapeHtml(languageFor(c.customer.language).label)}</td>
      <td>${c.policies}</td>
      <td>${c.claims}</td>
    </tr>`,
    )
    .join("");
  const table = customers.length
    ? `<table class="list"><thead><tr><th>Name</th><th>Phone</th><th>Language</th><th>Policies</th><th>Claims</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class="empty">No customers yet. <a href="/customers/new">Add a customer</a> or seed demo data from the Dashboard.</div>`;
  const body = `
    <div class="page-head"><div class="call-top"><h1 class="page">Customers</h1>
      <a class="btn btn-primary" href="/customers/new">＋ New customer</a></div>
      <div class="sub">Policyholders on record. Open one to see policies and claims.</div></div>
    <div class="card">${table}</div>`;
  return layout("Customers", mode, body, { currentPath: "/customers", insurerName, auth });
}

export function renderNewCustomer(
  mode: RunMode,
  insurerName: string,
  auth: AuthNav = { role: null, hasKey: false },
  opts: { error?: string; values?: Record<string, string> } = {},
): string {
  const v = opts.values ?? {};
  const langOptions = LANGUAGE_CODES.map(
    (code) =>
      `<option value="${code}"${v.language === code ? " selected" : ""}>${escapeHtml(
        LANGUAGES[code].label,
      )}</option>`,
  ).join("");
  const typeOptions = (["auto", "health", "home", "travel"] as const)
    .map(
      (t) =>
        `<option value="${t}"${v.policyType === t ? " selected" : ""}>${escapeHtml(
          prettyEnum(t),
        )}</option>`,
    )
    .join("");
  const err = opts.error
    ? `<div class="callout warn">${escapeHtml(opts.error)}</div>`
    : "";
  const val = (name: string) => escapeHtml(v[name] ?? "");
  const body = `
    <a class="btn btn-ghost" href="/customers">← Customers</a>
    <div class="page-head" style="margin-top:14px"><h1 class="page">New customer</h1>
      <div class="sub">Onboard a policyholder. You can add their first policy now, or later.</div></div>
    ${err}
    <div class="card"><div class="card-body">
      <form method="post" action="/customers">
        <div class="form-section">Policyholder</div>
        <div class="form-grid">
          <label>Full name</label>
          <input name="name" required value="${val("name")}" placeholder="e.g. Asha Verma" />
          <label>Phone (E.164)</label>
          <input name="phone" required value="${val("phone")}" placeholder="+919812345670" />
          <label>Email</label>
          <input name="email" type="email" value="${val("email")}" placeholder="name@example.com (optional)" />
          <label>Address</label>
          <input name="address" value="${val("address")}" placeholder="Street, city (optional)" />
          <label>Preferred call language</label>
          <select name="language">${langOptions}</select>
        </div>

        <div class="form-section">First policy (optional)</div>
        <div class="hint" style="margin-bottom:8px">Leave the policy number blank to add a customer with no policy yet.</div>
        <div class="form-grid">
          <label>Policy number</label>
          <input name="policyNumber" value="${val("policyNumber")}" placeholder="POL-AUTO-2001 (optional)" />
          <label>Type</label>
          <select name="policyType">${typeOptions}</select>
          <label>Coverage limit</label>
          <input name="coverageLimit" type="number" min="0" step="1" value="${val("coverageLimit")}" placeholder="e.g. 500000" />
          <label>Currency</label>
          <input name="currency" value="${v.currency ? escapeHtml(v.currency) : "USD"}" maxlength="3" style="max-width:120px" />
        </div>

        <div style="margin-top:16px"><button type="submit" class="btn-primary btn-lg">Add customer</button></div>
        <div class="hint" style="margin-top:8px">Next you'll land on the customer's page, where you can submit a claim for them.</div>
      </form>
    </div></div>`;
  return layout("New customer", mode, body, {
    currentPath: "/customers",
    insurerName,
    auth,
  });
}

export function renderCustomerDetail(
  view: CustomerView,
  mode: RunMode,
  insurerName: string,
  auth: AuthNav = { role: null, hasKey: false },
): string {
  const c = view.customer;
  const policyRows = view.policies.length
    ? view.policies
        .map(
          (p) => `<tr>
        <td><b>${escapeHtml(p.policyNumber)}</b></td>
        <td>${escapeHtml(p.type)}</td>
        <td>${escapeHtml(p.status)}</td>
        <td>${p.coverageLimit !== null ? `${escapeHtml(String(p.coverageLimit))} ${escapeHtml(p.currency ?? "")}` : "—"}</td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="4" class="hint">No policies.</td></tr>`;
  const claimRows = view.claims.length
    ? view.claims
        .map(
          (cl) => `<tr>
        <td><a class="rowlink" href="/claims/${escapeHtml(cl.id)}">${escapeHtml(cl.reference)}</a></td>
        <td>${escapeHtml(prettyEnum(cl.incidentType))}</td>
        <td>${escapeHtml(languageFor(cl.language).label)}</td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="3" class="hint">No claims yet.</td></tr>`;
  const body = `
    <a class="btn btn-ghost" href="/customers">← Customers</a>
    <div class="page-head" style="margin-top:14px"><h1 class="page">${escapeHtml(c.name)}</h1>
      <div class="sub">${escapeHtml(c.phone)}${c.email ? ` · ${escapeHtml(c.email)}` : ""}${
        c.address ? ` · ${escapeHtml(c.address)}` : ""
      } · prefers ${escapeHtml(languageFor(c.language).label)}</div></div>
    <div class="card"><div class="card-head"><h2>Policies</h2></div>
      <table class="list"><thead><tr><th>Policy #</th><th>Type</th><th>Status</th><th>Coverage</th></tr></thead>
      <tbody>${policyRows}</tbody></table></div>
    <div class="card"><div class="card-head"><div class="call-top"><h2>Claims</h2>
      <a class="btn btn-primary" href="/submit?customer=${escapeHtml(c.id)}">＋ New claim for ${escapeHtml(c.name)}</a></div></div>
      <table class="list"><thead><tr><th>Claim</th><th>Incident</th><th>Language</th></tr></thead>
      <tbody>${claimRows}</tbody></table></div>`;
  return layout(c.name, mode, body, { currentPath: "/customers", insurerName, auth });
}

export function renderClaims(
  views: CaseView[],
  mode: RunMode,
  insurerName: string,
  auth: AuthNav = { role: null, hasKey: false },
): string {
  const rows = views
    .map((v) => {
      const total = v.totals.billedTotal !== null
        ? `${v.totals.billedTotal} ${v.totals.currency ?? ""}`
        : "—";
      return `<tr>
        <td><a class="rowlink" href="/claims/${escapeHtml(v.claim.id)}">${escapeHtml(v.claim.reference)}</a></td>
        <td>${escapeHtml(v.claim.policyholderName)}</td>
        <td>${escapeHtml(prettyEnum(v.claim.incidentType))}</td>
        <td>${escapeHtml(languageFor(v.claim.language).label)}</td>
        <td>${v.contacts.length}</td>
        <td>${escapeHtml(total)}</td>
        <td>${claimStatusChip(v)}</td>
      </tr>`;
    })
    .join("");
  const table = views.length
    ? `<table class="list"><thead><tr><th>Claim</th><th>Policyholder</th><th>Incident</th><th>Language</th><th>Parties</th><th>Billed</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class="empty">No claims yet. <a href="/submit">Submit a claim</a> or seed demo data from the Dashboard.</div>`;
  const body = `
    <div class="page-head"><div class="call-top"><h1 class="page">Claims</h1>
      <a class="btn btn-primary" href="/submit">＋ New claim</a></div>
      <div class="sub">Every claim ClaimLine is working. Open one to call parties and sanction it.</div></div>
    <div class="toolbar"><div class="left">
      <form method="post" action="/ui/reconcile" style="margin:0"><button type="submit" class="btn-ghost">Refresh call results</button></form>
    </div></div>
    <div class="card">${table}</div>`;
  return layout("Claims", mode, body, { currentPath: "/claims", insurerName, auth });
}

export interface ClaimDetailExtras {
  reportText?: string | null;
  reportSentAt?: string | null;
  payment?: {
    status: string;
    provider: string;
    reference: string;
    amount: number;
    currency: string;
  } | null;
  /** Where a report would be delivered: "slack" | "teams" | "simulated" | … */
  notifyChannel?: string;
  /** Show the "Payment successful" pop-up (set right after a payout). */
  showPaidModal?: boolean;
  /** Cross-party fraud / consistency assessment. */
  fraud?: {
    level: "low" | "medium" | "high";
    score: number;
    flags: { severity: "info" | "warn" | "high"; message: string }[];
    summary: string;
  } | null;
}

function fraudCard(extras: ClaimDetailExtras): string {
  const f = extras.fraud;
  if (!f) return "";
  const palette = {
    low: { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0", icon: "🟢", label: "Low risk" },
    medium: { bg: "#fffbeb", fg: "#b45309", bd: "#fde68a", icon: "🟠", label: "Medium risk" },
    high: { bg: "#fef2f2", fg: "#b91c1c", bd: "#fecaca", icon: "🔴", label: "High risk" },
  }[f.level];
  const flagList = f.flags.length
    ? `<ul style="margin:8px 0 0;padding-left:20px">${f.flags
        .map((x) => `<li style="margin:2px 0">${escapeHtml(x.message)}</li>`)
        .join("")}</ul>`
    : `<div class="hint" style="margin-top:6px">No inconsistencies detected across the parties called.</div>`;
  return `<div class="card" style="margin-top:16px;border-color:${palette.bd}">
      <div class="card-head" style="background:${palette.bg}">
        <h2 style="color:${palette.fg}">${palette.icon} Fraud &amp; consistency check — ${palette.label}</h2>
        <div class="meta">Automated cross-party review (score ${f.score}/100). A human still decides.</div>
      </div>
      <div class="card-body">${flagList}</div>
    </div>`;
}

/** A demo payout destination (UPI id) derived from the policyholder name. */
function demoUpi(name: string): string {
  const slug = (name || "claimant").toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${slug || "claimant"}@okhdfc`;
}

function claimActions(view: CaseView, extras: ClaimDetailExtras): string {
  const id = escapeHtml(view.claim.id);
  const approved = view.claimDecision?.decision === "approved";
  const amount = view.claimDecision?.sanctionedAmount ?? null;
  const currency = view.claimDecision?.currency ?? "USD";
  const paid = extras.payment && extras.payment.status === "succeeded";

  const autopilot = `<form method="post" action="/ui/claims/${id}/autopilot" style="margin:0"
      onsubmit="return confirm('Autopilot will call every party on this claim. Continue?')">
      <button class="btn-primary" type="submit">🚀 Run autopilot — call all parties</button></form>`;

  let payout = "";
  if (paid) {
    const upi = demoUpi(view.claim.policyholderName);
    payout = `<span class="pill" style="background:#dcfce7;color:#166534" title="Ref ${escapeHtml(
      extras.payment!.reference,
    )}">✅ Paid ${extras.payment!.amount} ${escapeHtml(
      extras.payment!.currency,
    )} by Stripe · UPI ${escapeHtml(upi)}</span>`;
  } else if (approved && amount !== null) {
    payout = `<form method="post" action="/ui/claims/${id}/payout" style="margin:0">
      <button class="btn-ghost" type="submit">💳 Pay out ${amount} ${escapeHtml(
        currency,
      )} via Stripe</button></form>`;
  }

  return `<div class="startcall" style="margin:14px 0">${autopilot}${payout}</div>`;
}

/** "Payment successful" pop-up shown right after a payout completes. */
function paidModal(view: CaseView, extras: ClaimDetailExtras): string {
  const p = extras.payment;
  if (!extras.showPaidModal || !p || p.status !== "succeeded") return "";
  const id = escapeHtml(view.claim.id);
  const upi = demoUpi(view.claim.policyholderName);
  return `<div style="position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:60;padding:20px">
    <div style="background:#fff;border-radius:16px;max-width:440px;width:100%;padding:30px;box-shadow:0 24px 60px rgba(0,0,0,.35);text-align:center">
      <div style="font-size:48px;line-height:1">✅</div>
      <h2 style="margin:10px 0 6px;font-size:22px;color:#0f172a">Payment successful</h2>
      <p style="margin:0 0 4px;color:#0f172a;font-size:16px">Paid <b>${p.amount} ${escapeHtml(
        p.currency,
      )}</b> to ${escapeHtml(view.claim.policyholderName)}</p>
      <p style="margin:0 0 4px;color:#334155">Paid by <b>Stripe</b> → UPI <code>${escapeHtml(
        upi,
      )}</code></p>
      <p style="margin:0 0 18px;color:#94a3b8;font-size:12px">Ref ${escapeHtml(p.reference)}</p>
      <a href="/claims/${id}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:11px 24px;border-radius:9px;font-weight:600">Done</a>
    </div></div>`;
}

function reportSection(view: CaseView, extras: ClaimDetailExtras): string {
  if (!extras.reportText) return "";
  const id = escapeHtml(view.claim.id);
  const channel = escapeHtml(extras.notifyChannel ?? "simulated");
  const sent = extras.reportSentAt
    ? `<span class="meta">Last sent ${escapeHtml(extras.reportSentAt)}</span>`
    : `<span class="meta">Not sent yet</span>`;
  const label =
    channel === "slack"
      ? "Send to Slack"
      : channel === "teams"
        ? "Send to Teams"
        : channel === "composite"
          ? "Send to Slack + Teams"
          : "Send report (simulated)";
  return `<div class="card" style="margin-top:16px"><div class="card-head">
      <h2>Case report</h2><div class="meta">Autopilot summary of every call on this claim.</div></div>
    <div class="card-body">
      <pre style="white-space:pre-wrap;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin:0 0 12px">${escapeHtml(
        extras.reportText,
      )}</pre>
      <div class="startcall" style="margin:0">
        <form method="post" action="/ui/claims/${id}/report" style="margin:0">
          <button class="btn-ghost" type="submit">📤 ${label}</button></form>
        ${sent}
      </div>
    </div></div>`;
}

export function renderClaimDetail(
  view: CaseView,
  mode: RunMode,
  insurerName: string,
  auth: AuthNav = { role: null, hasKey: false },
  extras: ClaimDetailExtras = {},
): string {
  const needKey =
    mode === "live" && !auth.hasKey
      ? `<div class="callout warn">To place calls, ${
          auth.role === "guest"
            ? `<a href="/login">add your CALL-E API key</a>`
            : auth.role === "owner"
              ? `set <code>CALLE_API_KEY</code> on the server`
              : `<a href="/login">log in</a>`
        }.</div>`
      : "";
  const body = `
    <a class="btn btn-ghost" href="/claims">← All claims</a>
    ${needKey}
    ${claimActions(view, extras)}
    <div style="margin-top:14px">${renderCaseCard(view)}</div>
    ${fraudCard(extras)}
    ${reportSection(view, extras)}
    ${paidModal(view, extras)}`;
  return layout(view.claim.reference, mode, body, {
    currentPath: "/claims",
    insurerName,
    auth,
  });
}

const INCIDENT_TYPES = [
  "auto_collision",
  "auto_theft",
  "property_water",
  "property_fire",
  "property_theft",
  "injury",
  "other",
];

export interface AnalyticsData {
  claims: number;
  approved: number;
  rejected: number;
  pending: number;
  callsCompleted: number;
  callsNeedsReview: number;
  partiesCalled: number;
  hoursSaved: number;
  fraudFlagged: number;
  fraudHigh: number;
  paidOut: { currency: string; amount: number }[];
  incidentBreakdown: { type: string; count: number }[];
}

export function renderAnalytics(
  a: AnalyticsData,
  mode: RunMode,
  insurerName: string,
  auth: AuthNav = { role: null, hasKey: false },
): string {
  const kpi = (value: string, label: string, accent?: string) =>
    `<div class="stat"><div class="n" ${
      accent ? `style="color:${accent}"` : ""
    }>${escapeHtml(value)}</div><div class="l">${escapeHtml(label)}</div></div>`;

  const paid =
    a.paidOut.length > 0
      ? a.paidOut.map((p) => `${p.amount} ${p.currency}`).join(" · ")
      : "—";
  const reviewRate =
    a.partiesCalled > 0
      ? `${Math.round((a.callsNeedsReview / a.partiesCalled) * 100)}%`
      : "—";

  const incidentRows = a.incidentBreakdown.length
    ? a.incidentBreakdown
        .map(
          (i) =>
            `<tr><td>${escapeHtml(prettyEnum(i.type))}</td><td>${i.count}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="2" class="hint">No claims yet.</td></tr>`;

  const body = `
    <div class="page-head"><h1 class="page">Insights</h1>
      <div class="sub">Business impact across every claim — what ClaimLine's phone automation delivered.</div></div>

    <div class="stats">
      ${kpi(String(a.hoursSaved), "Agent-hours saved", "#2563eb")}
      ${kpi(String(a.callsCompleted + a.callsNeedsReview), "Calls placed")}
      ${kpi(String(a.callsCompleted), "Calls completed", "#047857")}
      ${kpi(String(a.fraudFlagged), "Fraud flagged", a.fraudFlagged ? "#b91c1c" : undefined)}
      ${kpi(paid, "Paid out")}
      ${kpi(reviewRate, "Needs-review rate")}
    </div>

    <div class="card" style="margin-top:16px"><div class="card-head">
      <h2>Claims funnel</h2><div class="meta">Human-owned outcomes — ClaimLine only gathers facts.</div></div>
      <div class="card-body">
        <div class="stats">
          ${kpi(String(a.claims), "Total claims")}
          ${kpi(String(a.pending), "Pending review")}
          ${kpi(String(a.approved), "Approved", "#047857")}
          ${kpi(String(a.rejected), "Rejected", "#b91c1c")}
        </div>
      </div></div>

    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Claims by incident type</h2></div>
      <table class="list"><thead><tr><th>Incident</th><th>Claims</th></tr></thead>
      <tbody>${incidentRows}</tbody></table></div>

    <div class="hint" style="margin-top:12px">Agent-hours saved assumes ~12 minutes of manual work per party call that ClaimLine placed instead.</div>`;
  return layout("Insights", mode, body, { currentPath: "/analytics", insurerName, auth });
}

export function renderSubmit(
  customers: PublicCustomer[],
  mode: RunMode,
  insurerName: string,
  selectedCustomerId?: string,
  auth: AuthNav = { role: null, hasKey: false },
): string {
  const customerOptions = customers
    .map(
      (c) =>
        `<option value="${escapeHtml(c.id)}"${
          c.id === selectedCustomerId ? " selected" : ""
        }>${escapeHtml(c.name)} (${escapeHtml(c.phone)})</option>`,
    )
    .join("");
  const langOptions = LANGUAGE_CODES.map(
    (code) => `<option value="${code}">${escapeHtml(LANGUAGES[code].label)}</option>`,
  ).join("");
  const incidentOptions = INCIDENT_TYPES.map(
    (t) => `<option value="${t}">${escapeHtml(prettyEnum(t))}</option>`,
  ).join("");

  const body = `
    <div class="page-head"><h1 class="page">Submit a claim</h1>
      <div class="sub">Open a new claim for a policyholder. ClaimLine will then call the parties to gather the facts.</div></div>
    <div class="card"><div class="card-body">
      <form method="post" action="/submit">
        <div class="form-section">Who is claiming?</div>
        <div class="form-grid">
          <label>Customer</label>
          <select name="customerId" required>${customerOptions || "<option value=''>No customers — seed demo data first</option>"}</select>
          <label>Call language</label>
          <select name="language">${langOptions}</select>
        </div>

        <div class="form-section">What happened?</div>
        <div class="form-grid">
          <label>Incident type</label>
          <select name="incidentType" required>${incidentOptions}</select>
          <label>Notes</label>
          <textarea name="notes" rows="2" placeholder="Short description of the incident"></textarea>
        </div>

        <div class="form-section">Parties to call (optional)</div>
        <div class="hint" style="margin-bottom:8px">The claimant is added automatically. Add a doctor, hospital billing, or repair shop and ClaimLine can call each one.</div>
        <div class="form-grid">
          <label>Treating doctor</label>
          <input name="doctor_phone" placeholder="+12025550109 (optional)" />
          <label>Doctor name</label>
          <input name="doctor_name" placeholder="Dr. …" />
          <label>Hospital billing</label>
          <input name="billing_phone" placeholder="+12025550117 (optional)" />
          <label>Billing name</label>
          <input name="billing_name" placeholder="… Hospital Billing" />
          <label>Repair shop</label>
          <input name="shop_phone" placeholder="+12025550188 (optional)" />
          <label>Shop name</label>
          <input name="shop_name" placeholder="… Auto Body" />
        </div>

        <div style="margin-top:16px"><button type="submit" class="btn-primary btn-lg">Open claim</button></div>
        <div class="hint" style="margin-top:8px">No calls are placed yet — you'll review and place each call from the claim page.</div>
      </form>
    </div></div>`;
  return layout("Submit a claim", mode, body, {
    currentPath: "/submit",
    insurerName,
    auth,
  });
}

// ---- Preview / review-before-calling page ----------------------------------

const SCENARIO_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Successful call" },
  { value: "voicemail", label: "Reaches voicemail" },
  { value: "refusal", label: "Person declines" },
  { value: "low_confidence", label: "Unclear answers (low confidence)" },
  { value: "failed", label: "Call fails (no answer)" },
];

function collectList(preview: CallPreview): string {
  const schema = preview.resultSchema as {
    properties?: Record<string, unknown>;
  };
  const keys = Object.keys(schema.properties ?? {});
  if (keys.length === 0) return "";
  const items = keys
    .filter((k) => k !== "estimated_cost_currency" && k !== "consent_recorded")
    .map((k) => `<li>${escapeHtml(fieldLabel(preview.callType, k))}</li>`)
    .join("");
  return `<ul class="evi">${items}</ul>`;
}

function previewPage(
  preview: CallPreview,
  mode: RunMode,
  action: string,
  includeCallTypeField: boolean,
  insurerName: string,
  backHref: string,
  auth: AuthNav = { role: null, hasKey: false },
): string {
  const who = escapeHtml(callTypeWho(preview.callType).replace(/^Calls /, ""));
  const lang = languageFromLocaleName(preview.locale);
  const scenarioPicker =
    mode === "fixture"
      ? `<label class="lbl" style="display:block;margin-bottom:6px">Simulated outcome (demo mode)</label>
         <select name="scenario" style="width:auto;margin-bottom:12px">${SCENARIO_OPTIONS.map(
           (o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`,
         ).join("")}</select>
         <div class="hint" style="margin:-6px 0 12px">Choose how this simulated call turns out.</div>`
      : "";

  const placeLabel = mode === "live" ? "Place real call now" : "Place simulated call";
  const callTypeField = includeCallTypeField
    ? `<input type="hidden" name="callType" value="${escapeHtml(preview.callType)}" />`
    : "";

  const body = `
    <a class="btn btn-ghost" href="${backHref}">← Back</a>
    <div class="card" style="margin-top:16px">
      <div class="card-head">
        <h2>Review before calling</h2>
        <div class="meta">${escapeHtml(humanCallType(preview.callType))} · ${who}</div>
      </div>
      <div class="card-body">
        <table class="kv">
          <tr><td class="k">Claim</td><td>${escapeHtml(preview.claimReference)} — ${escapeHtml(
            preview.policyholderName,
          )}</td></tr>
          <tr><td class="k">We will call</td><td>${escapeHtml(
            preview.maskedDestination,
          )} <span class="hint">(number hidden for privacy)</span></td></tr>
          <tr><td class="k">Language</td><td>${escapeHtml(lang)} <span class="hint">(${escapeHtml(
            preview.locale,
          )} · region ${escapeHtml(preview.region)})</span></td></tr>
        </table>

        <h3 style="margin:16px 0 6px;font-size:15px">What we'll collect</h3>
        ${collectList(preview)}

        <details style="margin-top:8px"><summary>See the exact words the assistant will use</summary>
          <pre class="script">${escapeHtml(preview.task)}</pre></details>

        <form method="post" action="${action}" style="margin-top:16px">
          ${callTypeField}
          <input type="hidden" name="confirm" value="true" />
          ${scenarioPicker}
          <div class="field-row">
            <button type="submit" class="btn-primary btn-lg">${escapeHtml(placeLabel)}</button>
            <a class="btn btn-ghost btn-lg" href="${backHref}">Cancel</a>
          </div>
        </form>
        ${
          mode === "fixture"
            ? `<div class="hint" style="margin-top:8px">This is demo mode — no real phone is dialed.</div>`
            : `<div class="callout warn" style="margin-top:8px">Live mode: this will ring a real phone. Only call numbers you're authorized to reach.</div>`
        }
      </div>
    </div>`;
  return layout(`Review — ${preview.claimReference}`, mode, body, {
    currentPath: "/claims",
    insurerName,
    auth,
  });
}

function languageFromLocaleName(locale: string): string {
  const l = locale.toLowerCase();
  if (l.startsWith("hi")) return "Hindi";
  if (l.startsWith("es")) return "Spanish";
  return "English";
}

export function renderPreview(
  preview: CallPreview,
  mode: RunMode,
  claimId: string,
  insurerName: string,
  auth: AuthNav = { role: null, hasKey: false },
): string {
  return previewPage(
    preview,
    mode,
    `/ui/claims/${escapeHtml(claimId)}/call`,
    true,
    insurerName,
    `/claims/${escapeHtml(claimId)}`,
    auth,
  );
}

export function renderContactPreview(
  preview: CallPreview,
  mode: RunMode,
  contactId: string,
  claimId: string,
  insurerName: string,
  auth: AuthNav = { role: null, hasKey: false },
): string {
  return previewPage(
    preview,
    mode,
    `/ui/contacts/${escapeHtml(contactId)}/call`,
    false,
    insurerName,
    `/claims/${escapeHtml(claimId)}`,
    auth,
  );
}

// ---- How it works page (CALL-E flow) ---------------------------------------

export function renderHowItWorks(
  mode: RunMode,
  insurerName: string,
  auth: AuthNav = { role: null, hasKey: false },
): string {
  const body = `
    <div class="page-head"><h1 class="page">How ClaimLine uses CALL-E</h1>
      <div class="sub">Every call runs through CALL-E's three-step agent flow.</div></div>
    <div class="card"><div class="card-body">
      <img class="diagram" src="/assets/calle-flow.png" alt="ClaimLine to CALL-E flow: plan_call, run_call, get_call_run" />
    </div></div>
    <div class="card"><div class="card-body">
      <p>ClaimLine is the caller; <b>CALL-E</b> places the call and returns a structured result:</p>
      <table class="kv">
        <tr><td class="k">1 · plan_call</td><td>ClaimLine gives CALL-E the goal + phone number and the answer schema. No call is placed yet — this is the preview you review.</td></tr>
        <tr><td class="k">2 · run_call</td><td>On your confirmation, CALL-E dials the party, discloses it's an AI assistant, gets consent, and holds the conversation in the chosen language.</td></tr>
        <tr><td class="k">3 · get_call_run</td><td>ClaimLine polls for the authoritative result — a schema-validated structured answer, transcript, and evidence — then verifies and files it.</td></tr>
      </table>
      <p class="hint">Ambiguous calls (voicemail, refusal, low confidence) are flagged for a human. ClaimLine only gathers facts — a person sanctions the claim.</p>
    </div></div>`;
  return layout("How it works", mode, body, { currentPath: "/how", insurerName, auth });
}

// ---- Login page ------------------------------------------------------------

export function renderLogin(
  mode: RunMode,
  insurerName: string,
  auth: AuthNav,
  opts: { error?: string; ownerEnabled: boolean; hasServerKey: boolean } = {
    ownerEnabled: false,
    hasServerKey: false,
  },
): string {
  const err = opts.error
    ? `<div class="callout warn">${escapeHtml(opts.error)}</div>`
    : "";
  const ownerForm = opts.ownerEnabled
    ? `<div class="card"><div class="card-head"><h2>Owner login</h2>
        <div class="meta">Places calls using the app's own CALL-E credits.</div></div>
      <div class="card-body">
        <form method="post" action="/login" class="form-grid" style="max-width:520px">
          <label>Username</label><input name="username" autocomplete="username" required />
          <label>Password</label><input name="password" type="password" autocomplete="current-password" required />
          <div></div><div><button type="submit" class="btn-primary">Log in as owner</button></div>
        </form>
      </div></div>`
    : `<div class="card"><div class="card-body"><div class="hint">Owner login is disabled (no owner password configured on this server).</div></div></div>`;

  const guestKeyField =
    mode === "live"
      ? `<label>Your CALL-E API key</label>
         <input name="apiKey" type="password" placeholder="calle_..." autocomplete="off" />
         <div></div><div class="hint">Kept in your session only — never stored or logged. Needed to place calls. Get one at <a href="https://dashboard.heycall-e.com/account/api-keys" target="_blank" rel="noreferrer">the CALL-E dashboard</a>.</div>`
      : `<div></div><div class="hint">Demo mode — no key needed; calls are simulated.</div>`;

  const body = `
    <div class="page-head"><h1 class="page">Log in</h1>
      <div class="sub">${escapeHtml(insurerName)} claims console.</div></div>
    ${err}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start">
      ${ownerForm}
      <div class="card"><div class="card-head"><h2>Continue as guest</h2>
        <div class="meta">Browse the console${
          mode === "live" ? "; add your own CALL-E API key to place calls." : "."
        }</div></div>
        <div class="card-body">
          <form method="post" action="/login" class="form-grid" style="max-width:520px">
            <input type="hidden" name="guest" value="1" />
            ${guestKeyField}
            <div></div><div><button type="submit" class="btn-ghost">Continue as guest</button></div>
          </form>
        </div></div>
    </div>`;
  return layout("Log in", mode, body, { currentPath: "/login", insurerName, auth });
}
