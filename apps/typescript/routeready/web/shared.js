export async function getDay() {
  const response = await fetch("/api/day");
  if (!response.ok) throw new Error("Could not load the day");
  return response.json();
}

/** Calls `handler` with every snapshot the server pushes; EventSource reconnects on its own. */
export function onSnapshot(handler) {
  const source = new EventSource("/api/stream");
  source.onmessage = (event) => handler(JSON.parse(event.data));
  return source;
}

export async function post(path, body = {}) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}

export const STATUS = {
  planned: "Not called yet",
  calling: "Calling now",
  confirmed: "Confirmed",
  unverified: "No answer",
  revisit: "Revisit later",
  removed: "Not today",
  delivered: "Delivered",
  failed: "Failed attempt",
};

/** Marker text: position in the route, or a symbol once the stop is settled. */
export function markLabel(status, position) {
  const settled = { delivered: "✓", failed: "✕", removed: "–", revisit: "↺" }[status];
  return settled ?? (position >= 0 ? String(position + 1) : "·");
}

export function clockFrom(shiftStart, minutes) {
  const [hours, mins] = shiftStart.split(":").map(Number);
  const total = Math.round(hours * 60 + mins + minutes) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function taka(amount) {
  return amount === null ? "Prepaid" : `Tk ${Number(amount).toLocaleString("en-US")}`;
}

/** Everything that came from a call or a fixture is escaped before it reaches the page. */
export function escapeHtml(value) {
  const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value ?? "").replace(/[&<>"']/g, (char) => entities[char]);
}
