import type { Action, Booking } from "./types.ts";

export type GdsSubmission =
  | { kind: "accepted" }
  /** The portal refused the change. Workflow B then asks the airline desk by phone. */
  | { kind: "rejected"; code: string; message: string };

/**
 * Stand-in for the airline B2B portal or GDS. A real integration would submit the
 * reissue or refund here; the demo only decides whether the portal accepts it.
 */
export interface Gds {
  submit(booking: Booking, action: Action): GdsSubmission;
}

export class FakeGds implements Gds {
  submit(booking: Booking, action: Action): GdsSubmission {
    if (action.kind === "move" && booking.simulatedGds === "reject_reschedule") {
      return {
        kind: "rejected",
        code: "REISSUE_NOT_PERMITTED",
        message: `The portal refused to reissue ticket ${booking.ticket}: the fare basis cannot be reissued through the B2B channel.`,
      };
    }
    if (action.kind === "refund" && booking.simulatedGds === "reject_refund") {
      return {
        kind: "rejected",
        code: "REFUND_NOT_PERMITTED",
        message: `The portal refused to refund ticket ${booking.ticket}: the refund must be approved by the airline.`,
      };
    }
    return { kind: "accepted" };
  }
}
