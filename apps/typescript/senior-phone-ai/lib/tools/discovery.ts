export type DiscoveryKind = "news" | "local_events";

export interface DiscoveryContext {
  readonly location?: string;
  readonly timezone: string;
}

export interface DiscoveryRequest {
  readonly context: DiscoveryContext;
  readonly kind: DiscoveryKind;
  readonly query: string;
}

function bounded(name: string, value: string | undefined, maximum: number): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) return undefined;
  if (trimmed.length > maximum) throw new Error(`${name} is too long`);
  return trimmed;
}

export function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value.includes("/") || value === "UTC";
  } catch {
    return false;
  }
}

export function discoveryClarification(
  kind: DiscoveryKind,
  context: Partial<DiscoveryContext>,
): string | undefined {
  if (!context.timezone || !isIanaTimezone(context.timezone)) {
    return "Ask the caller which city or timezone they mean before searching.";
  }
  if (kind === "local_events" && !context.location?.trim()) {
    return "Ask the caller for their city or suburb before searching for nearby events.";
  }
  return undefined;
}

function localDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function sevenDayLocalWindow(timezone: string, now = new Date()): {
  readonly endDate: string;
  readonly startDate: string;
} {
  if (!isIanaTimezone(timezone)) throw new Error("timezone must be a valid IANA timezone");
  return {
    startDate: localDate(now, timezone),
    endDate: localDate(new Date(now.getTime() + 6 * 24 * 60 * 60 * 1_000), timezone),
  };
}

export function buildDiscoveryQuery(request: DiscoveryRequest, now = new Date()): string {
  const query = bounded("query", request.query, 220);
  const location = bounded("location", request.context.location, 160);
  const clarification = discoveryClarification(request.kind, request.context);
  if (!query || clarification) throw new Error(clarification ?? "query is required");
  const window = sevenDayLocalWindow(request.context.timezone, now);
  if (request.kind === "news") {
    return [
      query,
      location ? `Relevant location: ${location}.` : undefined,
      `As of ${window.startDate} in ${request.context.timezone}.`,
      "Return only current reporting, state publication dates, prefer primary or well-established sources, and flag conflicting or developing claims.",
    ].filter(Boolean).join(" ");
  }
  return [
    query,
    `Near ${location}; ${window.startDate} through ${window.endDate} in ${request.context.timezone}.`,
    "Use current official council, library, venue, or community listings.",
    "Give up to 3 results with date/time, venue, address, source URL, and say availability needs confirmation unless confirmed.",
    "Exclude dates outside the window; do not guess.",
  ].join(" ");
}
