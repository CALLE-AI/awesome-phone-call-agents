import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildEvidence,
  sourced,
  isZoned,
  type EvidencePackage,
} from "asheard/reconciler";
import {
  withFlags,
  detectStuck,
  detectReplayed,
  detectRetryUnsafe,
  detectDurationUnreliable,
  timelineSpanMs,
} from "asheard/reconciler";
import { classify, rankBatch, BANDS } from "asheard/reconciler";
import { phrase, headline, subline, ENDING_CLAUSES } from "asheard/reconciler";
import type { Disposition } from "asheard/disposition";

/** A reading with everything quoted and agreeing. The boring, correct case. */
function cleanRead(): Disposition {
  return {
    surface: "calls-api",
    endstate: {
      value: "answered_human",
      basis: "quoted",
      from: ["answered_by"],
      note: "The payload said so.",
    },
    taskOutcome: {
      value: "met",
      basis: "quoted",
      from: ["task_completed"],
      note: "The payload said so.",
    },
    resultState: {
      value: "valid",
      basis: "quoted",
      from: ["structured_result"],
      note: "Present and valid.",
    },
    needsHuman: false,
    reasons: [],
  };
}

function read(over: Partial<Disposition> = {}): Disposition {
  return { ...cleanRead(), ...over };
}

/**
 * A package that has been through the detectors, because an unflagged one
 * cannot be ranked and every caller here is about to rank it.
 */
function pkg(over: Partial<EvidencePackage> = {}): EvidencePackage {
  const base = withFlags(
    buildEvidence({ read: cleanRead(), now: () => new Date("2000-01-06T12:00:00Z") }),
    { now: () => new Date("2000-01-06T12:00:00Z") },
  );
  return { ...base, ...over };
}

test("an evidence item cannot be built without a source field", () => {
  assert.throws(() => sourced("x", []), /at least one source field/);
  assert.deepEqual(sourced("x", ["a"]), { value: "x", from: ["a"] });
});

test("a naive timestamp is not treated as zoned", () => {
  assert.equal(isZoned("2000-01-02T21:14:05"), false);
  assert.equal(isZoned("2000-01-03T04:17:21.118300Z"), true);
  assert.equal(isZoned("2000-01-03T04:17:21+01:00"), true);
  assert.equal(isZoned(null), false);
});

test("the callable number never reaches the package", () => {
  const built = buildEvidence({
    read: cleanRead(),
    intent: {
      id: "i1",
      idempotencyKey: "ah_w1_abc",
      channel: "calls-api",
      authorization: {
        workflowId: "w1",
        purpose: "confirm",
        destination: "+13035550142",
        contractVersion: "1",
      },
      state: "accepted",
      boundId: "call_1",
      reasons: [],
      createdAt: "2000-01-06T11:00:00Z",
      updatedAt: "2000-01-06T11:00:00Z",
    },
  });
  const shown = built.authorized!.destination.value;
  assert.ok(!shown.includes("3035550142"), "the full number must not survive");
  assert.ok(shown.includes("*"), "it should be masked, not dropped");
});

test("turn counts are counted, and no transcript is different from an empty one", () => {
  const withTurns = buildEvidence({
    read: cleanRead(),
    payload: {
      id: "c1",
      status: "completed",
      transcript_turns: [
        { speaker: "bot" },
        { speaker: "bot" },
        { speaker: "user" },
        { speaker: "other" },
      ],
    },
  });
  assert.deepEqual(withTurns.observed.turns?.value, {
    total: 4,
    user: 1,
    bot: 2,
    unknown: 1,
  });

  const noTranscript = buildEvidence({
    read: cleanRead(),
    payload: { id: "c1", status: "completed" },
  });
  assert.equal(noTranscript.observed.turns, null);
});

test("a mixed-zone timeline is left in fetch order rather than sorted", () => {
  const built = buildEvidence({
    read: cleanRead(),
    events: [
      {
        data: [
          { id: "e1", type: "call.queued", call_id: "c1", created_at: "2000-01-06T10:00:00Z" },
          { id: "e2", type: "call.started", call_id: "c1", created_at: "2000-01-06T09:00:00" },
        ],
      },
    ],
  });
  assert.deepEqual(
    built.observed.timeline.map((e) => e.type),
    ["call.queued", "call.started"],
    "sorting a mix of zoned and naive timestamps would invent an order",
  );
});

