// src/domain/booking.ts — pure helpers over BookingValue / ResolvedDateTime.
// Importable by the gate (no I/O).

import type { BookingValue, Intent, ResolvedDateTime } from "./types.js";

/** The value a successful booking would write (PRD §6.1). */
export function expectedTarget(
  intent: Intent,
  intendedValue: BookingValue,
  originalHoldValue: BookingValue,
): BookingValue {
  return intent === "confirm" ? originalHoldValue : intendedValue;
}

/** Exact match on date + time + timezone (PRD §6.2 E3 — no rounding, service_type not compared). */
export function equalsDateTime(a: ResolvedDateTime, b: BookingValue): boolean {
  return (
    a.date === b.appointment_date &&
    a.time === b.appointment_time &&
    a.timezone === b.timezone
  );
}

export function resolvedToBookingValue(a: ResolvedDateTime, serviceType: string): BookingValue {
  return {
    appointment_date: a.date,
    appointment_time: a.time,
    timezone: a.timezone,
    service_type: serviceType,
  };
}
