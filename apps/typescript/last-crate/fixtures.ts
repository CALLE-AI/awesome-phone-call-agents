import { readFileSync } from "node:fs";
import { time, minutes } from "./workflow.ts";
const archive = JSON.parse(
  readFileSync(
    new URL("./response-fixtures/templates.json", import.meta.url),
    "utf8",
  ),
);
/** Hydrates explicitly synthetic JSON templates. Real recordings are never rewritten here. */
export function fixtureCall(
  role: string,
  input: any,
  offer: any,
  partner: any,
) {
  const template = archive.templates[`${input.scenario}-${role}`];
  if (!template) throw Error("No response fixture for this scenario.");
  const values: any = {
    quantity: role === "donor" ? input.quantity : offer.quantity,
    ready: input.ready,
    cutoff: role === "donor" ? input.cutoff : offer.cutoff,
    donor: input.donor,
    arrival:
      role === "partner"
        ? time(Math.min(minutes(offer.cutoff), partner.earliest + 5))
        : "",
    lateArrival: role === "partner" ? time(minutes(offer.cutoff) + 15) : "",
  };
  function hydrate(value: any): any {
    if (typeof value === "string") {
      const exact = value.match(/^\{\{(\w+)\}\}$/);
      if (exact) return values[exact[1]];
      return value.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key]));
    }
    if (Array.isArray(value)) return value.map(hydrate);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, hydrate(v)]),
      );
    return value;
  }
  return hydrate(template);
}