test("a zoned timeline is sorted oldest first", () => {
  const built = buildEvidence({
    read: cleanRead(),
    events: [
      {
        data: [
          { id: "e2", type: "call.completed", call_id: "c1", created_at: "2000-01-06T10:05:00Z" },
          { id: "e1", type: "call.queued", call_id: "c1", created_at: "2000-01-06T10:00:00Z" },
        ],
      },
    ],
  });
  assert.deepEqual(built.observed.timeline.map((e) => e.type), [
    "call.queued",
    "call.completed",
  ]);
  assert.equal(timelineSpanMs(built), 5 * 60 * 1000);
});

test("stuck fires on a non-terminal call past the threshold, and not before", () => {
  const base = buildEvidence({
    read: cleanRead(),
    payload: { id: "c1", status: "queued" },
    events: [
      {
        data: [
          { id: "e1", type: "call.queued", call_id: "c1", created_at: "2000-01-06T12:00:00Z" },
        ],
      },
    ],
  });

  const early = detectStuck(base, { now: () => new Date("2000-01-06T12:05:00Z") });
  assert.equal(early, null, "five minutes is still inside the SDK's own wait");

  const late = detectStuck(base, { now: () => new Date("2000-01-06T12:49:00Z") });
  assert.ok(late);
  assert.match(late!.summary, /49 minutes/);
  assert.match(late!.summary, /never been dialled/);
  assert.ok(late!.from.length > 0, "a flag must point at what set it");
});

test("stuck does not fire on a terminal call however old", () => {
  const done = buildEvidence({
    read: cleanRead(),
    payload: { id: "c1", status: "completed" },
    events: [
      {
        data: [
          { id: "e1", type: "call.queued", call_id: "c1", created_at: "2020-01-01T00:00:00Z" },
        ],
      },
    ],
  });
  assert.equal(detectStuck(done, { now: () => new Date("2000-01-06T12:00:00Z") }), null);
});

test("replay fires only when the call predates the request", () => {
  const built = buildEvidence({
    read: cleanRead(),
    payload: { id: "c1", status: "completed" },
    events: [
      {
        data: [
          { id: "e1", type: "call.queued", call_id: "c1", created_at: "2000-01-06T10:00:00Z" },
        ],
      },
    ],
  });
  assert.ok(detectReplayed(built, "2000-01-06T11:00:00Z"));
  assert.equal(detectReplayed(built, "2000-01-06T09:00:00Z"), null);
  assert.equal(detectReplayed(built, undefined), null, "no request time, no claim");
  assert.equal(
    detectReplayed(built, "2000-01-06T11:00:00"),
    null,
    "a naive request time cannot be compared",
  );
});

test("an unknown submission is never reported as safe to retry", () => {
  const unknown = pkg({
    authorized: {
      destination: sourced("+13*******11", ["intent.authorization.destination"]),
      purpose: sourced("confirm", ["intent.authorization.purpose"]),
      authorizedAt: sourced("2000-01-06T11:00:00Z", ["intent.createdAt"]),
      idempotencyKey: sourced("ah_w1_abc", ["intent.idempotencyKey"]),
      ledgerState: sourced("submission_unknown", ["intent.state"]),
      boundId: null,
    },
  });
  const flag = detectRetryUnsafe(unknown);
  assert.ok(flag);
  assert.match(flag!.summary, /rings a real person twice/);
});

test("a 422 retry points at the derived key rather than telling you to make a new one", () => {
  const accepted = pkg({
    authorized: {
      destination: sourced("+13*******11", ["intent.authorization.destination"]),
      purpose: sourced("confirm", ["intent.authorization.purpose"]),
      authorizedAt: sourced("2000-01-06T11:00:00Z", ["intent.createdAt"]),
      idempotencyKey: sourced("ah_w1_abc", ["intent.idempotencyKey"]),
      ledgerState: sourced("accepted", ["intent.state"]),
      boundId: sourced("call_1", ["intent.boundId"]),
    },
  });
  const flag = detectRetryUnsafe(accepted, 422);
  assert.ok(flag);
  assert.match(flag!.summary, /same one is correct for the next attempt/);
});

