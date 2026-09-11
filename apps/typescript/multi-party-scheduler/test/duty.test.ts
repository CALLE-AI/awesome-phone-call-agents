/**
 * Who is owed a release call and what clears that debt.
 *
 * One rule from three angles. A duty is created by what the person said on the
 * call, so it is read from the transcript and never from a provider status: a call
 * CALL-E marks failed or canceled can hold the confirmation question and a yes
 * after it. Reading the status as proof that nobody committed would cancel the
 * duty this app exists to keep. A duty is cleared only by evidence that somebody
 * was told, so an extraction the recording does not support cannot write it off.
 * And a refusal is recorded as the check that refused it, so a call that failed is
 * not filed as a window that closed.
 */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSdkPort } from "../src/calle.js";
import { runCoordination } from "../src/coordinate.js";
import { readEntries, replay } from "../src/ledger.js";
import { inspectLedger } from "../src/resume.js";
import { startFakeCalle, type FakeScript } from "../fake/calle-server.js";
import { coordinationRequest, PLUMBER, SUPER, TENANT } from "./fixtures.js";
import { stubPort, type StubScript } from "./stub.js";

/** 10am Pacific, which is when every stub call says it finished. */
const CLOCK = Date.parse("2026-08-04T17:00:00Z");

function ledgerPath(): string {
  return join(mkdtempSync(join(tmpdir(), "mps-duty-")), "ledger.jsonl");
}

function gather(phone: string): FakeScript {
  return {
    phone,
    phase: "gather",
    userLines: ["Hello?", "Option two works for me."],
    structuredResult: { available_options: [2], none_work: "no", notes: "" },
  };
}

function confirmYes(phone: string, extra: Partial<FakeScript> = {}): FakeScript {
  return {
    phone,
    phase: "confirm",
    userLines: ["Speaking.", "Confirm, see you then."],
    structuredResult: { answer: "confirm", notes: "" },
    ...extra,
  };
}

function confirmNo(phone: string): FakeScript {
  return {
    phone,
    phase: "confirm",
    userLines: ["Speaking.", "Sorry, something came up, I cannot make that."],
    structuredResult: { answer: "decline", notes: "" },
  };
}

function releaseOk(phone: string): FakeScript {
  return {
    phone,
    phase: "release",
    userLines: ["Hello?", "Okay, thanks for letting me know."],
    structuredResult: { acknowledged: "yes", notes: "" },
  };
}

async function withFake(
  scripts: FakeScript[],
  body: (
    port: Awaited<ReturnType<typeof createSdkPort>>,
    fake: Awaited<ReturnType<typeof startFakeCalle>>,
  ) => Promise<void>,
): Promise<void> {
  const fake = await startFakeCalle(scripts);
  const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
  try {
    await body(port, fake);
  } finally {
    await fake.close();
  }
}

for (const status of ["failed", "canceled"] as const) {
  test(`a yes on a call CALL-E reports as ${status} still owes a release call`, async () => {
    await withFake(
      [
        gather(PLUMBER),
        gather(TENANT),
        gather(SUPER),
        confirmYes(PLUMBER),
        // The tenant heard the question and agreed. The line then dropped, so the
        // call is not `completed` and the transcript still holds the yes.
        confirmYes(TENANT, { status }),
        releaseOk(TENANT),
        releaseOk(PLUMBER),
      ],
      async (port, fake) => {
        const path = ledgerPath();
        const result = await runCoordination({
          request: coordinationRequest(),
          port,
          ledgerPath: path,
          pollIntervalMs: 5,
        });
        assert.equal(result.outcome, "not_confirmed");
        assert.equal(result.slot_id, null);

        // The whole point. Both people who said yes are told, most recent first,
        // neither of them left waiting on an appointment that is not happening.
        assert.deepEqual(
          fake.created.filter((call) => call.phase === "release").map((call) => call.phones[0]),
          [TENANT, PLUMBER],
        );
        assert.deepEqual(result.unreleased, []);
        assert.equal(result.calls_placed, 7, "three gathers, two confirms, two release calls");
        assert.equal(
          result.note,
          `tenant said yes and it could not be credited (call_${status}), so nothing is going ahead`,
          "the refusal names the call, not the window",
        );

        const entries = readEntries(path);
        const commit = entries.filter((entry) => entry.kind === "commit").at(-1);
        assert.ok(commit !== undefined && commit.kind === "commit");
        assert.equal(commit.result.party_id, "tenant");
        assert.equal(commit.result.call_status, status);
        assert.equal(commit.result.heard_answer, "confirm", "the tenant did say yes");
        assert.equal(commit.result.question_asked, true, "after the confirmation question");
        assert.equal(commit.result.confirmed, false, "and it is not credited as a confirmation");

        const verification = replay(entries);
        assert.equal(verification.ok, true, JSON.stringify(verification.issues));
      },
    );
  });
}

