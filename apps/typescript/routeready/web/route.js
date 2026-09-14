import { STATUS, escapeHtml, markLabel, post } from "/shared.js";
import { callsScreen } from "/screens.js";

const $ = (id) => document.getElementById(id);
const config = await fetch("/api/route/config").then((response) => response.json());
const SESSION_KEY = "routeready-route-session";
const DRAFT_KEY = "routeready-route-draft";
const REGIONS = [
  ["US", "US +1"],
  ["SG", "SG +65"],
  ["AU", "AU +61"],
  ["CA", "CA +1"],
  ["GB", "GB +44"],
  ["IN", "IN +91"],
  ["BD", "BD +880"],
];

const store = {
  get(area, key) {
    try {
      return window[area].getItem(key);
    } catch {
      return null;
    }
  },
  set(area, key, value) {
    try {
      if (value === null) window[area].removeItem(key);
      else window[area].setItem(key, value);
    } catch {
      // Private windows can refuse storage; the page still works without it.
    }
  },
};

const pin = (text, className) =>
  L.divIcon({ className: "", html: `<div class="pin ${className}">${text}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
const scooter = (draggable) =>
  L.divIcon({ className: "rider-pin", html: `<div class="rider-marker ${draggable ? "draggable" : ""}">🛵</div>`, iconSize: [42, 42], iconAnchor: [21, 21] });
const tiles = (map) =>
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

// ======================================================================
// Setup
// ======================================================================
let draft = { stops: [], rider: null, source: "drag" };
try {
  draft = { ...draft, ...JSON.parse(store.get("localStorage", DRAFT_KEY) ?? "{}") };
} catch {
  // Ignore a damaged draft.
}
const saveDraft = () => store.set("localStorage", DRAFT_KEY, JSON.stringify(draft));

let setupMap = null;
let setupRider = null;
let setupPins = [];

function openSetup(message) {
  $("ride").hidden = true;
  $("setup").hidden = false;
  $("banner").hidden = !message;
  $("banner").textContent = message ?? "";
  $("consent-text").textContent = config.consent;
  $("max-stops").textContent = config.maxStops;
  if (!setupMap) initSetupMap();
  setTimeout(() => setupMap.invalidateSize(), 50);
  renderStopForms();
  renderSource();
}

function initSetupMap() {
  setupMap = L.map("setup-map", { zoomControl: true });
  tiles(setupMap);
  const points = [...draft.stops, ...(draft.rider ? [draft.rider] : [])];
  if (points.length) setupMap.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 15 });
  else setupMap.setView([40.7128, -74.006], 13);

  setupMap.on("click", (event) => {
    if (draft.stops.length >= config.maxStops) {
      $("setup-error").textContent = `You can add up to ${config.maxStops} stops.`;
      return;
    }
    const stop = { lat: event.latlng.lat, lng: event.latlng.lng, customer: "", phone: "", region: "US", label: "", cash: "" };
    draft.stops.push(stop);
    if (!draft.rider) placeRider(offset(event.latlng));
    saveDraft();
    renderStopForms();
    fillAddress(stop);
  });
  if (draft.rider) placeRider(draft.rider);
}

/** A default rider start a little south-west of the first stop, so there is distance to ride. */
function offset(latlng) {
  return { lat: latlng.lat - 0.018, lng: latlng.lng - 0.012 };
}

function placeRider(where) {
  draft.rider = { lat: where.lat, lng: where.lng };
  if (!setupRider) {
    setupRider = L.marker([where.lat, where.lng], { icon: scooter(true), draggable: true, zIndexOffset: 1000 }).addTo(setupMap);
    setupRider.on("dragend", () => {
      const { lat, lng } = setupRider.getLatLng();
      draft.rider = { lat, lng };
      saveDraft();
    });
  } else {
    setupRider.setLatLng([where.lat, where.lng]);
  }
  saveDraft();
}

async function fillAddress(stop) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${stop.lat}&lon=${stop.lng}`;
    const place = await fetch(url, { headers: { accept: "application/json" } }).then((response) => response.json());
    const a = place.address ?? {};
    const text = [a.house_number, a.road].filter(Boolean).join(" ") || place.name || (place.display_name ?? "").split(",").slice(0, 2).join(",");
    if (text && !stop.label && draft.stops.includes(stop)) {
      stop.label = text.slice(0, 80);
      saveDraft();
      renderStopForms();
    }
  } catch {
    // The address label is optional.
  }
}

