import test from "node:test";
import assert from "node:assert/strict";
import {
  validatePhoneNumber,
  maskPhoneNumber,
  checkRateLimit,
  validateEmail,
  maskEmail,
  validateCallConsent
} from "../lib/calle/security.ts";
import { createFixtureCallRecord } from "../lib/calle/fixture.ts";
import { SundialsDatabase } from "../lib/db.ts";
import type { LeadQueueItem, SundialCallRecord, SundialEvent, WebSessionContext } from "../lib/types.ts";
import { applyCalleSnapshot, mapCalleStatus } from "../lib/calle/sync-live.ts";
import type { Call } from "@call-e/calle";
import { buildLiveCallTask, liveCalleCreateInput, publicCalleError, regionFromE164, safeCalleBaseUrl } from "../lib/calle/live-binding.ts";
import { CalleAPIError } from "@call-e/calle";
import { scoreEvents, intentLevelFromScore } from "../lib/intent/score.ts";
import { behaviorFromEvents, declaredInterestFromEvents, interestThemes } from "../lib/intent/profile.ts";
import { harborFixtureOpportunity, GENERIC_FOLLOW_UP_TODAY, MISSED_PICKUP_ACTION, opportunityFromCall, queuePriority } from "../lib/intent/opportunity.ts";
import { companySizeChartLabel, shortInsightLabel } from "../lib/intent/phrases.ts";
import { buildAnalytics } from "../lib/intent/analytics.ts";
import {
  callJourneyBlurb,
  formatChipLabel,
  formatDateTime,
  formatDuration,
  formatHoverByPath,
  SPEED_TO_RING_SLA_SEC,
  speedToRingSlaMet,
  formatTranscriptOffset,
  normalizeCallTranscript,
  transcriptSpeakerName,
  groupIntentSignalsByTier,
  FUNNEL,
  displayPain,
  displayAction,
  leadDiscoveryFacts,
  splitDiscoveryFacts,
  leadProfileSummary,
  leadStatusSummary,
  pageEngagementRows,
  signalTier,
  sortLeadQueue,
  defaultLeadSortDirection,
  warmthHeadline
} from "../lib/console/format.ts";
import { newEntityId } from "../lib/ids.ts";
import { ctaOpensWidget, scDatasetProperties } from "../lib/sdk/cta-dataset.ts";
import { mockAnalytics } from "../lib/console/mock-data.ts";
import { fixtureCalls, fixtureLeads } from "../lib/console/fixtures/catalog.ts";
import { mockCalls, mockLeads, resetMockQueueCache } from "../lib/console/fixtures/index.ts";
import { resolveAllCalls, resolveAnalytics, resolveCallDetail, resolveLeadDetail, resolveLeadQueue } from "../lib/console/source.ts";
import { readWorkspaceSettings, writeWorkspaceSettings } from "../lib/console/workspace-settings.ts";
import { parseTheme } from "../lib/console/theme.ts";
import { authenticateSdkRequest } from "../lib/sdk/auth.ts";
import { SUNDIALS_API_KEY_HEADER } from "../lib/sdk/public-key.ts";
import { verifyPassword } from "../lib/accounts.ts";
import { decodeSessionCookie, encodeSessionCookie, sessionFromRequest, SESSION_COOKIE } from "../lib/console/session.ts";
import { DEFAULT_RETRY_DELAY_HOURS, defaultBrainConfig, defaultBrainGoals, enabledGoals, HARBOR_CLOSING_SCRIPT, HARBOR_OPENING_SCRIPT, MAX_RETRY_DELAY_HOURS, MIN_RETRY_DELAY_HOURS, normalizeBrainConfig, normalizeRetryDelayHours, readBrainConfig, writeBrainConfig } from "../lib/brain/config.ts";
import { liveCreateInputForRecord, processDueRetries, stopFollowUpsForVisitor } from "../lib/calle/retry.ts";
import { ingestCalleWebhook } from "../lib/calle/webhook.ts";
import { parseTrackingConsent, serializeTrackingConsent, TRACKING_CONSENT_TTL_MS } from "../lib/sdk/tracking-consent.ts";
import { applyGeminiCallProfile, buildCallProfilePrompt, clampPainCategory, hasGeminiBriefing, mergeBrainExtraction, mergePainCatalogs, resolvePainCategory, sanitizeTranscriptForGemini } from "../lib/brain/extract.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function session(): WebSessionContext {
  return {
    id: "sess_unit_test",
    visitorId: "vis_unit_test",
    accountId: "harbor",
    landingUrl: "/demo/pricing",
    timeOnPageSec: 95,
    leadContext: { pageType: "harbor-site", icp: "b2b-saas", sourceCta: "talk_to_sales" },
    detectedLocale: "en-US"
  };
}

function event(
  partial: Partial<SundialEvent> & Pick<SundialEvent, "event">
): SundialEvent {
  return {
    id: partial.id || `evt_${Math.random().toString(36).slice(2, 8)}`,
    accountId: "harbor",
    visitorId: "vis_unit_test",
    sessionId: partial.sessionId || "sess_unit_test",
    event: partial.event,
    properties: partial.properties || {},
    timestamp: partial.timestamp || new Date().toISOString()
  };
}

test("security: validates E.164 phone numbers correctly", () => {
  assert.equal(validatePhoneNumber("+15550192831").valid, true);
  assert.equal(validatePhoneNumber("+6555501010").valid, true);
  assert.equal(validatePhoneNumber("+442079460912").valid, true);
  assert.equal(validatePhoneNumber("+1 (555) 019-2831").valid, true);

  assert.equal(validatePhoneNumber("123").valid, false);
  assert.equal(validatePhoneNumber("911").valid, false);
  assert.equal(validatePhoneNumber("+1911").valid, false);
  assert.equal(validatePhoneNumber("+88216123456").valid, false);
  assert.equal(validatePhoneNumber("15550192831").valid, false);
  assert.equal(validatePhoneNumber("+33123456789").valid, false);
  assert.match(validatePhoneNumber("+33123456789").error || "", /supported list/i);
});

test("security: call consent must match the destination, be recent, and allow one retry", () => {
  const phone = "+15550192831";
  const fresh = {
    e164: phone,
    acceptedAt: new Date().toISOString(),
    allowOneRetry: true as const
  };
  const ok = validateCallConsent(phone, fresh);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.e164, phone);
    assert.equal(ok.allowOneRetry, true);
  }

  const missing = validateCallConsent(phone, undefined);
  assert.equal(missing.ok, false);

  const mismatch = validateCallConsent(phone, { ...fresh, e164: "+6555501010" });
  assert.equal(mismatch.ok, false);

  const noRetry = validateCallConsent(phone, { ...fresh, allowOneRetry: false });
  assert.equal(noRetry.ok, false);

  const stale = validateCallConsent(phone, {
    ...fresh,
    acceptedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString()
  });
  assert.equal(stale.ok, false);
});

test("tracking consent: durable localStorage values and expired session records are unknown", () => {
  assert.equal(parseTrackingConsent("granted"), "unknown");
  assert.equal(parseTrackingConsent("denied"), "unknown");
  const now = Date.now();
  assert.equal(parseTrackingConsent(serializeTrackingConsent("granted", now), now), "granted");
  assert.equal(
    parseTrackingConsent(serializeTrackingConsent("granted", now - TRACKING_CONSENT_TTL_MS - 1), now),
    "unknown"
  );
});

test("security: validates and masks lead emails", () => {
  assert.equal(validateEmail("nina@example.com").valid, true);
  assert.equal(validateEmail("not-an-email").valid, false);
  assert.equal(validateEmail("").valid, false);
  assert.equal(maskEmail("nina@example.com"), "n***@example.com");
});

test("security: masks phone numbers properly for display", () => {
  assert.equal(maskPhoneNumber("+15550192831"), "+1 (555) 019-****");
  assert.equal(maskPhoneNumber("+6555501010"), "+65 5550 ****");
});

test("security: rate limiting protects against rapid dispatch loops", () => {
  const testIp = "192.168.1.100";
  for (let i = 0; i < 5; i++) {
    const res = checkRateLimit(testIp);
    assert.equal(res.allowed, true);
  }
  const blocked = checkRateLimit(testIp);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
});

test("fixture: Harbor discovery dossier without a calendar booking", () => {
  const record = createFixtureCallRecord("+15550192831", session(), "Alex Example", "alex@example.com", {
    company: "Acme Corp",
    visitorId: "vis_unit_test",
    declaredCta: "talk_to_sales",
    intent: { score: 47, level: "high", signals: [] }
  });
  assert.equal(record.status, "completed");
  assert.ok(record.speedToDialSec && record.speedToDialSec > 15 && record.speedToDialSec < 35);
  assert.ok(record.leadDossier);
  assert.equal(record.leadDossier?.intentTier, "hot");
  assert.ok(record.transcript && record.transcript.length >= 4);
  assert.equal(record.contactEmail, "a***@example.com");
  assert.equal(record.opportunityProfile?.priority, "very_high");
  assert.equal(record.opportunityProfile?.currentUsers?.source, "explicit");
  assert.match(record.leadDossier?.nextStep || "", /follow-up/i);
  assert.match(record.transcript?.[1]?.text || "", /automated assistant/);
  assert.match(record.transcript?.[1]?.text || "", /Harbor sales/);
  assert.doesNotMatch(record.transcript?.[1]?.text || "", /this is Maya from/);
  assert.doesNotMatch(record.leadDossier?.nextStep || "", /calendar|thursday|scheduled call/i);
});

test("db: sqlite starts empty and persists trial runs", () => {
  const store = new SundialsDatabase(":memory:");
  const initialMetrics = store.getMetrics();
  assert.equal(initialMetrics.totalCallsToday, 0);
  assert.equal(initialMetrics.inFlightCallsCount, 0);
  assert.equal(initialMetrics.avgSpeedToDialSec, 0);
  assert.equal(store.getAnalytics().funnel.inboundVisitors, 0);

  const newCall = createFixtureCallRecord("+6555501010", session(), "Marcus Example", "marcus@example.com");
  store.saveCall(newCall);

  const fetched = store.getCall(newCall.id);
  assert.ok(fetched);
  assert.equal(fetched?.contactName, "Marcus Example");
  assert.equal(fetched?.contactEmail, "m***@example.com");
  assert.equal(store.getMetrics().totalCallsToday, 1);
});

