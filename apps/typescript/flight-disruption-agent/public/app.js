"use strict";

let snap = null;
let selected = null; // { disruptionId, pnr }
let selectedRequest = null; // request id
const airlinePreviews = new Map();
const passengerPreviews = new Map();
const callbackPreviews = new Map();
const previews = new Map();
const draft = {}; // form values by element id, kept across re-renders
let pollTimer = null;
let busy = false;

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function idr(n) {
  return `IDR ${Math.round(n).toLocaleString("en-US")}`;
}
function hhmm(iso) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}
function dayMonth(iso) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", day: "numeric", month: "short" }).format(new Date(iso));
}
const REASONS = [
  ["a late inbound aircraft", "operational"],
  ["a technical inspection", "operational"],
  ["a crew shortage", "operational"],
  ["weather at the destination", "force_majeure"],
  ["volcanic ash on the route", "force_majeure"],
  ["air traffic control restrictions", "force_majeure"],
];
const CASE_LABELS = { involuntary: "Involuntary", force_majeure: "Force majeure", voluntary: "Voluntary" };

function disruptionStatus(d) {
  return d.kind === "cancellation" ? "CANCELLED" : `DELAYED ${hm(d.delayMinutes)} → ${hhmm(d.newDeparture)}`;
}

function hm(minutes) {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function showError(message) {
  const el = $("error");
  el.textContent = message || "";
  el.hidden = !message;
}

let lastSnapJson = "";
let connectionLost = false;

/** quiet: a background refresh that re-renders only when something changed, e.g. a webhook event arrived. */
async function load({ quiet = false } = {}) {
  let data;
  try {
    data = await api("/api/state");
  } catch (e) {
    connectionLost = true;
    showError(`Could not reach the desk server: ${e.message}`);
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => load({ quiet: true }), 5000);
    return;
  }
  if (connectionLost) {
    connectionLost = false;
    showError("");
  }
  const json = JSON.stringify(data);
  const changed = json !== lastSnapJson;
  snap = data;
  lastSnapJson = json;
  if (!quiet || (changed && !busy)) render();
  clearTimeout(pollTimer);
  const running =
    snap.disruptions.some((d) => d.bookings.some((b) => b.entry && (b.entry.status === "in_progress" || b.entry.status === "submitted"))) ||
    snap.requests.some((r) => r.status === "passenger_call_in_progress" || r.status === "airline_call_in_progress" || r.callback?.status === "in_progress");
  pollTimer = setTimeout(() => load({ quiet: !running }), running ? (snap.live ? 5000 : 1500) : 5000);
}

async function act(fn) {
  if (busy) return;
  busy = true;
  document.body.style.cursor = "progress";
  try {
    await fn();
    showError("");
  } catch (e) {
    showError(e.message);
  } finally {
    busy = false;
    document.body.style.cursor = "";
    await load();
  }
}

// ------------------------------------------------------------------ render

function render() {
  if (callModal) renderCall(false);
  renderMode();
  renderBoard();
  renderFeed();
  renderDesk();
  renderRequests();
}

function renderMode() {
  const clock = $("clock");
  clock.hidden = !snap.demoNow;
  if (snap.demoNow) {
    clock.textContent = `Demo clock ${dayMonth(snap.demoNow)} ${hhmm(snap.demoNow)} WIB`;
    clock.title = "Passenger request cutoffs use this demo clock because the fictional flights are on 20 September 2026.";
  }
  const el = $("mode");
  if (snap.live) {
    el.className = "pill live";
    el.textContent = `LIVE · ${snap.mode.toUpperCase()} · calls ${snap.liveDemoPhone} · ${snap.liveBudget.used}/${snap.liveBudget.limit} used`;
  } else {
    el.className = "pill";
    el.textContent = "DRY RUN · no calls placed";
  }
}

function renderBoard() {
  const flights = [...snap.flights].sort((a, b) => a.departure.localeCompare(b.departure));
  $("board").innerHTML = flights
    .map((f) => {
      const d = f.disruption;
      const status = d
        ? `<span class="status-delayed">${esc(disruptionStatus(d))}</span>${d.cause === "force_majeure" ? ' <span class="dim">FM</span>' : ""}`
        : `<span class="status-ontime">ON TIME</span>`;
      let action = "";
      // A flight without a disruption can report one; a delayed flight can only get worse.
      if (f.passengers > 0 && (!d || d.kind === "delay")) {
        const delayId = `delay-${f.id}`;
        const reasonId = `reason-${f.id}`;
        const choices = [45, 90, 120, 240, 360].filter((m) => !d || m > d.delayMinutes);
        const delay = draft[delayId] ?? (d ? "cancel" : "240");
        const reason = draft[reasonId] ?? "a late inbound aircraft";
        const opt = (v, label, cur) => `<option value="${esc(v)}"${String(cur) === String(v) ? " selected" : ""}>${esc(label)}</option>`;
        const group = (cause, label) =>
          `<optgroup label="${esc(label)}">${REASONS.filter(([, c]) => c === cause).map(([r]) => opt(r, r, reason)).join("")}</optgroup>`;
        action = `<form data-report="${esc(f.id)}">
          <label class="sr" for="${esc(delayId)}">Disruption</label>
          <select id="${esc(delayId)}" name="delay">${choices.map((m) => opt(m, `+${hm(m)}`, delay)).join("")}${opt("cancel", "Cancelled", delay)}</select>
          <label class="sr" for="${esc(reasonId)}">Reason</label>
          <select id="${esc(reasonId)}" name="reason">${group("operational", "Operational")}${group("force_majeure", "Force majeure")}</select>
          <button type="submit">${d ? "Escalate" : "Report"}</button>
        </form>`;
      }
      return `<tr>
        <td class="code">${esc(f.code)}</td>
        <td>${esc(f.destinationCity.toUpperCase())} <span class="dim">${esc(f.destination)}</span></td>
        <td>${dayMonth(f.departure)} ${hhmm(f.departure)}</td>
        <td>${status}</td>
        <td>${f.passengers || '<span class="dim">–</span>'}</td>
        <td>${f.seatsAvailable || '<span class="dim">full</span>'}</td>
        <td>${action}</td>
      </tr>`;
    })
    .join("");
}

const FEED_CHIPS = { created: ["ok", "Recorded"], escalated: ["warn", "Escalated · call again"], conflict: ["warn", "Conflict · check by hand"], rejected: ["bad", "Rejected"] };

function renderFeed() {
  const el = $("feed");
  const events = snap.opsEvents ?? [];
  const pull = snap.feed;
  el.hidden = events.length === 0 && !pull;
  if (el.hidden) return;
  const flightCode = (id) => snap.flights.find((f) => f.id === id)?.code ?? id ?? "unknown flight";
  const pullStatus = pull
    ? `<div class="feed-pull">
        <span>Pulling <span class="mono">${esc(new URL(pull.url).origin)}</span> every ${pull.intervalSeconds}s</span>
        <span class="muted">last poll ${pull.lastPolledAt ? hhmm(pull.lastPolledAt) : "not yet"} · cursor <span class="mono">${esc(pull.cursor ?? "start")}</span> · ${pull.eventsRead} read</span>
        ${pull.lastError ? `<span class="chip bad">${esc(pull.lastError)}</span>` : pull.lastSuccessAt ? '<span class="chip ok">Feed OK</span>' : ""}
        <button type="button" class="btn ghost" data-feed-poll>Poll now</button>
        ${pull.invalid.length ? `<span class="feed-msg">Ignored ${pull.invalid.length} invalid event(s), latest: ${esc(pull.invalid[0].eventId ?? "no id")}: ${esc(pull.invalid[0].message)}</span>` : ""}
      </div>`
    : "";
  el.innerHTML = `<h2>Airline ops feed</h2>
    <p class="note">Events pushed to <span class="mono">POST /api/webhooks/airline-ops</span>${pull ? " or pulled from the airline feed" : ""}. Events record the disruption only; calls still start here.</p>
    ${pullStatus}
    <ul>${events
      .map((e) => {
        const [cls, label] = FEED_CHIPS[e.status] || ["", e.status];
        return `<li><span class="chip ${cls}">${esc(label)}</span>
          <span class="mono">${esc(e.type)}</span> <b>${esc(flightCode(e.flightId))}</b>
          <span class="muted">${hhmm(e.receivedAt)} · ${e.via === "feed" ? "pulled" : "pushed"} · ${esc(e.eventId)}</span>
          <span class="feed-msg">${esc(e.message)}</span></li>`;
      })
      .join("")}</ul>`;
}

