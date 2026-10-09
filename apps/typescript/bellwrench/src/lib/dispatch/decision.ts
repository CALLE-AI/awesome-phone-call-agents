import type { DispatchDecision, VendorCallResult } from "./types";

const MAX_NOTE_LENGTH = 500;

type DecisionInput = {
  dispatchId: string;
  kind: DispatchDecision["kind"];
  vendorId?: string;
  results: VendorCallResult[];
  note?: string;
  now?: () => Date;
};

export function createDispatchDecision(input: DecisionInput): DispatchDecision {
  const note = (input.note ?? "").trim().slice(0, MAX_NOTE_LENGTH);
  const recordedAt = (input.now ?? (() => new Date()))().toISOString();

  if (input.kind === "no_dispatch") {
    return {
      dispatchId: input.dispatchId,
      kind: "no_dispatch",
      vendorId: null,
      vendorName: null,
      callId: null,
      note,
      recordedAt,
      bookingStatus: "not_booked",
    };
  }

  const selected = input.results.find(
    (result) => result.vendorId === input.vendorId,
  );
  if (!selected || selected.status !== "verified") {
    throw new Error("Only a verified vendor result can be selected");
  }

  return {
    dispatchId: input.dispatchId,
    kind: "vendor_selected",
    vendorId: selected.vendorId,
    vendorName: selected.vendorName,
    callId: selected.callId,
    note,
    recordedAt,
    bookingStatus: "not_booked",
  };
}

export function saveDispatchDecision(
  storage: Pick<Storage, "setItem">,
  decision: DispatchDecision,
) {
  storage.setItem(
    `bellwrench.dispatch-decision.${decision.dispatchId}`,
    JSON.stringify(decision),
  );
}
