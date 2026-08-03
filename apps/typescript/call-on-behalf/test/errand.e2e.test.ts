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

/**
 * The three claims below are the same kind of mistake: a fact stated on evidence
 * that does not carry it. A definite answer to a reconciliation is read as proof
 * that no call was ever placed. A status CALL-E ended a call with is read as proof
 * that nothing was said on it. An extraction saying the callee refused is read as
 * the errand being done.
 */

test("a definite refusal on the reconcile is not proof the call was never made", async () => {
  // 401, 403, 400 and 402 can each be decided before the idempotency lookup ever
  // happens, so none of them says anything about the create that went unanswered.
  // Only getting the call back settles that.
  const definite = [
    { status: 401, code: "unauthorized" },
    { status: 403, code: "forbidden" },
    { status: 400, code: "bad_request" },
    { status: 402, code: "insufficient_balance" },
  ];
  for (const second of definite) {
    await withFake(
      [{ phone: CLINIC, createErrors: [{ status: 503, code: "service_unavailable" }, second] }],
      async (port, fake) => {
        const report = await runErrand({ request: errandRequest(), port, pollIntervalMs: 5 });
        assert.equal(report.outcome, "outcome_unknown", `${second.code} was read as proof of no call`);
        assert.equal(report.call_status, "unknown", second.code);
        assert.equal(report.call_id, null, "no answer ever named the call");
        assert.equal(
          report.callee_notes,
          `the call could not be reconciled (service_unavailable, then ${second.code})`,
        );
        assert.equal(report.commitment, "unconfirmed", "a call nobody can account for may have agreed something");
        assert.deepEqual(report.authorized_but_unused, [], "what the caller said is not known either");
        assert.match(report.next_step, /nobody knows yet whether the call was made/);
        assert.equal(report.next_step.includes("Nothing was said"), false, second.code);
        assert.equal(report.next_step.includes("refused to create the call"), false, second.code);
        assert.equal(fake.created.length, 0, "no second call was ever placed");
      },
    );
  }
});

test("a call that ended early still reports the conversation it carried", async () => {
  // A line that drops after the booking comes back as `failed`, sometimes with a
  // code that reads like nobody answered. The transcript holds the questions, the
  // answers and the slot, so the status cannot unsay any of it.
  const cases: [string, string | null][] = [
    ["failed", "line_dropped"],
    ["failed", "no_answer"],
    ["canceled", null],
  ];
  for (const [status, failureCode] of cases) {
    await withFake(
      [
        {
          phone: CLINIC,
          status: status as "failed" | "canceled",
          failureCode,
          botLines: BOT_LINES,
          userLines: USER_LINES,
          structuredResult: goodResult(),
        },
      ],
      async (port) => {
        const label = `${status}/${String(failureCode)}`;
        const report = await runErrand({ request: errandRequest(), port, pollIntervalMs: 5 });
        assert.equal(report.call_status, status, label);
        assert.equal(report.reached_person, true, `${label} was read as nobody on the line`);
        assert.equal(report.outcome, "partially_met", label);
        assert.equal(report.answers.every((answer) => answer.answered), true, `${label} lost the answers`);
        assert.equal(report.commitment, "committed", label);
        assert.equal(report.committed_datetime, "2026-08-13T09:40:00-07:00", label);
        assert.equal(report.confirmation_code, "4471", label);
        assert.match(report.callee_notes, new RegExp(`call_${status}`), label);
        assert.match(report.next_step, /That is arranged/, label);
        assert.equal(report.next_step.includes("Nothing was said on your behalf"), false, label);
        assert.equal(report.next_step.includes("did not connect to a person"), false, label);
      },
    );
  }
});

test("the transcript says who was on the line, not the failure code beside it", async () => {
  // A machine on the transcript is a machine, whatever code CALL-E filed the call
  // under. The ordering is the point here: the transcript is read before the code.
  await withFake(
    [
      {
        phone: CLINIC,
        status: "failed",
        failureCode: "busy",
        botLines: ["Hello, I am an automated assistant."],
        userLines: ["You have reached Bayview Family Clinic. Please leave a message after the tone."],
        structuredResult: null,
      },
    ],
    async (port) => {
      const report = await runErrand({ request: errandRequest(), port, pollIntervalMs: 5 });
      assert.equal(report.outcome, "voicemail");
      assert.equal(report.reached_person, false);
      assert.match(report.next_step, /went to a machine/);
    },
  );
});

