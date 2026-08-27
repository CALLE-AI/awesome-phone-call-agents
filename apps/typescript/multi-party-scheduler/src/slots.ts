/**
 * Slot handling.
 *
 * Two rules here matter. Times are spoken in one declared IANA timezone, never
 * in a zone guessed from a phone number or a locale. And people say "option two"
 * on a phone far more reliably than they say a date, so every slot carries an
 * option number and that is what the call asks for.
 */

import type { Slot, SlotInput } from "./types.js";

export const MIN_SLOTS = 2;
export const MAX_SLOTS = 4;

export class SlotError extends Error {}

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/;

/** The offset the given instant actually has in the given zone, as +HH:MM. */
export function zoneOffset(instantMs: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset",
  }).formatToParts(new Date(instantMs));
  const name = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  const match = /GMT([+-]\d{2}:\d{2})?/.exec(name);
  if (match === null) {
    throw new SlotError(`Cannot read a UTC offset for timezone ${timezone}.`);
  }
  return match[1] ?? "+00:00";
}

function declaredOffset(start: string): string {
  if (start.endsWith("Z")) {
    return "+00:00";
  }
  return start.slice(-6);
}

/** Read a slot time out loud in the meeting timezone. */
export function spokenTime(instantMs: number, timezone: string, option: number): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(instantMs));
  return `option ${option}, ${formatted}`;
}

export function parseSlots(inputs: SlotInput[], timezone: string): Slot[] {
  if (!Array.isArray(inputs) || inputs.length < MIN_SLOTS || inputs.length > MAX_SLOTS) {
    throw new SlotError(
      `slots must list between ${MIN_SLOTS} and ${MAX_SLOTS} options. A call cannot read a calendar out loud.`,
    );
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new SlotError(`meeting.timezone must be an IANA name such as America/Los_Angeles, got ${timezone}.`);
  }

  const parsed = inputs.map((input, index) => {
    if (typeof input?.id !== "string" || input.id.trim().length === 0) {
      throw new SlotError(`slots[${index}].id must be a non-empty string.`);
    }
    if (typeof input.start !== "string" || !ISO_WITH_OFFSET.test(input.start)) {
      throw new SlotError(
        `slots[${index}].start must be ISO 8601 with an offset, for example 2026-08-06T10:00:00-07:00.`,
      );
    }
    const startMs = Date.parse(input.start);
    if (Number.isNaN(startMs)) {
      throw new SlotError(`slots[${index}].start is not a real instant.`);
    }
    const actual = zoneOffset(startMs, timezone);
    if (declaredOffset(input.start) !== actual) {
      throw new SlotError(
        `slots[${index}].start carries offset ${declaredOffset(input.start)} but ${timezone} is ${actual} at that instant. Fix the request rather than letting a call read the wrong time.`,
      );
    }
    return { id: input.id.trim(), startMs, start: input.start };
  });

  const ids = new Set(parsed.map((slot) => slot.id));
  if (ids.size !== parsed.length) {
    throw new SlotError("slots must have unique ids.");
  }
  const starts = new Set(parsed.map((slot) => slot.startMs));
  if (starts.size !== parsed.length) {
    throw new SlotError("slots must be distinct instants.");
  }

  return [...parsed]
    .sort((left, right) => left.startMs - right.startMs)
    .map((slot, index) => ({
      id: slot.id,
      option: index + 1,
      start: slot.start,
      startMs: slot.startMs,
      spoken: spokenTime(slot.startMs, timezone, index + 1),
    }));
}

export function slotByOption(slots: Slot[], option: number): Slot | undefined {
  return slots.find((slot) => slot.option === option);
}

export function slotById(slots: Slot[], id: string): Slot | undefined {
  return slots.find((slot) => slot.id === id);
}

/** Keep only the options that are still feasible, in slot order. */
export function intersect(feasible: Slot[], options: number[]): Slot[] {
  const wanted = new Set(options);
  return feasible.filter((slot) => wanted.has(slot.option));
}

/** The earliest slot still feasible. Ties cannot happen, instants are distinct. */
export function chooseSlot(feasible: Slot[]): Slot | null {
  return feasible.length === 0 ? null : feasible[0]!;
}