test("a naive attempt timestamp is reported as an unusable clock", () => {
  const built = buildEvidence({
    read: cleanRead(),
    payload: {
      id: "c1",
      status: "failed",
      recipients: [
        {
          attempts: [
            {
              started_at: "2000-01-02T21:14:05",
              completed_at: "2000-01-02T21:15:38",
              failure_code: "408",
            },
          ],
        },
      ],
    },
  });
  const flag = detectDurationUnreliable(built);
  assert.ok(flag);
  assert.match(flag!.summary, /timezone/);
  assert.deepEqual(flag!.from, ["recipients[0].attempts[0]"]);
});

test("start equal to end is reported as no time at all", () => {
  const built = buildEvidence({
    read: cleanRead(),
    payload: {
      id: "c1",
      status: "failed",
      recipients: [
        {
          attempts: [
            {
              started_at: "2000-01-04T05:42:10.250000Z",
              completed_at: "2000-01-04T05:42:10.250000Z",
            },
          ],
        },
      ],
    },
  });
  const flag = detectDurationUnreliable(built);
  assert.ok(flag);
  assert.match(flag!.summary, /no time at all/);
});

test("flags come back in weight order and the package is not mutated", () => {
  const base = buildEvidence({
    read: cleanRead(),
    payload: {
      id: "c1",
      status: "queued",
      recipients: [
        {
          attempts: [
            { started_at: "2000-01-02T21:14:05", completed_at: "2000-01-02T21:15:38" },
          ],
        },
      ],
    },
    events: [
      {
        data: [
          { id: "e1", type: "call.queued", call_id: "c1", created_at: "2000-01-06T10:00:00Z" },
        ],
      },
    ],
  });
  const flagged = withFlags(base, { now: () => new Date("2000-01-06T12:00:00Z") });

  assert.equal(base.flags.length, 0, "the original must not grow flags underneath a renderer");
  assert.ok(flagged.flags.length >= 2);
  const weights = flagged.flags.map((f) => f.weight);
  assert.deepEqual(weights, [...weights].sort((a, b) => b - a));
  assert.equal(flagged.flags[0]!.code, "stuck");
});

test("a call nobody is watching outranks one whose clock is wrong", () => {
  const stuck = classify(
    withFlags(
      buildEvidence({
        read: cleanRead(),
        payload: { id: "c1", status: "queued" },
        events: [
          {
            data: [
              { id: "e1", type: "call.queued", call_id: "c1", created_at: "2000-01-06T10:00:00Z" },
            ],
          },
        ],
      }),
      { now: () => new Date("2000-01-06T12:00:00Z") },
    ),
  );
  assert.equal(stuck.band, "unwatched");
  assert.equal(stuck.rank, 0);
  assert.ok(stuck.because.from.length > 0);
});

test("the done-on-a-machine pairing lands in false_done", () => {
  const r = classify(
    pkg({
      read: read({
        endstate: {
          value: "answered_machine",
          basis: "quoted",
          from: ["answered_by"],
          note: "n",
        },
      }),
    }),
  );
  assert.equal(r.band, "false_done");
  assert.match(r.because.summary, /nothing here says a person was on the line/);
});

test("a clean call is the only thing that reaches as_expected", () => {
  assert.equal(classify(pkg()).band, "as_expected");
});

test("the briefing collapses the routine majority and counts what needs a person", () => {
  const clean = () => pkg();
  const bad = () =>
    pkg({
      read: read({
        endstate: { value: "answered_machine", basis: "quoted", from: ["answered_by"], note: "n" },
      }),
    });

  const b = rankBatch([bad(), clean(), clean(), bad(), clean()]);
  assert.equal(b.total, 5);
  assert.equal(b.needing, 2);
  assert.equal(b.routine.length, 3);
  assert.equal(b.groups.length, 1);
  assert.equal(b.groups[0]!.band, "false_done");
});

