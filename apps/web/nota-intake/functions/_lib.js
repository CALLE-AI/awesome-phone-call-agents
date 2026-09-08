// Shared helpers for the Nota.Lawyer intake Pages Functions.
import { REGIONS } from "./_regions.js";
export { REGIONS };

export function regionFor(e164) {
  const digits = (e164 || "").replace(/[^\d]/g, "");
  for (const len of [3, 2, 1]) {
    const cc = digits.slice(0, len);
    if (REGIONS[cc]) return { cc, ...REGIONS[cc] };
  }
  return null;
}

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}
