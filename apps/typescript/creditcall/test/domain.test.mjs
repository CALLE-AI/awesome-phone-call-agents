import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildCallGoal, calculateException, validatePhone } from "../src/domain.mjs";
import { maskPhone, sanitizeForDisplay } from "../src/display.mjs";
import { recordRun } from "../src/ledger.mjs";

const packet = {
  packetId: "PP-2086",
  invoiceId: "INV-25791",
  supplierReference: "Demo Supplier",
  item: "monitor arms",
  quantity: 8,
  orderedUnitPrice: 94,
  invoiceUnitPrice: 119,
  currency: "CAD",
  recordsAreFictional: true,
};

test("calculates the $200 exception in code", () => {
  const result = calculateException(packet);
  assert.equal(result.unitDifference, 25);
  assert.equal(result.totalDifference, 200);
});

test("requires a named human approver", () => {
  assert.throws(
    () => buildCallGoal(packet, { recipientConsent: true }),
    /named person must approve/,
  );
});

test("requires recipient consent", () => {
  assert.throws(
    () => buildCallGoal(packet, { authorizedBy: "Jonathan" }),
    /recipient must consent/,
  );
});

test("discloses automation and blocks impersonation", () => {
  const goal = buildCallGoal(packet, {
    authorizedBy: "Jonathan",
    recipientConsent: true,
  });
  assert.match(goal, /disclosed automated test call/);
  assert.match(goal, /Do not claim to represent the supplier/);
  assert.match(goal, /Do not request payment details/);
  assert.match(goal, /\$200\.00/);
});

test("handles call screening before talking to a person", () => {
  const goal = buildCallGoal(packet, {
    authorizedBy: "Jonathan",
    recipientConsent: true,
  });
  assert.match(goal, /Do not treat call-screening responses as recipient approval/);
  assert.match(goal, /repeat the automation disclosure/);
  assert.match(goal, /wait for their answer before continuing/);
});

test("accepts only explicit E.164 phone numbers", () => {
  assert.equal(validatePhone("+14165550123"), "+14165550123");
  assert.throws(() => validatePhone("416-555-0123"), /E\.164/);
});

test("masks phone numbers in nested output", () => {
  assert.equal(maskPhone("Call +14165550123"), "Call +1••••0123");
  assert.deepEqual(
    sanitizeForDisplay({ recipients: ["+14165550123"] }),
    { recipients: ["+1••••0123"] },
  );
});

test("does not persist raw provider results", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "creditcall-ledger-"));
  const file = path.join(directory, "run-test.json");
  await writeFile(file, "{}", { mode: 0o600 });

  try {
    await recordRun(file, {
      phone: "+14165550123",
      transcript: "private transcript",
    });
    const saved = JSON.parse(await readFile(file, "utf8"));
    assert.equal(saved.state, "submitted");
    assert.equal(typeof saved.updatedAt, "string");
    assert.equal("result" in saved, false);
    assert.doesNotMatch(JSON.stringify(saved), /private transcript|14165550123/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
