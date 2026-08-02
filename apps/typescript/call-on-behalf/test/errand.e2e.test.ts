/**
 * End to end over the real `@call-e/calle` client against a local fake CALL-E.
 * No credentials, no network beyond localhost, no phone line.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createSdkPort } from "../src/calle.js";
import { PreflightError, runErrand } from "../src/errand.js";
import { startFakeCalle, type FakeScript } from "../fake/calle-server.js";
import { BOT_LINES, CLINIC, errandRequest, goodResult, USER_LINES } from "./fixtures.js";

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

test("a clean errand comes back answered, agreed and with a transcript", async () => {
  await withFake(
    [{ phone: CLINIC, botLines: BOT_LINES, userLines: USER_LINES, structuredResult: goodResult() }],
    async (port, fake) => {
      const report = await runErrand({ request: errandRequest(), port, pollIntervalMs: 5 });
      assert.equal(report.outcome, "goal_met");
      assert.equal(report.commitment, "committed");
      assert.equal(report.committed_datetime, "2026-08-13T09:40:00-07:00");
      assert.equal(report.confirmation_code, "4471");
      assert.equal(report.answers.every((answer) => answer.answered), true);
      // Every answer names the turn it came from, because that is what makes it an answer.
      assert.equal(report.answers.every((answer) => answer.quote.length > 0), true);
      assert.match(report.answers[1]!.quote, /Yes, we take Blue Shield PPO/);
      assert.match(report.callee_notes, /They agreed with: "Earliest is Thursday/);
      assert.deepEqual(report.disclosed, [
        "the caller's full name",
        "date of birth",
        "insurance plan name",
      ]);
      assert.deepEqual(report.authorized_but_unused, []);
      assert.deepEqual(report.leaks, []);
      assert.equal(report.reached_person, true);
      assert.equal(report.transcript.length, 10);
      assert.equal(report.callee_phone_masked, "+14*******22");

      const created = fake.created[0]!;
      assert.match(created.idempotencyKey ?? "", /^cob-bayview-checkup-aug-[0-9a-f]{12}$/);
      assert.equal(created.locale, "en-US");
      assert.equal(created.metadata.errand_id, "bayview-checkup-aug");
      assert.equal(created.resultSchema?.additionalProperties, false);
      // Why the call was delegated is the person's business, not the callee's.
      assert.equal(created.task.includes("she is deaf"), false);
    },
  );
});

test("a time outside the authorized windows is reported as an unauthorized agreement", async () => {
  await withFake(
    [
      {
        phone: CLINIC,
        botLines: BOT_LINES,
        userLines: [
          "Bayview Family Clinic, how can I help?",
          "Let me look. Can I take the date of birth?",
          "Nothing this week. I have put her in for Saturday the fifteenth at ten o'clock.",
          "Yes, we take Blue Shield PPO.",
          "Photo identification and the insurance card.",
        ],
        structuredResult: goodResult("2026-08-15T10:00:00-07:00"),
      },
    ],
    async (port) => {
      const report = await runErrand({ request: errandRequest(), port, pollIntervalMs: 5 });
      assert.equal(report.commitment, "outside_authorized_window");
      assert.equal(report.committed_datetime, null);
      assert.match(report.next_step, /outside the windows you authorized/);
      assert.match(report.next_step, /cancel it if it does not work/);
    },
  );
});

test("a time the caller was not allowed to accept comes back as a proposal", async () => {
  await withFake(
    [
      {
        phone: CLINIC,
        botLines: BOT_LINES,
        userLines: [
          "Bayview Family Clinic, how can I help?",
          "Let me look. Can I take the date of birth?",
          "Nothing this week. I could do the twentieth at eleven.",
          "Yes, we take Blue Shield PPO.",
          "Photo identification and the insurance card.",
        ],
        structuredResult: {
          ...goodResult(),
          commitment_made: "other_time_offered",
          offered_datetime: "2026-08-20T11:00:00-07:00",
          confirmation_code: "",
        },
      },
    ],
    async (port) => {
      const report = await runErrand({ request: errandRequest(), port, pollIntervalMs: 5 });
      assert.equal(report.commitment, "proposal_only");
      assert.equal(report.outcome, "partially_met");
      assert.match(report.next_step, /Thursday, August 20 at 11:00 AM/);
      assert.match(report.next_step, /nothing was agreed/);
    },
  );
});

test("a time only the extraction knows about is not read back as an offer", async () => {
  await withFake(
    [
      {
        phone: CLINIC,
        botLines: BOT_LINES,
        userLines: USER_LINES,
        structuredResult: {
          ...goodResult(),
          commitment_made: "other_time_offered",
          offered_datetime: "2026-08-20T11:00:00-07:00",
          confirmation_code: "",
        },
      },
    ],
    async (port) => {
      const report = await runErrand({ request: errandRequest(), port, pollIntervalMs: 5 });
      assert.equal(report.commitment, "proposal_only");
      assert.match(report.next_step, /They offered another time and nothing was agreed/);
      assert.equal(report.next_step.includes("August 20"), false);
    },
  );
});

test("a business that will not deal with an automated caller is reported plainly", async () => {
  await withFake(
    [
      {
        phone: CLINIC,
        botLines: BOT_LINES.slice(0, 2),
        userLines: [
          "Bayview Family Clinic.",
          "Sorry, we do not take bookings from automated systems. She has to call us directly.",
        ],
        structuredResult: {
          ...goodResult(),
          commitment_made: "declined_by_callee",
          callee_declined_automated: "yes",
          notes: "asked for the patient to call",
        },
      },
    ],
    async (port) => {
      const report = await runErrand({ request: errandRequest(), port, pollIntervalMs: 5 });
      assert.equal(report.outcome, "callee_declined_automated");
      assert.match(report.next_step, /will not deal with an automated caller/);
      assert.match(report.next_step, /relay service/);
      assert.match(report.callee_notes, /we do not take bookings from automated systems/);
    },
  );
});

test("voicemail asks nothing and says so", async () => {
  await withFake(
    [
      {
        phone: CLINIC,
        botLines: ["Hello, I am an automated assistant."],
        userLines: ["You have reached Bayview Family Clinic. Please leave a message after the tone."],
        structuredResult: null,
      },
    ],
    async (port) => {
      const report = await runErrand({ request: errandRequest(), port, pollIntervalMs: 5 });
      assert.equal(report.outcome, "voicemail");
      assert.equal(report.answers.every((answer) => !answer.answered), true);
      assert.match(report.next_step, /went to a machine/);
    },
  );
});

test("a refusal from CALL-E is reported without inventing a call", async () => {
  await withFake([{ phone: CLINIC, apiError: { status: 402, code: "insufficient_balance" } }], async (port, fake) => {
    const report = await runErrand({ request: errandRequest(), port, pollIntervalMs: 5 });
    assert.equal(report.outcome, "api_error");
    assert.equal(report.call_id, null);
    assert.equal(report.callee_notes, "insufficient_balance");
    assert.match(report.next_step, /refused to create the call/);
    assert.deepEqual(report.transcript, []);
    assert.equal(fake.created.length, 0);
  });
});

test("a detail the caller volunteered on its own is reported to the person it belongs to", async () => {
  await withFake(
    [
      {
        phone: CLINIC,
        botLines: [...BOT_LINES, "Her record number is AB-994512, does that help?"],
        userLines: USER_LINES,
        structuredResult: goodResult(),
      },
    ],
    async (port) => {
      const report = await runErrand({ request: errandRequest(), port, pollIntervalMs: 5 });
      assert.equal(report.leaks.length, 1);
      assert.equal(report.leaks[0]!.kind, "identifier");
      assert.equal(report.leaks[0]!.severity, "block");
      assert.equal(report.leaks[0]!.masked.includes("994512"), false);
    },
  );
});

test("a script that would say something unauthorized never places the call", async () => {
  await withFake([{ phone: CLINIC, structuredResult: goodResult() }], async (port, fake) => {
    const request = errandRequest({
      goal: { summary: "ask them to email fatima.haddad@example.com about the check-up", commitment: "none" },
    });
    await assert.rejects(
      () => runErrand({ request, port, pollIntervalMs: 5 }),
      (error: unknown) => {
        assert.ok(error instanceof PreflightError);
        assert.match(error.message, /email address/);
        assert.match(error.message, /No call was placed/);
        return true;
      },
    );
    assert.equal(fake.created.length, 0);
  });
});

test("a retried errand reuses the call it already placed", async () => {
  await withFake(
    [{ phone: CLINIC, botLines: BOT_LINES, userLines: USER_LINES, structuredResult: goodResult() }],
    async (port, fake) => {
      const request = errandRequest();
      const first = await runErrand({ request, port, pollIntervalMs: 5 });
      const second = await runErrand({ request, port, pollIntervalMs: 5 });
      assert.equal(first.outcome, "goal_met");
      assert.equal(second.outcome, "goal_met");
      assert.equal(fake.created.length, 1);
    },
  );
});

test("a low completion confidence stops the report claiming the errand is done", async () => {
  await withFake(
    [
      {
        phone: CLINIC,
        botLines: BOT_LINES,
        userLines: USER_LINES,
        structuredResult: goodResult(),
        confidence: { score: 0.2, label: "low" },
      },
    ],
    async (port) => {
      const report = await runErrand({ request: errandRequest(), port, pollIntervalMs: 5 });
      assert.equal(report.outcome, "partially_met");
      assert.match(report.callee_notes, /scored its own completion low/);
    },
  );
});

test("an errand that only asks questions never agrees to anything", async () => {
  await withFake(
    [
      {
        phone: CLINIC,
        botLines: BOT_LINES,
        userLines: USER_LINES,
        structuredResult: { ...goodResult(), commitment_made: "none", offered_datetime: "", confirmation_code: "" },
      },
    ],
    async (port, fake) => {
      const request = errandRequest({
        goal: { summary: "ask what a first appointment needs", commitment: "none" },
        authorized_windows: [],
      });
      const report = await runErrand({ request, port, pollIntervalMs: 5 });
      assert.equal(report.commitment, "none_sought");
      assert.equal(report.outcome, "goal_met");
      assert.equal(fake.created[0]!.task.includes("You may not agree to anything"), true);
    },
  );
});

test("an answer the transcript does not support is reported as not answered", async () => {
  await withFake(
    [
      {
        phone: CLINIC,
        botLines: BOT_LINES.slice(0, 2),
        userLines: ["Bayview Family Clinic.", "Let me take a look for you."],
        structuredResult: goodResult(),
      },
    ],
    async (port) => {
      const report = await runErrand({ request: errandRequest(), port, pollIntervalMs: 5 });
      assert.equal(report.reached_person, true);
      assert.equal(report.answers.every((answer) => !answer.answered), true);
      assert.equal(report.answers.every((answer) => answer.answer === ""), true);
      assert.equal(report.answers.every((answer) => answer.quote === ""), true);
      assert.match(report.callee_notes, /3 answer\(s\) the transcript does not support/);
    },
  );
});

test("an agreement the transcript does not show is not reported as agreed", async () => {
  await withFake(
    [
      {
        phone: CLINIC,
        botLines: BOT_LINES,
        userLines: [
          "Bayview Family Clinic, how can I help?",
          "Let me look. Can I take the date of birth?",
          "Earliest is Thursday the thirteenth at nine forty in the morning.",
          "Yes, we take Blue Shield PPO.",
          "Photo identification and the insurance card.",
        ],
        structuredResult: goodResult(),
      },
    ],
    async (port) => {
      const report = await runErrand({ request: errandRequest(), port, pollIntervalMs: 5 });
      assert.equal(report.commitment, "unconfirmed");
      assert.equal(report.committed_datetime, null);
      assert.equal(report.confirmation_code, "");
      assert.equal(report.outcome, "partially_met");
      assert.equal(report.answers.every((answer) => answer.answered), true);
      assert.match(report.callee_notes, /no turn in the transcript shows anybody agreeing/);
      assert.match(report.next_step, /treat nothing as booked/);
    },
  );
});

test("a create whose answer was lost is reconciled under the same key, not dialled again", async () => {
  await withFake(
    [
      {
        phone: CLINIC,
        botLines: BOT_LINES,
        userLines: USER_LINES,
        structuredResult: goodResult(),
        lostCreateResponse: true,
      },
    ],
    async (port, fake) => {
      const lines: string[] = [];
      const report = await runErrand({
        request: errandRequest(),
        port,
        pollIntervalMs: 5,
        onProgress: (line) => lines.push(line),
      });
      assert.equal(report.outcome, "goal_met");
      assert.equal(fake.created.length, 1);
      assert.ok(lines.some((line) => line.includes("reconciling under the same key")));
    },
  );
});

test("a call that cannot be read comes back unknown and does not claim nothing was said", async () => {
  await withFake(
    [
      {
        phone: CLINIC,
        botLines: BOT_LINES,
        userLines: USER_LINES,
        structuredResult: goodResult(),
        pollError: { status: 503, code: "service_unavailable" },
      },
    ],
    async (port, fake) => {
      const report = await runErrand({ request: errandRequest(), port, pollIntervalMs: 5 });
      assert.equal(report.outcome, "outcome_unknown");
      assert.equal(report.call_status, "unknown");
      assert.equal(report.call_id, fake.created[0]!.id);
      assert.equal(report.commitment, "unconfirmed");
      assert.match(report.callee_notes, /service_unavailable/);
      assert.equal(report.next_step.includes("Nothing was said"), false);
      assert.match(report.next_step, /nobody knows yet whether the call was made/);
      assert.match(report.next_step, /reads that same call back/);
      assert.equal(fake.created.length, 1);
    },
  );
});

test("an errand that cannot be created at all is unknown, not a refusal", async () => {
  await withFake(
    [{ phone: CLINIC, apiError: { status: 503, code: "service_unavailable" } }],
    async (port, fake) => {
      const report = await runErrand({ request: errandRequest(), port, pollIntervalMs: 5 });
      assert.equal(report.outcome, "outcome_unknown");
      assert.equal(report.call_id, null);
      assert.match(report.callee_notes, /could not be reconciled/);
      assert.equal(fake.created.length, 0);
    },
  );
});