function statusChip(entry) {
  if (!entry) return `<span class="chip">Not called</span>`;
  const map = {
    submitted: ["run", "Submitting"],
    in_progress: ["run", "Call in progress"],
    applied: ["ok", "Done automatically"],
    needs_review: ["warn", "Needs a person"],
    resolved_by_human: ["ok", "Resolved by agent"],
    uncertain: ["bad", "Uncertain · do not redial"],
    failed_to_submit: ["bad", "Not started"],
  };
  const [cls, label] = map[entry.status] || ["", entry.status];
  return `<span class="chip ${cls}">${esc(label)}</span>`;
}

/** Current disruptions first; replaced ones stay visible below for their call history. */
function orderedDisruptions() {
  return [...snap.disruptions].sort((a, b) => Number(Boolean(a.supersededBy)) - Number(Boolean(b.supersededBy)) || b.createdAt.localeCompare(a.createdAt));
}

function renderDesk() {
  const desk = $("desk");
  if (!snap.disruptions.length) {
    desk.hidden = true;
    selected = null;
    return;
  }
  desk.hidden = false;
  if (!selected) {
    const d = orderedDisruptions()[0];
    selected = { disruptionId: d.id, pnr: d.bookings[0].pnr };
  }
  $("events").innerHTML = orderedDisruptions()
    .map((d) => {
      const c = d.bookings[0]?.quote.changeCase;
      const pricing =
        c === "voluntary"
          ? `(&lt; ${hm(d.bookings[0]?.quote.thresholdMinutes ?? 120)})`
          : c === "force_majeure"
            ? "(outside the airline's control)"
            : d.kind === "cancellation"
              ? "(cancelled by the airline)"
              : `(≥ ${hm(d.bookings[0]?.quote.thresholdMinutes ?? 120)})`;
      const handled = d.bookings.filter((b) => b.entry && ["applied", "resolved_by_human"].includes(b.entry.status)).length;
      const review = d.bookings.filter((b) => b.entry && ["needs_review", "uncertain"].includes(b.entry.status)).length;
      const rows = d.bookings
        .map((b) => {
          const current = selected && selected.disruptionId === d.id && selected.pnr === b.pnr;
          const cheapest = b.quote.moves.length ? Math.min(...b.quote.moves.map((m) => m.total)) : null;
          const chain = b.channel
            .map((p) => `<span class="party ${p.role === "airline" ? "airline" : ""}">${esc(p.name)}</span>`)
            .join('<span aria-hidden="true">→</span>');
          return `<button type="button" class="row" data-select="${esc(d.id)}|${esc(b.pnr)}" aria-current="${current}">
            <span class="who"><b>${esc(b.pnr)}</b> ${esc(b.passenger)} <span class="muted">${esc(b.fareFamily)} · ${idr(b.farePaid)}</span></span>
            ${statusChip(b.entry)}
            <span class="chain"><span class="sr">Sold via</span>${chain}</span>
            <span class="prices">
              ${b.quote.keep ? "<span>Keep <b>free</b></span>" : ""}
              <span>Move ${cheapest === null ? "<b>no seats</b>" : `from <b>${idr(cheapest)}</b>`}</span>
              <span>Refund <b>${idr(b.quote.refund.amount)}</b></span>
            </span>
          </button>`;
        })
        .join("");
      return `<article class="event${d.supersededBy ? " superseded" : ""}">
        <div class="event-head">
          <h2>${esc(d.flight.code)} to ${esc(d.flight.destinationCity)} ${d.kind === "cancellation" ? "cancelled" : `delayed ${hm(d.delayMinutes)}`}</h2>
          <div class="facts">
            ${d.newDeparture ? `<span>New departure <b>${hhmm(d.newDeparture)}</b></span>` : "<span><b>Will not operate</b></span>"}
            ${d.supersededBy ? `<span class="chip warn">Replaced by ${esc(d.supersededBy)}</span>` : ""}
            ${d.supersedes ? `<span>Replaces <b class="mono">${esc(d.supersedes)}</b></span>` : ""}
            <span>Cause <b>${esc(d.reason)}</b></span>
            <span>Source <b>${d.source?.kind === "airline_webhook" || d.source?.kind === "airline_feed" ? `airline ops ${d.source.kind === "airline_feed" ? "feed (pulled)" : "webhook"} <span class="mono">${esc(d.source.eventId)}</span>` : "reported on this desk"}</b></span>
            <span><b>${esc(CASE_LABELS[c] ?? c)}</b> pricing ${pricing}</span>
            <span><b>${handled}</b> handled · <b>${review}</b> need a person</span>
          </div>
        </div>
        ${rows}
      </article>`;
    })
    .join("");
  renderDetail();
}

/** Chat-style transcript: CALL-E on one side, the person it called on the other. */
function transcriptHtml(turns, other) {
  return `<div class="transcript">${turns
    .map((t) => {
      const bot = t.speaker === "bot";
      return `<div class="bubble ${bot ? "bot" : "them"}"><span class="spk">${bot ? "CALL-E" : esc(other)}</span><span>${esc(t.text)}</span></div>`;
    })
    .join("")}</div>`;
}

/** The workflow as a strip of steps, so it is clear where this booking or request is. */
function flowRibbon(steps) {
  return `<ol class="ribbon" aria-label="Progress">${steps
    .map(([state, label]) => `<li class="${state}"><span class="dot" aria-hidden="true"></span><span class="lbl">${esc(label)}</span></li>`)
    .join("")}</ol>`;
}

function disruptionRibbon(entry) {
  const s = entry?.status;
  const call = !entry ? "todo" : s === "submitted" || s === "in_progress" ? "ring" : s === "uncertain" || s === "failed_to_submit" ? "stop" : "done";
  const decided = s === "applied" || s === "resolved_by_human" ? "done" : s === "needs_review" ? "stop" : "todo";
  return flowRibbon([
    ["done", "Options priced"],
    [call, call === "ring" ? "CALL-E is calling the passenger" : "CALL-E calls the passenger"],
    [decided, s === "needs_review" ? "A person takes over" : "Passenger decides"],
    [s === "applied" || s === "resolved_by_human" ? "done" : "todo", "Booking updated"],
  ]);
}

function requestRibbon(r) {
  const s = r.status;
  if (s === "ineligible") return flowRibbon([["stop", "Not eligible"]]);
  const agreed = r.confirmedBy?.kind === "call";
  const passenger =
    s === "awaiting_call" ? "todo" : s === "passenger_call_in_progress" ? "ring" : agreed ? "done" : s === "declined" ? "done" : "stop";
  const airline = s === "confirmed_on_call" ? "todo" : s === "airline_call_in_progress" ? "ring" : s === "completed" ? "done" : agreed && r.airlineCall ? "stop" : "todo";
  const last = s === "completed" || s === "resolved_by_human" ? "done" : s === "declined" ? "stop" : "todo";
  return flowRibbon([
    ["done", "Request priced"],
    [passenger, passenger === "ring" ? "CALL-E is calling the passenger" : agreed ? "Passenger agreed on the call" : s === "declined" ? "Passenger kept the booking" : "CALL-E calls the passenger"],
    [airline, airline === "ring" ? "CALL-E is calling the airline desk" : "CALL-E calls the airline desk"],
    [last, s === "resolved_by_human" ? "Resolved by an agent" : s === "declined" ? "Nothing changes" : "Booking updated"],
  ]);
}

function quoteTable(title, lines, totalLabel, total, extraFirst, chosen = false) {
  const body = [
    extraFirst ? `<tr><td>${esc(extraFirst[0])}</td><td></td><td class="amt">${idr(extraFirst[1])}</td></tr>` : "",
    ...lines.map((l) => `<tr><td>${esc(l.party)}</td><td>${esc(l.label)}</td><td class="amt">${l.amount === 0 ? "0" : idr(l.amount)}</td></tr>`),
  ].join("");
  return `<table class="quote${chosen ? " chosen" : ""}">
    <thead><tr><th colspan="2">${esc(title)}${chosen ? ' <span class="chip ok">Chosen on the call</span>' : ""}</th><th class="amt">${esc(totalLabel)}</th></tr></thead>
    <tbody>${body}<tr class="total"><td colspan="2">${esc(totalLabel)}</td><td class="amt">${idr(total)}</td></tr></tbody>
  </table>`;
}