test("groups come back in band order", () => {
  const order = BANDS.map((b) => b.code);
  const stuckPkg = withFlags(
    buildEvidence({
      read: cleanRead(),
      payload: { id: "c1", status: "queued" },
      events: [
        {
          data: [
            { id: "e1", type: "call.queued", call_id: "c1", created_at: "2000-01-06T10:00:00Z" },
          ],
        },
      ],
    }),
    { now: () => new Date("2000-01-06T12:00:00Z") },
  );
  const falseDone = pkg({
    read: read({
      endstate: { value: "answered_machine", basis: "quoted", from: ["answered_by"], note: "n" },
    }),
  });

  const b = rankBatch([falseDone, stuckPkg]);
  const got = b.groups.map((g) => g.band);
  const sorted = [...got].sort((x, y) => order.indexOf(x) - order.indexOf(y));
  assert.deepEqual(got, sorted);
  assert.equal(got[0], "unwatched");
});

test("every ending has a clause and none of them mention a field name", () => {
  for (const [ending, clause] of Object.entries(ENDING_CLAUSES)) {
    assert.ok(clause.length > 0, `${ending} needs words`);
    assert.ok(clause.endsWith("."), `${ending} should be a sentence`);
    assert.ok(!/_/.test(clause), `${ending} leaked a field name into the copy`);
  }
});

test("no briefing line carries more than two clauses", () => {
  const cases = [
    pkg({ read: read({ endstate: { value: "answered_machine", basis: "quoted", from: ["a"], note: "n" } }) }),
    pkg({ read: read({ resultState: { value: "unsourced", basis: "derived", from: ["r"], note: "n" } }) }),
    pkg(),
  ];
  for (const p of cases) {
    const line = phrase(classify(p)).line;
    const sentences = line.split(". ").filter((s) => s.length > 0);
    assert.ok(sentences.length <= 2, `too many clauses: ${line}`);
  }
});

test("doubts never stack: exactly one is chosen", () => {
  const many = pkg({
    read: read({
      endstate: { value: "answered_machine", basis: "derived", from: ["a"], note: "n" },
      resultState: { value: "unsourced", basis: "derived", from: ["r"], note: "n" },
    }),
  });
  const c = phrase(classify(many)).clauses;
  assert.equal(c.doubt, "Nobody can say a person was on the line.", "the costliest doubt wins");
});

test("the action clause is the only instruction, and a clean call is cleared to act on", () => {
  assert.equal(phrase(classify(pkg())).clauses.action, "Safe to act on.");
});

test("the headline is a decision and carries no percentage", () => {
  assert.equal(headline(3, 12), "Three of twelve need you today.");
  assert.equal(headline(1, 12), "One of twelve needs you today.");
  assert.equal(headline(0, 12), "All twelve look fine.");
  assert.equal(headline(0, 0), "No calls to go through.");
  for (const h of [headline(3, 12), headline(1, 4), headline(0, 9)]) {
    assert.ok(!h.includes("%"), "no percentages anywhere");
  }
});

test("the subline says what was left out rather than hiding it", () => {
  assert.equal(subline(9), "Nine behaved as expected.");
  assert.equal(subline(1), "One behaved as expected.");
  assert.equal(subline(0), null);
});

test("an undocumented status counts as still open and is named as undocumented", async () => {
  const { isOpen, isDocumentedStatus, detectStuck: ds } = await import(
    "asheard/reconciler"
  );
  assert.equal(isOpen("preparing"), true, "a status nobody documented is not an ending");
  assert.equal(isDocumentedStatus("preparing"), false);
  assert.equal(isOpen("completed"), false);
  assert.equal(isOpen("queued"), true);

  const built = buildEvidence({
    read: cleanRead(),
    payload: { id: "c1", status: "preparing" },
    events: [
      {
        data: [
          { id: "e1", type: "call.queued", call_id: "c1", created_at: "2000-01-06T10:00:00Z" },
        ],
      },
    ],
  });
  const flag = ds(built, { now: () => new Date("2000-01-06T12:00:00Z") });
  assert.ok(flag);
  assert.match(flag!.summary, /not one of the five states/);
});

test("terminal is defined once in this library", async () => {
  const client = await import("asheard/calle");
  const flags = await import("asheard/reconciler");
  for (const s of ["completed", "failed", "canceled"]) {
    assert.equal(client.isTerminal(s), true);
    assert.equal(flags.isOpen(s), false, `${s} must not read as open`);
  }
  for (const s of ["queued", "in_progress"]) {
    assert.equal(client.isTerminal(s), false);
    assert.equal(flags.isOpen(s), true);
  }
});