test("events: ingest, identify merge, and intent snapshot", () => {
  const store = new SundialsDatabase(":memory:");
  store.ingestEventBatch({
    accountId: "harbor",
    visitorId: "vis_anon",
    sessionId: "sess_a",
    events: [
      { event: "page_view", properties: { path: "/demo" } },
      { event: "page_view", properties: { path: "/demo/pricing" } },
      { event: "cta_clicked", properties: { name: "learn_more" } }
    ]
  });
  store.ingestEventBatch({
    accountId: "harbor",
    visitorId: "vis_anon",
    sessionId: "sess_a",
    events: [
      {
        event: "identify",
        properties: { email: "john@example.com", company: "Acme", phone: "+15550192831", name: "John" }
      },
      { event: "cta_clicked", properties: { name: "talk_to_sales" } }
    ]
  });

  const visitor = store.getVisitor("vis_anon");
  assert.ok(visitor?.identifiedAt);
  assert.equal(visitor?.email, "j***@example.com");
  assert.equal(visitor?.company, "Acme");
  const events = store.getEventsForVisitor("vis_anon");
  assert.ok(events.some((item) => item.event === "page_view"));
  const snap = store.snapshotForVisitor("vis_anon");
  assert.ok(snap.intent.score >= 30);
  assert.equal(snap.intent.level, "medium");
  assert.ok(snap.declaredInterest.includes("talk_to_sales"));
  assert.ok(snap.behavior.pagesViewed.includes("/demo/pricing"));
});

test("intent: deterministic scoring weights", () => {
  const profile = scoreEvents([
    event({ event: "page_view", properties: { path: "/demo/pricing" } }),
    event({ event: "page_view", properties: { path: "/demo/pricing" } }),
    event({ event: "page_view", properties: { path: "/demo/pricing" } }),
    event({ event: "cta_clicked", properties: { name: "talk_to_sales" } }),
    event({ event: "cta_clicked", properties: { name: "talk_to_sales" } }),
    event({ event: "identify", properties: { email: "a@example.com", phone: "+15550192831" } })
  ]);
  assert.equal(profile.score, 3 + 3 + 15 + 10 + 5);
  assert.equal(profile.level, "medium");
  assert.ok(profile.signals.some((s) => s.type === "sales_intent"));
});

test("intent: 100-point scale treats 30 as medium and 60 as high", () => {
  assert.equal(intentLevelFromScore(29), "low");
  assert.equal(intentLevelFromScore(30), "medium");
  assert.equal(intentLevelFromScore(59), "medium");
  assert.equal(intentLevelFromScore(60), "high");
  assert.equal(intentLevelFromScore(100), "high");
  const medium = { score: 30, level: "medium" as const, signals: [] };
  const hotOpp = harborFixtureOpportunity({ score: 72, level: "high", signals: [] });
  assert.equal(queuePriority(medium, { ...hotOpp, priority: "high" }), "nurture");
  assert.equal(queuePriority({ score: 72, level: "high", signals: [] }, hotOpp), "very_high");
});

test("intent: returning visitor and declared interest", () => {
  const events = [
    event({ event: "page_view", properties: { path: "/demo/contact" }, sessionId: "s1" }),
    event({ event: "enterprise_interest", sessionId: "s2" })
  ];
  const profile = scoreEvents(events);
  assert.ok(profile.score >= 4 + 5 + 3);
  assert.ok(declaredInterestFromEvents(events).includes("enterprise"));
  assert.equal(behaviorFromEvents(events).returningVisitor, true);
});

test("intent: aggregates pointer-over time per page", () => {
  const events = [
    event({ event: "page_hover", properties: { path: "/demo/pricing", hoverSec: 5 } }),
    event({ event: "page_hover", properties: { path: "/demo/pricing", hoverSec: 7 } })
  ];
  const behavior = behaviorFromEvents(events);
  assert.equal(behavior.hoverSecByPath["/demo/pricing"], 12);
  const profile = scoreEvents(events);
  assert.equal(profile.score, 2);
  assert.ok(profile.signals.some((s) => s.source === "page_hover"));
});

test("intent: plan CTA and FAQ accordion are distinct signals", () => {
  const attrs = scDatasetProperties([
    { name: "data-sc-cta", value: "get_demo" },
    { name: "data-sc-plan", value: "professional" }
  ]);
  assert.deepEqual(attrs, { plan: "professional" });

  assert.equal(
    ctaOpensWidget({
      hasAttribute: (name) => name === "data-sc-open",
      getAttribute: (name) => (name === "data-sc-cta" ? "get_demo" : null)
    }),
    "get_demo"
  );
  assert.equal(
    ctaOpensWidget({
      hasAttribute: () => false,
      getAttribute: () => "talk_to_sales"
    }),
    null
  );

  const events = [
    event({ event: "cta_clicked", properties: { name: "get_demo", plan: "starter" } }),
    event({ event: "cta_clicked", properties: { name: "get_demo", plan: "professional" } }),
    event({ event: "faq_opened", properties: { topic: "sandbox", question: "Do you offer a sandbox?" } }),
    event({ event: "faq_opened", properties: { topic: "sandbox" } })
  ];
  const profile = scoreEvents(events);
  assert.equal(profile.score, 12 + 4 + 5 + 2);
  assert.ok(profile.signals.some((s) => s.type === "get_demo"));
  assert.ok(profile.signals.some((s) => s.type === "plan_starter"));
  assert.ok(profile.signals.some((s) => s.type === "plan_professional"));
  assert.ok(profile.signals.some((s) => s.type === "faq_sandbox"));
  assert.equal(profile.signals.filter((s) => s.type === "faq_sandbox").length, 1);

  const interest = declaredInterestFromEvents(events);
  assert.ok(interest.includes("plan_professional"));
  assert.ok(interest.includes("faq_sandbox"));
  assert.ok(interestThemes(interest).includes("professional plan"));
  assert.ok(interestThemes(interest).includes("FAQ sandbox"));
});

test("analytics: funnel counts from visitors, events, and completed calls", () => {
  const store = new SundialsDatabase(":memory:");
  store.ingestEventBatch({
    accountId: "harbor",
    visitorId: "vis_hot",
    sessionId: "sess_hot",
    events: [
      { event: "page_view", properties: { path: "/demo/pricing" } },
      { event: "page_view", properties: { path: "/demo/contact" } },
      { event: "cta_clicked", properties: { name: "talk_to_sales" } },
      { event: "cta_clicked", properties: { name: "get_demo" } },
      { event: "demo_requested" },
      { event: "enterprise_interest" },
      { event: "identify", properties: { email: "hot@example.com", phone: "+15550192831", company: "Acme" } }
    ]
  });
  const call = createFixtureCallRecord("+15550192831", session(), "John", "hot@example.com", {
    visitorId: "vis_hot",
    company: "Acme",
    intent: store.snapshotForVisitor("vis_hot").intent
  });
  store.saveCall(call);
  const analytics = store.getAnalytics();
  assert.equal(analytics.funnel.inboundVisitors, 1);
  assert.equal(analytics.funnel.highIntentVisitors, 1);
  assert.equal(analytics.funnel.callRequests, 1);
  assert.equal(analytics.funnel.callsCompleted, 1);
  assert.ok(analytics.kpis.avgIntentScore > 0);
  assert.ok(analytics.intelligence.competitors.some((row) => row.label === "Salesforce"));
  assert.ok(analytics.series.length >= 1);
  assert.equal(analytics.series[0].visitors, 1);
  const queue = store.getLeadQueue();
  assert.equal(queue[0]?.priority, "very_high");
  assert.equal(queue[0]?.lead.company, "Acme");
});

test("opportunity fixture distinguishes explicit vs inferred", () => {
  const opp = harborFixtureOpportunity({ score: 47, level: "high", signals: [] });
  assert.equal(opp.currentUsers?.source, "explicit");
  assert.equal(opp.scores.overall.source, "score");
  assert.equal(opp.recommendedAction?.source, "inferred");
});

test("empty analytics stays zero without seed data", () => {
  const analytics = buildAnalytics([], [], []);
  assert.equal(analytics.funnel.inboundVisitors, 0);
  assert.equal(analytics.kpis.avgResponseTimeSec, 0);
  assert.deepEqual(analytics.intelligence.topPainPoints, []);
  assert.deepEqual(analytics.series, []);
});

test("intelligence: pain labels keep long CALL-E wording and skip placeholders", () => {
  const summary =
    "The discovery call completed successfully. The recipient discussed their CRM needs, shared evaluation details, and confirmed they want a Harbor rep to follow up.";
  assert.equal(shortInsightLabel("See live transcript"), undefined);
  assert.equal(shortInsightLabel("Manual administration"), "Manual administration");
  assert.equal(shortInsightLabel("drowning in manual admin"), "Manual administration");
  assert.equal(shortInsightLabel(summary), undefined);
  const long = "HubSpot is very bad so they want a cheaper CRM";
  assert.equal(shortInsightLabel(long), long);
  assert.equal(displayPain(long), long);
  assert.equal(displayPain("See live transcript"), "—");

  const call = createFixtureCallRecord("+15550192831", session(), "Casey Example", "casey@example.com");
  call.opportunityProfile = {
    ...call.opportunityProfile!,
    primaryPain: { value: long, source: "explicit", confidence: 0.9 }
  };
  const skipped = buildAnalytics([], [], [call]);
  assert.equal(skipped.intelligence.topPainPoints.some((row) => row.label === long), false);

  call.opportunityProfile = {
    ...call.opportunityProfile!,
    painCategory: { value: "HubSpot cost", source: "explicit", confidence: 0.9 }
  };
  const analytics = buildAnalytics([], [], [call]);
  assert.ok(analytics.intelligence.topPainPoints.some((row) => row.label === "HubSpot cost"));
  assert.equal(analytics.intelligence.topPainPoints.some((row) => row.label === long), false);
});