test("a refusal CALL-E reported does not make the errand done", async () => {
  // Nobody agreed to anything, so the appointment the errand asked for was not
  // made. Every question was answered, which is partly met and not met in full.
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
        structuredResult: {
          ...goodResult(),
          commitment_made: "declined_by_callee",
          offered_datetime: "",
          confirmation_code: "",
        },
      },
    ],
    async (port) => {
      const report = await runErrand({ request: errandRequest(), port, pollIntervalMs: 5 });
      // Nobody refused anything in this transcript, they offered a slot. So the
      // refusal is the extraction's claim alone and the report will not state it.
      assert.equal(report.commitment, "unconfirmed");
      assert.equal(report.answers.every((answer) => answer.answered), true);
      assert.equal(report.outcome, "partially_met");
      assert.match(report.next_step, /nothing is settled either way/);
      assert.equal(report.next_step.includes("did not ask for anything to be agreed"), false);
      assert.match(report.callee_notes, /no turn in the transcript refuses anything/);
    },
  );
});

test("a refusal the callee actually voiced is reported as a refusal", async () => {
  // The other side of the same coin. When a turn plainly refuses the arrangement,
  // the report stands behind it, names the quote and stops calling the errand done.
  await withFake(
    [
      {
        phone: CLINIC,
        botLines: BOT_LINES,
        userLines: [
          "Bayview Family Clinic, how can I help?",
          "Let me look. Can I take the date of birth?",
          "I am afraid we cannot book that over the phone for somebody else.",
          "Yes, we take Blue Shield PPO.",
          "Photo identification and the insurance card.",
        ],
        structuredResult: {
          ...goodResult(),
          commitment_made: "declined_by_callee",
          offered_datetime: "",
          confirmation_code: "",
        },
      },
    ],
    async (port) => {
      const report = await runErrand({ request: errandRequest(), port, pollIntervalMs: 5 });
      assert.equal(report.commitment, "declined_by_callee");
      assert.match(report.next_step, /would not arrange it/);
      assert.match(report.callee_notes, /a turn in the transcript refuses it/);
      assert.match(report.callee_notes, /cannot book that over the phone/);
    },
  );
});

test("a refusal of one of the questions is not a refusal of the errand", async () => {
  // The arrangement was accepted on this call and what the callee turned down was
  // the insurance question. CALL-E still reported declined_by_callee, so the only
  // thing that could stand behind that claim is a turn refusing the arrangement,
  // and there is not one. Reading the insurance refusal as corroboration would tell
  // somebody their appointment was turned down in a call where it was held.
  await withFake(
    [
      {
        phone: CLINIC,
        botLines: BOT_LINES,
        userLines: [
          "Bayview Family Clinic, how can I help?",
          "Let me look. Can I take the date of birth?",
          "Earliest is Thursday the thirteenth at nine forty in the morning. I can hold that slot, reference four four seven one.",
          "No, we do not take Blue Shield PPO.",
          "Photo identification and the insurance card.",
        ],
        structuredResult: {
          ...goodResult(),
          answer_accepts_plan: "no",
          commitment_made: "declined_by_callee",
        },
      },
    ],
    async (port) => {
      const report = await runErrand({ request: errandRequest(), port, pollIntervalMs: 5 });
      assert.equal(report.commitment, "unconfirmed");
      assert.equal(report.committed_datetime, null);
      assert.match(report.next_step, /nothing is settled either way/);
      assert.equal(report.next_step.includes("would not arrange it on this call"), false);
      assert.match(report.callee_notes, /no turn refuses the arrangement/);
      assert.match(report.callee_notes, /we do not take Blue Shield PPO/);
      // The question they did turn down is still answered, out of that same turn.
      assert.equal(report.answers[1]!.answered, true);
      assert.equal(report.answers[1]!.answer, "no");
    },
  );
});

test("an agreement and a refusal in the same call settle nothing", async () => {
  // Both claims have a turn behind them, so the transcript contradicts itself and
  // this app does not pick a side. Reporting the agreement would book something the
  // callee took back, reporting the refusal would drop a slot they may be holding.
  await withFake(
    [
      {
        phone: CLINIC,
        botLines: [
          BOT_LINES[0]!,
          BOT_LINES[1]!,
          BOT_LINES[2]!,
          "Can you hold that slot on Thursday at nine forty?",
          BOT_LINES[4]!,
        ],
        userLines: [
          "Bayview Family Clinic, how can I help?",
          "Let me look. Can I take the date of birth?",
          "Earliest is Thursday the thirteenth at nine forty in the morning. I can hold that slot, reference four four seven one.",
          "Sorry, I am not able to hold that after all.",
          "Photo identification and the insurance card.",
        ],
        structuredResult: goodResult(),
      },
    ],
    async (port) => {
      const report = await runErrand({ request: errandRequest(), port, pollIntervalMs: 5 });
      assert.equal(report.commitment, "unconfirmed");
      assert.equal(report.committed_datetime, null);
      // A reference number belongs to an agreement that stands. This one does not.
      assert.equal(report.confirmation_code, "");
      assert.match(report.next_step, /both somebody agreeing to it and somebody refusing it/);
      assert.match(report.next_step, /call to check/);
      assert.match(report.callee_notes, /an agreement and a refusal for the same arrangement/);
      assert.match(report.callee_notes, /I can hold that slot/);
      assert.match(report.callee_notes, /not able to hold that after all/);
    },
  );
});