test("a wider event stream than attempt window is not a contradiction", async () => {
  // The usual shape: the stream covers queuing and finalization, the
  // attempt covers the dial. The stream being wider is expected, not a defect.
  const built = buildEvidence({
    read: cleanRead(),
    payload: {
      id: "c1",
      status: "completed",
      recipients: [
        {
          attempts: [
            {
              started_at: "2000-01-06T09:10:41.250000Z",
              completed_at: "2000-01-06T09:11:19.750000Z",
            },
          ],
        },
      ],
    },
    events: [
      {
        data: [
          { id: "e1", type: "call.started", call_id: "c1", created_at: "2000-01-06T09:10:04.500000Z" },
          { id: "e2", type: "call.completed", call_id: "c1", created_at: "2000-01-06T09:11:27.000000Z" },
        ],
      },
    ],
  });
  assert.equal(detectDurationUnreliable(built), null);
});

test("an attempt longer than the whole call is a contradiction", () => {
  const built = buildEvidence({
    read: cleanRead(),
    payload: {
      id: "c1",
      status: "completed",
      recipients: [
        {
          attempts: [
            { started_at: "2000-01-06T09:10:00Z", completed_at: "2000-01-06T09:20:00Z" },
          ],
        },
      ],
    },
    events: [
      {
        data: [
          { id: "e1", type: "call.started", call_id: "c1", created_at: "2000-01-06T09:10:00Z" },
          { id: "e2", type: "call.completed", call_id: "c1", created_at: "2000-01-06T09:11:00Z" },
        ],
      },
    ],
  });
  const flag = detectDurationUnreliable(built);
  assert.ok(flag);
  assert.match(flag!.summary, /One of those two is wrong/);
});

test("an attempt timestamped outside the call's own window is reported", () => {
  const built = buildEvidence({
    read: cleanRead(),
    payload: {
      id: "c1",
      status: "completed",
      recipients: [
        {
          attempts: [
            { started_at: "2000-01-06T08:00:00Z", completed_at: "2000-01-06T08:00:30Z" },
          ],
        },
      ],
    },
    events: [
      {
        data: [
          { id: "e1", type: "call.started", call_id: "c1", created_at: "2000-01-06T09:10:00Z" },
          { id: "e2", type: "call.completed", call_id: "c1", created_at: "2000-01-06T09:11:00Z" },
        ],
      },
    ],
  });
  const flag = detectDurationUnreliable(built);
  assert.ok(flag);
  assert.match(flag!.summary, /outside the window/);
});

test("only an explicitly human answered-by can produce answered_human", async () => {
  // The safety property. answered_human is the only member of
  // CONVERSATIONAL_ENDSTATES, so it is the value that clears the fail-closed
  // pairing rule. Nothing automated may reach it.
  const { normalizeCallsApi } = await import("asheard/disposition");

  const withAnsweredBy = (v: string) =>
    normalizeCallsApi({
      id: "c1",
      status: "completed",
      task_completed: true,
      structured_result: { answer: "x", evidence: "y" },
      recipients: [{ structured_result: { answered_by: v }, attempts: [] }],
    } as never);

  for (const machine of ["ivr", "menu", "auto_attendant", "voicemail", "machine", "vm"]) {
    const d = withAnsweredBy(machine);
    assert.equal(
      d.endstate.value,
      "answered_machine",
      `"${machine}" must never read as a person picking up`,
    );
    assert.equal(d.needsHuman, true, `"${machine}" with task_completed must route to a person`);
  }

  for (const human of ["human", "person", "live", "agent"]) {
    assert.equal(withAnsweredBy(human).endstate.value, "answered_human");
  }

  // The exact live payload that exposed the bug.
  const live = withAnsweredBy("ivr");
  assert.equal(live.endstate.basis, "quoted");
  assert.deepEqual(live.endstate.from, ["recipients[0].structured_result.answered_by"]);
});

