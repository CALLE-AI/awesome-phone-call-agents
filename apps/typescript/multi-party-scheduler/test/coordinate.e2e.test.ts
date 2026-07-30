/**
 * End to end over the real `@call-e/calle` client against a local fake CALL-E.
 * No credentials, no network beyond localhost, no phone line.
 */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSdkPort } from "../src/calle.js";
import { runCoordination } from "../src/coordinate.js";
import { readEntries, replay } from "../src/ledger.js";
import type { CoordinationRequest } from "../src/types.js";
import { startFakeCalle, type FakeScript } from "../fake/calle-server.js";
import { coordinationRequest, PLUMBER, requestInput, SUPER, TENANT } from "./fixtures.js";

const WORDS = ["", "one", "two", "three", "four"];

function gather(phone: string, options: number[]): FakeScript {
  const spoken =
    options.length === 0
      ? "None of those work for me this week."
      : `Option ${options.map((option) => WORDS[option]).join(" and option ")} works for me.`;
  return {
    phone,
    phase: "gather",
    userLines: ["Hello?", spoken],
    structuredResult: {
      available_options: options,
      none_work: options.length === 0 ? "yes" : "no",
      notes: "",
    },
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

function confirmNo(phone: string): FakeScript {
  return {
    phone,
    phase: "confirm",
    userLines: ["Speaking.", "Sorry, something came up, I cannot make that."],
    structuredResult: { answer: "decline", notes: "asked to move it" },
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

function ledgerPath(): string {
  return join(mkdtempSync(join(tmpdir(), "mps-")), "ledger.jsonl");
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

test("everyone answers, one time survives and it is confirmed with all three", async () => {
  await withFake(
    [
      gather(PLUMBER, [1, 2]),
      gather(TENANT, [2]),
      gather(SUPER, [2]),
      confirmYes(PLUMBER),
      confirmYes(TENANT),
      confirmYes(SUPER),
    ],
    async (port, fake) => {
      const path = ledgerPath();
      const result = await runCoordination({
        request: coordinationRequest(),
        port,
        ledgerPath: path,
        pollIntervalMs: 5,
      });
      assert.equal(result.outcome, "verbally_confirmed");
      assert.equal(result.slot_id, "thu-14");
      assert.deepEqual(result.confirmed_with, ["plumber", "tenant", "superintendent"]);
      assert.equal(result.calls_placed, 6);
      assert.equal(result.calls_saved, 2);

      // The second gather call must not read an option the first answer ruled out.
      const tenantGather = fake.created.find(
        (call) => call.phase === "gather" && call.phones[0] === TENANT,
      );
      assert.ok(tenantGather !== undefined);
      assert.equal(tenantGather.task.includes("option 3,"), false);
      assert.match(tenantGather.idempotencyKey ?? "", /^mps-ash-lane-3b-leak-gather-tenant-[0-9a-f]{12}$/);
      const confirm = fake.created.find((call) => call.phase === "confirm");
      assert.equal(confirm?.slotId, "thu-14");
      assert.equal(confirm?.resultSchema?.additionalProperties, false);

      const verification = replay(readEntries(path));
      assert.equal(verification.ok, true, JSON.stringify(verification.issues));
      assert.equal(verification.outcome, "verbally_confirmed");
    },
  );
});

test("an impossible schedule is found before the last party is dialled", async () => {
  await withFake(
    [
      gather(PLUMBER, [1]),
      {
        phone: TENANT,
        phase: "gather",
        userLines: ["Hello?", "Option one does not work, I am at work then."],
        structuredResult: { available_options: [], none_work: "yes", notes: "at work" },
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
      assert.equal(result.outcome, "no_common_slot");
      assert.equal(result.calls_placed, 2);
      assert.equal(result.calls_saved, 6);
      assert.equal(fake.created.length, 2, "the third party must never be called");
      assert.equal(replay(readEntries(path)).ok, true);
    },
  );
});

test("a party who declines at confirm time sends everyone else a release call", async () => {
  await withFake(
    [
      gather(PLUMBER, [2]),
      gather(TENANT, [2]),
      gather(SUPER, [2]),
      confirmYes(PLUMBER),
      confirmYes(TENANT),
      confirmNo(SUPER),
      releaseOk(PLUMBER),
      releaseOk(TENANT),
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
      assert.deepEqual(result.unreleased, []);
      assert.equal(result.calls_placed, 8);
      assert.match(result.note, /superintendent declined/);

      const releases = fake.created.filter((call) => call.phase === "release");
      assert.deepEqual(
        releases.map((call) => call.phones[0]),
        [TENANT, PLUMBER],
        "release in reverse order, the most recent yes first",
      );
      const verification = replay(readEntries(path));
      assert.equal(verification.ok, true, JSON.stringify(verification.issues));
    },
  );
});

test("a release call that reaches a machine is surfaced for a human", async () => {
  await withFake(
    [
      gather(PLUMBER, [2]),
      gather(TENANT, [2]),
      gather(SUPER, [2]),
      confirmYes(PLUMBER),
      confirmNo(TENANT),
      { phone: PLUMBER, phase: "release", userLines: ["Please leave a message after the tone."] },
    ],
    async (port) => {
      const result = await runCoordination({
        request: coordinationRequest(),
        port,
        pollIntervalMs: 5,
      });
      assert.equal(result.outcome, "not_confirmed");
      assert.deepEqual(result.unreleased, ["plumber"]);
    },
  );
});

test("a party who cannot be reached stops the run instead of guessing", async () => {
  await withFake(
    [{ phone: PLUMBER, phase: "gather", apiError: { status: 402, code: "insufficient_balance" } }],
    async (port) => {
      const result = await runCoordination({
        request: coordinationRequest(),
        port,
        pollIntervalMs: 5,
      });
      assert.equal(result.outcome, "not_reached");
      assert.equal(result.calls_placed, 1);
      assert.match(result.note, /plumber could not be reached/);
    },
  );
});

test("voicemail in the gather phase is not an answer", async () => {
  await withFake(
    [{ phone: PLUMBER, phase: "gather", userLines: ["You have reached the mailbox of Marcus Lee."] }],
    async (port) => {
      const result = await runCoordination({
        request: coordinationRequest(),
        port,
        pollIntervalMs: 5,
      });
      assert.equal(result.outcome, "not_reached");
    },
  );
});

test("a retried run reuses the calls it already placed", async () => {
  await withFake(
    [
      gather(PLUMBER, [2]),
      gather(TENANT, [2]),
      gather(SUPER, [2]),
      confirmYes(PLUMBER),
      confirmYes(TENANT),
      confirmYes(SUPER),
    ],
    async (port, fake) => {
      const request = coordinationRequest();
      const first = await runCoordination({ request, port, pollIntervalMs: 5 });
      const second = await runCoordination({ request, port, pollIntervalMs: 5 });
      assert.equal(first.outcome, "verbally_confirmed");
      assert.equal(second.outcome, "verbally_confirmed");
      assert.equal(fake.created.length, 6, "the same idempotency keys must not create new calls");
    },
  );
});

test("the extracted list and the transcript must agree before a slot counts", async () => {
  await withFake(
    [
      {
        phone: PLUMBER,
        phase: "gather",
        userLines: ["Hello?", "Option two works."],
        structuredResult: { available_options: [1, 2], none_work: "no", notes: "" },
      },
      gather(TENANT, [2]),
      gather(SUPER, [2]),
      confirmYes(PLUMBER),
      confirmYes(TENANT),
      confirmYes(SUPER),
    ],
    async (port) => {
      const path = ledgerPath();
      const result = await runCoordination({
        request: coordinationRequest(),
        port,
        ledgerPath: path,
        pollIntervalMs: 5,
      });
      assert.equal(result.outcome, "verbally_confirmed");
      const entries = readEntries(path);
      const first = entries.find((entry) => entry.kind === "gather");
      assert.ok(first !== undefined && first.kind === "gather");
      assert.deepEqual(first.result.structured_options, [1, 2]);
      assert.deepEqual(first.result.heard_options, [2]);
      assert.deepEqual(first.result.available_options, [2]);
      assert.equal(first.result.disagreement, true);
      assert.match(first.result.notes, /disagree, kept the overlap/);
    },
  );
});

test("no extracted result falls back to the transcript rather than failing", async () => {
  await withFake(
    [
      {
        phone: PLUMBER,
        phase: "gather",
        userLines: ["Hello?", "Option two works."],
        structuredResult: null,
      },
      gather(TENANT, [2]),
      gather(SUPER, [2]),
      confirmYes(PLUMBER),
      confirmYes(TENANT),
      confirmYes(SUPER),
    ],
    async (port) => {
      const result = await runCoordination({
        request: coordinationRequest(),
        port,
        pollIntervalMs: 5,
      });
      assert.equal(result.outcome, "verbally_confirmed");
      assert.equal(result.slot_id, "thu-14");
    },
  );
});

test("the call budget stops the run and says who was left hanging", async () => {
  await withFake(
    [
      gather(PLUMBER, [2]),
      gather(TENANT, [2]),
      gather(SUPER, [2]),
      confirmYes(PLUMBER),
    ],
    async (port) => {
      const base = coordinationRequest();
      const request: CoordinationRequest = { ...base, policy: { ...base.policy, maxCalls: 4 } };
      const result = await runCoordination({ request, port, pollIntervalMs: 5 });
      assert.equal(result.outcome, "budget_exhausted");
      assert.deepEqual(result.unreleased, ["plumber"]);
      assert.equal(result.calls_placed, 4);
    },
  );
});

test("the window closes the run before the next party is called", async () => {
  await withFake([gather(PLUMBER, [1, 2])], async (port, fake) => {
    let clock = 1_800_000_000_000;
    const result = await runCoordination({
      request: coordinationRequest(),
      port,
      pollIntervalMs: 5,
      now: () => clock,
      onProgress: (line) => {
        if (line.startsWith("  plumber:")) {
          clock += 46 * 60_000;
        }
      },
    });
    assert.equal(result.outcome, "window_expired");
    assert.equal(fake.created.length, 1);
  });
});

test("a party outside their calling hours is not dialled at all", async () => {
  await withFake([gather(PLUMBER, [1, 2])], async (port, fake) => {
    const parties = requestInput().parties.map((party) => ({ ...party }));
    parties[1]!.calling_hours = { start: "09:00", end: "17:00", timezone: "America/Los_Angeles" };
    const result = await runCoordination({
      request: coordinationRequest({ parties }),
      port,
      pollIntervalMs: 5,
      // 22:00 Pacific. Nobody rings a tenant then, whatever the protocol wants.
      now: () => Date.parse("2026-08-04T05:00:00Z"),
    });
    assert.equal(result.outcome, "not_reached");
    assert.equal(fake.created.length, 1, "the tenant must not be dialled at 10pm");
    assert.equal(result.calls_placed, 1, "a call that was never placed costs no budget");
  });
});

test("canceling in flight stops new calls and still releases everyone who said yes", async () => {
  await withFake(
    [
      gather(PLUMBER, [2]),
      gather(TENANT, [2]),
      gather(SUPER, [2]),
      confirmYes(PLUMBER),
      confirmYes(TENANT),
      confirmYes(SUPER),
      releaseOk(PLUMBER),
      releaseOk(TENANT),
    ],
    async (port, fake) => {
      const canceling = new AbortController();
      const path = ledgerPath();
      const result = await runCoordination({
        request: coordinationRequest(),
        port,
        ledgerPath: path,
        pollIntervalMs: 5,
        signal: canceling.signal,
        onProgress: (line) => {
          if (line === "  tenant: confirmed.") {
            canceling.abort();
          }
        },
      });
      assert.equal(result.outcome, "canceled");
      assert.equal(result.slot_id, null);
      assert.deepEqual(result.unreleased, []);
      assert.equal(
        fake.created.filter((call) => call.phase === "confirm").length,
        2,
        "the third confirm call must never be placed",
      );
      assert.deepEqual(
        fake.created.filter((call) => call.phase === "release").map((call) => call.phones[0]),
        [TENANT, PLUMBER],
        "canceling the booking does not cancel the duty to tell people",
      );
      const verification = replay(readEntries(path));
      assert.equal(verification.ok, true, JSON.stringify(verification.issues));
      assert.equal(verification.outcome, "canceled");
    },
  );
});
