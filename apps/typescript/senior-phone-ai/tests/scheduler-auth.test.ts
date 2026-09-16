import assert from "node:assert/strict";
import test from "node:test";

import { authorizeSchedulerRequest } from "../lib/scheduler/auth";

const secret = "scheduler-secret-with-at-least-32-characters";

test("host scheduler requires the exact server-only bearer secret", () => {
  assert.equal(authorizeSchedulerRequest(new Headers({ Authorization: `Bearer ${secret}` }), secret), true);
  assert.equal(authorizeSchedulerRequest(new Headers({ Authorization: "Bearer wrong-secret" }), secret), false);
  assert.equal(authorizeSchedulerRequest(new Headers(), secret), false);
  assert.equal(authorizeSchedulerRequest(new Headers({ Authorization: "Bearer short" }), "short"), false);
});