test("a completion time nobody can read is not reported as a window that closed", async () => {
  const scripts: StubScript[] = [
    { phase: "gather", phone: PLUMBER, userLines: ["Hello?", "Option two works."], structured: { available_options: [2], none_work: "no", notes: "" } },
    { phase: "gather", phone: TENANT, userLines: ["Hello?", "Option two works."], structured: { available_options: [2], none_work: "no", notes: "" } },
    { phase: "gather", phone: SUPER, userLines: ["Hello?", "Option two works."], structured: { available_options: [2], none_work: "no", notes: "" } },
    // A finished call the API gave no completion time for. The yes cannot be
    // credited, because nothing places it in time. The window itself did not close.
    {
      phase: "confirm",
      phone: PLUMBER,
      userLines: ["Speaking.", "Confirm, see you then."],
      structured: { answer: "confirm", notes: "" },
      completedAt: null,
    },
    { phase: "release", phone: PLUMBER, userLines: ["Hello?", "Okay, thanks for letting me know."], structured: { acknowledged: "yes", notes: "" } },
  ];
  const port = stubPort(scripts);
  const path = ledgerPath();
  const result = await runCoordination({
    request: coordinationRequest(),
    port,
    ledgerPath: path,
    pollIntervalMs: 1,
    now: () => CLOCK,
  });

  assert.equal(result.outcome, "not_confirmed", "the window is open, the timestamp is missing");
  assert.equal(
    result.note,
    "plumber said yes and it could not be credited (completion_time_unknown), so nothing is going ahead",
  );
  assert.doesNotMatch(result.note, /window closed/, "no check said the window closed");

  const entries = readEntries(path);
  const commit = entries.find((entry) => entry.kind === "commit");
  assert.ok(commit !== undefined && commit.kind === "commit");
  assert.equal(commit.result.within_window, false);
  assert.equal(commit.result.window_reason, "completion_time_unknown");
  assert.equal(commit.result.completion_time_usable, false);
  assert.equal(commit.result.heard_answer, "confirm");
  assert.equal(commit.result.confirmed, false);

  assert.deepEqual(
    port.creates.filter((call) => call.phase === "release").map((call) => call.phone),
    [PLUMBER],
    "the yes still earns the release call",
  );
  assert.deepEqual(result.unreleased, []);
  assert.equal(result.calls_placed, 5, "three gathers, the confirm, the release call it owed");
  const verification = replay(entries);
  assert.equal(verification.ok, true, JSON.stringify(verification.issues));
});

test("a release call the transcript does not acknowledge stays owed, whatever the extraction says", async () => {
  await withFake(
    [
      gather(PLUMBER),
      gather(TENANT),
      gather(SUPER),
      confirmYes(PLUMBER),
      confirmYes(TENANT),
      confirmNo(SUPER),
      releaseOk(TENANT),
      // Nobody acknowledged anything on this call. The extracted answer says they
      // did. An extraction is not a person being told.
      {
        phone: PLUMBER,
        phase: "release",
        userLines: ["Hello?"],
        structuredResult: { acknowledged: "yes", notes: "" },
      },
    ],
    async (port, fake) => {
      const path = ledgerPath();
      const result = await runCoordination({
        request: coordinationRequest(),
        port,
        ledgerPath: path,
        pollIntervalMs: 5,
      });
      assert.equal(result.outcome, "not_confirmed");
      assert.deepEqual(result.unreleased, ["plumber"], "the debt is reported, not written off");
      assert.deepEqual(
        fake.created.filter((call) => call.phase === "release").map((call) => call.phones[0]),
        [TENANT, PLUMBER],
      );

      const entries = readEntries(path);
      const release = entries
        .filter((entry) => entry.kind === "release")
        .map((entry) => (entry.kind === "release" ? entry.result : null))
        .find((held) => held?.party_id === "plumber");
      assert.ok(release !== undefined && release !== null);
      assert.equal(release.reached_person, true, "somebody picked up");
      assert.equal(release.heard_answer, "unknown", "and acknowledged nothing");
      assert.equal(release.structured_answer, "yes", "while the extraction claimed they did");
      assert.equal(release.acknowledged, false, "so the debt stands");

      assert.deepEqual(inspectLedger(entries).owedReleases, ["plumber"], "resume owns it");
      const verification = replay(entries);
      assert.equal(verification.ok, true, JSON.stringify(verification.issues));
    },
  );
});
