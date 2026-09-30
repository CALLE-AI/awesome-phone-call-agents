import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { addPostCallSearchInstructions, assertFollowupDestination, verifiedCallSummary, verifiedPreviewSearchRequest, verifiedSearchRequest } from "../lib/calle/followup-evidence";
import { CalleFollowupService, composeCalleSearchSms, emptyCalleFollowups } from "../lib/calle/followup-service";
import { parseCalleCallSnapshot } from "../lib/calle/status";
import { EncryptedJsonStore } from "../lib/storage/encrypted-json";
import type { TwilioSmsReceipt } from "../lib/tools/twilio-sms";
import type { SmsAdapter } from "../lib/tools/contracts";
import type { WebSearchResult } from "../lib/tools/search-web";

const destination = "+61491570157";
const question = "Please find the opening hours of Sydney City Library this Saturday.";
const permission = "May I text the search results to this same number after our call?";
const consent = "Yes, please.";
const extraction = { decision: "requested", public_information: "yes", unambiguous: "yes", request_quote: question, consent_question_quote: permission, consent_quote: consent };
function rawCall() { return { id: "call_search123", created_at: "2026-09-14T00:00:00Z", status: "completed", task_completed: true,
  structured_result: { post_call_search: { ...extraction } }, recipients: [{ attempts: [{ id: "attempt_one", transcript_turns: [
    { speaker: "user", text: question }, { speaker: "bot", text: permission }, { speaker: "user", text: consent },
  ] }] }] }; }
const result: WebSearchResult = { answer: "The library opens at 10 AM on Saturday.", correlationId: "11111111-1111-4111-8111-111111111111", query: question, retrievedAt: "2026-09-14T00:00:00Z", sources: [{ title: "Library", url: "https://example.com/library" }], status: "completed" };

test("CALL-E evidence needs a real customer request and adjacent explicit SMS permission", () => {
  assert.equal(verifiedSearchRequest(parseCalleCallSnapshot(rawCall())), question);
  for (const changed of [
    { ...extraction, decision: "declined" }, { ...extraction, unambiguous: "unclear" },
    { ...extraction, public_information: "no" }, { ...extraction, request_quote: "Invented request" },
    { ...extraction, consent_quote: "Invented yes" }, { ...extraction, consent_question_quote: "Different permission" },
  ]) {
    const raw = rawCall(); raw.structured_result.post_call_search = changed;
    assert.equal(verifiedSearchRequest(parseCalleCallSnapshot(raw)), undefined);
  }
  const denied = rawCall();
  denied.recipients[0]!.attempts[0]!.transcript_turns.push({ speaker: "user", text: "Actually, do not send me a text." });
  assert.equal(verifiedSearchRequest(parseCalleCallSnapshot(denied)), undefined);
  const forged = rawCall(); forged.recipients[0]!.attempts[0]!.transcript_turns[2]!.speaker = "bot";
  assert.equal(verifiedSearchRequest(parseCalleCallSnapshot(forged)), undefined);
  const running = rawCall(); running.status = "in_progress";
  assert.equal(verifiedSearchRequest(parseCalleCallSnapshot(running)), undefined);
  const multiple = rawCall(); const turns = multiple.recipients[0]!.attempts[0]!.transcript_turns;
  multiple.recipients[0]!.attempts = [{ id: "attempt_one", transcript_turns: turns.slice(0, 1) }, { id: "attempt_two", transcript_turns: turns.slice(1) }];
  assert.equal(verifiedSearchRequest(parseCalleCallSnapshot(multiple)), undefined);
});

