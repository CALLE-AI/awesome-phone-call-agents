import { STATUS, clockFrom, escapeHtml, markLabel, taka } from "/shared.js";

const initial = (name) => escapeHtml((name ?? "?").charAt(0).toUpperCase());

function chip(stop) {
  const label = stop.status === "confirmed" && stop.note ? stop.note : (STATUS[stop.status] ?? stop.status);
  return `<span class="chip ${stop.status}">${escapeHtml(label)}</span>`;
}

/** Bottom sheet of the Route screen: trip progress, next stop, current call. */
export function routeSheet(snap) {
  const byId = new Map(snap.stops.map((stop) => [stop.id, stop]));
  const next = snap.order[0] ? byId.get(snap.order[0]) : null;
  const { rider } = snap;
  const trip =
    next && rider.remainingKm !== null
      ? `<div class="trip"><span>${rider.remainingKm.toFixed(1)} km</span>
           <span class="muted">${Math.ceil(rider.remainingMinutes ?? 0)} min away</span>
           <span>${escapeHtml(rider.arriveClock ?? "")}</span></div>
         <div class="progress"><i style="width:${Math.round((rider.progress ?? 0) * 100)}%"></i></div>`
      : `<div class="trip"><span>${escapeHtml(snap.story.title)}</span><span class="muted">${escapeHtml(snap.clock)}</span></div>
         <div class="progress"><i style="width:0%"></i></div>`;

  const card = next
    ? `<div class="stop-card">
         <div class="row">
           <div class="avatar">${initial(next.customer)}</div>
           <div style="flex:1;min-width:0">
             <div class="name">${escapeHtml(next.customer)}</div>
             <div class="addr">${escapeHtml(next.label)}</div>
           </div>
           ${chip(next)}
         </div>
         <div class="facts">
           ${next.landmark ? `<span class="fact">📍 ${escapeHtml(next.landmark)}</span>` : ""}
           ${next.handoff === "guard_or_neighbor" ? `<span class="fact">🛡️ Guard can receive</span>` : ""}
           <span class="fact cash">${next.codAmount === null ? "Prepaid" : `Collect ${taka(next.codAmount)}`}</span>
         </div>
       </div>`
    : `<div class="stop-card"><div class="name">${snap.done ? "Route complete" : "No stop ahead"}</div>
         <div class="addr">${escapeHtml(snap.story.detail)}</div></div>`;

  const rest = snap.order.slice(1, 5).map((id) => `<span>${escapeHtml(byId.get(id)?.customer ?? id)}</span>`);
  const upNext = rest.length ? `<div class="up-next">${rest.join("")}</div>` : "";
  return `<div class="handle"></div>${trip}${card}${callingStrip(snap)}${upNext}`;
}

function callingStrip(snap) {
  const call = snap.calls[0];
  if (!call || call.result !== null) return "";
  const said = call.lines.filter((line) => line.speaker === "customer").at(-1)?.text;
  const heard = said ?? call.lines.filter((line) => line.speaker === "bot").at(-1)?.text ?? "Dialling…";
  return `<div class="calling-strip ${call.live ? "live" : ""}">
      <div class="wave"><i></i><i></i><i></i><i></i></div>
      <div style="min-width:0">
        <div class="who">Calling ${escapeHtml(call.customer)} ${call.live ? '<span class="chip live">Live</span>' : ""}</div>
        <div class="said">${escapeHtml(heard)}</div>
      </div>
    </div>`;
}

/** Stops screen: what is ahead, then what is settled. */
export function stopsScreen(snap) {
  const ahead = snap.order.map((id) => snap.stops.find((stop) => stop.id === id)).filter(Boolean);
  const settled = snap.stops.filter((stop) => !snap.order.includes(stop.id));
  const row = (stop, position) => `
    <li class="stop-row ${position < 0 ? "settled" : ""}">
      <span class="badge-num ${stop.status}">${markLabel(stop.status, position)}</span>
      <div style="min-width:0">
        <div class="name">${escapeHtml(stop.customer)}</div>
        <div class="addr">${escapeHtml(stop.label)}</div>
        <div class="meta">${chip(stop)}${stop.eta && position >= 0 ? `<span class="muted">ETA ${escapeHtml(stop.eta)}</span>` : ""}
          ${stop.live ? '<span class="chip live">Live call</span>' : ""}</div>
        ${stop.quote ? `<div class="quote">“${escapeHtml(stop.quote)}”</div>` : ""}
        ${stop.landmark ? `<div class="landmark">📍 ${escapeHtml(stop.landmark)}</div>` : ""}
      </div>
      <span class="cash">${taka(stop.codAmount)}</span>
    </li>`;
  return `<h2>Today's stops</h2>
    <ul class="list">${ahead.map((stop, i) => row(stop, i)).join("")}${settled.map((stop) => row(stop, -1)).join("")}</ul>`;
}

