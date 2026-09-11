import type { DayFixture } from "../core/types.js";
import type { EngineEvent } from "./engine.js";

/** One line of plain text for an event log, or null for events a log skips. */
export function describeEvent(event: EngineEvent, day: DayFixture): string | null {
  const name = (id: string) => day.stops.find((stop) => stop.id === id)?.customer ?? id;
  switch (event.type) {
    case "plan":
      return event.at === 0 ? `Morning route: ${event.order.map(name).join(" -> ")}` : null;
    case "call_started":
      return `Calling ${name(event.stopId)} (${event.reason})`;
    case "call_line":
      return event.line.speaker === "customer" ? `${name(event.stopId)}: "${event.line.text}"` : null;
    case "call_result":
      return event.verified
        ? `${name(event.stopId)}: ${event.note}`
        : `${name(event.stopId)}: unverified, route unchanged (${event.note})`;
    case "reordered":
      return `Re-ordered, saves ${Math.round(event.savedMinutes)} min: ${event.after.map(name).join(" -> ")}`;
    case "delivered":
      return `Delivered to ${name(event.stopId)}${event.waited > 0 ? ` after waiting ${Math.round(event.waited)} min` : ""}`;
    case "failed_attempt":
      return `Failed attempt at ${name(event.stopId)}: ${event.reason}`;
    case "call_error":
      return `${name(event.stopId)}: ${event.message}`;
    case "day_done":
      return "Route finished";
    case "leg":
      return null;
  }
}
