"use strict";

let snap = null;
let selected = null; // { disruptionId, pnr }
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

async function load() {
  try {
    snap = await api("/api/state");
    showError("");
  } catch (e) {
    showError(`Could not reach the desk server: ${e.message}`);
    return;
  }
  render();
  clearTimeout(pollTimer);
  const running = snap.disruptions.some((d) => d.bookings.some((b) => b.entry && (b.entry.status === "in_progress" || b.entry.status === "submitted")));
  if (running) pollTimer = setTimeout(load, snap.live ? 5000 : 1500);
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
  renderMode();
  renderBoard();
  renderDesk();
}

function renderMode() {
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
        ? `<span class="status-delayed">DELAYED ${hm(d.delayMinutes)} → ${hhmm(d.newDeparture)}</span>`
        : `<span class="status-ontime">ON TIME</span>`;
      let action = "";
      if (f.passengers > 0 && !d) {
        const delayId = `delay-${f.id}`;
        const reasonId = `reason-${f.id}`;
        const delay = draft[delayId] ?? "240";
        const reason = draft[reasonId] ?? "a late inbound aircraft";
        const opt = (v, label, cur) => `<option value="${esc(v)}"${String(cur) === String(v) ? " selected" : ""}>${esc(label)}</option>`;
        action = `<form data-report="${esc(f.id)}">
          <label class="sr" for="${esc(delayId)}">Delay</label>
          <select id="${esc(delayId)}" name="delay">${[45, 90, 120, 240, 360].map((m) => opt(m, `+${hm(m)}`, delay)).join("")}</select>
          <label class="sr" for="${esc(reasonId)}">Reason</label>
          <select id="${esc(reasonId)}" name="reason">${["a late inbound aircraft", "weather at the destination", "a technical inspection", "air traffic control restrictions"].map((r) => opt(r, r, reason)).join("")}</select>
          <button type="submit">Report delay</button>
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

function renderDesk() {
  const desk = $("desk");
  if (!snap.disruptions.length) {
    desk.hidden = true;
    selected = null;
    return;
  }
  desk.hidden = false;
  if (!selected) {
    const d = snap.disruptions[0];
    selected = { disruptionId: d.id, pnr: d.bookings[0].pnr };
  }
  $("events").innerHTML = snap.disruptions
    .map((d) => {
      const c = d.bookings[0]?.quote.changeCase;
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
              <span>Keep <b>free</b></span>
              <span>Move ${cheapest === null ? "<b>no seats</b>" : `from <b>${idr(cheapest)}</b>`}</span>
              <span>Refund <b>${idr(b.quote.refund.amount)}</b></span>
            </span>
          </button>`;
        })
        .join("");
      return `<article class="event">
        <div class="event-head">
          <h2>${esc(d.flight.code)} to ${esc(d.flight.destinationCity)} delayed ${hm(d.delayMinutes)}</h2>
          <div class="facts">
            <span>New departure <b>${hhmm(d.newDeparture)}</b></span>
            <span>Cause <b>${esc(d.reason)}</b></span>
            <span><b>${c === "involuntary" ? "Involuntary" : "Voluntary"}</b> pricing (${c === "involuntary" ? "≥" : "<"} ${hm(d.bookings[0]?.quote.thresholdMinutes ?? 120)})</span>
            <span><b>${handled}</b> handled · <b>${review}</b> need a person</span>
          </div>
        </div>
        ${rows}
      </article>`;
    })
    .join("");
  renderDetail();
}

function quoteTable(title, lines, totalLabel, total, extraFirst) {
  const body = [
    extraFirst ? `<tr><td>${esc(extraFirst[0])}</td><td></td><td class="amt">${idr(extraFirst[1])}</td></tr>` : "",
    ...lines.map((l) => `<tr><td>${esc(l.party)}</td><td>${esc(l.label)}</td><td class="amt">${l.amount === 0 ? "0" : idr(l.amount)}</td></tr>`),
  ].join("");
  return `<table class="quote">
    <thead><tr><th colspan="2">${esc(title)}</th><th class="amt">${esc(totalLabel)}</th></tr></thead>
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

  const options = [
    `<table class="quote"><thead><tr><th colspan="2">1 · Keep delayed flight (${hhmm(q.keep.newDeparture)})</th><th class="amt">Cost</th></tr></thead><tbody><tr class="total"><td colspan="2">No change to the ticket</td><td class="amt">${idr(0)}</td></tr></tbody></table>`,
    ...q.moves.map((m) => quoteTable(`2 · Move to ${m.label} (${m.seatsAvailable} seats)`, m.lines, "Passenger pays", m.total)),
    quoteTable("3 · Cancel and refund", q.refund.lines, "Refund", q.refund.amount, ["Fare paid", q.refund.gross]),
  ].join("");

  el.innerHTML = `
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
    ${entry && entry.status !== "failed_to_submit" ? renderEntry(entry, b, key) : renderCallBox(d, b, key, entry)}
  `;
  if (!entry || entry.status === "failed_to_submit") ensurePreview(d.id, b.pnr, key);
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
    const opts = [["none", "Close without changing the booking"], ["keep", "Keep on delayed flight"], ...entry.quote.moves.map((m) => [`move:${m.id}`, `Move to ${m.label} (${idr(m.total)})`]), ["refund", `Refund ${idr(entry.quote.refund.amount)}`]];
    parts.push(`<div class="callbox"><h3>Resolve as a person</h3>
      <label for="${esc(actId)}" class="note">After contacting the passenger yourself</label>
      <select id="${esc(actId)}">${opts.map(([v, l]) => `<option value="${esc(v)}"${cur === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
      <label for="${esc(noteId)}" class="note">Note for the booking</label>
      <textarea id="${esc(noteId)}">${esc(draft[noteId] ?? "")}</textarea>
      <div class="row-inline"><button type="button" class="btn" data-resolve="${esc(key)}">Resolve</button></div></div>`);
  }
  if (o?.transcript?.length) {
    parts.push(`<details><summary>Transcript (${o.transcript.length} turns)</summary><div class="transcript" style="padding:10px 12px">${o.transcript
      .map((t) => `<div class="turn"><span class="spk">${esc(t.speaker)}</span><span>${esc(t.text)}</span></div>`)
      .join("")}</div></details>`);
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

// ------------------------------------------------------------------ events

document.addEventListener("input", (e) => {
  if (e.target.id) draft[e.target.id] = e.target.value;
});
document.addEventListener("change", (e) => {
  if (e.target.id) draft[e.target.id] = e.target.value;
});

document.addEventListener("submit", (e) => {
  const form = e.target.closest("[data-report]");
  if (!form) return;
  e.preventDefault();
  const flightId = form.dataset.report;
  const data = new FormData(form);
  act(async () => {
    const d = await api("/api/disruptions", { flightId, delayMinutes: Number(data.get("delay")), reason: String(data.get("reason")) });
    selected = null;
    previews.clear();
    snap = null;
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
    act(() => api("/api/calls/start", { disruptionId, pnr, confirmLast4: draft[`last4-${key}`] }));
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
    previews.clear();
  });
});

load();
