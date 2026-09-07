/**
 * The corpus is published; the captures it derives from are not. These tests
 * are what stands between the two.
 *
 * A pull request in this ecosystem was frozen for days after real call data
 * reached a public branch, and force-pushing did not clear it because the old
 * objects still resolved. There is no cheap fix after the fact, so the check
 * belongs in the suite rather than in someone's memory.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, cpSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QUIRKS, quirksIn, type CallPayload } from "../src/quirks.ts";

const FIXTURE_DIR = "fixtures/calls";
const RAW_DIR = "probe-results";

/**
 * The private captures are never published, so the two tests that check the
 * masking against its own input cannot run from a clean checkout. They are
 * skipped with a reason rather than deleted, because they are the tests that
 * prove no real data reached `fixtures/`, and anyone holding the captures can
 * still run them.
 */
const HAVE_RAW = existsSync(RAW_DIR);
const rawOnly = { skip: HAVE_RAW ? false : "probe-results/ is not published" };

const fixtureFiles = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json"));
const fixtureText = fixtureFiles.map((f) => readFileSync(join(FIXTURE_DIR, f), "utf8")).join("\n");
const fixtures = fixtureFiles.map((f) => JSON.parse(readFileSync(join(FIXTURE_DIR, f), "utf8")) as CallPayload);

/** Ranges reserved for documentation. Nothing else may appear. */
const RESERVED = [/^\+120255501\d{2}$/, /^\+1\d{3}5550(1\d{2})$/, /^\+447700900\d{3}$/];

describe("the corpus carries no real data", () => {
  test("every phone number lies in a reserved documentation range", () => {
    const numbers = [...new Set(fixtureText.match(/\+\d{7,15}/g) ?? [])];
    assert.ok(numbers.length > 0, "expected the corpus to contain phone numbers");
    for (const number of numbers) {
      assert.ok(
        RESERVED.some((r) => r.test(number)),
        `${number} is not in a reserved range`,
      );
    }
  });

  test("no identifier survives from the raw captures", rawOnly, () => {
    // Anything long and hex-ish in a capture is an id the masking must replace.
    const raw = readdirSync(RAW_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readFileSync(join(RAW_DIR, f), "utf8"))
      .join("\n");
    const rawIds = new Set([
      ...(raw.match(/call_[A-Za-z0-9_-]{10,}/g) ?? []),
      ...(raw.match(/\b[0-9a-f]{32}\b/g) ?? []),
      ...(raw.match(/\b(?:att|rcp)_[0-9a-f]{10,}\b/g) ?? []),
    ]);
    assert.ok(rawIds.size > 0, "expected the captures to contain identifiers");
    const leaked = [...rawIds].filter((id) => fixtureText.includes(id));
    assert.deepEqual(leaked, [], `identifiers reached the corpus: ${leaked.join(", ")}`);
  });

  test("no vendor name or credential prefix appears", () => {
    for (const forbidden of ["telnyx", "twilio", "iams_live", "iams_test", "abuse@"]) {
      assert.ok(
        !fixtureText.toLowerCase().includes(forbidden),
        `the corpus mentions ${forbidden}`,
      );
    }
  });
});

describe("the predicates are safe to run on foreign payloads", () => {
  test("no quirk throws on a malformed payload", () => {
    const hostile: unknown[] = [
      {},
      { recipients: null },
      { recipients: [{}] },
      { recipients: [{ attempts: null }] },
      { recipients: [{ attempts: [{}] }] },
      { recipients: [{ attempts: [{ transcriptTurns: "not an array" }] }] },
      { recipients: [{ structuredResult: "not an object", attempts: [] }] },
      { createdAt: 12345, recipients: [{ attempts: [{ startedAt: null, failureCode: 404 }] }] },
    ];
    for (const payload of hostile) {
      assert.doesNotThrow(() => quirksIn(payload as CallPayload), `threw on ${JSON.stringify(payload)}`);
    }
  });

  test("every declared quirk is exercised by at least one fixture", () => {
    const covered = new Set(fixtures.flatMap((f) => quirksIn(f)));
    const orphans = QUIRKS.filter((q) => !covered.has(q.id)).map((q) => q.id);
    assert.deepEqual(orphans, [], `declared but never demonstrated: ${orphans.join(", ")}`);
  });
});

describe("the corpus agrees with its own index", () => {
  const index = JSON.parse(readFileSync("fixtures/index.json", "utf8")) as {
    calls: Array<{ file: string; quirks: string[] }>;
  };

  test("the index lists every fixture on disk, and no others", () => {
    assert.deepEqual(index.calls.map((c) => c.file).sort(), [...fixtureFiles].sort());
  });

  test("recorded quirks match what the predicates decide now", () => {
    for (const entry of index.calls) {
      const payload = JSON.parse(readFileSync(join(FIXTURE_DIR, entry.file), "utf8")) as CallPayload;
      assert.deepEqual(quirksIn(payload), entry.quirks, `${entry.file} no longer carries its recorded quirks`);
    }
  });
});

describe("regenerating is deterministic", () => {
  test("a second run produces byte-identical fixtures", rawOnly, () => {
    const scratch = mkdtempSync(join(tmpdir(), "calle-corpus-"));
    try {
      cpSync("fixtures", join(scratch, "before"), { recursive: true });
      execFileSync("npm", ["run", "mask"], { stdio: "pipe", shell: true });
      for (const file of fixtureFiles) {
        assert.equal(
          readFileSync(join(FIXTURE_DIR, file), "utf8"),
          readFileSync(join(scratch, "before", "calls", file), "utf8"),
          `${file} changed on regeneration`,
        );
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