function renderDetail() {
  const el = $("detail");
  const d = snap.disruptions.find((x) => x.id === selected?.disruptionId);
  const b = d?.bookings.find((x) => x.pnr === selected.pnr);
  if (!d || !b) {
    el.innerHTML = `<p class="empty">Select a passenger to see their priced options and the call CALL-E will make.</p>`;
    return;
  }
  const key = `${d.id}:${b.pnr}`;
  const entry = b.entry;
  const q = b.quote;

  const n = q.keep ? 1 : 0;
  const pick = entry?.outcome?.result;
  const chose = (kind, flightId) => Boolean(pick && pick.choice === kind && (!flightId || pick.selected_flight === flightId));
  const keepChosen = chose("keep_delayed_flight");
  const options = [
    q.keep
      ? `<table class="quote${keepChosen ? " chosen" : ""}"><thead><tr><th colspan="2">1 · Keep delayed flight (${hhmm(q.keep.newDeparture)})${keepChosen ? ' <span class="chip ok">Chosen on the call</span>' : ""}</th><th class="amt">Cost</th></tr></thead><tbody><tr class="total"><td colspan="2">No change to the ticket</td><td class="amt">${idr(0)}</td></tr></tbody></table>`
      : "",
    ...q.moves.map((m) => quoteTable(`${n + 1} · Move to ${m.label} (${m.seatsAvailable} seats)`, m.lines, "Passenger pays", m.total, undefined, chose("move_to_other_flight", m.flightId))),
    quoteTable(`${n + 2} · Cancel and refund`, q.refund.lines, "Refund", q.refund.amount, ["Fare paid", q.refund.gross], chose("refund")),
  ].join("");

  el.innerHTML = `
    ${disruptionRibbon(entry)}
    <div>
      <h2>${esc(b.passenger)} <span class="mono muted">${esc(b.pnr)}</span></h2>
      <dl class="kv" style="margin-top:8px">
        <dt>Fare</dt><dd>${esc(b.fareFamily)} · ${idr(b.farePaid)}</dd>
        <dt>Phone</dt><dd class="mono">${esc(b.phoneMasked)} <span class="muted">(fictional)</span></dd>
        <dt>Sold via</dt><dd>${b.channel.map((p) => esc(p.name)).join(" → ")}</dd>
        <dt>Booking</dt><dd>${esc(b.state.status.replaceAll("_", " "))}${b.state.currentPnr !== b.pnr ? ` · new code <b class="mono">${esc(b.state.currentPnr)}</b>` : ""}</dd>
      </dl>
    </div>
    <div>
      <h3 style="margin-bottom:6px">Options priced before the call</h3>
      <p class="note" style="margin-bottom:6px">Each party in the chain applies its own rule. CALL-E cannot look prices up mid-call, so these numbers are exactly what the passenger hears.</p>
      ${options}
    </div>
    ${
      entry && entry.status !== "failed_to_submit"
        ? renderEntry(entry, b, key)
        : d.supersededBy
          ? `<p class="note">This disruption was replaced by <span class="mono">${esc(d.supersededBy)}</span>. Call ${esc(b.passenger)} from the new one.</p>`
          : renderCallBox(d, b, key, entry)
    }
  `;
  if ((!entry || entry.status === "failed_to_submit") && !d.supersededBy) ensurePreview(d.id, b.pnr, key);
}

function renderCallBox(d, b, key, entry) {
  const p = previews.get(key);
  const live = snap.live;
  const blocked = p?.blockedReason;
  const last4Id = `last4-${key}`;
  const destination = p
    ? `${esc(p.destinationMasked)}${p.redirected ? " <span class=\"note\">(live calls always go to LIVE_DEMO_PHONE, never the fixture number)</span>" : ""}`
    : "…";
  return `<div class="callbox ${live ? "live" : ""}">
    <h3>${live ? "Place a real call" : "Simulate the call"}</h3>
    ${entry?.status === "failed_to_submit" ? `<p class="note bad">Last attempt was not started: ${esc(entry.error)}</p>` : ""}
    <dl class="kv"><dt>Destination</dt><dd class="mono">${destination}</dd><dt>Mode</dt><dd>${live ? `live (${esc(snap.mode)}), ${snap.liveBudget.limit - snap.liveBudget.used} calls left` : "dry run: scripted answer, no network"}</dd></dl>
    ${blocked ? `<p class="note bad">${esc(blocked)}</p>` : ""}
    ${p ? `<details><summary>What CALL-E will be told</summary><pre>${esc(p.task)}</pre></details>
    <details><summary>Result schema CALL-E fills in after the call</summary><pre>${esc(JSON.stringify(p.resultSchema, null, 2))}</pre></details>` : ""}
    ${planCheckHtml({ kind: "passenger", disruptionId: d.id, pnr: b.pnr }, `passenger:${key}`)}
    ${
      live
        ? `<div class="row-inline"><label for="${esc(last4Id)}">Type the last 4 digits of the destination to confirm</label>
            <input id="${esc(last4Id)}" inputmode="numeric" maxlength="4" autocomplete="off" value="${esc(draft[last4Id] ?? "")}">
            <button type="button" class="btn live" data-call="${esc(d.id)}|${esc(b.pnr)}" ${blocked ? "disabled" : ""}>Place real call</button></div>
           <p class="note">This dials a real phone. A started call cannot be recalled.</p>`
        : `<div class="row-inline"><button type="button" class="btn" data-call="${esc(d.id)}|${esc(b.pnr)}" ${blocked ? "disabled" : ""}>Simulate call</button></div>`
    }
  </div>`;
}

