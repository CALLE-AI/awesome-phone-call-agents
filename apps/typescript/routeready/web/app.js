import { escapeHtml, getDay, onSnapshot, post } from "/shared.js";
import { callsScreen, routeSheet, stopsScreen, todayScreen } from "/screens.js";

const day = await getDay();
const points = new Map([[day.hub.id, day.hub], ...day.stops.map((stop) => [stop.id, stop])]);
const $ = (id) => document.getElementById(id);

let tab = new URLSearchParams(location.search).get("tab") ?? "route";
let pace = "normal";
let shownToast = 0;
let routeVersion = 0;
let ghostTimer;

// ---------- map ----------
const map = L.map("map", { zoomControl: false });
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
const allPoints = [...points.values()].map((point) => [point.lat, point.lng]);
const fit = () => map.fitBounds(L.latLngBounds(allPoints), { paddingTopLeft: [26, 96], paddingBottomRight: [26, 300] });
fit();

const pin = (text, className) =>
  L.divIcon({ className: "", html: `<div class="pin ${className}">${text}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
L.marker([day.hub.lat, day.hub.lng], { icon: pin("H", "hub") }).addTo(map);
const markers = new Map(day.stops.map((stop) => [stop.id, { marker: L.marker([stop.lat, stop.lng]).addTo(map), key: "" }]));
const ghostLine = L.polyline([], { color: "#9aa3af", weight: 4, dashArray: "3 8" }).addTo(map);
const routeLine = L.polyline([], { color: "#0e1014", weight: 5, opacity: 0.9, lineJoin: "round" }).addTo(map);
const rider = L.marker([day.hub.lat, day.hub.lng], {
  icon: L.divIcon({ className: "rider-pin", html: '<div class="rider-marker">🛵</div>', iconSize: [42, 42], iconAnchor: [21, 21] }),
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

// ---------- rendering ----------
const drawn = {};
function draw(name, value, render) {
  const key = JSON.stringify(value);
  if (drawn[name] === key) return;
  drawn[name] = key;
  render();
}

function render(snap) {
  $("story-title").textContent = snap.paused ? `Paused · ${snap.story.title}` : snap.story.title;
  $("story-detail").textContent = snap.story.detail;
  $("pause").hidden = !snap.started || snap.done;
  $("pause").innerHTML = snap.paused
    ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/></svg>';
  $("start").hidden = snap.started;
  $("start-sub").textContent = `${day.stops.length} stops in ${day.city} · shift starts ${day.shiftStart}`;
  $("start-live").disabled = !snap.liveAvailable;
  $("start-note").textContent = snap.liveAvailable
    ? "Live calls are set up on this server."
    : "Live calls are off, so the day runs with scripted customers.";

  rider.setLatLng([snap.rider.lat, snap.rider.lng]);
  if (snap.routeVersion > routeVersion) {
    ghostLine.setLatLngs(routeLine.getLatLngs());
    clearTimeout(ghostTimer);
    ghostTimer = setTimeout(() => ghostLine.setLatLngs([]), 9000);
  }
  routeVersion = snap.routeVersion;
  routeLine.setLatLngs(pathThrough(snap.rider.from, snap.order));
  for (const stop of snap.stops) {
    const position = snap.order.indexOf(stop.id);
    const label = { delivered: "✓", failed: "✕", removed: "–", revisit: "↺" }[stop.status] ?? (position >= 0 ? position + 1 : "·");
    const entry = markers.get(stop.id);
    const key = `${stop.status}:${label}`;
    if (entry.key !== key) {
      entry.marker.setIcon(pin(label, stop.status));
      entry.key = key;
    }
  }

  draw("sheet", [snap.order, snap.rider, snap.calls[0], snap.story, snap.done], () => {
    $("route-sheet").innerHTML = routeSheet(snap);
  });
  draw("stops", [snap.order, snap.stops], () => {
    $("screen-stops").innerHTML = stopsScreen(snap);
  });
  draw("calls", snap.calls, () => {
    $("screen-calls").innerHTML = callsScreen(snap);
  });
  draw("today", [snap.metrics, snap.baseline, snap.log, snap.done, snap.running], () => {
    $("screen-today").innerHTML = todayScreen(snap, day);
  });

  if (snap.toast && snap.toast.id !== shownToast) {
    shownToast = snap.toast.id;
    const toast = $("toast");
    $("toast-title").textContent = snap.toast.title;
    $("toast-detail").textContent = snap.toast.detail;
    toast.className = `toast show ${snap.toast.tone}`;
    clearTimeout(render.toastTimer);
    render.toastTimer = setTimeout(() => (toast.className = "toast"), 6000);
  }
  for (const button of document.querySelectorAll("#pace button")) {
    button.classList.toggle("active", button.dataset.pace === (snap.started ? snap.pace : pace));
  }
}

onSnapshot(render);

// ---------- navigation ----------
function showTab(name) {
  tab = name;
  for (const screen of document.querySelectorAll(".screen")) screen.classList.toggle("active", screen.id === `screen-${name}`);
  for (const button of document.querySelectorAll("#tabbar button")) button.classList.toggle("active", button.dataset.tab === name);
  if (name === "route") {
    map.invalidateSize();
    fit();
  }
}
$("tabbar").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-tab]");
  if (button) showTab(button.dataset.tab);
});
showTab(tab);

// ---------- controls ----------
const fail = (error) => alert(error.message);

$("start-sim").addEventListener("click", () => post("/api/run", { mode: "simulate", pace }).catch(fail));
$("pause").addEventListener("click", (event) => {
  const resume = event.currentTarget.innerHTML.includes("M8 5v14");
  post(resume ? "/api/resume" : "/api/pause").catch(fail);
});
$("pace").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-pace]");
  if (!button) return;
  pace = button.dataset.pace;
  for (const other of document.querySelectorAll("#pace button")) other.classList.toggle("active", other === button);
  post("/api/pace", { pace }).catch(() => {});
});
document.addEventListener("click", (event) => {
  if (event.target.closest('[data-action="restart"]')) post("/api/run", { mode: "simulate", pace }).then(() => showTab("route")).catch(fail);
});

// ---------- live calls ----------
const modal = $("live-modal");
$("live-targets").innerHTML = day.live.targets
  .map((target) => `${escapeHtml(points.get(target.stopId)?.customer ?? target.stopId)} → ${escapeHtml(target.maskedPhone)} (${escapeHtml(target.region)})`)
  .join("<br />");
$("live-consent-text").textContent = day.live.consent;
$("start-live").addEventListener("click", () => (modal.hidden = false));
$("live-cancel").addEventListener("click", () => (modal.hidden = true));
$("live-go").addEventListener("click", async () => {
  $("live-error").textContent = "";
  try {
    await post("/api/run", {
      mode: "live",
      pace,
      token: $("live-token").value.trim(),
      consent: $("live-consent").checked ? day.live.consent : "",
    });
    modal.hidden = true;
    showTab("route");
  } catch (error) {
    $("live-error").textContent = error.message;
  }
});
