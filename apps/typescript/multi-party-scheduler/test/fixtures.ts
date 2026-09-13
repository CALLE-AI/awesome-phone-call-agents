/**
 * Shared fixtures. Phone numbers come from the reserved 555-01xx range, so
 * nothing here can ring a real handset.
 *
 * Every party is callable around the clock. Calling hours are real policy and
 * they have their own tests with an injected clock: a fixture that inherits the
 * default window would pass or fail depending on the time of day the suite runs.
 *
 * The slots below are fixed calendar times, because the call scripts are asserted
 * word for word and a floating slot would move "Thursday, August 6 at 2:00 PM" and
 * the zone label with it. Fixed times need a fixed clock beside them: a slot is
 * judged against the wall clock in several places, `resume` refusing to settle a
 * confirm for a slot that has already started among them, so anything that judges
 * these slots has to be given `FIXTURE_NOW` rather than the machine's clock. The
 * two came from different sources until 2026-08-06, when the calendar passed the
 * slots and three recovery tests started failing on code nobody had touched.
 */

import { parseRequest } from "../src/config.js";
import type { CoordinationRequest, CoordinationRequestInput } from "../src/types.js";

export const PLUMBER = "+14155550101";
export const TENANT = "+14155550100";
export const SUPER = "+14155550102";

export const ANY_HOUR = { start: "00:00", end: "23:59", timezone: "UTC" } as const;

/**
 * Two days before the first slot, inside every party's calling hours, and far
 * enough from the fixture's own window (`policy.windowMinutes`) that a run and the
 * resume that finishes it are both comfortably inside it.
 */
export const FIXTURE_NOW = Date.parse("2026-08-04T09:00:00-07:00");

/** The clock the fixture's slots belong to. Pass as `now` to anything that reads one. */
export const fixtureNow = (): number => FIXTURE_NOW;

/**
 * The same instant as the provider reports it.
 *
 * A window is judged against two clocks, ours and CALL-E's, so pinning only ours
 * moves the fake server's `completed_at` out of the window and every answer comes
 * back `outside_window`. Pass this to `startFakeCalle` wherever `fixtureNow` is
 * passed to a run.
 */
export const FIXTURE_COMPLETED_AT = new Date(FIXTURE_NOW).toISOString();

export function requestInput(
  overrides: Partial<CoordinationRequestInput> = {},
): CoordinationRequestInput {
  return {
    request_id: "ash-lane-3b-leak",
    meeting: {
      purpose: "the plumbing repair at 14 Ash Lane, apartment 3B",
      location: "14 Ash Lane, apartment 3B",
      timezone: "America/Los_Angeles",
      organizer: "Ash Lane property management",
      duration_minutes: 90,
    },
    slots: [
      { id: "thu-10", start: "2026-08-06T10:00:00-07:00" },
      { id: "thu-14", start: "2026-08-06T14:00:00-07:00" },
      { id: "fri-09", start: "2026-08-07T09:00:00-07:00" },
    ],
    parties: [
      {
        id: "plumber",
        name: "Marcus Lee",
        phone: PLUMBER,
        role: "plumber",
        region: "US",
        locale: "en-US",
        consent_recorded: true,
        calling_hours: { ...ANY_HOUR },
      },
      {
        id: "tenant",
        name: "Fatima Haddad",
        phone: TENANT,
        role: "tenant",
        region: "US",
        locale: "en-US",
        consent_recorded: true,
        calling_hours: { ...ANY_HOUR },
      },
      {
        id: "superintendent",
        name: "Dana Alvarez",
        phone: SUPER,
        role: "building superintendent",
        region: "US",
        locale: "en-US",
        consent_recorded: true,
        calling_hours: { ...ANY_HOUR },
      },
    ],
    ...overrides,
  };
}

export function coordinationRequest(
  overrides: Partial<CoordinationRequestInput> = {},
): CoordinationRequest {
  return parseRequest(requestInput(overrides));
}
