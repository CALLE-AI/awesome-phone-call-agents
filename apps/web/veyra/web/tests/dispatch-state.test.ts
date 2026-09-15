import assert from "node:assert/strict";
import test from "node:test";

import { dispatchClaimAction } from "../lib/campaigns/dispatch-state";

test("claims only a pending call from an active campaign", () => {
  assert.equal(
    dispatchClaimAction({
      campaignStatus: "launching",
      callStatus: "pending",
      anotherCallSubmitting: false,
    }),
    "claim",
  );
});

test("defers later contacts while one provider submission is unresolved", () => {
  assert.equal(
    dispatchClaimAction({
      campaignStatus: "launched",
      callStatus: "pending",
      anotherCallSubmitting: true,
    }),
    "defer",
  );
});

test("a redelivered submitting call requires reconciliation instead of recreation", () => {
  assert.equal(
    dispatchClaimAction({
      campaignStatus: "launched",
      callStatus: "submitting",
      anotherCallSubmitting: false,
    }),
    "require_reconciliation",
  );
});

test("a paused campaign blocks every queued call", () => {
  assert.equal(
    dispatchClaimAction({
      campaignStatus: "reconciliation_required",
      callStatus: "pending",
      anotherCallSubmitting: false,
    }),
    "require_reconciliation",
  );
});

test("completed and failed call rows are idempotently skipped", () => {
  for (const callStatus of ["queued", "completed", "failed", "submission_uncertain"]) {
    assert.equal(
      dispatchClaimAction({
        campaignStatus: "launched",
        callStatus,
        anotherCallSubmitting: false,
      }),
      "skip",
    );
  }
});