function renderStopForms() {
  for (const marker of setupPins) marker.remove();
  setupPins = draft.stops.map((stop, i) => {
    const marker = L.marker([stop.lat, stop.lng], { icon: pin(String(i + 1), "planned"), draggable: true }).addTo(setupMap);
    marker.on("dragend", () => {
      const { lat, lng } = marker.getLatLng();
      Object.assign(stop, { lat, lng });
      saveDraft();
    });
    return marker;
  });
  $("no-stops").hidden = draft.stops.length > 0;
  const field = (i, name, label, value, extra = "") =>
    `<label class="${name === "customer" || name === "label" ? "wide" : ""}">${label}<input data-i="${i}" data-field="${name}" value="${escapeHtml(value)}" ${extra} /></label>`;
  $("stop-forms").innerHTML = draft.stops
    .map(
      (stop, i) => `<li class="stop-form">
        <div class="head"><span style="display:flex;gap:8px;align-items:center"><span class="badge-num">${i + 1}</span>Stop ${i + 1}</span>
          <button type="button" class="remove" data-remove="${i}">Remove</button></div>
        ${field(i, "customer", "Customer name", stop.customer, 'maxlength="40" placeholder="Who answers the phone"')}
        <label class="wide">Phone number
          <span class="phone-row">
            <input data-i="${i}" data-field="phone" value="${escapeHtml(stop.phone)}" inputmode="tel" placeholder="+14155550123" />
            <select data-i="${i}" data-field="region">${REGIONS.map(([code, text]) => `<option value="${code}" ${code === stop.region ? "selected" : ""}>${text}</option>`).join("")}</select>
          </span>
        </label>
        ${field(i, "label", "Address or note", stop.label, 'maxlength="80" placeholder="House 12, Main Street"')}
        ${field(i, "cash", "Cash to collect", stop.cash, 'maxlength="24" placeholder="Prepaid"')}
      </li>`,
    )
    .join("");
}

$("stop-forms").addEventListener("input", (event) => {
  const input = event.target.closest("[data-field]");
  if (!input) return;
  draft.stops[Number(input.dataset.i)][input.dataset.field] = input.value;
  saveDraft();
});
$("stop-forms").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (!button) return;
  draft.stops.splice(Number(button.dataset.remove), 1);
  saveDraft();
  renderStopForms();
});

