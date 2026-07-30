import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConfigError, POLICY_LIMITS, parseRequest, resolveCodeKey } from "../src/config.js";
import { approvalRequest, BOB_PHONE, requestInput } from "./fixtures.js";

function expectConfigError(input: unknown, fragment: string): void {
  assert.throws(
    () => parseRequest(input),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError, `expected ConfigError, got ${String(error)}`);
      assert.match(error.message, new RegExp(fragment, "i"));
      return true;
    },
  );
}

test("a valid request resolves policy defaults", () => {
  const request = approvalRequest();
  assert.equal(request.policy.mode, "single");
  assert.equal(request.policy.binding, "code_from_request");
  assert.equal(request.policy.windowSeconds, POLICY_LIMITS.windowSeconds.default);
  assert.equal(request.approvers.length, 1);
});

test("an approver id that could become a path or a key separator is refused", () => {
  expectConfigError(
    requestInput({ approvers: [{ ...requestInput().approvers[0]!, id: "../alice" }] }),
    "approvers\\[0\\].id must be 2 to 64 characters",
  );
  expectConfigError(
    requestInput({ approvers: [{ ...requestInput().approvers[0]!, id: "a" }] }),
    "approvers\\[0\\].id must be 2 to 64 characters",
  );
});

test("a phone number that is not E.164 is refused", () => {
  expectConfigError(requestInput({ approvers: [{ ...requestInput().approvers[0]!, phone: "415-555-0100" }] }), "E.164");
});

test("an approver who is not enrolled for the environment is refused", () => {
  expectConfigError(
    requestInput({
      approvers: [{ ...requestInput().approvers[0]!, authorized_for: ["staging"] }],
    }),
    "not authorized for production",
  );
});

test("a window longer than ten minutes is refused", () => {
  expectConfigError(requestInput({ policy: { window_seconds: 1800 } }), "between 60 and 600");
});

test("a per-call timeout longer than the window is refused", () => {
  expectConfigError(
    requestInput({ policy: { window_seconds: 120, per_call_timeout_seconds: 240 } }),
    "must not exceed",
  );
});

test("dual control needs two approvers", () => {
  expectConfigError(requestInput({ policy: { mode: "dual" } }), "at least two enrolled approvers");
});

test("two approvers on one handset is refused", () => {
  const first = requestInput().approvers[0]!;
  expectConfigError(
    requestInput({
      policy: { mode: "dual" },
      approvers: [first, { ...first, id: "bob", name: "Bob" }],
    }),
    "unique phone numbers",
  );
});

test("dual control with two enrolled approvers is accepted", () => {
  const first = requestInput().approvers[0]!;
  const request = parseRequest(
    requestInput({
      policy: { mode: "dual" },
      approvers: [first, { ...first, id: "bob", name: "Bob", phone: BOB_PHONE }],
    }),
  );
  assert.equal(request.policy.mode, "dual");
  assert.equal(request.approvers.length, 2);
});

test("a summary too long to read on a call is refused", () => {
  expectConfigError(
    requestInput({ change: { ...requestInput().change, summary: "x".repeat(700) } }),
    "characters or fewer",
  );
});

test("a missing request id or change field is refused", () => {
  expectConfigError({ change: requestInput().change, approvers: requestInput().approvers }, "request_id");
  expectConfigError(
    requestInput({ change: { ...requestInput().change, environment: "" } }),
    "change.environment",
  );
});

test("code_from_request will not run without shared key material", () => {
  assert.throws(
    () => resolveCodeKey({ binding: "code_from_request" }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError, `expected ConfigError, got ${String(error)}`);
      assert.match(error.message, /CALLE_APPROVAL_CODE_KEY/);
      assert.match(error.message, /--code-key-file/);
      return true;
    },
  );
  // The phrase is spoken on the call, so it is not a secret an operator has to hold.
  assert.equal(resolveCodeKey({ binding: "liveness_phrase" }), null);
  assert.equal(resolveCodeKey({ binding: "code_from_request", env: "k".repeat(32) })?.length, 32);
  assert.throws(
    () => resolveCodeKey({ binding: "code_from_request", env: "too short" }),
    /128 bits/,
  );
});

test("a key file other accounts can read is refused before the key is read", () => {
  const path = join(mkdtempSync(join(tmpdir(), "pag-key-")), "approval-code.key");
  writeFileSync(path, `${"k".repeat(40)}\n`, "utf8");
  chmodSync(path, 0o644);
  assert.throws(
    () => resolveCodeKey({ binding: "code_from_request", file: path }),
    /0644/,
  );
  chmodSync(path, 0o600);
  const key = resolveCodeKey({ binding: "code_from_request", file: path });
  assert.equal(key?.toString("utf8"), "k".repeat(40));
});
