import { escapeHtml, onSnapshot, taka } from "/shared.js";

const $ = (selector) => document.querySelector(selector);
let voice = false;
let lastVersion = null;
let lastNext = null;
let bannerTimer;

// Browsers only allow speech after a tap, so voice starts off.
$("#voice").addEventListener("click", () => {
  voice = !voice;
  $("#voice").textContent = voice ? "🔊 Voice on" : "🔈 Voice off";
  speak("Voice instructions on.");
});

function speak(text) {
  if (!voice || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

function readiness(stop) {
  if (stop.status === "confirmed") return { text: stop.note.charAt(0).toUpperCase() + stop.note.slice(1), tone: "good" };
  if (stop.status === "calling") return { text: "Calling the customer…", tone: "wait" };
  if (stop.status === "unverified") return { text: "Not confirmed: no answer on the call", tone: "warn" };
  return { text: "Not confirmed yet", tone: "neutral" };
}

onSnapshot((snap) => {
  $("#r-clock").textContent = snap.clock;
  const byId = new Map(snap.stops.map((stop) => [stop.id, stop]));
  const nextId = snap.order[0] ?? null;
  const next = nextId ? byId.get(nextId) : null;
  if (!next) {
    $("#card").innerHTML = `<p class="label">Route</p><h1>${snap.done ? "Route complete" : "Waiting for the route"}</h1>`;
    $("#then").textContent = "";
    lastVersion = snap.routeVersion;
    return;
  }

  const ready = readiness(next);
  const cash =
    next.codAmount === null ? "Prepaid" : `Collect ${taka(next.codAmount)}${next.cash === "yes" ? " · cash ready" : ""}`;
  $("#card").innerHTML = `
    <p class="label">${snap.rider.moving ? "Heading to" : "Next stop"}</p>
    <h1>${escapeHtml(next.customer)}</h1>
    <p class="address">${escapeHtml(next.label)}</p>
    <p class="ready ${ready.tone}">${escapeHtml(ready.text)}</p>
    ${next.landmark ? `<p class="hint">📍 ${escapeHtml(next.landmark)}</p>` : ""}
    ${next.handoff === "guard_or_neighbor" ? '<p class="hint">🛡️ Guard or neighbour can receive</p>' : ""}
    <p class="cash">${escapeHtml(cash)}</p>`;
  const then = snap.order.slice(1, 4).map((id) => escapeHtml(byId.get(id)?.customer ?? id));
  $("#then").innerHTML = then.length ? `Then: ${then.join(" → ")}` : "Last stop";

  const announcement = `Next stop: ${next.customer}, ${next.label}. ${ready.text}.`;
  if (lastVersion !== null && snap.routeVersion > lastVersion) {
    $("#banner").hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => ($("#banner").hidden = true), 6000);
    speak(`Route updated. ${announcement}`);
  } else if (lastNext !== null && nextId !== lastNext) {
    speak(announcement);
  }
  lastVersion = snap.routeVersion;
  lastNext = nextId;
});