$("search").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = $("search-text").value.trim();
  if (!text) return;
  $("setup-error").textContent = "";
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(text)}`;
    const [place] = await fetch(url, { headers: { accept: "application/json" } }).then((response) => response.json());
    if (!place) throw new Error("not found");
    setupMap.setView([Number(place.lat), Number(place.lon)], 16);
  } catch {
    $("setup-error").textContent = "Could not find that place. Try another search or move the map by hand.";
  }
});

function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This browser cannot share its location."));
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy }),
      (error) => reject(new Error(error.code === 1 ? "Location permission was denied." : "Could not get your location.")),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  });
}

$("locate").addEventListener("click", async () => {
  try {
    const here = await currentPosition();
    setupMap.setView([here.lat, here.lng], 16);
    placeRider(here);
  } catch (error) {
    $("setup-error").textContent = error.message;
  }
});

function renderSource() {
  for (const button of document.querySelectorAll("#source button")) button.classList.toggle("active", button.dataset.source === draft.source);
  $("source-help").textContent =
    draft.source === "gps"
      ? "The rider's position comes from this phone's GPS while the route is open. Keep the page open while riding."
      : "Test from a desk: drag 🛵 on the map, or tap the map, to move the rider. Calls start as the rider gets close.";
}
$("source").addEventListener("click", (event) => {
  const button = event.target.closest("[data-source]");
  if (!button) return;
  draft.source = button.dataset.source;
  saveDraft();
  renderSource();
});

$("go").addEventListener("click", async () => {
  const button = $("go");
  $("setup-error").textContent = "";
  button.disabled = true;
  try {
    if (draft.source === "gps") placeRider(await currentPosition());
    if (!draft.rider) throw new Error("Place the rider on the map first.");
    const repeatApproved = !$("repeat").hidden && $("repeat-ok").checked;
    const { sessionId } = await post("/api/route/start", {
      repeatApproval: repeatApproved ? config.repeatApproval : "",
      apiKey: $("api-key").value,
      consent: $("consent").checked ? config.consent : "",
      rider: draft.rider,
      stops: draft.stops,
      merchant: $("merchant").value,
      language: $("language").value,
      callAheadMinutes: Number($("call-ahead").value),
      speedKmh: Number($("speed").value),
      testCall: $("test-call").checked,
      utcOffsetMinutes: -new Date().getTimezoneOffset(),
      locationSource: draft.source,
    });
    $("api-key").value = "";
    $("repeat").hidden = true;
    $("repeat-ok").checked = false;
    store.set("sessionStorage", SESSION_KEY, sessionId);
    openRide(sessionId);
  } catch (error) {
    if (error.data?.repeat) {
      $("repeat").hidden = false;
      $("repeat-numbers").textContent = error.data.repeat.join(", ");
      $("repeat-text").textContent = error.data.approval;
      $("setup-error").textContent = "Tick the box to call these numbers again, or change the stops.";
    } else {
      $("setup-error").textContent = error.message;
    }
  } finally {
    button.disabled = false;
  }
});

// ======================================================================
// Riding
// ======================================================================
let sessionId = null;
let source = null;
let map = null;
let rider = null;
let routeLine = null;
let stopMarkers = new Map();
let dragging = false;
let watchId = null;
let lastSent = 0;
let shownToast = 0;
let latest = null;
let tab = "route";

function openRide(id) {
  sessionId = id;
  $("setup").hidden = true;
  $("ride").hidden = false;
  const stream = new EventSource(`/api/route/stream?session=${encodeURIComponent(id)}`);
  stream.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.gone) {
      stream.close();
      closeRide(data.gone);
      return;
    }
    render(data);
  };
}

function closeRide(message) {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  store.set("sessionStorage", SESSION_KEY, null);
  sessionId = null;
  openSetup(message);
}

function sendLocation(where, force = false) {
  const now = Date.now();
  if (!force && now - lastSent < 800) return;
  lastSent = now;
  post("/api/route/location", { session: sessionId, lat: where.lat, lng: where.lng, accuracy: where.accuracy ?? null }).catch(() => {});
}

function initRideMap(snap) {
  source = snap.locationSource;
  map = L.map("map", { zoomControl: false });
  tiles(map);
  const points = [...snap.stops.map((stop) => [stop.lat, stop.lng]), [snap.rider.lat, snap.rider.lng]];
  map.fitBounds(L.latLngBounds(points), { paddingTopLeft: [40, 110], paddingBottomRight: [40, 360], maxZoom: 16 });
  routeLine = L.polyline([], { color: "#0e1014", weight: 4, opacity: 0.85, dashArray: "2 9", lineCap: "round" }).addTo(map);
  stopMarkers = new Map(snap.stops.map((stop) => [stop.id, { marker: L.marker([stop.lat, stop.lng]).addTo(map), key: "" }]));
  const draggable = source === "drag";
  rider = L.marker([snap.rider.lat, snap.rider.lng], { icon: scooter(draggable), draggable, zIndexOffset: 1000 }).addTo(map);
  if (draggable) {
    rider.on("dragstart", () => (dragging = true));
    rider.on("drag", () => sendLocation(rider.getLatLng()));
    rider.on("dragend", () => {
      dragging = false;
      sendLocation(rider.getLatLng(), true);
    });
    map.on("click", (event) => {
      rider.setLatLng(event.latlng);
      sendLocation(event.latlng, true);
    });
  } else if (navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(
      (position) => sendLocation({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy }, true),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
  }
}

const minutes = (value) => (value < 1 ? "under a minute" : `about ${Math.ceil(value)} min`);
const distance = (meters) => (meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(1)} km`);
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function chip(stop) {
  const label = stop.status === "confirmed" && stop.note ? stop.note : (STATUS[stop.status] ?? stop.status);
  return `<span class="chip ${stop.status}">${escapeHtml(capitalize(label))}</span>`;
}

