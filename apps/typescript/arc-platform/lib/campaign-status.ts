/**
 * What a campaign is actually doing, worked out rather than remembered.
 *
 * `Campaign.status` is a String written once, at launch, and never touched
 * again: there is not a single `campaign.update` in the app. StepReview sent
 * "ACTIVE" the moment the button was pressed, so a campaign with nothing
 * booked, no rate confirmed on any call and a flight three weeks away
 * announced itself as running - and would still say ACTIVE a year after its
 * flight ended, because nothing was ever going to change it.
 *
 * A stored status can only be true by luck. This derives it from the things
 * that are true by construction: whether a line is booked, and where today
 * sits against the flight.
 *
 * Three stored values still win, because they record a DECISION rather than a
 * guess at progress - somebody archived, cancelled or paused this deliberately,
 * and no amount of item state should argue with them.
 */
export type StatusKey =
  | "DRAFT" | "PLANNED" | "SCHEDULED" | "ACTIVE"
  | "COMPLETED" | "PAUSED" | "CANCELLED" | "ARCHIVED";

export interface DerivedStatus {
  key: StatusKey;
  label: string;
  /** Why, in the few words a badge tooltip can hold. */
  note: string;
}

/** A decision someone made. Never overridden by derivation. */
const DECIDED: Record<string, DerivedStatus> = {
  ARCHIVED:  { key: "ARCHIVED",  label: "Archived",  note: "Archived by hand." },
  CANCELLED: { key: "CANCELLED", label: "Cancelled", note: "Cancelled by hand." },
  PAUSED:    { key: "PAUSED",    label: "Paused",    note: "Paused by hand." },
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function deriveCampaignStatus(input: {
  storedStatus: string | null | undefined;
  /** ItemStatus values for this campaign's plan lines. */
  itemStatuses: string[];
  flightStart: Date | string | null;
  flightEnd: Date | string | null;
  now?: Date;
}): DerivedStatus {
  const decided = DECIDED[(input.storedStatus ?? "").toUpperCase()];
  if (decided) return decided;

  const items = input.itemStatuses ?? [];
  if (items.length === 0) {
    return { key: "DRAFT", label: "Draft", note: "No plan lines yet." };
  }

  const booked = items.filter((s) => s === "BOOKED").length;
  if (booked === 0) {
    /* The common case, and the one that used to read ACTIVE. A plan exists and
       has been approved; nothing has been bought. */
    return {
      key: "PLANNED",
      label: "Planned",
      note: `${items.length} line${items.length === 1 ? "" : "s"} planned, none booked yet.`,
    };
  }

  const asDate = (v: Date | string | null) => (v == null ? null : new Date(v));
  const start = asDate(input.flightStart);
  const end = asDate(input.flightEnd);
  const today = startOfDay(input.now ?? new Date());
  const of = `${booked} of ${items.length} line${items.length === 1 ? "" : "s"} booked`;

  /* Dates are compared by DAY. A flight ending today is still running today,
     and a campaign does not become "completed" at one minute past midnight of
     the day it is still on air. */
  if (end && startOfDay(end) < today) {
    return { key: "COMPLETED", label: "Completed", note: `Flight ended. ${of}.` };
  }
  if (start && startOfDay(start) > today) {
    return { key: "SCHEDULED", label: "Scheduled", note: `${of}. Flight has not started.` };
  }
  return { key: "ACTIVE", label: "Active", note: `${of}. On air.` };
}
