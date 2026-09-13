/**
 * The claim file loader. Nothing here guesses: a missing field, a channel this app
 * does not know or a policy outside its limits is an error rather than a default.
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ClaimError, loadClaim, parseClaim, POLICY_LIMITS } from "../src/config.js";
import { claimInput, withContact } from "./fixtures.js";

function refuses(input: unknown, fragment: RegExp): void {
  assert.throws(
    () => parseClaim(input),
    (error: unknown) => {
      assert.ok(error instanceof ClaimError, `expected a ClaimError, got ${String(error)}`);
      assert.match(error.message, fragment);
      return true;
    },
  );
}

test("a complete claim file parses into the shapes the app runs on", () => {
  const parsed = parseClaim(claimInput());
  assert.equal(parsed.claimId, "northgate-voicemail-0912");
  assert.equal(parsed.customer.name, "Dana Whitfield");
  assert.equal(parsed.contact.channel, "voicemail");
  assert.equal(parsed.contact.claimed_to_be, "Northgate Credit Union");
  assert.equal(parsed.trustedNumber.printed_on, "the back of the debit card");
  assert.equal(parsed.trustedNumber.region, "US");
  assert.equal(parsed.policy.recentWindowMinutes, 60);
  assert.equal(parsed.policy.perCallTimeoutSeconds, 240);
  assert.equal(parsed.policy.language, "en-US");
  assert.equal(parsed.policy.minConfidence, 0.5);
});

test("policy defaults are filled in and the file may leave policy out", () => {
  const input = claimInput() as unknown as Record<string, unknown>;
  const { policy: _dropped, ...withoutPolicy } = input;
  const parsed = parseClaim(withoutPolicy);
  assert.equal(parsed.policy.recentWindowMinutes, POLICY_LIMITS.recentWindowMinutes.default);
  assert.equal(parsed.policy.perCallTimeoutSeconds, POLICY_LIMITS.perCallTimeoutSeconds.default);
  assert.equal(parsed.policy.minConfidence, POLICY_LIMITS.minConfidence.default);
  assert.equal(parsed.policy.language, "en-US");
});

test("the file has to be a JSON object", () => {
  refuses("a string", /must contain a JSON object/);
  refuses(null, /must contain a JSON object/);
  refuses([claimInput()], /must contain a JSON object/);
});

test("claim_id is stable, short and safe to put in an idempotency key", () => {
  refuses({ ...claimInput(), claim_id: "" }, /claim_id must be a non-empty string/);
  refuses({ ...claimInput(), claim_id: "ab" }, /claim_id must be 3 to 64 characters/);
  refuses({ ...claimInput(), claim_id: "north gate" }, /claim_id must be 3 to 64 characters/);
  refuses({ ...claimInput(), claim_id: "../../etc/passwd" }, /claim_id must be 3 to 64 characters/);
  assert.equal(parseClaim({ ...claimInput(), claim_id: "a.b-c_1" }).claimId, "a.b-c_1");
});

test("the customer needs a name, because the call says whose behalf it is on", () => {
  refuses({ ...claimInput(), customer: {} }, /customer\.name must be a non-empty string/);
  refuses({ ...claimInput(), customer: "Dana" }, /customer must be an object/);
  refuses({ ...claimInput(), customer: { name: "D".repeat(90) } }, /customer\.name must be 80 characters/);
});

test("the channel is one of the four this app knows", () => {
  for (const channel of ["voicemail", "text_message", "missed_call", "answered_call"] as const) {
    assert.equal(parseClaim(withContact({ channel })).contact.channel, channel);
  }
  refuses(withContact({ channel: "carrier pigeon" as never }), /contact\.channel must be one of/);
});

test("the arrival time is a real instant with an offset, so the call can say when", () => {
  for (const arrived of ["2026-07-31", "yesterday morning", "2026-07-31T09:12:00", "2026-13-31T09:12:00Z"]) {
    refuses(withContact({ arrived_at: arrived }), /contact\.arrived_at must be ISO 8601 with an offset/);
  }
  assert.equal(
    parseClaim(withContact({ arrived_at: "2026-07-31T16:12:00Z" })).contact.arrived_at,
    "2026-07-31T16:12:00Z",
  );
});

test("the spoken subject is short, because a phone call is not a statement", () => {
  refuses(withContact({ claimed_about: "" }), /contact\.claimed_about must be a non-empty string/);
  refuses(withContact({ claimed_about: "x".repeat(90) }), /contact\.claimed_about must be 80 characters/);
});

test("who it claimed to be is required, because that is who gets called", () => {
  refuses(withContact({ claimed_to_be: "" }), /contact\.claimed_to_be must be a non-empty string/);
  refuses({ ...claimInput(), contact: "a voicemail" }, /contact must be an object/);
});

test("what was asked for is required, so the customer writes it down once", () => {
  refuses(withContact({ asked_for: "" }), /contact\.asked_for must be a non-empty string/);
});

test("where the trusted number was printed is required", () => {
  refuses(
    { ...claimInput(), trusted_number: { phone: "+14155550100" } },
    /trusted_number\.printed_on must be a non-empty string/,
  );
  refuses({ ...claimInput(), trusted_number: "+14155550100" }, /trusted_number must be an object/);
});

test("policy numbers are bounded and a value outside the range says the range", () => {
  refuses({ ...claimInput(), policy: { per_call_timeout_seconds: 5 } }, /per_call_timeout_seconds must be between/);
  refuses({ ...claimInput(), policy: { per_call_timeout_seconds: 9000 } }, /per_call_timeout_seconds must be between/);
  refuses({ ...claimInput(), policy: { recent_window_minutes: 2 } }, /recent_window_minutes must be between/);
  refuses({ ...claimInput(), policy: { recent_window_minutes: 4000 } }, /recent_window_minutes must be between/);
  refuses({ ...claimInput(), policy: { min_confidence: 2 } }, /min_confidence must be between/);
  refuses({ ...claimInput(), policy: { per_call_timeout_seconds: "240" as never } }, /must be a number/);
  refuses({ ...claimInput(), policy: "default" }, /policy must be an object/);
});

test("the language is a BCP 47 tag, because it is passed on as the recipient locale", () => {
  assert.equal(parseClaim({ ...claimInput(), policy: { language: "es-MX" } }).policy.language, "es-MX");
  refuses({ ...claimInput(), policy: { language: "Spanish" } }, /must be a BCP 47 tag/);
});

test("a claim file is read from disk and a broken one says which file", () => {
  const dir = mkdtempSync(join(tmpdir(), "vcc-claim-"));
  const good = join(dir, "claim.json");
  writeFileSync(good, JSON.stringify(claimInput()), "utf8");
  assert.equal(loadClaim(good).claimId, "northgate-voicemail-0912");

  const broken = join(dir, "broken.json");
  writeFileSync(broken, "{ not json", "utf8");
  assert.throws(() => loadClaim(broken), (error: unknown) => {
    assert.ok(error instanceof ClaimError);
    assert.match(error.message, /is not valid JSON/);
    assert.match(error.message, /broken\.json/);
    return true;
  });

  assert.throws(() => loadClaim(join(dir, "missing.json")), (error: unknown) => {
    assert.ok(error instanceof ClaimError);
    assert.match(error.message, /Cannot read claim file/);
    return true;
  });
});

test("the example claim file in the repository is a valid claim", () => {
  const parsed = loadClaim(join(import.meta.dirname, "..", "examples", "claim.example.json"));
  assert.equal(parsed.claimId.length > 0, true);
  assert.notEqual(parsed.contact.number_shown, parsed.trustedNumber.phone);
});