function render(snap) {
  latest = snap;
  if (!map) initRideMap(snap);
  const byId = new Map(snap.stops.map((stop) => [stop.id, stop]));
  const next = byId.get(snap.order[0]) ?? null;
  const call = snap.calls[0] && snap.calls[0].result === null ? snap.calls[0] : null;

  // Story line
  let title = "Route complete";
  let detail = `${snap.metrics.delivered} delivered · ${snap.metrics.calls} calls`;
  if (next && snap.door === next.id) {
    title = `At ${next.customer}'s door`;
    detail = next.cash ? `Collect ${next.cash}` : "Prepaid order";
  } else if (next) {
    title = `Riding to ${next.customer}`;
    detail = `${distance(next.metersAway)} away · ${minutes(next.minutesAway)} · arrives ${next.eta}`;
  }
  if (call) detail = `Calling ${call.customer} now`;
  $("story-title").textContent = title;
  $("story-detail").textContent = detail;

  // Map
  if (!(source === "drag" && dragging)) rider.setLatLng([snap.rider.lat, snap.rider.lng]);
  const riderAt = source === "drag" && dragging ? rider.getLatLng() : snap.rider;
  routeLine.setLatLngs([[riderAt.lat, riderAt.lng], ...snap.order.map((id) => [byId.get(id).lat, byId.get(id).lng])]);
  for (const stop of snap.stops) {
    const entry = stopMarkers.get(stop.id);
    const label = markLabel(stop.status, snap.order.indexOf(stop.id));
    const key = `${stop.status}:${label}`;
    if (entry.key !== key) {
      entry.marker.setIcon(pin(label, stop.status));
      entry.key = key;
    }
  }

  draw("sheet", [snap.order, snap.door, snap.stops, call, snap.finished, snap.callsHalted], () => ($("route-sheet").innerHTML = routeSheet(snap, next, call)));
  draw("stops", [snap.order, snap.stops], () => ($("screen-stops").innerHTML = stopsScreen(snap)));
  draw("calls", snap.calls, () => ($("screen-calls").innerHTML = callsScreen(snap)));
  draw("log", [snap.metrics, snap.log], () => ($("screen-log").innerHTML = logScreen(snap)));

  if (snap.toast && snap.toast.id !== shownToast) {
    shownToast = snap.toast.id;
    const toast = $("toast");
    toast.textContent = snap.toast.title;
    toast.className = `toast show ${snap.toast.tone}`;
    clearTimeout(render.toastTimer);
    render.toastTimer = setTimeout(() => (toast.className = "toast"), 6000);
  }
}

const drawn = {};
function draw(name, value, paint) {
  const key = JSON.stringify(value);
  if (drawn[name] === key) return;
  drawn[name] = key;
  paint();
}

function routeSheet(snap, next, call) {
  const done = snap.stops.filter((stop) => ["delivered", "failed", "removed", "revisit"].includes(stop.status)).length;
  const progress = `${done} of ${snap.stops.length} done`;
  if (!next) {
    return `<div class="handle"></div>
      <p class="sheet-label"><span>${progress}</span><span>${escapeHtml(snap.clock)}</span></p>
      <div class="next"><h3>Route complete</h3><p class="addr">${snap.metrics.delivered} delivered · ${snap.metrics.tripsAvoided} trips avoided · ${snap.metrics.calls} calls</p></div>
      ${callingLine(call)}
      <button class="end-btn" type="button" data-action="end">End route and discard the key</button>`;
  }
  const atDoor = snap.door === next.id;
  const hint = next.landmark
    ? `📍 ${escapeHtml(next.landmark)}`
    : next.handoff === "guard_or_neighbor"
      ? "🛡️ A guard or neighbour can receive it"
      : "";
  let tip = "";
  if (snap.callsHalted) {
    tip = `<p class="tip halted"><b>Calls stopped on this route.</b> ${escapeHtml(snap.callsHalted)}. Check the call in your CALL-E dashboard. You can still mark each door.</p>`;
  } else if (!next.called && !call) {
    const move = source === "drag" ? " Drag 🛵 closer to test it." : "";
    tip = `<p class="tip">RouteReady calls <b>${escapeHtml(next.customer)}</b> when the rider is ${snap.callAheadMinutes} min away. Now ${minutes(next.minutesAway)}.${move}</p>`;
  }
  return `<div class="handle"></div>
    <p class="sheet-label"><span>${atDoor ? "At the door" : "Next stop"} · ${progress}</span><span>${atDoor ? escapeHtml(snap.clock) : `ETA ${escapeHtml(next.eta ?? "")}`}</span></p>
    <div class="next">
      <div class="next-head">
        <div class="next-who">
          <p class="order">${escapeHtml(next.order)} · ${escapeHtml(next.maskedPhone)}</p>
          <h3>${escapeHtml(next.customer)}</h3>
          <p class="addr">${escapeHtml(next.label)}</p>
        </div>
        ${chip(next)}
      </div>
      ${hint ? `<p class="hint">${hint}</p>` : ""}
      <p class="pay">${next.cash ? `Collect ${escapeHtml(next.cash)}` : "Prepaid"}</p>
      <div class="actions">
        <button class="done" type="button" data-finish="delivered" data-stop="${next.id}">Delivered</button>
        <button class="missed" type="button" data-finish="nobody_home" data-stop="${next.id}">Nobody home</button>
      </div>
    </div>
    ${callingLine(call)}${tip}`;
}

