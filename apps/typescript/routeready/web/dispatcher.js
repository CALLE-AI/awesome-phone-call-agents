import { STATUS, clockFrom, escapeHtml, getDay, markLabel, onSnapshot, taka } from "/shared.js";

const day = await getDay();
const points = new Map([[day.hub.id, day.hub], ...day.stops.map((stop) => [stop.id, stop])]);
const $ = (selector) => document.querySelector(selector);
const clock = (minutes) => (minutes === null || minutes === undefined ? "…" : clockFrom(day.shiftStart, minutes));

$("#place").textContent = `${day.city} · ${day.merchant}`;

// ---- Map ----
const map = L.map("map", { zoomControl: false });
L.control.zoom({ position: "bottomleft" }).addTo(map);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
map.fitBounds(L.latLngBounds([...points.values()].map((point) => [point.lat, point.lng])).pad(0.12));

const pin = (text, className) =>
  L.divIcon({ className: "", html: `<div class="pin ${className}">${text}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
L.marker([day.hub.lat, day.hub.lng], { icon: pin("H", "hub") }).addTo(map).bindTooltip(escapeHtml(day.hub.label));
const markers = new Map(
  day.stops.map((stop) => [
    stop.id,
    { marker: L.marker([stop.lat, stop.lng]).addTo(map).bindTooltip(escapeHtml(`${stop.customer} · ${stop.label}`)), key: "" },
  ]),
);
const previousLine = L.polyline([], { color: "#94a3b8", weight: 4, dashArray: "4 8" }).addTo(map);
const routeLine = L.polyline([], { color: "#0f766e", weight: 5, opacity: 0.85 }).addTo(map);
const rider = L.marker([day.hub.lat, day.hub.lng], {
  icon: L.divIcon({ className: "", html: '<div class="rider">🛵</div>', iconSize: [38, 38], iconAnchor: [19, 19] }),
  zIndexOffset: 1000,
}).addTo(map);

function pathThrough(from, ids) {
  const path = [];
  let at = from;
  for (const id of ids) {
    const a = points.get(at);
    const b = points.get(id);
    path.push(...(day.shapes[`${at}>${id}`] ?? [[a.lat, a.lng], [b.lat, b.lng]]));
    at = id;
  }
  return path;
}

let routeVersion = 0;
let clearPrevious;

function renderMap(snap) {
  rider.setLatLng([snap.rider.lat, snap.rider.lng]);
  if (snap.routeVersion > routeVersion) {
    // Keep the old route visible for a moment so the change is easy to see.
    previousLine.setLatLngs(routeLine.getLatLngs());
    clearTimeout(clearPrevious);
    clearPrevious = setTimeout(() => previousLine.setLatLngs([]), 8000);
  }
  routeVersion = snap.routeVersion;
  routeLine.setLatLngs(pathThrough(snap.rider.from, snap.order));
  for (const stop of snap.stops) {
    const label = markLabel(stop.status, snap.order.indexOf(stop.id));
    const entry = markers.get(stop.id);
    const key = `${stop.status}:${label}`;
    if (entry.key !== key) {
      entry.marker.setIcon(pin(label, `s-${stop.status}`));
      entry.key = key;
    }
  }
}

// ---- Panels ----
function renderHeader(snap) {
  $("#clock").textContent = snap.clock;
  const mode = $("#mode");
  const live = snap.mode === "live";
  mode.textContent = snap.running ? (live ? "Live day" : "Simulated day") : snap.done ? "Day complete" : "Ready";
  mode.className = `badge ${live && snap.running ? "live" : "sim"}`;
}

function renderCall(snap) {
  const card = $("#call");
  const call = snap.call;
  if (!call) {
    card.innerHTML = `<h2>Calls</h2>
      <p class="muted">While the rider drives, RouteReady phones the next customers through CALL-E: one line, one call at a time, each customer at most once a day. Answers only change the route when the customer's own words back them up.</p>`;
    return;
  }
  const customer = snap.stops.find((stop) => stop.id === call.stopId)?.customer ?? "";
  const status =
    call.result === null
      ? '<span class="chip s-calling">On the line</span>'
      : call.verified
        ? '<span class="chip s-confirmed">Verified</span>'
        : '<span class="chip s-unverified">Unverified · route unchanged</span>';
  const lines = call.lines
    .map((line) => {
      const who = { bot: "RouteReady AI", customer: "Customer", system: "" }[line.speaker] ?? "";
      return `<div class="line ${line.speaker}">${who ? `<span>${who}</span>` : ""}<p>${escapeHtml(line.text)}</p></div>`;
    })
    .join("");
  card.innerHTML = `
    <div class="call-head">
      <h2>${call.result === null ? "Calling" : "Last call"}: ${escapeHtml(customer)}</h2>
      <span class="badge ${call.live ? "live" : "sim"}">${call.live ? "Live · CALL-E" : "Simulated"}</span>
    </div>
    <p class="muted">${escapeHtml(call.maskedPhone)} · ${escapeHtml(call.reason)}</p>
    <div class="transcript">${lines || '<p class="muted">Dialling…</p>'}</div>
    <div class="call-result">${status}${call.result ? ` <span>${escapeHtml(call.result)}</span>` : ""}</div>
    ${previousCallSummary(snap)}`;
  const transcript = card.querySelector(".transcript");
  transcript.scrollTop = transcript.scrollHeight;
}

