import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { addPostCallSearchInstructions, assertFollowupDestination, verifiedCallSummary, verifiedSearchRequest } from "../lib/calle/followup-evidence";
import { CalleFollowupService, composeCalleSearchSms, emptyCalleFollowups } from "../lib/calle/followup-service";
import { parseCalleCallSnapshot } from "../lib/calle/status";
import { EncryptedJsonStore } from "../lib/storage/encrypted-json";
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
  controls: { enabled: boolean; call: ReturnType<typeof parseCalleCallSnapshot>; searches: number; sends: number; now: number; search: () => Promise<WebSearchResult>; sms: SmsAdapter };
}) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "calle-followup-"));
  const path = join(directory, "state.enc.json");
  const controls = { enabled: true, call: parseCalleCallSnapshot(rawCall()), searches: 0, sends: 0, now: Date.parse("2026-09-14T00:00:00Z"),
    search: async () => result, sms: { async send() { return { status: "queued", providerMessageId: "SMfixture" }; } } as SmsAdapter };
  const restart = () => new CalleFollowupService(new EncryptedJsonStore(path, "synthetic-storage-key-at-least-32-characters", emptyCalleFollowups), {
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

test("search and recap share one SMS; a failed search still allows an approved recap", async () => {
  for (const fails of [false, true]) await fixture(async ({ service, controls }) => {
    controls.call = summaryCall(true);
    if (fails) controls.search = async () => { throw new Error("Unavailable"); };
    controls.sms = { async send(request) {
      assert.ok(request.message.includes(recap));
      assert.ok(request.message.includes(fails ? "could not verify" : "https://example.com/library"));
      assert.ok(request.message.length <= 480);
      return { status: "queued", providerMessageId: "SMfixture" };
    } };
    await service.register("call_search123", destination, true);
    await service.runOnce(); await service.runOnce();
    assert.equal(controls.searches, 1); assert.equal(controls.sends, 1);
  });
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