test("the transcript is read from where the API actually puts it", async () => {
  // Every payload the API returns hangs the transcript off the attempt. An
  // earlier version of readTurns looked only at the top level and therefore
  // reported "no transcript" for every real call, while its own test passed
  // against a fixture shaped the way the author assumed.
  const real = (await import("asheard/fixtures/calls-api/completed-voicemail-task-completed.json", {
    with: { type: "json" },
  })).default as Record<string, unknown>;

  const built = buildEvidence({ read: cleanRead(), payload: real });
  assert.ok(built.observed.turns, "a payload with a transcript must report turn counts");
  assert.ok(built.observed.turns!.value.total > 0);
  assert.match(built.observed.turns!.from[0]!, /recipients\[0\]\.attempts\[0\]\.transcript_turns/);

  // A payload with no transcript anywhere is still a different fact from one
  // with an empty transcript, and must stay null rather than becoming zero.
  const none = buildEvidence({
    read: cleanRead(),
    payload: { id: "c1", status: "completed", recipients: [{ attempts: [{}] }] },
  });
  assert.equal(none.observed.turns, null);
});

test("an unflagged package cannot be ranked", () => {
  // An empty flag list means either nothing fired or nobody looked, and those
  // are opposite facts. Ranking the second as though it were the first is how
  // a stuck call ends up in the "behaved as expected" line.
  const raw = buildEvidence({ read: cleanRead() });
  assert.equal(raw.flagsComputed, false);
  assert.throws(() => classify(raw), /has not been through the detectors/);

  const done = withFlags(raw);
  assert.equal(done.flagsComputed, true);
  assert.doesNotThrow(() => classify(done));
});

test("an open call with no usable clock is reported, dialled or not", () => {
  // Without a zoned event there is no way to say how long it has been open.
  // That is a finding, not a reason to stay quiet.
  const dialled = buildEvidence({
    read: cleanRead(),
    payload: {
      id: "c1",
      status: "in_progress",
      recipients: [{ attempts: [{ started_at: "2000-01-06T09:00:00Z" }] }],
    },
  });
  const flag = detectStuck(dialled, { now: () => new Date("2000-01-06T12:00:00Z") });
  assert.ok(flag, "a call that is open with no clock must not read as fine");
  assert.match(flag!.summary, /nothing here says how long/);
});

test("every dialable destination is a US number", async () => {
  // CALL-E refuses Canadian destinations with 422 unsupported_region, and a
  // demo button that cannot place its call is worse than one that is not
  // offered. The fiction range exists in every area code, so this costs
  // nothing to hold to.
  const { DESTINATIONS, isAllowedDestination } = await import(
    "asheard/reconciler"
  );
  const CANADIAN = new Set(["204", "226", "236", "249", "250", "289", "306", "343", "365", "387", "403", "416", "418", "431", "437", "438", "450", "506", "514", "519", "548", "579", "581", "587", "604", "613", "639", "647", "672", "705", "709", "742", "778", "780", "782", "807", "819", "825", "867", "873", "902", "905"]);

  for (const d of DESTINATIONS) {
    assert.match(d.e164, /^\+1\d{10}$/, `${d.id} must be a NANP number in E.164`);
    const area = d.e164.slice(2, 5);
    assert.ok(!CANADIAN.has(area), `${d.id} is in Canadian area code ${area}, which CALL-E refuses`);
    assert.ok(isAllowedDestination(d.e164));
  }
  assert.equal(isAllowedDestination("+13035550199"), false);
});

test("404 on the attempt reads as unreachable, derived", async () => {
  // Observed 6 Sep 2026 against +1 303 555 0100, a number in the range held
  // back for fiction and assigned to nobody. Nothing rang.
  const { normalizeCallsApi } = await import("asheard/disposition");
  const d = normalizeCallsApi({
    id: "c1",
    status: "failed",
    failure_code: "call_failed",
    recipients: [{ attempts: [{ failure_code: "404" }] }],
  } as never);
  assert.equal(d.endstate.value, "unreachable");
  assert.equal(d.endstate.basis, "derived", "an undocumented code is never quoted");
  assert.equal(d.needsHuman, true);
});

test("an attempt code nobody has watched happen stays unknown", async () => {
  const { normalizeCallsApi } = await import("asheard/disposition");
  const d = normalizeCallsApi({
    id: "c1",
    status: "failed",
    recipients: [{ attempts: [{ failure_code: "503" }] }],
  } as never);
  assert.equal(d.endstate.value, "unknown");
  assert.match(d.endstate.note, /never been watched happen/);
});