test("intelligence: company size chart extracts a number and keeps profile text", () => {
  assert.equal(companySizeChartLabel("about 200 users now, expected about 500 by next year"), "200");
  assert.equal(companySizeChartLabel("500 team members (~10,000 users)"), "500");
  assert.equal(companySizeChartLabel("10 internal users"), "10");
  assert.equal(companySizeChartLabel("150 users"), "150");
  assert.equal(companySizeChartLabel("11–50"), "11–50");
  assert.equal(companySizeChartLabel("45-person RevOps team"), "45");
  assert.equal(companySizeChartLabel("80 current users, planning 150"), "80");
  assert.equal(companySizeChartLabel("Student project"), undefined);
  assert.equal(companySizeChartLabel("See live transcript"), undefined);

  const call = createFixtureCallRecord("+15550192831", session(), "Casey Example", "casey@example.com");
  const sizeText = "about 200 users now, expected about 500 by next year";
  call.opportunityProfile = {
    ...call.opportunityProfile!,
    companySize: { value: sizeText, source: "explicit", confidence: 0.9 }
  };
  const analytics = buildAnalytics([], [], [call]);
  assert.deepEqual(analytics.intelligence.companySizeDistribution, [{ label: "200", count: 1 }]);
  assert.equal(call.opportunityProfile?.companySize?.value, sizeText);

  const other = createFixtureCallRecord("+15550192832", session(), "Riley Example", "riley@example.com");
  other.opportunityProfile = {
    ...other.opportunityProfile!,
    companySize: { value: "200 analytics seats", source: "explicit", confidence: 0.9 }
  };
  const merged = buildAnalytics([], [], [call, other]);
  assert.deepEqual(merged.intelligence.companySizeDistribution, [{ label: "200", count: 2 }]);
});

test("theme: parseTheme accepts light dark system and defaults to light", () => {
  assert.equal(parseTheme("light"), "light");
  assert.equal(parseTheme("dark"), "dark");
  assert.equal(parseTheme("system"), "system");
  assert.equal(parseTheme("nope"), "light");
  assert.equal(parseTheme(null), "light");
});