function previousCallSummary(snap) {
  const call = snap.previousCall;
  if (!call) return "";
  const customer = snap.stops.find((stop) => stop.id === call.stopId)?.customer ?? "";
  const said = call.lines.filter((line) => line.speaker === "customer").at(-1)?.text;
  const chip = call.verified
    ? '<span class="chip s-confirmed">Verified</span>'
    : '<span class="chip s-unverified">Unverified · route unchanged</span>';
  return `<div class="previous">
      <div><span class="muted">Previous call:</span> <strong>${escapeHtml(customer)}</strong>
        <span class="badge small ${call.live ? "live" : "sim"}">${call.live ? "Live · CALL-E" : "Simulated"}</span></div>
      <div class="call-result">${chip} <span>${escapeHtml(call.result ?? "")}</span></div>
      ${said ? `<div class="quote">“${escapeHtml(said)}”</div>` : ""}
    </div>`;
}

function renderKpis(snap) {
  const m = snap.metrics;
  const b = snap.baseline;
  if (!b) {
    $("#kpis").innerHTML = '<tbody><tr><td class="muted">Run a day to compare it with the same day without calls.</td></tr></tbody>';
    return;
  }
  const rows = [
    ["Failed attempts at the door", b.failedAttempts, m.failedAttempts],
    ["Minutes waiting at doors", Math.round(b.doorWaitMinutes), Math.round(m.doorWaitMinutes)],
    ["Wasted trips avoided", 0, m.tripsAvoided],
    ["Calls placed (cost)", "0", `${m.calls} ($${(m.calls * 0.05).toFixed(2)})`],
    ["Route finished", clock(b.finishedAt), snap.done ? clock(m.finishedAt) : "in progress"],
  ];
  $("#kpis").innerHTML = `
    <thead><tr><th></th><th>Without calls</th><th>RouteReady</th></tr></thead>
    <tbody>${rows.map(([label, before, after]) => `<tr><td>${label}</td><td>${before}</td><td><strong>${after}</strong></td></tr>`).join("")}</tbody>`;
}

function renderRoute(snap) {
  const ahead = snap.order.map((id) => snap.stops.find((stop) => stop.id === id));
  const settled = snap.stops.filter((stop) => !snap.order.includes(stop.id));
  $("#route").innerHTML = [...ahead, ...settled]
    .map((stop) => {
      const position = snap.order.indexOf(stop.id);
      const eta = stop.eta && position >= 0 ? ` <span class="muted">· ETA ${stop.eta}</span>` : "";
      return `<li class="stop">
        <span class="pin s-${stop.status}">${markLabel(stop.status, position)}</span>
        <div class="who">
          <div><strong>${escapeHtml(stop.customer)}</strong> <span class="muted">${escapeHtml(stop.label)}</span></div>
          <div class="meta"><span class="chip s-${stop.status}">${STATUS[stop.status] ?? stop.status}</span>
            ${stop.note ? escapeHtml(stop.note) : ""}${eta}${stop.live ? ' <span class="badge live small">Live</span>' : ""}</div>
          ${stop.quote ? `<div class="quote">“${escapeHtml(stop.quote)}”</div>` : ""}
          ${stop.landmark ? `<div class="landmark">📍 ${escapeHtml(stop.landmark)}</div>` : ""}
        </div>
        <span class="cash">${taka(stop.codAmount)}</span>
      </li>`;
    })
    .join("");
}

function renderLog(snap) {
  $("#log").innerHTML = snap.log
    .slice()
    .reverse()
    .map((entry) => `<li class="k-${entry.kind}"><time>${entry.clock}</time><span>${escapeHtml(entry.text)}</span></li>`)
    .join("");
}

const rendered = {};
function renderIfChanged(name, value, render) {
  const key = JSON.stringify(value);
  if (rendered[name] === key) return;
  rendered[name] = key;
  render();
}

onSnapshot((snap) => {
  renderHeader(snap);
  renderMap(snap);
  renderIfChanged("call", [snap.call, snap.previousCall], () => renderCall(snap));
  renderIfChanged("kpis", [snap.metrics, snap.baseline, snap.done], () => renderKpis(snap));
  renderIfChanged("route", [snap.order, snap.stops], () => renderRoute(snap));
  renderIfChanged("log", snap.log, () => renderLog(snap));
});

// ---- Controls ----
async function post(path, body = {}) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}
const speed = () => Number($("#speed").value);

$("#run-sim").addEventListener("click", () => post("/api/run", { mode: "simulate", speed: speed() }).catch((error) => alert(error.message)));
$("#stop").addEventListener("click", () => post("/api/stop"));

const liveButton = $("#run-live");
if (!day.live.available) {
  liveButton.disabled = true;
  liveButton.title = `Live mode unavailable: ${day.live.problem}`;
}
$("#live-targets").innerHTML = day.live.targets
  .map((target) => `<li>${escapeHtml(points.get(target.stopId)?.customer ?? target.stopId)} → ${escapeHtml(target.maskedPhone)} (${escapeHtml(target.region)})</li>`)
  .join("");
$("#live-consent-text").textContent = day.live.consent;
liveButton.addEventListener("click", () => $("#live-dialog").showModal());
$("#live-form").addEventListener("submit", async (event) => {
  if (event.submitter?.value !== "start") return;
  event.preventDefault();
  $("#live-error").textContent = "";
  try {
    await post("/api/run", {
      mode: "live",
      speed: speed(),
      token: $("#live-token").value.trim(),
      consent: $("#live-consent").checked ? day.live.consent : "",
    });
    $("#live-dialog").close();
  } catch (error) {
    $("#live-error").textContent = error.message;
  }
});
