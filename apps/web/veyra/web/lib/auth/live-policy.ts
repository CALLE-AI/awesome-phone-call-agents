import type { CallMode } from "@/lib/calle/safety";

export const LIVE_OPERATOR_ROLE = "live_operator";

export class LiveAccessError extends Error {
  readonly status = 403;

  constructor() {
    super("This account is not authorized for live calling or live-deployment results");
    this.name = "LiveAccessError";
  }
}

export function hasLiveOperatorRole(role: string | null | undefined): boolean {
  return role === LIVE_OPERATOR_ROLE;
}

export function assertResultsOperatorRole(role: string | null | undefined): void {
  if (!hasLiveOperatorRole(role)) throw new LiveAccessError();
}

export function assertLiveOperatorRole(
  role: string | null | undefined,
  mode: CallMode,
): void {
  if (mode === "live") assertResultsOperatorRole(role);
}