function callingLine(call) {
  if (!call) return "";
  const heard = call.lines.filter((line) => line.speaker !== "system").at(-1)?.text ?? call.lines.at(-1)?.text ?? "Dialling…";
  return `<div class="calling live">
      <span class="wave"><i></i><i></i><i></i><i></i></span>
      <span class="calling-text"><b>Calling ${escapeHtml(call.customer)} · live</b> · ${escapeHtml(heard)}</span>
    </div>`;
}

function stopsScreen(snap) {
  const ahead = snap.order.map((id) => snap.stops.find((stop) => stop.id === id));
  const settled = snap.stops.filter((stop) => !snap.order.includes(stop.id));
  const row = (stop, position) => `
    <li class="stop-row ${position < 0 ? "settled" : ""}">
      <span class="badge-num ${stop.status}">${markLabel(stop.status, position)}</span>
      <div style="min-width:0">
        <div class="order-ref">${escapeHtml(stop.order)} · ${escapeHtml(stop.maskedPhone)} (${escapeHtml(stop.region)})</div>
        <div class="name">${escapeHtml(stop.customer)}</div>
        <div class="addr">${escapeHtml(stop.label)}</div>
        <div class="meta">${chip(stop)}${stop.eta && position >= 0 ? `<span class="muted">ETA ${escapeHtml(stop.eta)} · ${distance(stop.metersAway)}</span>` : ""}</div>
        ${stop.note && stop.status === "unverified" ? `<div class="quote">${escapeHtml(capitalize(stop.note))}</div>` : ""}
        ${stop.quote ? `<div class="quote">“${escapeHtml(stop.quote)}”</div>` : ""}
      </div>
      <span class="cash">${stop.cash ? escapeHtml(stop.cash) : "Prepaid"}</span>
    </li>`;
  return `<h2>Stops</h2><ul class="list">${ahead.map((stop, i) => row(stop, i)).join("")}${settled.map((stop) => row(stop, -1)).join("")}</ul>`;
}

function logScreen(snap) {
  const m = snap.metrics;
  const log = snap.log
    .slice()
    .reverse()
    .map((entry) => `<div class="log-item ${entry.kind}"><time>${escapeHtml(entry.clock)}</time><span>${escapeHtml(entry.text)}</span></div>`)
    .join("");
  return `<h2>Today</h2>
    <div class="kpis">
      <div class="kpi lead"><b>${m.delivered}</b><span>delivered</span></div>
      <div class="kpi"><b>${m.tripsAvoided}</b><span>wasted trips avoided</span></div>
      <div class="kpi"><b>${m.nobodyHome}</b><span>nobody home</span></div>
      <div class="kpi"><b>${m.calls}</b><span>CALL-E calls placed</span></div>
    </div>
    <div class="panel"><h3>What happened</h3>${log}</div>
    <button class="end-btn" type="button" data-action="end">End route and discard the key</button>`;
}

function showTab(name) {
  tab = name;
  for (const screen of document.querySelectorAll("#ride .screen")) screen.classList.toggle("active", screen.id === `screen-${name}`);
  for (const button of document.querySelectorAll("#tabbar button")) button.classList.toggle("active", button.dataset.tab === name);
  if (name === "route" && map) setTimeout(() => map.invalidateSize(), 30);
}
$("tabbar").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-tab]");
  if (button) showTab(button.dataset.tab);
});

async function endRoute() {
  const busy = latest?.lineBusy ? " The call on the line will still finish, because CALL-E has no cancel." : "";
  if (!confirm(`End this route? Your API key is discarded and no new calls start.${busy}`)) return;
  await post("/api/route/end", { session: sessionId }).catch(() => {});
  closeRide("Route ended. Your API key was discarded.");
}
$("end").addEventListener("click", endRoute);

document.addEventListener("click", (event) => {
  if (event.target.closest('[data-action="end"]')) return void endRoute();
  const finish = event.target.closest("[data-finish]");
  if (finish) post("/api/route/finish", { session: sessionId, stopId: finish.dataset.stop, outcome: finish.dataset.finish }).catch((error) => alert(error.message));
});

// ======================================================================
// Start: rejoin a route this tab already started, otherwise show setup.
// ======================================================================
const saved = store.get("sessionStorage", SESSION_KEY);
if (saved) openRide(saved);
else openSetup(null);