test("workspace settings: mock overlay does not seed sqlite", () => {
  const dir = mkdtempSync(join(tmpdir(), "sundials-"));
  const prev = process.env.SUNDIALS_DB_PATH;
  process.env.SUNDIALS_DB_PATH = join(dir, "sundials.db");
  try {
    assert.equal(readWorkspaceSettings().dataSource, "live");
    writeWorkspaceSettings({ dataSource: "mock" });
    assert.equal(readWorkspaceSettings().dataSource, "mock");
    const snap = resolveAnalytics("7d");
    assert.equal(snap.source, "mock");
    assert.ok(snap.analytics.kpis.highIntentLeads > 0);
    assert.equal(snap.analytics.series.length, 7);
    const store = new SundialsDatabase(join(dir, "sundials.db"));
    assert.equal(store.getAnalytics().funnel.inboundVisitors, 0);
    assert.equal(store.getLeadQueue().length, 0);
    assert.equal(store.getAllCalls().length, 0);
    writeWorkspaceSettings({ dataSource: "live" });
    assert.equal(resolveAnalytics().source, "live");
  } finally {
    if (prev === undefined) delete process.env.SUNDIALS_DB_PATH;
    else process.env.SUNDIALS_DB_PATH = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mock overlay: leads and calls come from JSON fixtures, not sqlite", () => {
  const dir = mkdtempSync(join(tmpdir(), "sundials-queue-"));
  const prev = process.env.SUNDIALS_DB_PATH;
  process.env.SUNDIALS_DB_PATH = join(dir, "sundials.db");
  resetMockQueueCache();
  try {
    writeWorkspaceSettings({ dataSource: "mock" });
    const queue = resolveLeadQueue();
    const calls = resolveAllCalls();
    assert.equal(queue.source, "mock");
    assert.equal(calls.source, "mock");
    assert.ok(queue.leads.length >= 12);
    assert.ok(calls.calls.length >= 12);
    assert.ok(queue.leads.some((lead) => lead.priority === "very_high"));
    assert.ok(queue.leads.some((lead) => lead.priority === "high"));
    assert.ok(queue.leads.some((lead) => lead.priority === "nurture"));
    assert.ok(queue.leads.some((lead) => lead.priority === "disqualified"));
    assert.ok(calls.calls.some((call) => call.status === "completed" && (call.transcript?.length || 0) >= 3));
    assert.ok(calls.calls.some((call) => call.status === "no_answer"));
    assert.ok(
      calls.calls.some(
        (call) => call.status === "queued" && call.retryDueAt && Date.parse(call.retryDueAt) > Date.now()
      )
    );

    const north = queue.leads.find((lead) => lead.lead.company === "Northline Revenue");
    assert.ok(north);
    const northDetail = resolveLeadDetail(north!.visitorId);
    assert.equal(northDetail.source, "mock");
    assert.ok(northDetail.lead);
    assert.ok(northDetail.calls.length >= 3);
    assert.ok(northDetail.calls.some((call) => call.status === "no_answer"));
    assert.ok(northDetail.calls.some((call) => call.status === "completed"));
    assert.equal(northDetail.lead?.latestCallId, north!.latestCallId);
    const done = resolveCallDetail(north!.latestCallId!);
    assert.ok(done.call);
    assert.equal(done.call?.visitorId, north!.visitorId);
    assert.equal(done.lead?.visitorId, north!.visitorId);
    assert.doesNotMatch(north!.lead.email || "", /maya\.chen@/i);
    assert.match(north!.lead.email || "", /\*\*\*@/);
    assert.match(done.call?.phoneNumber || "", /\*\*\*\*/);
    assert.ok(!("rawPhoneNumber" in (done.call || {})));
    assert.ok(!northDetail.calls.some((call) => /see live transcript/i.test(call.opportunityProfile?.primaryPain?.value || "")));

    const store = new SundialsDatabase(join(dir, "sundials.db"));
    assert.equal(store.getLeadQueue().length, 0);
    assert.equal(store.getAllCalls().length, 0);

    writeWorkspaceSettings({ dataSource: "live" });
    assert.equal(resolveLeadQueue().source, "live");
    assert.equal(resolveAllCalls().source, "live");
    assert.equal(resolveLeadDetail(north!.visitorId).lead, null);
    assert.equal(resolveCallDetail(north!.latestCallId!).call, null);
  } finally {
    writeWorkspaceSettings({ dataSource: "live" });
    if (prev === undefined) delete process.env.SUNDIALS_DB_PATH;
    else process.env.SUNDIALS_DB_PATH = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mock fixtures: JSON queue is typed, varied, and Harbor-shaped", () => {
  resetMockQueueCache();
  const leads = mockLeads();
  const calls = mockCalls();
  assert.equal(fixtureLeads.length, 16);
  assert.equal(fixtureCalls.length, 17);
  assert.equal(leads.length, fixtureLeads.length);
  assert.equal(calls.length, fixtureCalls.length);
  for (const item of leads) {
    assert.match(item.visitorId, /^[0-9a-f-]{36}$/i);
    assert.equal(item.accountId, "harbor");
    assert.ok(item.lead.company);
    assert.ok(item.lead.name);
    assert.ok(item.behavior.pagesViewed.length > 0);
    assert.ok(item.behavior.pagesViewed.every((path) => path.startsWith("/demo")));
    assert.ok(item.intent.signals.some((signal) => ["email_provided", "returning_visitor", "pricing_interest", "page_hover"].includes(signal.type)));
  }
  assert.ok(leads.some((lead) => !lead.latestCallId));
  const retry = calls.find((call) => call.status === "queued" && call.retryDueAt);
  assert.ok(retry);
  assert.ok(Date.parse(retry!.retryDueAt || "") > Date.now());
  const completed = calls.filter((call) => call.status === "completed");
  assert.ok(completed.every((call) => (call.transcript?.length || 0) >= 3));
  assert.ok(
    calls
      .flatMap((call) => call.transcript || [])
      .every((turn) => typeof turn.timestamp === "string" && /^\d+$/.test(turn.timestamp))
  );
  const northDone = calls.find((call) => call.id === "11111111-0003-4000-8000-000000000003");
  assert.deepEqual(
    (northDone?.transcript || []).map((turn) => turn.timestamp),
    ["1", "5", "19", "33", "48", "62", "78", "92", "108", "124", "142", "158", "176", "192", "208", "224", "242", "258", "274", "290", "308", "324"]
  );
  assert.ok((northDone?.transcript?.length || 0) >= 15);
  assert.equal(northDone?.durationSec, 332);
  assert.equal(formatTranscriptOffset(northDone?.transcript?.[0]?.timestamp), "0:01");
  assert.ok(completed.every((call) => call.durationSec > 0));
  assert.ok(
    completed.every(
      (call) => !/see live transcript/i.test(JSON.stringify(call.opportunityProfile?.primaryPain || {}))
    )
  );
});

test("mock analytics: range slices series and stays non-zero", () => {
  const today = mockAnalytics("today");
  const week = mockAnalytics("7d");
  const month = mockAnalytics("30d");
  assert.equal(today.series.length, 1);
  assert.equal(week.series.length, 7);
  assert.equal(month.series.length, 30);
  assert.ok(month.funnel.inboundVisitors > 0);
  assert.ok(month.intelligence.topPainPoints.length > 0);
});

test("live binding: maps E.164 country and builds a Harbor recipient task", () => {
  assert.deepEqual(regionFromE164("+6555501911"), { region: "SG", locale: "en-SG" });
  assert.deepEqual(regionFromE164("+15550192831"), { region: "US", locale: "en-US" });
  assert.deepEqual(regionFromE164("+442079460912"), { region: "GB", locale: "en-GB" });
  assert.throws(() => regionFromE164("+33123456789"), /Unsupported destination country/);
  assert.throws(() => regionFromE164("15550192831"), /Unsupported destination country/);
  assert.equal(safeCalleBaseUrl("https://api.heycall-e.com"), "https://api.heycall-e.com");

  const harbor = defaultBrainConfig();
  const task = buildLiveCallTask("+6555501911", session(), "Tobias", "founder@example.com", {
    company: "Acme",
    declaredCta: "talk_to_sales",
    declaredInterest: ["pricing", "talk_to_sales"],
    intent: { score: 40, level: "high", signals: [] },
    productName: harbor.productName,
    agentIdentity: harbor.agentIdentity,
    tonePersona: harbor.tonePersona,
    openingScript: harbor.openingScript,
    closingScript: harbor.closingScript
  });
  assert.match(task, /^Call \+6555501911/);
  assert.match(task, /English \(en-SG\)/);
  assert.match(task, /destination region SG/);
  assert.match(task, /Harbor CRM discovery/);
  assert.match(task, /automated assistant for Harbor Sales/);
  assert.match(task, /GOAL:/);
  assert.match(task, /pricing/);
  assert.doesNotMatch(task, /You are Maya/);
  assert.doesNotMatch(task, /visited pricing three times/i);
  assert.doesNotMatch(task, /api\.call-e\.ai/);
  assert.doesNotMatch(task, /If they want a human follow-up, say a Harbor rep will reach out/);
  assert.doesNotMatch(task, /a Harbor rep will reach out/i);
  assert.match(task, /SILENT OBJECTIVES/);
  assert.match(task, /Hi there, thanks for picking up/i);
  assert.match(task, /recorded for quality/i);
  assert.match(task, /what can we help you with today/i);
  assert.match(task, /customizing a Harbor plan/i);
  assert.match(task, /Close with:/);
  assert.doesNotMatch(task, /thanks so much for picking up/i);
  assert.match(task, /EXTRACT \(silent/);
});

test("live binding: uses the provided openingScript", () => {
  const task = buildLiveCallTask("+15550192831", session(), "Alex", "alex@example.com", {
    openingScript: "Hello from Northwind Voice. This call may be recorded. How can we help you today?",
    closingScript: "Thanks for the time. Northwind will take it from here."
  });
  assert.match(task, /Hello from Northwind Voice/);
  assert.match(task, /How can we help you today/);
  assert.match(task, /Northwind will take it from here/);
  assert.doesNotMatch(task, /Harbor/);
});

test("live binding: missing openingScript does not inject Harbor", () => {
  const missing = buildLiveCallTask("+15550192831", session(), "Alex", "alex@example.com");
  const empty = buildLiveCallTask("+15550192831", session(), "Alex", "alex@example.com", {
    openingScript: "   "
  });
  for (const task of [missing, empty]) {
    assert.doesNotMatch(task, /Harbor/i);
    assert.match(task, /automated assistant/i);
    assert.match(task, /recorded for quality/i);
    assert.match(task, /What can we help you with today/i);
    assert.match(task, /glad we could help/i);
    assert.doesNotMatch(task, /calling on behalf of Harbor/i);
    assert.doesNotMatch(task, /customizing a Harbor plan/i);
  }
});

test("live binding: surfaces CALL-E 422 clarification questions", () => {
  const err = new CalleAPIError({
    code: "call_not_ready",
    message: "Call task creation was rejected.",
    status: 422,
    details: { questions: ["Should this call be placed in English?"] }
  });
  const text = publicCalleError(err);
  assert.match(text, /clarification/);
  assert.match(text, /English/);
  assert.doesNotMatch(text, /API key/);
});

test("live snapshot: completed CALL-E call fills status, transcript, opportunity", () => {
  const local = createFixtureCallRecord("+15550192831", session(), "Tobias", "founder@example.com");
  local.status = "dialing";
  local.dryRun = false;
  local.calleCallId = "calle_live_1";
  local.transcript = undefined;
  local.leadDossier = undefined;
  local.opportunityProfile = undefined;
  local.durationSec = 0;

  const remote = {
    id: "calle_live_1",
    status: "completed",
    taskCompleted: true,
    summary: "Qualified a CRM replacement lead. Manual admin pain. Evaluating Salesforce. 1-2 month timeline.",
    completedAt: new Date().toISOString(),
    failureCode: null,
    failureMessage: null,
    recipients: [
      {
        attempts: [
          {
            startedAt: new Date(Date.now() - 90_000).toISOString(),
            completedAt: new Date().toISOString(),
            failureMessage: null,
            transcriptTurns: [
              {
                speaker: "bot",
                text: "This is an automated assistant calling on behalf of Harbor sales.",
                offset_seconds: 1
              },
              { speaker: "user", text: "We need to replace Salesforce next month.", offset_seconds: 8 }
            ]
          }
        ]
      }
    ]
  } as unknown as Call;

  const merged = applyCalleSnapshot(local, remote);
  assert.equal(merged.status, "completed");
  assert.ok(merged.transcript && merged.transcript.length === 2);
  assert.equal(merged.transcript?.[0]?.speaker, "agent");
  assert.match(merged.transcript?.[0]?.text || "", /automated assistant/);
  assert.ok((merged.durationSec || 0) >= 80);
  assert.equal(merged.leadDossier?.intentTier, "hot");
  assert.ok(merged.opportunityProfile);
  assert.ok(merged.opportunityProfile?.alternatives?.value?.includes("Salesforce"));
});

test("live create: sends CALL-E result schemas for dashboard tagging", () => {
  const input = liveCalleCreateInput("+15550192831", session(), "Alex", "alex@example.com", {
    declaredCta: "talk_to_sales",
    activeGoals: enabledGoals(defaultBrainConfig())
  });
  assert.equal(input.resultSchema?.type, "object");
  assert.equal(input.recipientResultSchema?.type, "object");
  const properties = input.resultSchema?.properties as Record<string, unknown>;
  assert.ok(properties.primary_pain);
  assert.ok(properties.interest_level);
  assert.ok(properties.company_description);
  const recipientProps = input.recipientResultSchema?.properties as Record<string, unknown>;
  assert.ok(recipientProps.answered_by);
});

test("live snapshot: structured result tags pain instead of the call summary", () => {
  const local = createFixtureCallRecord("+15550192831", session(), "Alex", "alex@example.com");
  local.status = "dialing";
  local.dryRun = false;
  local.calleCallId = "calle_structured_1";
  local.transcript = undefined;
  local.leadDossier = undefined;
  local.opportunityProfile = undefined;

  const remote = {
    id: "calle_structured_1",
    status: "completed",
    taskCompleted: true,
    summary:
      "The discovery call completed successfully. The recipient discussed their CRM needs and confirmed they want a Harbor rep to follow up.",
    structuredResult: {
      primary_pain: "Fragmented customer data",
      use_case: "CRM replacement",
      timeline: "1-2 months",
      company_size: "80 reps",
      company_description: "B2B logistics software",
      alternatives: ["Salesforce"],
      objections: ["Migration effort"],
      decision_role: "Founder",
      interest_level: "strong",
      asked_for_person: "yes",
      handoff_recommended: "yes",
      evidence_summary: "They asked for a Harbor rep after describing siloed customer data."
    },
    completedAt: new Date().toISOString(),
    failureCode: null,
    failureMessage: null,
    recipients: [
      {
        structuredResult: { answered_by: "human" },
        attempts: [
          {
            startedAt: new Date(Date.now() - 60_000).toISOString(),
            completedAt: new Date().toISOString(),
            failureMessage: null,
            transcriptTurns: [
              { speaker: "bot", text: "Thanks so much for picking up.", offset_seconds: 1 },
              { speaker: "user", text: "Our customer data is siloed across three tools.", offset_seconds: 8 }
            ]
          }
        ]
      }
    ]
  } as unknown as Call;

  const merged = applyCalleSnapshot(local, remote);
  assert.equal(merged.status, "completed");
  assert.equal(merged.opportunityProfile?.primaryPain?.value, "Fragmented customer data");
  assert.doesNotMatch(merged.opportunityProfile?.primaryPain?.value || "", /discovery call completed/i);
  assert.equal(merged.leadDossier?.triggerPain, "Fragmented customer data");
  assert.deepEqual(merged.opportunityProfile?.alternatives?.value, ["Salesforce"]);
  assert.equal(merged.opportunityProfile?.companyDescription?.value, "B2B logistics software");
  assert.equal(merged.opportunityProfile?.wantsHumanFollowUp?.value, true);
});

test("live snapshot: long CALL-E pain and use case are kept", () => {
  const local = createFixtureCallRecord("+15550192831", session(), "Alex", "alex@example.com");
  local.status = "dialing";
  local.dryRun = false;
  local.calleCallId = "calle_long_pain";
  local.transcript = undefined;
  local.leadDossier = undefined;
  local.opportunityProfile = undefined;

  const pain = "HubSpot is very bad so they want a cheaper CRM";
  const useCase = "Replace HubSpot with a cheaper CRM for a 500-person team";
  const remote = {
    id: "calle_long_pain",
    status: "completed",
    taskCompleted: true,
    summary: "The call completed successfully.",
    structuredResult: {
      primary_pain: pain,
      use_case: useCase,
      timeline: "",
      company_size: "500 people",
      alternatives: ["HubSpot", "Salesforce"],
      objections: [],
      decision_role: "",
      interest_level: "moderate",
      asked_for_person: "no",
      handoff_recommended: "unknown",
      evidence_summary: "They said HubSpot is very bad and asked for a cheaper option."
    },
    completedAt: new Date().toISOString(),
    failureCode: null,
    failureMessage: null,
    recipients: [
      {
        structuredResult: { answered_by: "human" },
        attempts: [
          {
            startedAt: new Date(Date.now() - 80_000).toISOString(),
            completedAt: new Date().toISOString(),
            failureMessage: null,
            transcriptTurns: [
              { speaker: "user", text: "I want to change my CRM. HubSpot is very bad.", offset_seconds: 8 }
            ]
          }
        ]
      }
    ]
  } as unknown as Call;

  const merged = applyCalleSnapshot(local, remote);
  assert.equal(merged.opportunityProfile?.primaryPain?.value, pain);
  assert.equal(merged.opportunityProfile?.useCase?.value, useCase);
  assert.equal(merged.opportunityProfile?.companySize?.value, "500 people");
  assert.equal(displayPain(merged.opportunityProfile?.primaryPain?.value), pain);
  assert.equal(displayPain(merged.opportunityProfile?.timeline?.value), "—");
});

test("live snapshot: placeholder timeline is not stored", () => {
  const local = createFixtureCallRecord("+15550192831", session(), "Terr", "terr@example.com");
  local.status = "dialing";
  local.dryRun = false;
  local.calleCallId = "calle_placeholder_timeline";
  local.transcript = undefined;
  local.leadDossier = undefined;
  local.opportunityProfile = undefined;
  local.useCase = "";

  const remote = {
    id: "calle_placeholder_timeline",
    status: "completed",
    taskCompleted: true,
    summary: "The discovery call completed.",
    structuredResult: {
      primary_pain: "HubSpot is too expensive",
      use_case: "",
      timeline: "See live transcript",
      company_size: "",
      alternatives: ["HubSpot"],
      objections: [],
      decision_role: "",
      interest_level: "moderate",
      asked_for_person: "no",
      handoff_recommended: "unknown",
      evidence_summary: "They said HubSpot is too expensive."
    },
    completedAt: new Date().toISOString(),
    failureCode: null,
    failureMessage: null,
    recipients: [
      {
        structuredResult: { answered_by: "human" },
        attempts: [
          {
            startedAt: new Date(Date.now() - 60_000).toISOString(),
            completedAt: new Date().toISOString(),
            failureMessage: null,
            transcriptTurns: [{ speaker: "user", text: "HubSpot is too expensive.", offset_seconds: 6 }]
          }
        ]
      }
    ]
  } as unknown as Call;

  const merged = applyCalleSnapshot(local, remote);
  const timeline = merged.opportunityProfile?.timeline;
  const useCase = merged.opportunityProfile?.useCase;
  const action = merged.opportunityProfile?.recommendedAction;
  assert.equal(displayPain(timeline?.value), "—");
  assert.equal(displayAction(action?.value), "—");
  assert.equal(timeline, undefined);
  assert.equal(useCase, undefined);
});

test("live snapshot: voicemail structured result is no_answer", () => {
  const local = createFixtureCallRecord("+15550192831", session(), "Alex", "alex@example.com");
  local.status = "dialing";
  local.dryRun = false;
  local.calleCallId = "calle_vm_1";
  local.opportunityProfile = undefined;

  const remote = {
    id: "calle_vm_1",
    status: "completed",
    taskCompleted: false,
    summary: "Reached voicemail.",
    structuredResult: null,
    completedAt: new Date().toISOString(),
    failureCode: null,
    failureMessage: null,
    recipients: [
      {
        structuredResult: { answered_by: "voicemail" },
        attempts: [
          {
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            failureMessage: null,
            transcriptTurns: [{ speaker: "bot", text: "Please leave a message.", offset_seconds: 1 }]
          }
        ]
      }
    ]
  } as unknown as Call;

  const merged = applyCalleSnapshot(local, remote);
  assert.equal(merged.status, "no_answer");
  assert.notEqual(merged.opportunityProfile?.priority, "disqualified");
});

test("opportunity: missed pickup and failed-without-speech are not disqualified", () => {
  const highIntent = { score: 47, level: "high" as const, signals: [] };

  const missed = createFixtureCallRecord("+15550192831", session(), "Tobias", "founder@example.com");
  missed.status = "no_answer";
  missed.opportunityProfile = undefined;
  missed.leadDossier = undefined;
  missed.transcript = [];
  missed.fullTranscript = "";
  const missedProfile = opportunityFromCall(missed, highIntent);
  assert.notEqual(missedProfile.priority, "disqualified");
  assert.equal(missedProfile.recommendedAction?.value, MISSED_PICKUP_ACTION);
  assert.equal(missedProfile.wantsHumanFollowUp?.value, true);

  const failedSilent = { ...missed, status: "failed" as const };
  const failedProfile = opportunityFromCall(failedSilent, highIntent);
  assert.notEqual(failedProfile.priority, "disqualified");
  assert.equal(failedProfile.recommendedAction?.value, MISSED_PICKUP_ACTION);
});

function sampleLead(overrides: Partial<LeadQueueItem> = {}): LeadQueueItem {
  return {
    visitorId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    accountId: "harbor",
    lead: { name: "Alex", company: "Acme", email: "alex@example.com" },
    intent: { score: 72, level: "high", signals: [] },
    behavior: {
      pagesViewed: ["/demo"],
      pageViewCounts: { "/demo": 1 },
      hoverSecByPath: {},
      returningVisitor: false,
      sessionDurationSec: 40,
      visitCount: 1
    },
    declaredInterest: ["pricing"],
    priority: "high",
    lastSeenAt: new Date().toISOString(),
    ...overrides
  };
}

test("console: Valid SQD funnel stage explains BANT", () => {
  const sqd = FUNNEL.find((stage) => stage.key === "salesQualified");
  assert.equal(sqd?.title, "Valid SQD");
  assert.match(sqd?.hint || "", /sales-qualified discovery/i);
  assert.match(sqd?.hint || "", /BANT/i);
  assert.match(sqd?.hint || "", /budget/i);
});

test("console: warmth is intent /100 and lead status follows the call", () => {
  assert.equal(warmthHeadline(72, "high"), "72/100 · HIGH");
  assert.doesNotMatch(warmthHeadline(72, "high"), /\/10 ·|overall/i);

  const waiting = leadStatusSummary(sampleLead());
  assert.equal(waiting.headline, "No discovery call yet");

  const missed = leadStatusSummary(
    sampleLead({
      latestCallId: "call-1",
      latestCallStatus: "no_answer",
      opportunity: {
        ...harborFixtureOpportunity(),
        recommendedAction: { value: MISSED_PICKUP_ACTION, source: "inferred", confidence: 0.9 }
      }
    })
  );
  assert.equal(missed.headline, "No answer");
  assert.equal(missed.detail, MISSED_PICKUP_ACTION);

  const done = leadStatusSummary(
    sampleLead({
      latestCallId: "call-2",
      latestCallStatus: "completed",
      opportunity: harborFixtureOpportunity()
    })
  );
  assert.equal(done.headline, "Discovery complete");
  assert.match(done.detail, /follow-up/i);

  const withFacts = leadProfileSummary(
    sampleLead({
      opportunity: harborFixtureOpportunity()
    })
  );
  assert.match(withFacts, /Replace spreadsheets/i);
  assert.match(withFacts, /80/);

  const bare = leadProfileSummary(sampleLead());
  assert.match(bare, /pricing/i);

  assert.equal(formatChipLabel("email_provided"), "Email provided");
  assert.equal(formatChipLabel("plan_professional"), "Professional plan");
  assert.equal(formatChipLabel("faq_sandbox"), "FAQ: sandbox");
  assert.equal(signalTier("plan_enterprise"), "high");
  assert.equal(signalTier("plan_starter"), "medium");
  assert.equal(signalTier("email_provided"), "high");
  assert.equal(signalTier("returning_visitor"), "high");
  assert.equal(signalTier("pricing_interest"), "medium");
  assert.equal(signalTier("page_hover"), "low");

  const grouped = groupIntentSignalsByTier([
    { type: "page_hover", source: "behavior", confidence: 0.4 },
    { type: "email_provided", source: "form", confidence: 0.9 },
    { type: "pricing_interest", source: "page", confidence: 0.6 },
    { type: "email_provided", source: "repeat", confidence: 0.8 }
  ]);
  assert.deepEqual(
    grouped.map((group) => ({ tier: group.tier, label: group.label, types: group.signals.map((s) => s.type) })),
    [
      { tier: "high", label: "High intent", types: ["email_provided"] },
      { tier: "medium", label: "Medium", types: ["pricing_interest"] },
      { tier: "low", label: "Page interest", types: ["page_hover"] }
    ]
  );

  const pages = pageEngagementRows({
    pagesViewed: ["/demo/pricing", "/demo"],
    pageViewCounts: { "/demo/pricing": 2, "/demo": 4 },
    hoverSecByPath: { "/demo/pricing": 40, "/demo": 8 },
    returningVisitor: false,
    sessionDurationSec: 90,
    visitCount: 1
  });
  assert.equal(pages[0]?.path, "/demo/pricing");
  assert.ok((pages[0]?.barPct || 0) > (pages[1]?.barPct || 0));

  const facts = leadDiscoveryFacts(
    sampleLead({
      opportunity: {
        ...harborFixtureOpportunity(),
        companyDescription: { value: "B2B logistics software", source: "explicit", confidence: 0.9 }
      }
    })
  );
  assert.equal(facts.some((fact) => fact.label === "Company"), false);
  assert.ok(facts.some((fact) => fact.label === "Use case"));
  assert.ok(facts.some((fact) => fact.label === "Size"));
  assert.ok(facts.some((fact) => fact.label === "Pain point"));

  assert.match(callJourneyBlurb({ ...createFixtureCallRecord("+15550192831", session()), status: "queued" }), /queued/i);

  const dialing = leadStatusSummary(
    sampleLead({ latestCallId: "call-3", latestCallStatus: "dialing" }),
    { ...createFixtureCallRecord("+15550192831", session()), status: "dialing", speedToDialSec: 12 }
  );
  assert.equal(dialing.detail, "Ringing after 12s.");
});

test("console: leads table sorts by company, warmth, profile, and status", () => {
  const zeta = sampleLead({
    visitorId: "vis-zeta",
    lead: { name: "Zed", company: "Zeta Co", email: "zed@example.com" },
    intent: { score: 40, level: "medium", signals: [] },
    latestCallId: "call-zeta",
    latestCallStatus: "queued"
  });
  const acme = sampleLead({
    visitorId: "vis-acme",
    lead: { name: "Ann", company: "Acme", email: "ann@example.com" },
    intent: { score: 90, level: "high", signals: [] },
    latestCallId: "call-acme",
    latestCallStatus: "completed"
  });
  const beta = sampleLead({
    visitorId: "vis-beta",
    lead: { name: "Bea", company: "Beta Inc", email: "bea@example.com" },
    intent: { score: 70, level: "high", signals: [] },
    latestCallId: "call-beta",
    latestCallStatus: "dialing"
  });
  const rows = [zeta, acme, beta];
  assert.equal(defaultLeadSortDirection("warmth"), "desc");
  assert.equal(defaultLeadSortDirection("company"), "asc");
  assert.deepEqual(
    sortLeadQueue(rows, "company", "asc").map((lead) => lead.lead.company),
    ["Acme", "Beta Inc", "Zeta Co"]
  );
  assert.deepEqual(
    sortLeadQueue(rows, "warmth", "desc").map((lead) => lead.intent.score),
    [90, 70, 40]
  );
  assert.deepEqual(
    sortLeadQueue(rows, "status", "asc").map((lead) => lead.latestCallStatus),
    ["dialing", "queued", "completed"]
  );
  const withProfile = [
    sampleLead({
      visitorId: "vis-b",
      opportunity: { ...harborFixtureOpportunity(), callSummary: { value: "Needs HubSpot replacement", source: "explicit", confidence: 0.9 } }
    }),
    sampleLead({
      visitorId: "vis-a",
      opportunity: { ...harborFixtureOpportunity(), callSummary: { value: "Asking about analytics", source: "explicit", confidence: 0.9 } }
    })
  ];
  assert.deepEqual(
    sortLeadQueue(withProfile, "profile", "asc").map((lead) => lead.visitorId),
    ["vis-a", "vis-b"]
  );
});

test("console: formatDuration uses compact unit labels", () => {
  assert.equal(formatDuration(), "");
  assert.equal(formatDuration(0), "");
  assert.equal(formatDuration(-4), "");
  assert.equal(formatDuration(12), "12s");
  assert.equal(formatDuration(22.4), "22s");
  assert.equal(formatDuration(59), "59s");
  assert.equal(formatDuration(60), "1m");
  assert.equal(formatDuration(83), "1m 23s");
  assert.equal(formatDuration(120), "2m");
  assert.equal(formatDuration(162), "2m 42s");
  assert.equal(formatDuration(3600), "1h");
  assert.equal(formatDuration(3660), "1h 1m");
  assert.equal(formatDuration(3723), "1h 2m 3s");
  assert.equal(formatDuration(SPEED_TO_RING_SLA_SEC), "5m");
  assert.equal(formatHoverByPath({ "/demo": 12, "/demo/pricing": 162 }), "/demo 12s, /demo/pricing 2m 42s");
  assert.equal(formatHoverByPath({ "/demo": 0 }), "");
});

test("console: speed-to-ring SLA is five minutes", () => {
  assert.equal(SPEED_TO_RING_SLA_SEC, 300);
  assert.equal(speedToRingSlaMet(0), false);
  assert.equal(speedToRingSlaMet(22.4), true);
  assert.equal(speedToRingSlaMet(300), true);
  assert.equal(speedToRingSlaMet(301), false);
});

test("console: transcript offsets use m:ss and speaker labels stay human", () => {
  assert.equal(formatTranscriptOffset(), "0:00");
  assert.equal(formatTranscriptOffset(""), "0:00");
  assert.equal(formatTranscriptOffset("1"), "0:01");
  assert.equal(formatTranscriptOffset("8"), "0:08");
  assert.equal(formatTranscriptOffset("65"), "1:05");
  assert.equal(formatTranscriptOffset("1:04"), "1:04");
  assert.equal(formatTranscriptOffset("2026-09-04T17:00:24.000Z"), "");
  assert.equal(formatTranscriptOffset("2026-09-04T17:00:01.000Z", "2026-09-04T17:00:00.000Z"), "0:01");
  const recovered = normalizeCallTranscript({
    requestedAt: "2026-09-04T17:00:00.000Z",
    transcript: [
      { speaker: "system", text: "Start", timestamp: "2026-09-04T17:00:01.000Z" },
      { speaker: "agent", text: "Hello", timestamp: "5" }
    ]
  } as SundialCallRecord);
  assert.equal(recovered.transcript?.[0]?.timestamp, "1");
  assert.equal(recovered.transcript?.[1]?.timestamp, "5");
  assert.equal(
    transcriptSpeakerName("agent", {
      agentIdentity: "Warm, welcoming discovery host for Harbor sales",
      productName: "Harbor CRM"
    }),
    "Harbor Sales"
  );
  assert.equal(transcriptSpeakerName("bot", { productName: "Harbor CRM" }), "Harbor CRM");
  assert.equal(transcriptSpeakerName("user", { contactName: "Maya Example" }), "Maya Example");
  assert.equal(transcriptSpeakerName("user", { leadName: "Jordan Example" }), "Jordan Example");
  assert.equal(transcriptSpeakerName("user", {}), "Caller");
  assert.equal(transcriptSpeakerName("system", {}), "System");
  assert.equal(transcriptSpeakerName("agent", { agentIdentity: "Alex Example" }), "Alex Example");
  assert.equal(transcriptSpeakerName("agent", {}), "Harbor");
});

test("opportunity: only a disqualified dossier marks the lead disqualified", () => {
  const call = createFixtureCallRecord("+15550192831", session(), "Tobias", "founder@example.com");
  call.status = "failed";
  call.opportunityProfile = undefined;
  call.leadDossier = {
    ...call.leadDossier!,
    intentTier: "disqualified"
  };
  const profile = opportunityFromCall(call, { score: 10, level: "low", signals: [] });
  assert.equal(profile.priority, "disqualified");
});

test("live snapshot: no-answer / canceled without user speech is not a failed sale", () => {
  assert.equal(mapCalleStatus("canceled"), "no_answer");
  assert.equal(mapCalleStatus("failed", { hadUserSpeech: false, failureMessage: "No answer" }), "no_answer");
  assert.equal(mapCalleStatus("failed", { hadUserSpeech: true }), "failed");
  assert.equal(
    mapCalleStatus("failed", { hadUserSpeech: false, failureCode: "insufficient_balance" }),
    "failed"
  );

  const local = createFixtureCallRecord("+15550192831", session(), "Tobias", "founder@example.com");
  local.status = "dialing";
  local.dryRun = false;
  local.calleCallId = "calle_missed_1";
  local.transcript = undefined;
  local.leadDossier = undefined;
  local.opportunityProfile = undefined;

  const remote = {
    id: "calle_missed_1",
    status: "canceled",
    taskCompleted: false,
    summary: "Recipient did not pick up.",
    completedAt: new Date().toISOString(),
    failureCode: "no_answer",
    failureMessage: "No answer",
    recipients: [{ attempts: [{ startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), failureMessage: "No answer", transcriptTurns: [] }] }]
  } as unknown as Call;

  const merged = applyCalleSnapshot(local, remote);
  assert.equal(merged.status, "no_answer");
  assert.equal(merged.connectedAt, undefined);
  assert.notEqual(merged.opportunityProfile?.priority, "disqualified");
  assert.equal(merged.opportunityProfile?.recommendedAction?.value, MISSED_PICKUP_ACTION);
});

test("ids: new entity ids are UUID-shaped and lookup works for prefixed or UUID visitors", () => {
  const id = newEntityId();
  assert.match(id, /^[0-9a-f-]{8,}$/i);
  assert.doesNotMatch(id, /^vis_/);
  assert.doesNotMatch(id, /^call_/);

  const store = new SundialsDatabase(":memory:");
  const visitorId = newEntityId();
  store.ingestEventBatch({
    accountId: "harbor",
    visitorId,
    sessionId: newEntityId(),
    events: [
      { event: "page_view", properties: { path: "/demo" } },
      {
        event: "identify",
        properties: { email: "lead@example.com", company: "Acme", name: "Lead" }
      }
    ]
  });
  const lead = store.getLeadById(visitorId);
  assert.ok(lead);
  assert.equal(lead?.visitorId, visitorId);
  assert.match(store.getEventsForVisitor(visitorId)[0]?.id || "", /^[0-9a-f-]{8,}$/i);

  store.ingestEventBatch({
    accountId: "harbor",
    visitorId: "vis_legacy",
    sessionId: "sess_legacy",
    events: [
      { event: "page_view", properties: { path: "/demo/pricing" } },
      { event: "identify", properties: { email: "old@example.com" } }
    ]
  });
  assert.equal(store.getLeadById("vis_legacy")?.visitorId, "vis_legacy");

  const fixture = createFixtureCallRecord("+15550192831", session());
  assert.doesNotMatch(fixture.id, /^call_/);
  store.saveCall({ ...fixture, visitorId });
  assert.equal(store.getCallsForVisitor(visitorId).length, 1);
  assert.equal(store.getCall(fixture.id)?.id, fixture.id);
});

test("sdk auth: generated account key maps to the account and rejects anything else", () => {
  const store = new SundialsDatabase(":memory:");
  const harbor = store.getAccount("harbor");
  assert.ok(harbor);
  assert.equal(harbor?.sdkKey, null);
  const key = store.generateSdkKey("harbor");
  assert.match(key, /^Harbor-[0-9a-f-]{36}$/i);

  const ok = authenticateSdkRequest(new Headers({ [SUNDIALS_API_KEY_HEADER]: key }), "harbor", store);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.accountId, "harbor");

  const missing = authenticateSdkRequest(new Headers(), undefined, store);
  assert.equal(missing.ok, false);

  const wrong = authenticateSdkRequest(new Headers({ [SUNDIALS_API_KEY_HEADER]: "not-an-issued-key" }), undefined, store);
  assert.equal(wrong.ok, false);

  const mismatch = authenticateSdkRequest(new Headers({ [SUNDIALS_API_KEY_HEADER]: key }), "acme", store);
  assert.equal(mismatch.ok, false);
});

test("accounts: harbor seed, signup, password hash, and session cookie", () => {
  const store = new SundialsDatabase(":memory:");
  const harbor = store.getAccountByUsername("harbor");
  assert.ok(harbor);
  assert.equal(harbor?.id, "harbor");
  assert.equal(harbor?.sdkKey, null);
  assert.equal(verifyPassword("harbor", harbor!.passwordHash), true);
  assert.equal(verifyPassword("nope", harbor!.passwordHash), false);

  const created = store.createAccount({ username: "northline", password: "secret1", companyName: "Northline" });
  assert.equal(created.ok, true);
  if (created.ok) {
    assert.equal(created.account.username, "northline");
    assert.match(created.account.id, /^northline/);
    const sdk = store.generateSdkKey(created.account.id);
    assert.match(sdk, /^Northline-/);
    const auth = authenticateSdkRequest(
      new Headers({ [SUNDIALS_API_KEY_HEADER]: sdk }),
      created.account.id,
      store
    );
    assert.equal(auth.ok, true);
  }

  const taken = store.createAccount({ username: "harbor", password: "secret1", companyName: "Other" });
  assert.equal(taken.ok, false);

  const token = encodeSessionCookie({ accountId: "harbor", username: "harbor", exp: Date.now() + 60_000 });
  const session = decodeSessionCookie(token);
  assert.equal(session?.accountId, "harbor");
  assert.equal(decodeSessionCookie("tampered"), null);

  const unauth = sessionFromRequest({ cookies: { get: () => undefined } });
  assert.equal(unauth, null);

  const authed = sessionFromRequest({
    cookies: { get: (name: string) => (name === SESSION_COOKIE ? { value: token } : undefined) }
  });
  assert.equal(authed?.accountId, "harbor");
});

test("brain: default Harbor config includes Harbor opening", () => {
  const config = defaultBrainConfig();
  assert.equal(config.accountId, "harbor");
  assert.equal(config.openingScript, HARBOR_OPENING_SCRIPT);
  assert.equal(config.closingScript, HARBOR_CLOSING_SCRIPT);
  assert.equal(config.retryDelayHours, DEFAULT_RETRY_DELAY_HOURS);
  assert.match(config.openingScript, /automated assistant for Harbor Sales/);
  assert.match(config.openingScript, /recorded for quality/i);
  assert.match(config.openingScript, /what can we help you with today/i);
});

test("brain: default goals and live task injection", () => {
  const config = defaultBrainConfig();
  assert.ok(config.goals.some((goal) => goal.targetField === "companySize" && goal.enabled));
  assert.equal(enabledGoals({ ...config, goals: config.goals.map((goal) => ({ ...goal, enabled: goal.id !== "timeline" })) }).some((goal) => goal.id === "timeline"), false);

  const task = buildLiveCallTask("+15550192831", session(), "Alex", "alex@example.com", {
    declaredCta: "talk_to_sales",
    productName: config.productName,
    agentIdentity: config.agentIdentity,
    tonePersona: config.tonePersona,
    openingScript: config.openingScript,
    closingScript: config.closingScript,
    activeGoals: enabledGoals(config)
  });
  assert.match(task, /How many reps are currently logging in every day/);
  assert.match(task, /Listen first/);
  assert.match(task, /automated assistant for Harbor Sales/);
  assert.doesNotMatch(task, /visited pricing three times/i);
  assert.doesNotMatch(task, /Also cover buying role, objections, and whether they want a human Harbor follow-up/);
});

test("brain: extraction merge overlays Gemini fields without dropping scores", () => {
  const base = harborFixtureOpportunity();
  const merged = mergeBrainExtraction(base, {
    companySize: "120 seats",
    alternatives: ["HubSpot", "spreadsheets"],
    migrationScope: "CSV contacts plus history",
    callSummary: "They want a cheaper CRM than HubSpot."
  });
  assert.equal(merged.scores.overall.value, base.scores.overall.value);
  assert.equal(merged.companySize?.value, "120 seats");
  assert.deepEqual(merged.alternatives?.value, ["HubSpot", "spreadsheets"]);
  assert.equal(merged.extractedGoals?.migrationScope?.value, "CSV contacts plus history");
  assert.equal(merged.callSummary?.value, "They want a cheaper CRM than HubSpot.");
});

test("gemini: call briefing fills empty tags and replaces generic follow-up", () => {
  const base = {
    ...harborFixtureOpportunity(),
    useCase: undefined,
    timeline: { value: "See live transcript", source: "inferred" as const, confidence: 0.4 },
    recommendedAction: { value: GENERIC_FOLLOW_UP_TODAY, source: "inferred" as const, confidence: 0.75 }
  };
  const profiled = applyGeminiCallProfile(base, {
    summary: "Terr compared Harbor with HubSpot and Salesforce for a cheaper CRM.",
    wants: "A lower-cost CRM that can replace HubSpot without a painful migration.",
    nextActions: [
      "Send a Harbor vs HubSpot pricing comparison today",
      "Ask which Salesforce edition they are evaluating"
    ],
    primaryPain: "HubSpot cost",
    painCategory: "HubSpot cost",
    useCase: "Replace HubSpot with a cheaper CRM",
    timeline: "",
    alternatives: ["HubSpot", "Salesforce"],
    recommendedAction: "Send Harbor vs HubSpot pricing today"
  });
  assert.match(profiled.callSummary?.value || "", /cheaper CRM/i);
  assert.match(profiled.leadWants?.value || "", /lower-cost CRM/i);
  assert.equal(profiled.useCase?.value, "Replace HubSpot with a cheaper CRM");
  assert.equal(profiled.timeline, undefined);
  assert.equal(profiled.recommendedAction?.value, "Send Harbor vs HubSpot pricing today");
  assert.deepEqual(profiled.nextActions?.value, [
    "Send a Harbor vs HubSpot pricing comparison today",
    "Ask which Salesforce edition they are evaluating"
  ]);
  assert.equal(displayAction(GENERIC_FOLLOW_UP_TODAY), "—");
  assert.equal(displayAction(profiled.recommendedAction?.value), "Send Harbor vs HubSpot pricing today");
  assert.equal(profiled.painCategory?.value, "HubSpot cost");
  assert.equal(profiled.primaryPain?.value, "HubSpot cost");
  assert.equal(hasGeminiBriefing({ opportunityProfile: profiled }), true);
  assert.match(leadProfileSummary(sampleLead({ opportunity: profiled })), /cheaper CRM/i);
  const facts = leadDiscoveryFacts(sampleLead({ opportunity: profiled }));
  assert.equal(facts.some((fact) => fact.label === "Timeline"), false);
  assert.equal(facts.some((fact) => fact.label === "Call summary"), false);
  assert.equal(facts.some((fact) => fact.label === "Action"), false);
  assert.ok(facts.some((fact) => fact.label === "Use case"));
  assert.ok(facts.some((fact) => fact.label === "Pain point"));
  assert.ok(facts.some((fact) => fact.label === "Next for sales"));
  const split = splitDiscoveryFacts(facts);
  assert.ok(split.narrative.some((fact) => fact.label === "Next for sales"));
  assert.ok(split.meta.some((fact) => fact.label === "Use case"));
  assert.equal(split.meta.some((fact) => fact.label === "Next for sales"), false);
});

test("gemini: prompt masks PII and omits the raw phone number", () => {
  const call = createFixtureCallRecord("+15550192831", session(), "Terr", "terr@example.com");
  call.company = "Northline";
  call.fullTranscript = "Call me at +1 415 555 0199 or terr@example.com if Harbor is cheaper than HubSpot.";
  const cleaned = sanitizeTranscriptForGemini(call.fullTranscript);
  assert.match(cleaned, /t\*\*\*@example.com/i);
  assert.doesNotMatch(cleaned, /4155550199/);
  const prompt = buildCallProfilePrompt(call, "Harbor CRM", ["HubSpot cost"]);
  assert.ok(prompt);
  assert.doesNotMatch(prompt || "", /\+15550192831/);
  assert.doesNotMatch(prompt || "", /terr@example.com/i);
  assert.match(prompt || "", /Harbor CRM/);
  assert.match(prompt || "", /Known pain categories/);
  assert.match(prompt || "", /HubSpot cost/);
  assert.match(prompt || "", /painCategory/);
});

test("gemini: pain catalog reuses an existing account label and clamps to 3 words", () => {
  const reuse = resolvePainCategory("hubspot cost", ["HubSpot cost", "Manual CRM admin"]);
  assert.equal(reuse.label, "HubSpot cost");
  assert.equal(reuse.isNew, false);
  assert.deepEqual(reuse.catalog, ["HubSpot cost", "Manual CRM admin"]);

  const created = resolvePainCategory("Salesforce admin overhead tonight", ["HubSpot cost"]);
  assert.equal(created.label, "Salesforce admin overhead");
  assert.equal(created.isNew, true);
  assert.deepEqual(created.catalog, ["HubSpot cost", "Salesforce admin overhead"]);
  assert.equal(clampPainCategory("one two three four"), "one two three");
  assert.deepEqual(
    mergePainCatalogs(["HubSpot cost", "Staffing Needs"], ["High CRM Cost", "hubspot cost"], "Cost and Usability"),
    ["HubSpot cost", "Staffing Needs", "High CRM Cost", "Cost and Usability"]
  );
});

test("brain: config persists beside the database path", () => {
  const dir = mkdtempSync(join(tmpdir(), "sundials-brain-"));
  const prev = process.env.SUNDIALS_DB_PATH;
  process.env.SUNDIALS_DB_PATH = join(dir, "sundials.db");
  try {
    const written = writeBrainConfig({
      ...defaultBrainConfig(),
      productName: "Harbor CRM",
      goals: defaultBrainGoals().map((goal) => (goal.id === "timeline" ? { ...goal, enabled: false } : goal))
    });
    assert.equal(written.goals.find((goal) => goal.id === "timeline")?.enabled, false);
    assert.equal(written.openingScript, HARBOR_OPENING_SCRIPT);
    assert.equal(written.closingScript, HARBOR_CLOSING_SCRIPT);
    assert.equal(readBrainConfig("harbor").goals.find((goal) => goal.id === "timeline")?.enabled, false);
    assert.equal(readBrainConfig("harbor").openingScript, HARBOR_OPENING_SCRIPT);
    assert.equal(readBrainConfig("harbor").closingScript, HARBOR_CLOSING_SCRIPT);
    assert.equal(normalizeBrainConfig({ accountId: "harbor", productName: "Harbor CRM" }).openingScript, HARBOR_OPENING_SCRIPT);
    assert.equal(normalizeBrainConfig({ accountId: "harbor", productName: "Harbor CRM" }).closingScript, HARBOR_CLOSING_SCRIPT);
    assert.equal(normalizeBrainConfig({ accountId: "harbor", productName: "Harbor CRM" }).retryDelayHours, DEFAULT_RETRY_DELAY_HOURS);
    const cleared = writeBrainConfig({ ...defaultBrainConfig(), openingScript: "   " });
    assert.equal(cleared.openingScript, "");
    assert.equal(readBrainConfig("harbor").openingScript, "");
  } finally {
    if (prev === undefined) delete process.env.SUNDIALS_DB_PATH;
    else process.env.SUNDIALS_DB_PATH = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

function missedPickupRecord(overrides: Partial<SundialCallRecord> = {}): SundialCallRecord {
  const call = createFixtureCallRecord("+15550192831", session(), "Alex", "alex@example.com", {
    visitorId: "vis_unit_test",
    company: "Acme"
  });
  call.status = "no_answer";
  call.transcript = [];
  call.fullTranscript = "";
  call.leadDossier = undefined;
  call.opportunityProfile = {
    ...harborFixtureOpportunity(),
    priority: "nurture",
    recommendedAction: { value: MISSED_PICKUP_ACTION, source: "inferred", confidence: 0.9 }
  };
  call.rawContactEmail = "alex@example.com";
  return { ...call, ...overrides };
}

function withBrain<T>(config: Partial<import("../lib/types.ts").BrainConfig>, run: () => T): T {
  const dir = mkdtempSync(join(tmpdir(), "sundials-retry-"));
  const prev = process.env.SUNDIALS_DB_PATH;
  process.env.SUNDIALS_DB_PATH = join(dir, "sundials.db");
  try {
    writeBrainConfig({ ...defaultBrainConfig(), ...config });
    return run();
  } finally {
    if (prev === undefined) delete process.env.SUNDIALS_DB_PATH;
    else process.env.SUNDIALS_DB_PATH = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("brain: retryDelayHours default, bounds, and skip-if-invalid", () => {
  assert.equal(normalizeRetryDelayHours(undefined, true), DEFAULT_RETRY_DELAY_HOURS);
  assert.equal(normalizeRetryDelayHours(null), undefined);
  assert.equal(normalizeRetryDelayHours(0), undefined);
  assert.equal(normalizeRetryDelayHours(MIN_RETRY_DELAY_HOURS - 0.01), undefined);
  assert.equal(normalizeRetryDelayHours(MAX_RETRY_DELAY_HOURS + 1), undefined);
  assert.equal(normalizeRetryDelayHours("nope"), undefined);
  assert.equal(normalizeRetryDelayHours(2), 2);
  assert.equal(normalizeBrainConfig({ ...defaultBrainConfig(), retryDelayHours: 0 }).retryDelayHours, undefined);
});

test("retry: failed/no-speech marks reconciliation and does not schedule another call", () => {
  withBrain({ retryDelayHours: 2 }, () => {
    const store = new SundialsDatabase(":memory:");
    const parent = missedPickupRecord();
    store.saveCall(parent);

    const saved = store.peekCalls().find((call) => call.id === parent.id);
    assert.equal(store.peekCalls().filter((call) => call.retryOfCallId === parent.id).length, 0);
    assert.equal(saved?.retryDueAt, undefined);
    assert.equal(saved?.needsReconciliation, true);
    assert.match(saved?.errorReason || "", /ambiguous provider outcome/i);
    const review = leadStatusSummary(
      sampleLead({ latestCallId: saved!.id, latestCallStatus: "no_answer" }),
      saved
    );
    assert.equal(review.headline, "Needs review");

    const failedSilent = missedPickupRecord({
      id: newEntityId(),
      visitorId: "vis_failed_silent",
      status: "failed",
      session: { ...session(), visitorId: "vis_failed_silent" }
    });
    store.saveCall(failedSilent);
    assert.equal(store.peekCalls().filter((call) => call.retryOfCallId === failedSilent.id).length, 0);
    assert.equal(store.peekCalls().find((call) => call.id === failedSilent.id)?.needsReconciliation, true);
  });
});

test("retry: completed and failed-with-speech do not retry", () => {
  withBrain({ retryDelayHours: 1 }, () => {
    const store = new SundialsDatabase(":memory:");
    const completed = createFixtureCallRecord("+15550192831", session(), "Alex", "alex@example.com", {
      visitorId: "vis_completed"
    });
    store.saveCall(completed);
    assert.equal(store.peekCalls().length, 1);
    assert.ok(!store.peekCalls().some((call) => call.retryOfCallId));
    assert.equal(store.peekCalls()[0]?.needsReconciliation, undefined);

    const spoke = missedPickupRecord({
      status: "failed",
      visitorId: "vis_spoke",
      transcript: [
        { speaker: "agent", text: "Hello" },
        { speaker: "user", text: "Hi, we already talked." }
      ],
      fullTranscript: "[USER]: Hi, we already talked."
    });
    store.saveCall(spoke);
    assert.equal(store.peekCalls().filter((call) => call.retryOfCallId === spoke.id).length, 0);
    assert.equal(store.peekCalls().find((call) => call.id === spoke.id)?.needsReconciliation, undefined);
  });
});

test("retry: leftover queued retries are cancelled by the hackathon lock", () => {
  const store = new SundialsDatabase(":memory:");
  const parent = missedPickupRecord({ status: "queued", retryOfCallId: undefined });
  const leftover = missedPickupRecord({
    id: newEntityId(),
    status: "queued",
    retryOfCallId: parent.id,
    retryCount: 1,
    retryDueAt: new Date(Date.now() - 1000).toISOString(),
    visitorId: parent.visitorId
  });
  store.saveCall(parent, { skipRetryHooks: true });
  store.saveCall(leftover, { skipRetryHooks: true });
  processDueRetries(store);
  const retry = store.peekCalls().find((call) => call.id === leftover.id);
  assert.equal(retry?.status, "failed");
  assert.match(retry?.retryCancelReason || retry?.errorReason || "", /hackathon retry lock/i);
});

test("retry: live create uses current Brain openingScript", () => {
  withBrain({ openingScript: "FIRST SCRIPT unique-aaa. This call may be recorded." }, () => {
    const retry = missedPickupRecord({ status: "queued", retryOfCallId: newEntityId(), retryCount: 1 });
    writeBrainConfig({
      ...defaultBrainConfig(),
      openingScript: "UPDATED SCRIPT unique-bbb. This call may be recorded. How can we help?"
    });
    const input = liveCreateInputForRecord(retry);
    assert.ok(input);
    assert.match(input?.task || "", /UPDATED SCRIPT unique-bbb/);
    assert.doesNotMatch(input?.task || "", /unique-aaa/);
    assert.match(input?.task || "", /Harbor CRM discovery/);
  });
});

test("retry: stop follow-up revokes consent even when no retry was queued", () => {
  withBrain({ retryDelayHours: 1 }, () => {
    const store = new SundialsDatabase(":memory:");
    const parent = missedPickupRecord();
    store.saveCall(parent);
    assert.equal(store.peekCalls().filter((call) => call.retryOfCallId === parent.id).length, 0);

    const cancelled = stopFollowUpsForVisitor(store, parent.visitorId, parent.rawPhoneNumber);
    assert.equal(cancelled, 0);
    assert.equal(store.peekCalls().find((call) => call.id === parent.id)?.callConsentAllowOneRetry, false);
  });
});

test("console: scheduled retry journey shows due time and no raw ids", () => {
  const dueAt = "2026-09-06T15:30:00.000Z";
  const retry = missedPickupRecord({
    status: "queued",
    retryOfCallId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    retryCount: 1,
    retryDueAt: dueAt,
    durationSec: 0
  });
  const blurb = callJourneyBlurb(retry);
  assert.equal(blurb, `Follow-up discovery call scheduled for ${formatDateTime(dueAt)}.`);
  assert.doesNotMatch(blurb, /aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/);
  assert.equal(blurb.includes(retry.id), false);

  const status = leadStatusSummary(
    sampleLead({ latestCallId: retry.id, latestCallStatus: "queued" }),
    retry
  );
  assert.equal(status.headline, "Retry scheduled");
  assert.match(status.detail, /follow-up ring/i);
  assert.doesNotMatch(status.detail, /aaaaaaaa/);
});

test("retry: missing or mismatched call consent does not schedule a follow-up", () => {
  withBrain({ retryDelayHours: 1 }, () => {
    const store = new SundialsDatabase(":memory:");
    store.saveCall(missedPickupRecord({ callConsentAllowOneRetry: false }));
    assert.equal(store.peekCalls().filter((call) => Boolean(call.retryOfCallId)).length, 0);

    store.saveCall(missedPickupRecord({ id: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff", callConsentE164: "+6555501010" }));
    assert.equal(store.peekCalls().filter((call) => Boolean(call.retryOfCallId)).length, 0);
  });
});

test("webhook: unknown or dry-run ids are not writable from the body", async () => {
  const store = new SundialsDatabase(":memory:");
  const missing = await ingestCalleWebhook(store, { callId: "calle_missing" }, async () => {
    throw new Error("must not fetch CALL-E for an unknown id");
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.status, 404);

  const dry = createFixtureCallRecord("+15550192831", session(), "Alex", "alex@example.com");
  dry.calleCallId = undefined;
  dry.dryRun = true;
  store.saveCall(dry);
  const noCalle = await ingestCalleWebhook(
    store,
    {
      callId: dry.id,
      transcript: [{ speaker: "user", text: "ATTACKER PLANTED THIS" }]
    },
    async () => {
      throw new Error("must not fetch CALL-E without a calleCallId");
    }
  );
  assert.equal(noCalle.ok, false);
  if (!noCalle.ok) assert.equal(noCalle.status, 404);
});

test("webhook: ignores body transcript and re-fetches CALL-E", async () => {
  const store = new SundialsDatabase(":memory:");
  const local = createFixtureCallRecord("+15550192831", session(), "Alex", "alex@example.com");
  local.status = "dialing";
  local.dryRun = false;
  local.calleCallId = "calle_hook_1";
  local.transcript = undefined;
  local.fullTranscript = undefined;
  local.leadDossier = undefined;
  local.opportunityProfile = undefined;
  store.saveCall(local);

  const remote = {
    id: "calle_hook_1",
    status: "completed",
    taskCompleted: true,
    summary: "Qualified a CRM replacement lead.",
    completedAt: new Date().toISOString(),
    failureCode: null,
    failureMessage: null,
    recipients: [
      {
        attempts: [
          {
            startedAt: new Date(Date.now() - 90_000).toISOString(),
            completedAt: new Date().toISOString(),
            failureMessage: null,
            transcriptTurns: [
              { speaker: "bot", text: "This is an automated assistant calling on behalf of Harbor sales.", offset_seconds: 1 },
              { speaker: "user", text: "We need to replace Salesforce next month.", offset_seconds: 8 }
            ]
          }
        ]
      }
    ]
  } as unknown as Call;

  const result = await ingestCalleWebhook(
    store,
    {
      callId: "calle_hook_1",
      status: "completed",
      transcript: [{ speaker: "user", text: "ATTACKER PLANTED THIS" }],
      recordingUrl: "https://evil.example/recording.mp3",
      extractedIntelligence: { intentTier: "hot", warmthScore: 9.9, nextStep: "Send contract" }
    },
    async (id) => {
      assert.equal(id, "calle_hook_1");
      return remote;
    }
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.call.status, "completed");
  assert.doesNotMatch(result.call.fullTranscript || "", /ATTACKER PLANTED/);
  assert.match(result.call.transcript?.[1]?.text || "", /Salesforce/);
  assert.notEqual(result.call.recordingUrl, "https://evil.example/recording.mp3");
  assert.notEqual(result.call.leadDossier?.nextStep, "Send contract");

  const unverified = await ingestCalleWebhook(store, { callId: "calle_hook_1" }, async () => null);
  assert.equal(unverified.ok, false);
  if (!unverified.ok) assert.equal(unverified.status, 401);
});
