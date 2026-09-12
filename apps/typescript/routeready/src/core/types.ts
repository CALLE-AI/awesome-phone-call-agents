export type YesNoUnknown = "yes" | "no" | "unknown";
export type Readiness = "ready_now" | "within_15_min" | "15_to_45_min" | "later_today" | "not_today" | "unknown";
export type Handoff = "in_person" | "guard_or_neighbor" | "none" | "unknown";
export type CashReady = "yes" | "no" | "not_applicable" | "unknown";

/** Structured result CALL-E extracts for one readiness call (see READINESS_SCHEMA). */
export interface ReadinessAnswer {
  reached_recipient: YesNoUnknown;
  readiness: Readiness;
  ready_clock_time: string;
  handoff: Handoff;
  cod_cash_ready: CashReady;
  landmark: string;
  customer_quote: string;
  quote_in_english: string;
}

export interface GeoPoint {
  id: string;
  lat: number;
  lng: number;
}

export interface Stop extends GeoPoint {
  customer: string;
  label: string;
  phone: string;
  codAmount: number | null;
  serviceMinutes: number;
  /** Latest promised delivery in minutes after shift start; null when nothing was promised. */
  windowEnd: number | null;
  firstTime: boolean;
  gated: boolean;
}

/** Simulation ground truth: what this customer would say and when they can really receive. */
export interface Truth {
  /** Minutes after shift start; null when they cannot receive today. */
  readyAt: number | null;
  reached: YesNoUnknown;
  readiness: Readiness;
  /** Clock time the customer names, "HH:MM", or "" when they name none. */
  readyClock: string;
  handoff: Handoff;
  cash: CashReady;
  landmark: string;
  quote: string;
}

export interface DayFixture {
  id: string;
  city: string;
  timezone: string;
  shiftStart: string;
  merchant: string;
  hub: GeoPoint & { label: string };
  stops: Stop[];
  truth: Record<string, Truth>;
}

export interface Travel {
  ids: string[];
  durationsSeconds: number[][];
  distancesMeters: number[][];
  shapes: Record<string, [number, number][]>;
}