test("CALL-E instructions collect delayed search and consent without promising in-call browsing", () => {
  assert.doesNotThrow(() => assertFollowupDestination({ recipients: [{ phones: [destination] }] }, destination));
  for (const raw of [{ recipients: [] }, { recipients: [{ phones: ["+61491570158"] }] }, { recipients: [{ phones: [destination, "+61491570158"] }] }, { recipients: [{ phones: [destination] }, { phones: [destination] }] }]) {
    assert.throws(() => assertFollowupDestination(raw, destination));
  }
  const task = addPostCallSearchInstructions("A briefing. Do not promise callbacks, SMS, bookings, purchases or recurring calls.");
  assert.match(task, /cannot search live/);
  assert.match(task, /after our call/);
  assert.doesNotMatch(task, /Do not promise callbacks, SMS/);
  assert.throws(() => composeCalleSearchSms({ ...result, sources: [] }));
  assert.throws(() => composeCalleSearchSms({ ...result, answer: "x".repeat(600) }));
});

async function fixture(run: (dependencies: {
  service: CalleFollowupService; restart: () => CalleFollowupService; path: string;
  controls: { preview: boolean; reads: number; receipt: TwilioSmsReceipt | undefined; enabled: boolean; call: ReturnType<typeof parseCalleCallSnapshot>; searches: number; sends: number; now: number; search: () => Promise<WebSearchResult>; sms: SmsAdapter };
}) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "calle-followup-"));
  const path = join(directory, "state.enc.json");
  const controls = { preview: false, reads: 0, receipt: undefined as TwilioSmsReceipt | undefined, enabled: true, call: parseCalleCallSnapshot(rawCall()), searches: 0, sends: 0, now: Date.parse("2026-09-14T00:00:00Z"),
    search: async () => result, sms: { async send() { return { status: "queued", providerMessageId: "SMfixture" }; } } as SmsAdapter };
  const restart = () => new CalleFollowupService(new EncryptedJsonStore(path, "synthetic-storage-key-at-least-32-characters", emptyCalleFollowups), {
    preview: () => controls.preview,
    readSmsStatus: async () => { controls.reads++; return controls.receipt; },
    now: () => controls.now, enabled: () => controls.enabled, recipients: [destination],
    async readCall(id, number) { assert.equal(id, "call_search123"); assert.equal(number, destination); return controls.call; },
    async search(query) { assert.equal(query, question); controls.searches++; return controls.search(); },
    sms: { async send(request) { controls.sends++; assert.equal(request.destinationE164, destination); return controls.sms.send(request); } },
  });
  try { await run({ service: restart(), restart, controls, path }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("completed CALL-E call searches and sends once across concurrent workers and restarts", async () => {
  await fixture(async ({ service, restart, controls, path }) => {
    await service.register("call_search123", destination, true);
    await Promise.all([service.runOnce(), restart().runOnce()]);
    await restart().runOnce();
    assert.equal(controls.searches, 1); assert.equal(controls.sends, 1);
    assert.equal((await restart().list())[0]?.status, "queued");
    const disk = await readFile(path, "utf8");
    assert.ok(!disk.includes(destination)); assert.ok(!disk.includes(question));
    await service.applyDelivery({ eventId: "delivery-1", providerMessageId: "SMfixture", occurredAt: new Date().toISOString(), status: "sent" });
    assert.equal((await restart().list())[0]?.status, "sent");
  });
});

test("no early search, missing consent, expiry and mismatched call results prevent SMS", async () => {
  await fixture(async ({ service, controls }) => {
    await assert.rejects(service.register("call_search123", destination, false));
    await assert.rejects(service.register("call_search123", "+61491570158", true));
    await service.register("call_search123", destination, true);
    const running = rawCall(); running.status = "in_progress"; controls.call = parseCalleCallSnapshot(running);
    await service.runOnce(); assert.equal(controls.searches, 0);
    controls.now += 31_000;
    controls.call = { ...parseCalleCallSnapshot(rawCall()), postCallSearch: undefined };
    await service.runOnce(); assert.equal(controls.sends, 0);
    assert.equal((await service.list())[0]?.status, "no_permission");
  });
  await fixture(async ({ service, controls }) => {
    await service.register("call_search123", destination, true); controls.now += 3 * 60 * 60_000;
    await service.runOnce(); assert.equal(controls.searches, 0);
    assert.equal((await service.list())[0]?.status, "expired");
  });
  await fixture(async ({ service, controls }) => {
    await service.register("call_search123", destination, true); controls.call = { ...controls.call, callId: "call_wrong" };
    await service.runOnce(); assert.equal(controls.searches, 0);
  });
  await fixture(async ({ service, controls }) => {
    await service.register("call_search123", destination, true); controls.call = { ...controls.call, createdAt: "2026-09-01T00:00:00Z" };
    await service.runOnce(); assert.equal(controls.searches, 0);
    assert.equal((await service.list())[0]?.status, "expired");
  });
});

test("cancellation or disabling during search wins before SMS; failures and uncertain sends never retry", async () => {
  for (const mode of ["cancel", "disable", "search-failure", "uncertain"] as const) {
    await fixture(async ({ service, restart, controls }) => {
      const registered = await service.register("call_search123", destination, true);
      controls.search = async () => {
        if (mode === "cancel") await service.cancel(registered.id);
        if (mode === "disable") controls.enabled = false;
        if (mode === "search-failure") throw new Error("Search failed");
        return result;
      };
      if (mode === "uncertain") controls.sms = { async send() { throw new Error("Timeout after provider acceptance"); } };
      await service.runOnce(); await restart().runOnce();
      assert.equal(controls.sends, mode === "uncertain" ? 1 : 0);
      if (mode === "uncertain") assert.equal((await service.list())[0]?.status, "unknown");
    });
  }
});

const recap = "We discussed your weekend plans and your library question.";
const recapQuestion = "May I text this summary to this same number after our call?";
function summaryCall(withSearch = false) {
  const raw = rawCall();
  const turns = withSearch ? raw.recipients[0]!.attempts[0]!.transcript_turns : [];
  return parseCalleCallSnapshot({ ...raw,
    structured_result: {
      ...(withSearch ? raw.structured_result : {}),
      post_call_summary: { decision: "requested", summary_quote: recap, consent_question_quote: recapQuestion, consent_quote: consent },
    },
    recipients: [{ attempts: [{ id: "attempt_one", transcript_turns: [...turns,
      { speaker: "bot", text: recap }, { speaker: "bot", text: recapQuestion }, { speaker: "user", text: consent },
    ] }] }],
  });
}

test("ordinary completed conversations send a recap to the called number once without a search", async () => {
  await fixture(async ({ service, restart, controls }) => {
    controls.call = summaryCall();
    assert.equal(verifiedCallSummary(controls.call), recap);
    controls.sms = { async send(request) {
      assert.equal(request.message, `Senior Phone AI: ${recap}`);
      return { status: "queued", providerMessageId: "SMfixture" };
    } };
    await service.register("call_search123", destination, true);
    await Promise.all([service.runOnce(), restart().runOnce()]);
    await restart().runOnce();
    assert.equal(controls.searches, 0); assert.equal(controls.sends, 1);
  });
});

test("summary consent must match the transcript and cannot be inferred from a provider summary", () => {
  const call = summaryCall();
  for (const changed of [
    { ...call, postCallSummary: undefined, summary: recap },
    { ...call, postCallSummary: { ...call.postCallSummary!, decision: "declined" as const } },
    { ...call, postCallSummary: { ...call.postCallSummary!, summary_quote: "Invented recap" } },
    { ...call, postCallSummary: { ...call.postCallSummary!, consent_quote: "Yes but only if it is free" } },
    { ...call, status: "failed" as const },
    { ...call, status: "in_progress" as const },
    { ...call, transcript: [] },
    { ...call, transcript: call.transcript.map((turn, i) => i === 2 ? { ...turn, speaker: "assistant" as const } : turn) },
    { ...call, transcript: call.transcript.map((turn, i) => i === 2 ? { ...turn, id: "other_attempt-2" } : turn) },
    { ...call, transcript: [...call.transcript, { id: "attempt_one-3", offsetSeconds: 5, speaker: "caller" as const, text: "Do not text me." }] },
  ]) assert.equal(verifiedCallSummary(changed), undefined);
});

test("a search produces only the sourced customer answer; failure never falls back to a recap", async () => {
  for (const fails of [false, true]) await fixture(async ({ service, controls }) => {
    controls.call = summaryCall(true);
    if (fails) controls.search = async () => { throw new Error("Unavailable"); };
    controls.sms = { async send(request) {
      assert.equal(fails, false);
      assert.doesNotMatch(request.message, new RegExp(recap));
      assert.ok(request.message.includes("https://example.com/library"));
      assert.ok(request.message.length <= 480);
      return { status: "queued", providerMessageId: "SMfixture" };
    } };
    await service.register("call_search123", destination, true);
    await service.runOnce(); await service.runOnce();
    assert.equal(controls.searches, 1); assert.equal(controls.sends, fails ? 0 : 1);
    assert.equal((await service.list())[0]?.status, fails ? "search_failed" : "queued");
  });
});

test("operator preview recovers a confirmed request when CALL-E splits the consent question", () => {
  const raw = rawCall();
  const summary = "The call completed successfully, then confirmed a restaurant-search request near Southern Cross Station in Melbourne for a 2:00 dinner and agreed to an operator-only SMS preview with no text actually sent.";
  raw.structured_result.post_call_search = {
    decision: "requested", public_information: "yes", unambiguous: "no", request_quote: "",
    consent_question_quote: "May I prepare an SMS search results preview for this same number after our call? No text will be sent.",
    consent_quote: "Yeah.",
  };
  raw.recipients[0]!.attempts[0]!.transcript_turns = [
    { speaker: "user", text: "Find a popular restaurant around Southern Cross Station in Melbourne." },
    { speaker: "bot", text: "May I prepare an SMS search results preview for this same number after our call?" },
    { speaker: "bot", text: "No text will be sent." },
    { speaker: "user", text: "Yeah." },
  ];
  const call = parseCalleCallSnapshot({ ...raw, summary });
  assert.equal(verifiedSearchRequest(call, true), undefined);
  assert.equal(verifiedPreviewSearchRequest(call), "Find restaurant near Southern Cross Station in Melbourne for a 2:00 dinner");
  assert.equal(verifiedPreviewSearchRequest({ ...call, transcript: [...call.transcript, { id: "attempt_one-4", offsetSeconds: 5, speaker: "caller", text: "Actually, cancel that." }] }), undefined);
});

test("cancelled summaries do not send and uncertain summary sends never retry", async () => {
  for (const cancel of [false, true]) await fixture(async ({ service, restart, controls }) => {
    controls.call = summaryCall();
    controls.sms = { async send() { throw new Error("Uncertain acceptance"); } };
    const job = await service.register("call_search123", destination, true);
    if (cancel) await service.cancel(job.id);
    await service.runOnce(); await restart().runOnce();
    assert.equal(controls.sends, cancel ? 0 : 1);
    assert.equal((await service.list())[0]?.status, cancel ? "cancelled" : "unknown");
  });
});


test("local SMS history survives restart and polls receipts without sending duplicates", async () => {
  await fixture(async ({ service, restart, controls }) => {
    await service.register("call_search123", destination, true);
    await service.runOnce();
    const original = (await service.list())[0]!;
    assert.equal(original.callId, "call_search123");
    assert.ok(original.message.includes("library"));
    assert.equal(original.dispatchedAt, controls.now);
    controls.receipt = { status: "sent" };
    await Promise.all([service.checkDelivery(), restart().checkDelivery()]);
    assert.equal(controls.reads, 1);
    assert.equal((await restart().list())[0]!.status, "queued");
    assert.equal((await restart().list())[0]!.receipt?.status, "sent");
    controls.now += 30_000;
    controls.receipt = undefined;
    await restart().checkDelivery();
    assert.equal((await service.list())[0]!.checkFailed, true);
    assert.equal((await service.list())[0]!.receipt?.status, "sent");
    controls.now += 30_000;
    controls.receipt = { status: "delivered" };
    await restart().checkDelivery();
    assert.equal((await service.list())[0]!.status, "sent");
    assert.equal((await service.list())[0]!.message, original.message);
    controls.receipt = { status: "failed" };
    controls.now += 30_000;
    await restart().runOnce();
    assert.equal((await service.list())[0]!.status, "sent");
    assert.equal(controls.sends, 1);
  });
});

test("failed delivery stays in history; disabled and expired receipt checks do not run", async () => {
  await fixture(async ({ service, restart, controls }) => {
    await service.register("call_search123", destination, true);
    await service.runOnce();
    controls.enabled = false;
    await service.checkDelivery();
    assert.equal(controls.reads, 0);
    assert.ok((await restart().list())[0]!.message);
    controls.enabled = true;
    controls.receipt = { status: "undelivered", errorCode: "30003" };
    await service.checkDelivery();
    assert.equal((await restart().list())[0]!.status, "failed");
    assert.equal((await restart().list())[0]!.receipt?.errorCode, "30003");
    controls.now += 86_400_001;
    await service.runOnce();
    assert.equal(controls.reads, 1);
    assert.equal((await service.list())[0]!.message, "");
    assert.equal(controls.sends, 1);
  });
});


test("receipt lookup cannot overwrite a concurrent delivered callback or poll expired history", async () => {
  const state = emptyCalleFollowups();
  let now = Date.parse("2026-09-14T00:00:00Z");
  let finish!: (value: TwilioSmsReceipt) => void;
  let started!: () => void;
  const reading = new Promise<void>((resolve) => { started = resolve; });
  let reads = 0;
  const service = new CalleFollowupService({ async transact(operation) { return operation(state); } }, {
    enabled: () => true, now: () => now, recipients: [destination],
    readCall: async () => parseCalleCallSnapshot(rawCall()), search: async () => result,
    sms: { send: async () => ({ status: "queued", providerMessageId: "SMfixture" }) },
    readSmsStatus: async () => { reads++; started(); return new Promise((resolve) => { finish = resolve; }); },
  });
  await service.register("call_search123", destination, true);
  await service.runOnce();
  const lookup = service.checkDelivery();
  await reading;
  await service.applyDelivery({ eventId: "delivered", providerMessageId: "SMfixture", status: "sent", occurredAt: new Date(now).toISOString() });
  finish({ status: "queued" });
  await lookup;
  assert.equal((await service.list())[0]!.status, "sent");
  assert.equal((await service.list())[0]!.receipt?.status, "delivered");
  state.calls[0]!.status = "queued";
  now += 86_400_001;
  await service.checkDelivery();
  assert.equal(reads, 1);
});


test("demo previews are saved without SMS dispatch and cannot become live after restart", async () => {
  await fixture(async ({ service, restart, controls }) => {
    controls.preview = true;
    await service.register("call_search123", destination, true);
    controls.preview = false;
    await restart().runOnce();
    const row = (await service.list())[0]!;
    assert.equal(row.status, "previewed");
    assert.ok(row.message.includes("library"));
    assert.equal(controls.sends, 0);
    await restart().runOnce();
    assert.equal(controls.sends, 0);
    assert.equal(controls.reads, 0);
    assert.equal((await restart().list())[0]!.status, "previewed");
  });
});

test("preview mode uses natural SMS language without claiming delivery", () => {
  const task = addPostCallSearchInstructions("Brief conversation", true);
  assert.match(task, /May I prepare an SMS with the search results for this same number after our call\?/);
  assert.match(task, /prepare the SMS if I can verify the results/);
  assert.doesNotMatch(task, /\bdemo\b/i);
  assert.doesNotMatch(task, /\bpreview\b/i);
  assert.doesNotMatch(task, /no text will be sent/i);
  assert.doesNotMatch(task, /I will look that up after our call and text you/);
});
