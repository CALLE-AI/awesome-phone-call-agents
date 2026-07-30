/**
 * Recovery, end to end over the real client against the local fake CALL-E.
 *
 * The two failures that matter are a process that dies between the yes and the
 * release call and a create response that is lost while the call itself goes
 * ahead. Both can leave somebody expecting an appointment that is not happening.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CalleCallError, createSdkPort, type CallePort } from "../src/calle.js";
import { runCoordination } from "../src/coordinate.js";
import { readEntries, replay } from "../src/ledger.js";
import { resumeCoordination, ResumeError } from "../src/resume.js";
import { startFakeCalle, type FakeScript } from "../fake/calle-server.js";
import { coordinationRequest, PLUMBER, SUPER, TENANT } from "./fixtures.js";

function gather(phone: string): FakeScript {
  return {
    phone,
    phase: "gather",
    userLines: ["Hello?", "Option two works for me."],
    structuredResult: { available_options: [2], none_work: "no", notes: "" },
  };
}

function confirmYes(phone: string): FakeScript {
  return {
    phone,
    phase: "confirm",
    userLines: ["Speaking.", "Confirm, see you then."],
    structuredResult: { answer: "confirm", notes: "" },
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

const FULL_RUN: FakeScript[] = [
  gather(PLUMBER),
  gather(TENANT),
  gather(SUPER),
  confirmYes(PLUMBER),
  confirmYes(TENANT),
  confirmYes(SUPER),
  releaseOk(PLUMBER),
  releaseOk(TENANT),
  releaseOk(SUPER),
];

function ledgerPath(): string {
  return join(mkdtempSync(join(tmpdir(), "mps-resume-")), "ledger.jsonl");
}

async function withFake(
  body: (
    port: CallePort,
    fake: Awaited<ReturnType<typeof startFakeCalle>>,
  ) => Promise<void>,
): Promise<void> {
  const fake = await startFakeCalle(FULL_RUN);
  const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
  try {
    await body(port, fake);
  } finally {
    await fake.close();
  }
}

function phones(fake: Awaited<ReturnType<typeof startFakeCalle>>, phase: string): (string | undefined)[] {
  return fake.created.filter((call) => call.phase === phase).map((call) => call.phones[0]);
}

test("a crash between the yes and the release call is finished by resume", async () => {
  await withFake(async (port, fake) => {
    const request = coordinationRequest();
    const path = ledgerPath();
    await assert.rejects(
      () =>
        runCoordination({
          request,
          port,
          ledgerPath: path,
          pollIntervalMs: 5,
          onProgress: (line) => {
            if (line === "  tenant: confirmed.") {
              throw new Error("power cut");
            }
          },
        }),
      /power cut/,
    );
    const crashed = replay(readEntries(path));
    assert.equal(crashed.ok, false);
    assert.ok(crashed.issues.some((issue) => issue.problem.includes("did not finish")));
    assert.deepEqual(phones(fake, "release"), [], "nobody has been told yet");

    const resumed = await resumeCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 });
    assert.equal(resumed.outcome, "not_confirmed");
    assert.deepEqual(resumed.unreleased, []);
    assert.equal(resumed.calls_placed, 7, "5 recorded calls plus the 2 releases the run owed");
    assert.deepEqual(phones(fake, "release"), [TENANT, PLUMBER], "most recent yes first");

    const after = replay(readEntries(path));
    assert.equal(after.ok, true, JSON.stringify(after.issues));
    assert.equal(after.outcome, "not_confirmed");
  });
});

test("a confirm whose create response was lost is settled and that party is released", async () => {
  await withFake(async (port, fake) => {
    const request = coordinationRequest();
    const path = ledgerPath();
    // The call is created, then the answer never gets back to us.
    const lossy: CallePort = {
      ...port,
      async createCall(input, key) {
        const call = await port.createCall(input, key);
        if (key.startsWith("mps-ash-lane-3b-leak-confirm-superintendent")) {
          throw new CalleCallError("connection_error", "the create response never arrived");
        }
        return call;
      },
    };

    const first = await runCoordination({ request, port: lossy, ledgerPath: path, pollIntervalMs: 5 });
    assert.equal(first.outcome, "not_confirmed");
    assert.deepEqual(first.unreleased, []);
    assert.equal(phones(fake, "confirm").length, 3, "the superintendent was called, we just never saw it");
    assert.deepEqual(phones(fake, "release"), [TENANT, PLUMBER]);

    const resumed = await resumeCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 });
    assert.equal(resumed.outcome, "not_confirmed");
    assert.deepEqual(resumed.unreleased, []);
    assert.match(resumed.note, /resumed an unfinished run/);
    assert.deepEqual(
      phones(fake, "release"),
      [TENANT, PLUMBER, SUPER],
      "the party who said yes on the call we lost is told too",
    );
    const entries = readEntries(path);
    const reconciled = entries.find((entry) => entry.kind === "reconcile");
    assert.ok(reconciled !== undefined && reconciled.kind === "reconcile");
    assert.equal(reconciled.result.party_id, "superintendent");
    assert.equal(reconciled.result.confirmed, true, "the same idempotency key found the same call");
    const after = replay(entries);
    assert.equal(after.ok, true, JSON.stringify(after.issues));
  });
});

test("a finished run with nothing owed is left exactly as it was", async () => {
  await withFake(async (port, fake) => {
    const request = coordinationRequest();
    const path = ledgerPath();
    const first = await runCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 });
    assert.equal(first.outcome, "verbally_confirmed");
    const before = readFileSync(path, "utf8");

    const resumed = await resumeCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 });
    assert.equal(resumed.outcome, "verbally_confirmed");
    assert.equal(resumed.note, "nothing to resume");
    assert.equal(readFileSync(path, "utf8"), before, "resume writes nothing when nothing is owed");
    assert.deepEqual(phones(fake, "release"), []);
  });
});

test("resume refuses a ledger another request wrote", async () => {
  await withFake(async (port) => {
    const request = coordinationRequest();
    const path = ledgerPath();
    await runCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 });
    const other = coordinationRequest({
      meeting: { ...coordinationRequest().meeting, purpose: "a different job at 14 Ash Lane" },
    });
    await assert.rejects(
      () => resumeCoordination({ request: other, port, ledgerPath: path, pollIntervalMs: 5 }),
      (error: unknown) => {
        assert.ok(error instanceof ResumeError);
        assert.match(error.message, /written from a different request/);
        return true;
      },
    );
  });
});