/** Calls screen: the call on the line, then every earlier call. */
export function callsScreen(snap) {
  if (!snap.calls.length) {
    return `<h2>Calls ahead</h2>
      <div class="call-card"><div class="who">No calls yet</div>
        <p class="muted">While you ride, RouteReady phones the customers you are about to reach: one line, one call at a time, each customer at most once a day.</p>
      </div>`;
  }
  const card = (call) => {
    const onLine = call.result === null;
    const outcome = onLine
      ? '<span class="chip calling">On the line</span>'
      : call.verified
        ? `<span class="chip confirmed">Answer used</span><span>${escapeHtml(call.result)}</span>`
        : `<span class="chip failed">Route unchanged</span><span>${escapeHtml(call.result)}</span>`;
    const lines = call.lines
      .map((line) => `<div class="bubble ${line.speaker}">${escapeHtml(line.text)}</div>`)
      .join("");
    return `<div class="call-card ${onLine ? "on-line" : ""}">
        <div class="head">
          <div style="min-width:0">
            <div class="who">${escapeHtml(call.customer)}</div>
            <div class="why">${escapeHtml(call.startedAt)} · ${escapeHtml(call.maskedPhone)} · ${escapeHtml(call.reason)}</div>
          </div>
          <span class="chip ${call.live ? "live" : ""}">${call.live ? "Live · CALL-E" : "Simulated"}</span>
        </div>
        <div class="transcript">${lines || '<div class="bubble system">Dialling…</div>'}</div>
        <div class="outcome">${outcome}</div>
      </div>`;
  };
  return `<h2>Calls ahead</h2><div class="list">${snap.calls.map(card).join("")}</div>`;
}

/** Today screen: what the calls changed, against the same day without them. */
export function todayScreen(snap, day) {
  const m = snap.metrics;
  const b = snap.baseline;
  const clock = (minutes) => clockFrom(day.shiftStart, minutes);
  const saved = b && b.finishedAt !== null && m.finishedAt !== null ? Math.round(b.finishedAt - m.finishedAt) : null;
  const kpis = `
    <div class="kpis">
      <div class="kpi lead"><b>${m.failedAttempts}</b><span>failed attempts${b ? ` · ${b.failedAttempts} without calls` : ""}</span></div>
      <div class="kpi"><b>${m.tripsAvoided}</b><span>wasted trips avoided</span></div>
      <div class="kpi"><b>${m.delivered}</b><span>delivered</span></div>
      <div class="kpi"><b>${m.calls}</b><span>calls · $${(m.calls * 0.05).toFixed(2)} at $0.05 each</span></div>
    </div>`;
  const compare = `
    <div class="panel">
      <h3>Same day, with and without calls</h3>
      <div class="log-item"><time>Finish</time><span>${b && b.finishedAt !== null ? clock(b.finishedAt) : "—"} without calls · <strong>${m.finishedAt !== null ? clock(m.finishedAt) : "in progress"}</strong> with RouteReady${saved !== null ? ` · ${saved} min earlier` : ""}</span></div>
      <div class="log-item"><time>Waiting</time><span>${b ? Math.round(b.doorWaitMinutes) : "—"} min at doors without calls · <strong>${Math.round(m.doorWaitMinutes)} min</strong> with RouteReady</span></div>
      <div class="log-item"><time>Ridden</time><span>${m.kilometres.toFixed(1)} km</span></div>
    </div>`;
  const log = snap.log
    .slice()
    .reverse()
    .map((entry) => `<div class="log-item ${entry.kind}"><time>${escapeHtml(entry.clock)}</time><span>${escapeHtml(entry.text)}</span></div>`)
    .join("");
  const again = snap.done || !snap.running
    ? `<button class="cta" data-action="restart" style="margin-top:12px"><span>Run the day again</span><span>↻</span></button>`
    : "";
  return `<h2>Today</h2>${kpis}${compare}<div class="panel"><h3>What RouteReady did</h3>${log}</div>${again}`;
}
