import { describe, expect, it } from "vitest";

import { canReturnToPrepare, invalidateCallApproval } from "./workflow";

describe("invalidateCallApproval", () => {
  it("invalidates confirmation and preview identity after call-relevant input changes", () => {
    expect(
      invalidateCallApproval({
        dispatchId: "dispatch-1",
        confirmed: true,
        hasResponse: true,
      }),
    ).toEqual({
      dispatchId: "",
      confirmed: false,
      clearResponse: true,
      clearPendingIntent: true,
    });
  });

  it("blocks edit navigation while a real call is in flight", () => {
    expect(canReturnToPrepare(true)).toBe(false);
    expect(canReturnToPrepare(false)).toBe(true);
  });
});
