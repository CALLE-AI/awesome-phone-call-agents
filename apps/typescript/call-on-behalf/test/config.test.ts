import assert from "node:assert/strict";
import test from "node:test";
import { ConfigError, LIMITS, parseRequest } from "../src/config.js";
import { errandInput, errandRequest } from "./fixtures.js";

function expectError(input: unknown, fragment: string): void {
  assert.throws(
    () => parseRequest(input),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError, `expected ConfigError, got ${String(error)}`);
      assert.match(error.message, new RegExp(fragment, "i"));
      return true;
    },
  );
}

test("a valid errand resolves policy defaults", () => {
  const request = errandRequest();
  assert.equal(request.policy.language, "en-US");
  assert.equal(request.policy.leaveVoicemail, false);
  assert.equal(request.policy.perCallTimeoutSeconds, 300);
  assert.equal(request.policy.minConfidence, LIMITS.minConfidence.default);
  assert.equal(request.questions.length, 3);
  assert.equal(request.authorizedWindows.length, 2);
});

test("a number that is not E.164 is refused", () => {
  expectError(errandInput({ callee: { ...errandInput().callee, phone: "(415) 555-0122" } }), "E.164");
});

test("saying where the number came from is required", () => {
  const callee = { ...errandInput().callee } as Record<string, unknown>;
  delete callee.published_source;
  expectError(errandInput({ callee: callee as never }), "callee.published_source");
});

test("a reason for delegating the call is required", () => {
  expectError(
    errandInput({ on_behalf_of: { name: "Fatima Haddad" } as never }),
    "reason_for_delegation",
  );
});

test("a payment card in the budget is refused", () => {
  expectError(
    errandInput({
      disclosure: [{ key: "card", label: "card on file", value: "4111 1111 1111 1111" }],
    }),
    "will not read that out",
  );
});

test("a password or a national identifier in the budget is refused", () => {
  expectError(
    errandInput({ disclosure: [{ key: "portal", label: "portal password", value: "hunter2" }] }),
    "password",
  );
});

test("a detail pasted into a question is refused before any call", () => {
  expectError(
    errandInput({
      questions: [{ id: "ssn", text: "Do you have her file under 123-45-6789?", answer: "yes_no" }],
    }),
    "detail nobody authorized",
  );
});

test("an authorized detail inside a question is fine", () => {
  const request = parseRequest(
    errandInput({
      questions: [{ id: "plan", text: "Do you take Blue Shield PPO?", answer: "yes_no" }],
    }),
  );
  assert.equal(request.questions.length, 1);
});

test("a bare date in a question is allowed, it is only a warning", () => {
  const request = parseRequest(
    errandInput({
      questions: [{ id: "form", text: "Did the form from 2026-08-01 arrive?", answer: "yes_no" }],
    }),
  );
  assert.equal(request.questions[0]!.id, "form");
});

test("accepting a time needs windows that say which times", () => {
  const input = errandInput();
  delete input.authorized_windows;
  expectError(input, "authorized_windows must say which times");
});

test("a window that ends before it starts is refused", () => {
  expectError(
    errandInput({
      authorized_windows: [{ from: "2026-08-12T17:00:00-07:00", to: "2026-08-12T09:00:00-07:00" }],
    }),
    "must start before it ends",
  );
});

test("a window without an offset is refused, because it would need guessing", () => {
  expectError(
    errandInput({ authorized_windows: [{ from: "2026-08-12T09:00", to: "2026-08-12T17:00" }] }),
    "ISO 8601 with an offset",
  );
});

test("a phone call is not an interview and not a data file", () => {
  const question = errandInput().questions[0]!;
  expectError(
    errandInput({
      questions: [
        question,
        { ...question, id: "q2" },
        { ...question, id: "q3" },
        { ...question, id: "q4" },
        { ...question, id: "q5" },
      ],
    }),
    "is the cap",
  );
  const item = errandInput().disclosure[0]!;
  expectError(
    errandInput({
      disclosure: Array.from({ length: 7 }, (_, index) => ({ ...item, key: `k${index}` })),
    }),
    "is the cap",
  );
});

test("unknown commitment modes and bad language tags are refused", () => {
  expectError(errandInput({ goal: { summary: "x", commitment: "whatever" as never } }), "goal.commitment");
  expectError(errandInput({ policy: { language: "english" } }), "BCP 47");
});

test("duplicate question ids and disclosure keys are refused", () => {
  const question = errandInput().questions[0]!;
  expectError(errandInput({ questions: [question, { ...question }] }), "unique");
  const item = errandInput().disclosure[0]!;
  expectError(errandInput({ disclosure: [item, { ...item, value: "other" }] }), "unique");
});