function renderEntry(entry, b, key) {
  const o = entry.outcome;
  const r = o?.result;
  const parts = [];
  parts.push(`<dl class="kv">
    <dt>Status</dt><dd>${statusChip(entry)} <span class="muted">${esc(o?.providerStatus ?? "")}</span></dd>
    <dt>Call id</dt><dd class="mono">${esc(entry.callId ?? "none")}</dd>
    <dt>Dialed</dt><dd class="mono">${esc(entry.destinationMasked)}${entry.redirected ? " (demo phone)" : ""}</dd>
    <dt>Idempotency</dt><dd class="mono">${esc(entry.idempotencyKey)}</dd>
    ${o?.confidence ? `<dt>Confidence</dt><dd>${o.confidence.score.toFixed(2)} (${esc(o.confidence.label)})</dd>` : ""}
  </dl>`);

  if (entry.status === "in_progress" || entry.status === "submitted") {
    const wait = snap.live ? `First status check ${snap.polling.firstSeconds}s after the call starts, then every ${snap.polling.everySeconds}s.` : "Scripted call, a few seconds.";
    parts.push(`<p class="note">${esc(wait)} Closing this page does not stop the call.</p>`);
  }
  if (entry.status === "uncertain") {
    parts.push(`<p class="note bad">CALL-E may or may not have started this call: ${esc(entry.error)} It will not be redialed. Check the CALL-E dashboard, then close this item.</p>`);
  }
  if (r) {
    parts.push(`<div class="outcome"><h3>What the passenger decided</h3>
      <dl class="kv">
        <dt>Choice</dt><dd><b>${esc(r.choice.replaceAll("_", " "))}</b></dd>
        <dt>Flight</dt><dd class="mono">${esc(r.selected_flight)}</dd>
        <dt>Fee accepted</dt><dd>${esc(r.fee_accepted.replaceAll("_", " "))}</dd>
        <dt>Asked for a person</dt><dd>${esc(r.human_requested)}</dd>
      </dl>
      ${r.reason ? `<blockquote>${esc(r.reason)}</blockquote>` : ""}</div>`);
  }
  if (o?.summary) parts.push(`<p><span class="muted">Summary:</span> ${esc(o.summary)}</p>`);
  if (entry.status === "applied" || entry.status === "resolved_by_human") {
    parts.push(`<p class="applied">${esc(entry.applied)}</p>`);
  }
  if (entry.decision?.kind === "review" && entry.status === "needs_review") {
    parts.push(`<ul class="reasons">${entry.decision.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`);
  }
  if (entry.status === "needs_review" || entry.status === "uncertain") {
    const actId = `action-${key}`;
    const noteId = `note-${key}`;
    const cur = draft[actId] ?? "none";
    const replaced = snap.disruptions.find((x) => x.id === entry.disruptionId)?.supersededBy;
    const opts = replaced ? [["none", "Close without changing the booking"]] : [["none", "Close without changing the booking"], ...(entry.quote.keep ? [["keep", "Keep on delayed flight"]] : []), ...entry.quote.moves.map((m) => [`move:${m.id}`, `Move to ${m.label} (${idr(m.total)})`]), ["refund", `Refund ${idr(entry.quote.refund.amount)}`]];
    parts.push(`<div class="callbox"><h3>Resolve as a person</h3>
      <label for="${esc(actId)}" class="note">After contacting the passenger yourself</label>
      <select id="${esc(actId)}">${opts.map(([v, l]) => `<option value="${esc(v)}"${cur === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
      <label for="${esc(noteId)}" class="note">Note for the booking</label>
      <textarea id="${esc(noteId)}">${esc(draft[noteId] ?? "")}</textarea>
      <div class="row-inline"><button type="button" class="btn" data-resolve="${esc(key)}">Resolve</button></div></div>`);
  }
  if (o?.transcript?.length) {
    parts.push(`<details open><summary>Transcript (${o.transcript.length} turns)</summary>${transcriptHtml(o.transcript, "Passenger")}</details>`);
  }
  parts.push(`<details><summary>What CALL-E was told</summary><pre>${esc(entry.task)}</pre></details>`);
  return `<div class="outcome"><h3>Call</h3>${parts.join("")}</div>`;
}

async function ensurePreview(disruptionId, pnr, key) {
  if (previews.has(key)) return;
  previews.set(key, null);
  try {
    previews.set(key, await api("/api/calls/preview", { disruptionId, pnr }));
    if (selected && `${selected.disruptionId}:${selected.pnr}` === key) renderDetail();
  } catch (e) {
    previews.delete(key);
    showError(e.message);
  }
}




// ------------------------------------------------------------------ check with CALL-E (plan only)

const planResults = new Map(); // key -> "loading" | { error } | plan result

/** Sends this call's exact task to CALL-E's planner. CALL-E plans it; nothing is dialed. */
function planCheckHtml(target, key) {
  if (!snap.planCheck?.available) return "";
  const r = planResults.get(key);
  let out = "";
  if (r === "loading") out = `<p class="note">Asking CALL-E's planner. This takes about 15 seconds; nothing is dialed.</p>`;
  else if (r?.error) out = `<p class="note bad">${esc(r.error)}</p>`;
  else if (r) {
    out = `<p class="plan-verdict">${r.ready ? '<span class="chip ok">CALL-E: ready to run</span>' : '<span class="chip warn">CALL-E needs changes</span>'}
      <span class="note">Planned for ${esc(r.destinationMasked)} (${esc(r.region)}). Not dialed.</span></p>
      ${r.questions.length ? `<ul class="reasons">${r.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>` : ""}
      ${r.goal ? `<details><summary>CALL-E's plan for this call</summary><pre>${esc(r.goal)}</pre></details>` : ""}`;
  }
  return `<div class="plan-check">
    <div class="row-inline"><button type="button" class="btn ghost" data-plan="${esc(JSON.stringify(target))}" data-plan-key="${esc(key)}" ${r === "loading" || !snap.planCheck.phoneMasked ? "disabled" : ""}>Check with CALL-E (no call)</button>
      <span class="note">${snap.planCheck.phoneMasked ? "Sends this exact task to CALL-E's planner using your CALL-E login." : "Set CALLE_PLAN_PHONE to your own number to check with CALL-E."}</span></div>
    ${out}</div>`;
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-plan]");
  if (!btn) return;
  const key = btn.dataset.planKey;
  const target = JSON.parse(btn.dataset.plan);
  planResults.set(key, "loading");
  render();
  try {
    planResults.set(key, await api("/api/calle/plan", target));
    showToast("CALL-E planned the call. Nothing was dialed.");
  } catch (err) {
    planResults.set(key, { error: err.message });
  }
  render();
});

// ------------------------------------------------------------------ call pop-up

let callModal = null; // { kind, key, who, sub, openedAt, shown, phase, timer }
let toastTimer = null;

function showToast(message) {
  const el = $("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3200);
}

function openCall(kind, key, who, sub) {
  closeCall();
  callModal = { kind, key, who, sub, openedAt: Date.now(), shown: 0, phase: "", timer: null, lastFocus: document.activeElement };
  callModal.timer = setInterval(tickCall, 250);
  renderCall(true);
  $("call-modal").querySelector("[data-call-close]")?.focus();
}

function closeCall() {
  if (!callModal) return;
  clearInterval(callModal.timer);
  const back = callModal.lastFocus;
  callModal = null;
  $("call-modal").hidden = true;
  $("call-modal").innerHTML = "";
  back?.focus?.();
}

/** The latest state of the call the pop-up is showing, whatever kind it is. */
function callState(m) {
  if (!snap) return null;
  if (m.kind === "passenger") {
    const [disruptionId, pnr] = m.key.split(":");
    const b = snap.disruptions.find((d) => d.id === disruptionId)?.bookings.find((x) => x.pnr === pnr);
    const e = b?.entry;
    if (!e) return null;
    const live = e.status === "submitted" || e.status === "in_progress";
    let verdict = "";
    if (e.status === "applied") verdict = `<span class="chip ok">Done automatically</span><span>${esc(e.applied ?? "")}</span>`;
    else if (e.status === "needs_review") verdict = `<span class="chip warn">Needs a person</span><span>${esc(e.decision?.reasons?.join(" ") ?? "")}</span>`;
    else if (e.status === "uncertain" || e.status === "failed_to_submit") verdict = `<span class="chip bad">Not placed</span><span>${esc(e.error ?? "")}</span>`;
    return { live, outcome: e.outcome, verdict, other: "Passenger" };
  }
  const r = snap.requests.find((x) => x.request.id === m.key);
  if (!r) return null;
  const call = m.kind === "intake" ? r.passengerCall : m.kind === "airline" ? r.airlineCall : r.callback;
  if (!call) return null;
  const live = call.status === "submitted" || call.status === "in_progress";
  const reasons = r.reviewReasons?.join(" ") ?? "";
  let verdict = "";
  if (call.status === "uncertain" || call.status === "failed_to_submit") verdict = `<span class="chip bad">Not placed</span><span>${esc(call.error ?? "")}</span>`;
  else if (m.kind === "intake") {
    const move = r.action?.kind === "move" ? r.quote.moves.find((mv) => mv.id === r.action.optionId) : null;
    if (r.status === "confirmed_on_call") verdict = `<span class="chip ok">Agreed on the call</span><span>${r.action?.kind === "refund" ? "Refund" : `Move to ${esc(move?.label ?? "")}`} for ${idr(r.amount ?? 0)}. Next: CALL-E calls the airline desk.</span>`;
    else if (r.status === "declined") verdict = `<span class="chip">Kept the booking</span><span>Nothing changes.</span>`;
    else if (r.status === "needs_review") verdict = `<span class="chip warn">Needs a person</span><span>${esc(reasons)}</span>`;
  } else if (m.kind === "airline") {
    if (r.status === "completed") verdict = `<span class="chip ok">Done</span><span>${esc(r.applied ?? "")}</span>`;
    else if (r.status === "needs_review") verdict = `<span class="chip warn">Needs a person</span><span>${esc(reasons)}</span>`;
  } else if (r.callbackVerdict) {
    verdict = r.callbackVerdict.kind === "delivered"
      ? `<span class="chip ok">Passenger heard the result</span>`
      : `<span class="chip warn">Follow up in writing</span><span>${esc(r.callbackVerdict.reasons.join(" "))}</span>`;
  }
  return { live, outcome: call.outcome, verdict, other: m.kind === "airline" ? "Airline desk" : "Passenger" };
}

function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function tickCall() {
  if (!callModal) return;
  const st = callState(callModal);
  const turns = st?.outcome?.transcript ?? [];
  // Once the call has ended, play the conversation back one line at a time.
  if (st && !st.live && callModal.shown < turns.length && Date.now() - (callModal.lastShown ?? 0) > 850) {
    callModal.shown += 1;
    callModal.lastShown = Date.now();
    renderCall(true);
    return;
  }
  renderCall(false);
}

function renderCall(full) {
  const m = callModal;
  if (!m) return;
  const el = $("call-modal");
  const st = callState(m);
  const turns = st?.outcome?.transcript ?? [];
  const elapsed = Date.now() - m.openedAt;
  const ringing = !st || (st.live && elapsed < 2200);
  const replaying = st && !st.live && m.shown < turns.length;
  const ended = st && !st.live && !replaying;
  const failed = ended && st.outcome && st.outcome.state !== "completed" && !turns.length;
  const phase = ringing ? "ringing" : st.live ? "connected" : replaying ? "replay" : "ended";
  const stateText = ringing ? "Ringing…" : st.live ? `On the call · ${clock(elapsed - 2200)}` : failed ? "No answer" : replaying ? "Call recording" : "Call ended";
  if (!full && phase === m.phase) {
    const pill = el.querySelector(".call-head .state");
    if (pill) pill.textContent = stateText;
    return;
  }
  m.phase = phase;
  const body = turns.length && !st.live
    ? turns
        .slice(0, m.shown)
        .map((t, i) => {
          const bot = t.speaker === "bot";
          return `<div class="bubble ${bot ? "bot" : "them"}${i === m.shown - 1 ? " new" : ""}"><span class="spk">${bot ? "CALL-E" : esc(st.other)}</span><span>${esc(t.text)}</span></div>`;
        })
        .join("")
    : `<p class="waiting">${ringing ? `Calling ${esc(m.who)}…` : st?.live ? (snap.live ? "CALL-E is on the phone. The transcript arrives when the call ends." : `CALL-E is talking with ${esc(m.who)}…`) : failed ? "Nobody picked up." : "No transcript for this call."}</p>`;
  const entering = !m.rendered;
  m.rendered = true;
  el.hidden = false;
  el.innerHTML = `<div class="call-backdrop${entering ? " entering" : ""}" data-call-backdrop>
    <div class="call ${ringing ? "ringing" : ""}" role="dialog" aria-modal="true" aria-labelledby="call-title">
      <div class="call-head">
        <div class="call-avatar"><img src="calle-icon.svg" alt="" width="54" height="54"></div>
        <div class="who" id="call-title">${esc(m.who)}</div>
        <div class="sub">${esc(m.sub)}</div>
        <div class="state">${esc(stateText)}</div>
      </div>
      <div class="call-body">${body}</div>
      <div class="call-result">
        ${ended && st.verdict ? `<div class="verdict">${st.verdict}</div>` : ""}
        <div class="row-inline"><button type="button" class="btn ${ended ? "" : "ghost"}" data-call-close>${ended ? "Done" : "Hide"}</button></div>
      </div>
    </div>
  </div>`;
  const b = el.querySelector(".call-body");
  if (b) b.scrollTop = b.scrollHeight;
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && callModal) closeCall();
});
document.addEventListener("click", (e) => {
  if (!callModal) return;
  if (e.target.closest("[data-call-close]") || e.target.matches("[data-call-backdrop]")) closeCall();
});

function passengerName(pnr) {
  return snap?.bookings?.find((b) => b.pnr === pnr)?.passenger ?? pnr;
}

// ------------------------------------------------------------------ passenger requests (Workflow B)

const REQUEST_CHIPS = {
  ineligible: ["bad", "Not eligible"],
  awaiting_call: ["run", "CALL-E to call passenger"],
  passenger_call_in_progress: ["run", "Calling passenger"],
  declined: ["", "Kept booking"],
  confirmed_on_call: ["run", "Agreed · call airline desk"],
  completed: ["ok", "Done"],
  airline_call_in_progress: ["run", "Calling airline desk"],
  needs_review: ["warn", "Needs a person"],
  resolved_by_human: ["ok", "Resolved by agent"],
};

function requestChip(status) {
  const [cls, label] = REQUEST_CHIPS[status] || ["", status];
  return `<span class="chip ${cls}">${esc(label)}</span>`;
}

function renderRequestForm() {
  const form = $("request-form");
  if (form.contains(document.activeElement)) return; // don't rebuild under the operator's cursor
  const bookings = snap.bookings.filter((b) => b.state.status === "ticketed");
  const pnr = bookings.some((b) => b.pnr === draft["req-pnr"]) ? draft["req-pnr"] : bookings[0]?.pnr;
  const booking = snap.bookings.find((b) => b.pnr === pnr);
  const kind = draft["req-kind"] ?? "change";
  const channel = draft["req-channel"] ?? "chat";
  const opt = (v, label, cur) => `<option value="${esc(v)}"${cur === v ? " selected" : ""}>${esc(label)}</option>`;
  const moves = booking?.voluntary.moves ?? [];
  const target = moves.some((m) => m.flightId === draft["req-target"]) ? draft["req-target"] : "";
  form.innerHTML = `<h3>New request</h3>
    <div class="fields">
      <label>Booking<select id="req-pnr">${bookings.map((b) => opt(b.pnr, `${b.pnr} · ${b.passenger} · ${b.flight.code}${b.disrupted ? " (disrupted)" : ""}`, pnr)).join("")}</select></label>
      <label>Passenger asked about<select id="req-kind">${opt("change", "A change (picks on the call)", kind)}${opt("reschedule", "Another flight", kind)}${opt("refund", "A refund", kind)}</select></label>
      ${kind === "reschedule" ? `<label>Flight they mentioned<select id="req-target">${opt("", "None, pick on the call", target ?? "")}${moves.map((m) => opt(m.flightId, `${m.label} · ${idr(m.total)}`, target)).join("")}</select></label>` : ""}
      <label>Came in through<select id="req-channel">${opt("chat", "Chat", channel)}${opt("web_form", "Web form", channel)}${opt("phone", "Phone line", channel)}</select></label>
    </div>
    <div class="row-inline"><button type="submit" class="btn" ${booking ? "" : "disabled"}>Check and price</button>
      <span class="note">Prices every option at voluntary rates. CALL-E then calls the passenger to agree the change; nothing changes until they agree.</span></div>`;
}

function renderRequests() {
  renderRequestForm();
  const list = $("request-list");
  if (!snap.requests.length) {
    list.innerHTML = "";
    $("request-detail").innerHTML = `<p class="empty">Log a request to see the priced options, CALL-E's call to the passenger, and CALL-E's call to the airline desk.</p>`;
    return;
  }
  if (!snap.requests.some((r) => r.request.id === selectedRequest)) selectedRequest = snap.requests[0].request.id;
  list.innerHTML = `<article class="event">${snap.requests
    .map((r) => {
      const current = r.request.id === selectedRequest;
      const agreedMove = r.action?.kind === "move" ? r.quote.moves.find((m) => m.id === r.action.optionId) : null;
      const what = r.action
        ? r.action.kind === "refund" ? "Agreed: refund" : `Agreed: ${agreedMove?.label ?? "move"}`
        : r.request.kind === "refund" ? "Asked about a refund" : r.request.kind === "reschedule" ? "Asked about another flight" : "Asked about a change";
      return `<button type="button" class="row" data-req-select="${esc(r.request.id)}" aria-current="${current}">
        <span class="who"><b>${esc(r.request.pnr)}</b> ${esc(r.passenger)} <span class="muted">${esc(r.flight.code)} · via ${esc(r.request.channel.replace("_", " "))}</span></span>
        ${requestChip(r.status)}
        <span class="prices"><span>${esc(what)}</span>${r.amount === null ? "" : `<span>${r.action?.kind === "refund" ? "Refund" : "Passenger pays"} <b>${idr(r.amount)}</b></span>`}</span>
      </button>`;
    })
    .join("")}</article>`;
  renderRequestDetail();
}

function requestSteps(r) {
  const step = (cls, text) => `<li class="${cls}">${text}</li>`;
  const steps = [step(r.eligibility.eligible ? "done" : "stop", r.eligibility.eligible ? "Eligible; every option priced" : "Not eligible")];
  if (!r.eligibility.eligible) return steps;
  const agreed = r.confirmedBy?.kind === "call";
  if (r.status === "awaiting_call") steps.push(step("todo", "CALL-E calls the passenger"));
  else if (r.status === "passenger_call_in_progress") steps.push(step("todo", "CALL-E is calling the passenger"));
  else if (r.status === "declined") steps.push(step("stop", "Passenger kept the booking on the call"));
  else if (agreed) steps.push(step("done", `Passenger agreed on the call: ${r.action?.kind === "refund" ? "refund" : "move"} for ${idr(r.amount ?? 0)}`));
  else if (r.passengerCall) steps.push(step("stop", "No clear agreement on the passenger call"));
  if (agreed) {
    if (r.status === "confirmed_on_call") steps.push(step("todo", "CALL-E calls the airline desk"));
    else if (r.status === "airline_call_in_progress") steps.push(step("todo", "CALL-E is calling the airline desk"));
    else if (r.status === "completed") steps.push(step("done", r.action?.kind === "refund" ? "Airline desk approved the refund" : "Airline desk reissued the ticket"));
    else if (r.airlineCall) steps.push(step("stop", "Airline desk did not make the change"));
  }
  if (r.status === "needs_review") steps.push(step("todo", "A person resolves the request"));
  if (r.status === "resolved_by_human") steps.push(step("done", "Resolved by an agent"));
  if (r.callbackVerdict) steps.push(step(r.callbackVerdict.kind === "delivered" ? "done" : "stop", r.callbackVerdict.kind === "delivered" ? "Passenger heard the result" : "Passenger needs written follow-up"));
  return steps;
}

function renderRequestDetail() {
  const el = $("request-detail");
  const r = snap.requests.find((x) => x.request.id === selectedRequest);
  if (!r) return;
  const id = r.request.id;
  const parts = [];
  parts.push(`<div><h2>${esc(r.passenger)} <span class="mono muted">${esc(r.request.pnr)}</span></h2>
    <dl class="kv" style="margin-top:8px">
      <dt>Flight</dt><dd>${esc(r.flight.code)} · ${dayMonth(r.flight.departure)} ${hhmm(r.flight.departure)}</dd>
      <dt>Sold via</dt><dd>${r.channel.map((p) => esc(p.name)).join(" → ")}</dd>
      <dt>Request</dt><dd>${esc(r.request.kind)} via ${esc(r.request.channel.replace("_", " "))}${r.request.conversation ? ` <span class="muted">(from the channel integration, conversation <span class="mono">${esc(r.request.conversation.id)}</span>)</span>` : " <span class=\"muted\">(typed by the operator)</span>"}</dd>
      ${r.confirmedBy ? `<dt>Agreed</dt><dd>by the passenger on the CALL-E call <span class="mono muted">${esc(r.confirmedBy.callId ?? "")}</span></dd>` : ""}
      <dt>Booking</dt><dd>${esc(r.bookingState.status.replaceAll("_", " "))}${r.bookingState.currentPnr !== r.request.pnr ? ` · new code <b class="mono">${esc(r.bookingState.currentPnr)}</b>` : ""}</dd>
    </dl></div>`);
  parts.unshift(requestRibbon(r));
  parts.push(`<ol class="steps">${requestSteps(r).join("")}</ol>`);
  if (r.eligibility.reasons.length) parts.push(`<ul class="reasons">${r.eligibility.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`);
  if (r.eligibility.eligible) {
    const agreedId = r.action?.kind === "move" ? r.action.optionId : null;
    const tables = [
      ...r.quote.moves
        .filter((m) => !r.action || m.id === agreedId)
        .map((m) => quoteTable(`Move to ${m.label}`, m.lines, "Passenger pays", m.total)),
      !r.action || r.action.kind === "refund" ? quoteTable("Cancel and refund", r.quote.refund.lines, "Refund", r.quote.refund.amount, ["Fare paid", r.quote.refund.gross]) : "",
    ];
    parts.push(`<div><h3 style="margin-bottom:6px">${r.action ? "The change the passenger agreed" : "Options CALL-E will offer"}</h3>${tables.join("")}</div>`);
  }
  if (r.eligibility.warnings.length) parts.push(`<ul class="reasons">${r.eligibility.warnings.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`);

  if (r.status === "awaiting_call") {
    parts.push(renderPassengerCallBox(r));
    ensurePassengerPreview(id);
  }
  if (r.passengerCall && !(r.status === "awaiting_call" && r.passengerCall.status === "failed_to_submit")) parts.push(renderPassengerCall(r));
  if (r.status === "confirmed_on_call") {
    parts.push(renderAirlineCallBox(r));
    ensureAirlinePreview(id);
  }
  if (r.airlineCall) parts.push(renderAirlineCall(r));
  if (r.applied && (r.status === "completed" || r.status === "resolved_by_human")) parts.push(`<p class="applied">${esc(r.applied)}</p>`);
  if (r.channelUpdates?.length) {
    const deliveryChip = { sent: "ok", sending: "run", failed: "bad", not_configured: "" };
    parts.push(`<details><summary>Updates sent to the passenger's ${esc(r.request.channel.replace("_", " "))} (${r.channelUpdates.length})</summary><div class="transcript" style="padding:10px 12px">${r.channelUpdates
      .map((u) => `<div class="turn"><span class="spk">${hhmm(u.at)}</span><span><span class="chip ${deliveryChip[u.delivery] ?? ""}">${esc(u.delivery.replace("_", " "))}</span> ${esc(u.reply)}${u.error ? ` <span class="note bad">${esc(u.error)}</span>` : ""}</span></div>`)
      .join("")}</div></details>`);
  }
  if (r.status === "needs_review") {
    parts.push(`<ul class="reasons">${r.reviewReasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`);
    const ids = { apply: `req-apply-${id}`, pnr: `req-newpnr-${id}`, ticket: `req-ticket-${id}`, note: `req-note-${id}` };
    const apply = draft[ids.apply] ?? "none";
    parts.push(`<div class="callbox"><h3>Resolve as a person</h3>
      <select id="${esc(ids.apply)}"><option value="none"${apply === "none" ? " selected" : ""}>Close without changing the booking</option>${r.action ? `<option value="apply"${apply === "apply" ? " selected" : ""}>Apply the agreed ${r.action.kind === "refund" ? "refund" : "move"}</option>` : ""}</select>
      ${r.action?.kind === "move" ? `<div class="row-inline"><label for="${esc(ids.pnr)}" class="note">Booking code from the airline</label><input id="${esc(ids.pnr)}" class="wide" maxlength="6" autocomplete="off" value="${esc(draft[ids.pnr] ?? "")}">
        <label for="${esc(ids.ticket)}" class="note">Ticket</label><input id="${esc(ids.ticket)}" class="wide" placeholder="000-0000000000" autocomplete="off" value="${esc(draft[ids.ticket] ?? "")}"></div>` : ""}
      <label for="${esc(ids.note)}" class="note">Note for the booking</label>
      <textarea id="${esc(ids.note)}">${esc(draft[ids.note] ?? "")}</textarea>
      <div class="row-inline"><button type="button" class="btn" data-req-resolve="${esc(id)}">Resolve</button></div></div>`);
  }
  if (r.status === "completed" || r.status === "resolved_by_human") {
    if (!r.callback || r.callback.status === "failed_to_submit") {
      parts.push(renderCallbackBox(r));
      ensureCallbackPreview(id);
    } else {
      parts.push(renderCallRecord("Result call to the passenger", r.callback));
      if (r.callbackVerdict?.kind === "follow_up") parts.push(`<ul class="reasons">${r.callbackVerdict.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`);
    }
  }
  el.innerHTML = parts.join("");
}

function renderPassengerCallBox(r) {
  const id = r.request.id;
  const p = passengerPreviews.get(id);
  const live = snap.live;
  const last4Id = `req-p-last4-${id}`;
  const blocked = p?.blockedReason;
  return `<div class="callbox ${live ? "live" : ""}">
    <h3>${live ? "CALL-E calls the passenger for real" : "Simulate CALL-E calling the passenger"}</h3>
    <p class="note">CALL-E offers every option above, gets a clear yes to any cost, and records the choice. The airline is contacted only after this call.</p>
    ${r.passengerCall?.status === "failed_to_submit" ? `<p class="note bad">Last attempt was not started: ${esc(r.passengerCall.error)}</p>` : ""}
    <dl class="kv"><dt>Destination</dt><dd class="mono">${p ? `${esc(p.destinationMasked)}${p.redirected ? ' <span class="note">(live calls always go to LIVE_DEMO_PHONE)</span>' : ""}` : "…"}</dd></dl>
    ${blocked ? `<p class="note bad">${esc(blocked)}</p>` : ""}
    ${p ? `<details><summary>What CALL-E will be told</summary><pre>${esc(p.task)}</pre></details>
    <details><summary>Result schema</summary><pre>${esc(JSON.stringify(p.resultSchema, null, 2))}</pre></details>` : ""}
    ${planCheckHtml({ kind: "intake", id }, `intake:${id}`)}
    ${live
      ? `<div class="row-inline"><label for="${esc(last4Id)}">Type the last 4 digits of the destination to confirm</label>
          <input id="${esc(last4Id)}" inputmode="numeric" maxlength="4" autocomplete="off" value="${esc(draft[last4Id] ?? "")}">
          <button type="button" class="btn live" data-req-passenger="${esc(id)}" ${blocked ? "disabled" : ""}>Place real call</button></div>`
      : `<div class="row-inline"><button type="button" class="btn" data-req-passenger="${esc(id)}" ${blocked ? "disabled" : ""}>Simulate passenger call</button></div>`}
  </div>`;
}

function renderPassengerCall(r) {
  const c = r.passengerCall;
  const o = c.outcome;
  const s = o?.structured;
  const flight = s && s.selected_flight !== "none" ? r.quote.moves.find((m) => m.flightId === s.selected_flight)?.label ?? s.selected_flight : null;
  return `<div class="outcome"><h3>CALL-E call to the passenger</h3>
    <dl class="kv">
      <dt>Status</dt><dd>${esc(c.status.replaceAll("_", " "))} <span class="muted">${esc(o?.providerStatus ?? "")}</span></dd>
      <dt>Call id</dt><dd class="mono">${esc(c.callId ?? "none")}</dd>
      <dt>Dialed</dt><dd class="mono">${esc(c.destinationMasked)}${c.redirected ? " (demo phone)" : ""}</dd>
      ${o?.confidence ? `<dt>Confidence</dt><dd>${o.confidence.score.toFixed(2)} (${esc(o.confidence.label)})</dd>` : ""}
      ${s ? `<dt>Choice</dt><dd><b>${esc(String(s.choice).replaceAll("_", " "))}</b>${flight ? ` · ${esc(flight)}` : ""}</dd>
      <dt>Cost accepted</dt><dd>${esc(String(s.fee_accepted).replaceAll("_", " "))}</dd>
      <dt>Asked for a person</dt><dd>${esc(s.human_requested)}</dd>` : ""}
    </dl>
    ${c.error ? `<p class="note bad">${esc(c.error)}</p>` : ""}
    ${s?.reason ? `<blockquote>${esc(s.reason)}</blockquote>` : ""}
    ${o?.summary ? `<p><span class="muted">Summary:</span> ${esc(o.summary)}</p>` : ""}
    ${o?.transcript?.length ? `<details open><summary>Transcript (${o.transcript.length} turns)</summary>${transcriptHtml(o.transcript, "Passenger")}</details>` : ""}
    <details><summary>What CALL-E was told</summary><pre>${esc(c.task)}</pre></details>
  </div>`;
}

async function ensurePassengerPreview(id) {
  if (passengerPreviews.has(id)) return;
  passengerPreviews.set(id, null);
  try {
    passengerPreviews.set(id, await api("/api/requests/passenger/preview", { id }));
    if (selectedRequest === id) renderRequestDetail();
  } catch (e) {
    passengerPreviews.delete(id);
    showError(e.message);
  }
}

function renderCallbackBox(r) {
  const id = r.request.id;
  const p = callbackPreviews.get(id);
  const live = snap.live;
  const last4Id = `req-cb-last4-${id}`;
  const blocked = p?.blockedReason;
  return `<div class="callbox ${live ? "live" : ""}"><h3>Optional: call the passenger with the result</h3>
    ${r.callback?.status === "failed_to_submit" ? `<p class="note bad">Last attempt was not started: ${esc(r.callback.error)}</p>` : ""}
    <dl class="kv"><dt>Destination</dt><dd class="mono">${p ? `${esc(p.destinationMasked)}${p.redirected ? ' <span class="note">(live calls always go to LIVE_DEMO_PHONE)</span>' : ""}` : "…"}</dd></dl>
    ${blocked ? `<p class="note bad">${esc(blocked)}</p>` : ""}
    ${p ? `<details><summary>What CALL-E will be told</summary><pre>${esc(p.task)}</pre></details>` : ""}
    ${live
      ? `<div class="row-inline"><label for="${esc(last4Id)}">Type the last 4 digits of the destination to confirm</label>
          <input id="${esc(last4Id)}" inputmode="numeric" maxlength="4" autocomplete="off" value="${esc(draft[last4Id] ?? "")}">
          <button type="button" class="btn live" data-req-callback="${esc(id)}" ${blocked ? "disabled" : ""}>Place real call</button></div>`
      : `<div class="row-inline"><button type="button" class="btn" data-req-callback="${esc(id)}" ${blocked ? "disabled" : ""}>Simulate result call</button></div>`}
  </div>`;
}

function renderCallRecord(title, c) {
  const o = c.outcome;
  return `<div class="outcome"><h3>${esc(title)}</h3>
    <dl class="kv">
      <dt>Status</dt><dd>${esc(c.status.replaceAll("_", " "))} <span class="muted">${esc(o?.providerStatus ?? "")}</span></dd>
      <dt>Call id</dt><dd class="mono">${esc(c.callId ?? "none")}</dd>
      <dt>Dialed</dt><dd class="mono">${esc(c.destinationMasked)}${c.redirected ? " (demo phone)" : ""}</dd>
    </dl>
    ${c.error ? `<p class="note bad">${esc(c.error)}</p>` : ""}
    ${o?.summary ? `<p><span class="muted">Summary:</span> ${esc(o.summary)}</p>` : ""}
    ${o?.transcript?.length ? `<details open><summary>Transcript (${o.transcript.length} turns)</summary>${transcriptHtml(o.transcript, "Passenger")}</details>` : ""}
    <details><summary>What CALL-E was told</summary><pre>${esc(c.task)}</pre></details>
  </div>`;
}

async function ensureCallbackPreview(id) {
  if (callbackPreviews.has(id)) return;
  callbackPreviews.set(id, null);
  try {
    callbackPreviews.set(id, await api("/api/requests/callback/preview", { id }));
    if (selectedRequest === id) renderRequestDetail();
  } catch (e) {
    callbackPreviews.delete(id);
    showError(e.message);
  }
}

function renderAirlineCallBox(r) {
  const id = r.request.id;
  const p = airlinePreviews.get(id);
  const live = snap.live;
  const last4Id = `req-last4-${id}`;
  const blocked = p?.blockedReason;
  return `<div class="callbox ${live ? "live" : ""}">
    <h3>${live ? "CALL-E calls the airline desk for real" : "Simulate CALL-E calling the airline desk"}</h3>
    <p class="note">CALL-E asks the desk to make exactly the change the passenger agreed, and never accepts a higher charge or a lower refund.</p>
    ${r.airlineCall?.status === "failed_to_submit" ? `<p class="note bad">Last attempt was not started: ${esc(r.airlineCall.error)}</p>` : ""}
    <dl class="kv"><dt>Desk</dt><dd>${esc(p?.airline ?? "…")}</dd><dt>Destination</dt><dd class="mono">${p ? `${esc(p.destinationMasked)}${p.redirected ? ' <span class="note">(live calls always go to LIVE_DEMO_PHONE)</span>' : ""}` : "…"}</dd></dl>
    ${blocked ? `<p class="note bad">${esc(blocked)}</p>` : ""}
    ${p ? `<details><summary>What CALL-E will be told</summary><pre>${esc(p.task)}</pre></details>
    <details><summary>Result schema</summary><pre>${esc(JSON.stringify(p.resultSchema, null, 2))}</pre></details>` : ""}
    ${planCheckHtml({ kind: "airline", id }, `airline:${id}`)}
    ${live
      ? `<div class="row-inline"><label for="${esc(last4Id)}">Type the last 4 digits of the destination to confirm</label>
          <input id="${esc(last4Id)}" inputmode="numeric" maxlength="4" autocomplete="off" value="${esc(draft[last4Id] ?? "")}">
          <button type="button" class="btn live" data-req-airline="${esc(id)}" ${blocked ? "disabled" : ""}>Place real call</button></div>`
      : `<div class="row-inline"><button type="button" class="btn" data-req-airline="${esc(id)}" ${blocked ? "disabled" : ""}>Simulate airline call</button></div>`}
  </div>`;
}

function renderAirlineCall(r) {
  const c = r.airlineCall;
  if (c.status === "failed_to_submit" && r.status === "confirmed_on_call") return "";
  const o = c.outcome;
  const s = o?.structured;
  return `<div class="outcome"><h3>Airline desk call</h3>
    <dl class="kv">
      <dt>Status</dt><dd>${esc(c.status.replaceAll("_", " "))} <span class="muted">${esc(o?.providerStatus ?? "")}</span></dd>
      <dt>Call id</dt><dd class="mono">${esc(c.callId ?? "none")}</dd>
      <dt>Dialed</dt><dd class="mono">${esc(c.destinationMasked)}${c.redirected ? " (demo phone)" : ""}</dd>
      <dt>Idempotency</dt><dd class="mono">${esc(c.idempotencyKey)}</dd>
      ${o?.confidence ? `<dt>Confidence</dt><dd>${o.confidence.score.toFixed(2)} (${esc(o.confidence.label)})</dd>` : ""}
      ${s ? `<dt>Outcome</dt><dd><b>${esc(String(s.outcome).replaceAll("_", " "))}</b></dd>${
        "approved_refund_amount" in s
          ? `<dt>Approved</dt><dd class="mono">${esc(s.approved_refund_amount)}</dd><dt>Reference</dt><dd class="mono">${esc(s.refund_reference)}</dd>`
          : `<dt>New code</dt><dd class="mono">${esc(s.new_booking_code)}</dd><dt>Ticket</dt><dd class="mono">${esc(s.new_ticket_number)}</dd><dt>Reference</dt><dd class="mono">${esc(s.airline_reference)}</dd>`
      }` : ""}
    </dl>
    ${s?.reason ? `<blockquote>${esc(s.reason)}</blockquote>` : ""}
    ${o?.summary ? `<p><span class="muted">Summary:</span> ${esc(o.summary)}</p>` : ""}
    ${o?.transcript?.length ? `<details open><summary>Transcript (${o.transcript.length} turns)</summary>${transcriptHtml(o.transcript, "Airline desk")}</details>` : ""}
    <details><summary>What CALL-E was told</summary><pre>${esc(c.task)}</pre></details>
  </div>`;
}

async function ensureAirlinePreview(id) {
  if (airlinePreviews.has(id)) return;
  airlinePreviews.set(id, null);
  try {
    airlinePreviews.set(id, await api("/api/requests/airline/preview", { id }));
    if (selectedRequest === id) renderRequestDetail();
  } catch (e) {
    airlinePreviews.delete(id);
    showError(e.message);
  }
}

// ------------------------------------------------------------------ events

document.addEventListener("input", (e) => {
  if (e.target.id) draft[e.target.id] = e.target.value;
});
document.addEventListener("change", (e) => {
  if (e.target.id) draft[e.target.id] = e.target.value;
  if (["req-pnr", "req-kind"].includes(e.target.id)) {
    e.target.blur();
    renderRequestForm();
  }
});

document.addEventListener("submit", (e) => {
  if (e.target.id === "request-form") {
    e.preventDefault();
    const kind = draft["req-kind"] ?? "change";
    const body = {
      pnr: $("req-pnr")?.value,
      kind,
      targetFlightId: kind === "reschedule" ? $("req-target")?.value || null : null,
      channel: $("req-channel")?.value ?? "chat",
    };
    act(async () => {
      const entry = await api("/api/requests", body);
      selectedRequest = entry.request.id;
      showToast(entry.status === "ineligible" ? "Request logged: not eligible." : "Request priced. CALL-E is ready to call the passenger.");
      document.activeElement?.blur();
    });
    return;
  }
  const form = e.target.closest("[data-report]");
  if (!form) return;
  e.preventDefault();
  const flightId = form.dataset.report;
  const data = new FormData(form);
  act(async () => {
    const choice = String(data.get("delay"));
    const reason = String(data.get("reason"));
    const cause = REASONS.find(([r]) => r === reason)?.[1] ?? "operational";
    const d = await api("/api/disruptions", {
      flightId,
      kind: choice === "cancel" ? "cancellation" : "delay",
      cause,
      delayMinutes: choice === "cancel" ? 0 : Number(choice),
      reason,
    });
    selected = null;
    previews.clear();
    snap = null;
    showToast(`${d.kind === "cancellation" ? "Cancellation" : "Delay"} reported. Every passenger's options are priced.`);
    return d;
  });
});

document.addEventListener("click", (e) => {
  const sel = e.target.closest("[data-select]");
  if (sel) {
    const [disruptionId, pnr] = sel.dataset.select.split("|");
    selected = { disruptionId, pnr };
    renderDesk();
    return;
  }
  const call = e.target.closest("[data-call]");
  if (call) {
    const [disruptionId, pnr] = call.dataset.call.split("|");
    const key = `${disruptionId}:${pnr}`;
    act(async () => {
      await api("/api/calls/start", { disruptionId, pnr, confirmLast4: draft[`last4-${key}`] });
      openCall("passenger", key, passengerName(pnr), `Flight change call · booking ${pnr}`);
    });
    return;
  }
  if (e.target.closest("[data-feed-poll]")) {
    act(() => api("/api/feed/poll", {}));
    return;
  }
  const reqSel = e.target.closest("[data-req-select]");
  if (reqSel) {
    selectedRequest = reqSel.dataset.reqSelect;
    renderRequests();
    return;
  }
  const reqPassenger = e.target.closest("[data-req-passenger]");
  if (reqPassenger) {
    const id = reqPassenger.dataset.reqPassenger;
    act(async () => {
      const r = await api("/api/requests/passenger/start", { id, confirmLast4: draft[`req-p-last4-${id}`] });
      openCall("intake", id, passengerName(r.request.pnr), `Agreeing the change · booking ${r.request.pnr}`);
    });
    return;
  }
  const reqAirline = e.target.closest("[data-req-airline]");
  if (reqAirline) {
    const id = reqAirline.dataset.reqAirline;
    act(async () => {
      const r = await api("/api/requests/airline/start", { id, confirmLast4: draft[`req-last4-${id}`] });
      openCall("airline", id, "Nusantara Air agency desk", `Making the change · booking ${r.request.pnr}`);
    });
    return;
  }
  const reqCallback = e.target.closest("[data-req-callback]");
  if (reqCallback) {
    const id = reqCallback.dataset.reqCallback;
    act(async () => {
      const r = await api("/api/requests/callback/start", { id, confirmLast4: draft[`req-cb-last4-${id}`] });
      openCall("callback", id, passengerName(r.request.pnr), `Result call · booking ${r.request.pnr}`);
    });
    return;
  }
  const reqResolve = e.target.closest("[data-req-resolve]");
  if (reqResolve) {
    const id = reqResolve.dataset.reqResolve;
    act(() =>
      api("/api/requests/resolve", {
        id,
        apply: draft[`req-apply-${id}`] === "apply",
        newPnr: draft[`req-newpnr-${id}`] ?? "",
        ticket: draft[`req-ticket-${id}`] ?? "",
        note: draft[`req-note-${id}`] ?? "",
      }),
    );
    return;
  }
  const res = e.target.closest("[data-resolve]");
  if (res) {
    const key = res.dataset.resolve;
    act(() => api("/api/calls/resolve", { key, action: draft[`action-${key}`] ?? "none", note: draft[`note-${key}`] ?? "" }));
    return;
  }
});

$("reset").addEventListener("click", () => {
  if (!confirm("Reset all demo bookings, delays, and call records?")) return;
  act(async () => {
    await api("/api/reset", {});
    selected = null;
    selectedRequest = null;
    previews.clear();
    airlinePreviews.clear();
    callbackPreviews.clear();
  });
});

load();
