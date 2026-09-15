import { STATUS, clockFrom, escapeHtml, markLabel, taka } from "/shared.js";

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

const DOOR = { delivering: ["confirmed", "Delivering"], waiting: ["calling", "Waiting at the door"], failed: ["failed", "Nobody ready"] };

function doorChip(state) {
  const [className, label] = DOOR[state];
  return `<span class="chip ${className}">${label}</span>`;
}

function chip(stop) {
  const label = stop.status === "confirmed" && stop.note ? stop.note : (STATUS[stop.status] ?? stop.status);
  return `<span class="chip ${stop.status}">${escapeHtml(capitalize(label))}</span>`;
}

/** Route screen sheet: the one stop that matters now, and the call in progress. */
export function routeSheet(snap) {
  const byId = new Map(snap.stops.map((stop) => [stop.id, stop]));
  const atDoor = snap.door;
  const next = byId.get(atDoor?.stopId ?? snap.order[0]) ?? null;
  const delivered = snap.stops.filter((stop) => stop.status === "delivered").length;
  const progress = `${delivered} of ${snap.stops.length} delivered`;
  if (!next) {
    return `<div class="handle"></div>
      <p class="sheet-label"><span>${progress}</span><span>${escapeHtml(snap.clock)}</span></p>
      <div class="next"><h3>${snap.done ? "Route complete" : "No stop ahead"}</h3>
        <p class="addr">${escapeHtml(snap.story.detail)}</p></div>`;
  }
  const { rider } = snap;
  let when = next.eta ? `ETA ${escapeHtml(next.eta)}` : "";
  if (atDoor) when = escapeHtml(snap.clock);
  else if (rider.target === next.id && rider.remainingMinutes !== null) {
    when = `${Math.ceil(rider.remainingMinutes)} min · ${escapeHtml(rider.arriveClock)}`;
  }
  const hint = next.landmark
    ? `📍 ${escapeHtml(next.landmark)}`
    : next.handoff === "guard_or_neighbor"
      ? "🛡️ A guard or neighbour can receive it"
      : "";
  return `<div class="handle"></div>
    <p class="sheet-label"><span>${atDoor ? "At the door" : "Next stop"} · ${progress}</span><span>${when}</span></p>
    <div class="next">
      <div class="next-head">
        <div class="next-who">
          <p class="order">${escapeHtml(next.order)}</p>
          <h3>${escapeHtml(next.customer)}</h3>
          <p class="addr">${escapeHtml(next.label)}</p>
        </div>
        ${atDoor ? doorChip(atDoor.state) : chip(next)}
      </div>
      ${hint ? `<p class="hint">${hint}</p>` : ""}
      <p class="pay">${next.codAmount === null ? "Prepaid" : `Collect ${taka(next.codAmount)}`}</p>
    </div>
    ${callingLine(snap)}`;
}

function callingLine(snap) {
  const call = snap.calls[0];
  if (!call || call.result !== null) return "";
  const heard = call.lines.filter((line) => line.speaker !== "system").at(-1)?.text ?? "Dialling…";
  return `<div class="calling ${call.live ? "live" : ""}">
      <span class="wave"><i></i><i></i><i></i><i></i></span>
      <span class="calling-text"><b>Calling ${escapeHtml(call.customer)}${call.live ? " · live" : ""}</b> · ${escapeHtml(heard)}</span>
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
        <div class="order-ref">${escapeHtml(stop.order)}</div>
        <div class="name">${escapeHtml(stop.customer)}</div>
        <div class="addr">${escapeHtml(stop.label)}</div>
        <div class="meta">${chip(stop)}${stop.eta && position >= 0 ? `<span class="muted">ETA ${escapeHtml(stop.eta)}</span>` : ""}
          ${stop.live ? '<span class="chip live">Live call</span>' : ""}</div>
        ${stop.quote ? `<div class="quote">“${escapeHtml(stop.quote)}”</div>` : ""}
      </div>
      <span class="cash">${taka(stop.codAmount)}</span>
    </li>`;
  return `<h2>Today's stops</h2>
    <ul class="list">${ahead.map((stop, i) => row(stop, i)).join("")}${settled.map((stop) => row(stop, -1)).join("")}</ul>`;
}

/** Calls screen: the call on the line, then every earlier call. */
export function callsScreen(snap) {
  if (!snap.calls.length) {
    return `<h2>Calls</h2>
      <div class="call-card"><div class="who">No calls yet</div>
        <p class="muted">While you ride, RouteReady phones the customers you are about to reach, one at a time.</p>
      </div>`;
  }
  const card = (call) => {
    const onLine = call.result === null;
    const outcome = onLine
      ? '<span class="chip calling">On the line</span>'
      : call.verified
        ? `<span class="chip confirmed">Route updated</span><span>${escapeHtml(capitalize(call.result))}</span>`
        : `<span class="chip">No change</span><span>${escapeHtml(capitalize(call.result))}</span>`;
    const lines = call.lines.map((line) => `<div class="bubble ${line.speaker}">${escapeHtml(line.text)}</div>`).join("");
    return `<div class="call-card ${onLine ? "on-line" : ""}">
        <div class="head">
          <div style="min-width:0">
            <div class="who">${escapeHtml(call.customer)}</div>
            <div class="why">${escapeHtml(call.startedAt)} · ${escapeHtml(call.maskedPhone)}</div>
          </div>
          <span class="chip ${call.live ? "live" : ""}">${call.live ? "Live · CALL-E" : "Simulated"}</span>
        </div>
        <div class="transcript">${lines || '<div class="bubble system">Dialling…</div>'}</div>
        <div class="outcome">${outcome}</div>
      </div>`;
  };
  return `<h2>Calls</h2><div class="list">${snap.calls.map(card).join("")}</div>`;
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
      <div class="kpi"><b>${m.calls}</b><span>calls · $${(m.calls * 0.05).toFixed(2)}</span></div>
    </div>`;
  const compare = `
    <div class="panel">
      <h3>Same day, with and without calls</h3>
      <div class="log-item"><time>Finish</time><span>${b && b.finishedAt !== null ? clock(b.finishedAt) : "—"} without calls · <strong>${m.finishedAt !== null ? clock(m.finishedAt) : "in progress"}</strong> with RouteReady${saved !== null ? ` · ${saved} min earlier` : ""}</span></div>
      <div class="log-item"><time>Waiting</time><span>${b ? Math.round(b.doorWaitMinutes) : "—"} min at doors without calls · <strong>${Math.round(m.doorWaitMinutes)} min</strong> with RouteReady</span></div>
    </div>`;
  const log = snap.log
    .slice()
    .reverse()
    .map((entry) => `<div class="log-item ${entry.kind}"><time>${escapeHtml(entry.clock)}</time><span>${escapeHtml(entry.text)}</span></div>`)
    .join("");
  const again =
    snap.done || !snap.running
      ? `<button class="cta" data-action="restart" style="margin-top:12px"><span>Run the day again</span><span>↻</span></button>`
      : "";
  const halted = snap.callsHalted
    ? `<div class="panel"><h3>Calls stopped for today</h3><p class="muted">${escapeHtml(snap.callsHalted)}. Check the call in the CALL-E dashboard before calling anyone else.</p></div>`
    : "";
  return `<h2>Today</h2>${halted}${kpis}${compare}<div class="panel"><h3>What happened</h3>${log}</div>${again}`;
}
