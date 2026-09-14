import assert from "node:assert/strict";
import test from "node:test";
import { healthPrompt, localClock, officialDomains, renderBriefingTask, researchQuery, SHARED_BRIEFING_PROFILE, validateProfile, type SeniorProfile } from "../lib/briefings/model";
import { prepareBriefing, type Search } from "../lib/briefings/service";

const now = new Date("2026-09-10T21:00:00Z");
const profile: SeniorProfile = { id: "fictional-senior", name: "Fictional senior", country: "Australia", countryCode: "AU", region: "NSW", locality: "Sydney", timezone: "Australia/Sydney", interests: ["gardening"], topics: ["news", "activities", "benefits", "retirement"], prepareAt: "06:00", autoPrepare: false, consentToPersonalization: true, officialDomains: [], healthReminders: true, lastHealthCheck: "2026-01-10", agreedHealthFollowUp: "" };
const fake: Search = async (query, correlationId, domains) => ({ answer: "Synthetic sourced briefing for offline testing.", query, correlationId, retrievedAt: now.toISOString(), status: "completed", sources: [{ title: "Synthetic source", url: `https://${domains[0] || "example.com"}/information` }] });

test("each senior has a local morning and date independent of server timezone", () => {
  assert.deepEqual(localClock("Australia/Sydney", now), { date: "2026-09-11", time: "07:00" });
  assert.deepEqual(localClock("America/Los_Angeles", now), { date: "2026-09-10", time: "14:00" });
  assert.equal(localClock("Australia/Sydney", new Date("2026-10-03T20:00:00Z")).time, "07:00");
});

test("profiles reject malformed dates and timezone, but allow unknown health history", () => {
  assert.deepEqual(validateProfile(profile, now), profile);
  assert.throws(() => validateProfile({ ...profile, timezone: "Not/AZone" }, now));
  assert.throws(() => validateProfile({ ...profile, lastHealthCheck: "2026-02-30" }, now));
  assert.throws(() => validateProfile({ ...profile, lastHealthCheck: "2026-12-01" }, now));
  assert.throws(() => validateProfile({ ...profile, officialDomains: ["https://example.com/path"] }, now));
  assert.throws(() => validateProfile({ ...profile, autoPrepare: "true" }, now));
  assert.equal(validateProfile({ ...profile, lastHealthCheck: "" }, now).lastHealthCheck, "");
});

test("search localization never leaks name or health dates, and AU sources do not cross countries", () => {
  const query = researchQuery(profile, "activities", "2026-09-11");
  assert.match(query, /Sydney, NSW, Australia/);
  assert.match(query, /gardening/);
  assert.ok(!query.includes(profile.name));
  assert.ok(!query.includes(profile.lastHealthCheck));
  assert.ok(officialDomains(profile, "retirement").includes("ato.gov.au"));
  assert.deepEqual(officialDomains({ ...profile, countryCode: "GB" }, "retirement"), []);
});

test("briefing retrieves fresh evidence for each topic and embeds it into the phone task", async () => {
  const calls: string[] = [];
  const result = await prepareBriefing(profile, "fingerprint", async (...args) => { calls.push(args[0]); return fake(...args); }, now);
  assert.equal(calls.length, 4);
  assert.equal(result.localDate, "2026-09-11");
  assert.equal(result.status, "ready");
  const task = renderBriefingTask(result, profile, now);
  assert.match(task, /Synthetic sourced briefing/);
  assert.match(task, /cannot browse during this phone call/);
  assert.match(task, /No clinical review interval/);
  assert.throws(() => renderBriefingTask(result, { ...profile, consentToPersonalization: false }, now));
  assert.throws(() => renderBriefingTask(result, { ...profile, id: "another-senior" }, now));
  assert.throws(() => renderBriefingTask(result, profile, new Date("2026-09-11T21:00:00Z")));
});

test("the shared Australian briefing contains no recipient profile", async () => {
  const result = await prepareBriefing(SHARED_BRIEFING_PROFILE, "shared-fingerprint", fake, now);
  const task = renderBriefingTask(result, SHARED_BRIEFING_PROFILE, now);
  assert.match(task, /older people in Australia/);
  assert.match(task, /When asked about today's news or anything important/);
  assert.ok(!task.includes(SHARED_BRIEFING_PROFILE.name));
  assert.equal(result.healthPrompt, "");
});

test("failure and missing citations produce explicit gaps, never yesterday's answer", async () => {
  const previous = await prepareBriefing(profile, "fingerprint", fake, now);
  const result = await prepareBriefing(profile, "fingerprint", async (query, correlation, domains) => {
    if (domains.length) throw new Error("Private provider error");
    return fake(query, correlation, domains);
  }, now, [previous]);
  assert.equal(result.status, "partial");
  assert.equal(result.sections.find((section) => section.topic === "benefits")?.status, "unavailable");
  assert.ok(!JSON.stringify(result).includes("Private provider error"));
  const empty = await prepareBriefing(profile, "fingerprint", async (...args) => ({ ...await fake(...args), sources: [] }), now);
  assert.equal(empty.status, "unavailable");
  assert.throws(() => renderBriefingTask(empty, profile, now));
});

test("benefit facts require official-domain evidence and unknown countries fail closed", async () => {
  const foreign = await prepareBriefing({ ...profile, countryCode: "GB", country: "United Kingdom", topics: ["benefits"] }, "foreign", fake, now);
  assert.equal(foreign.status, "unavailable");
  const wrongSource = await prepareBriefing({ ...profile, topics: ["benefits"] }, "fp", async (query, id) => fake(query, id, ["servicesaustralia.gov.au.attacker.invalid"]), now);
  assert.equal(wrongSource.status, "unavailable");
});

test("health prompts use agreed dates and never invent an overdue diagnosis", () => {
  assert.equal(healthPrompt({ ...profile, healthReminders: false }, "2026-09-11"), "");
  assert.match(healthPrompt({ ...profile, lastHealthCheck: "" }, "2026-09-11"), /No last health-check date/);
  assert.match(healthPrompt(profile, "2026-09-11"), /elapsed time alone does not establish/);
  assert.match(healthPrompt({ ...profile, agreedHealthFollowUp: "2026-09-01" }, "2026-09-11"), /Ask whether it has already happened/);
  assert.match(healthPrompt({ ...profile, agreedHealthFollowUp: "2026-10-01" }, "2026-09-11"), /Do not describe it as overdue/);
});

test("consent denial prevents search execution", async () => {
  let invoked = false;
  await assert.rejects(prepareBriefing({ ...profile, consentToPersonalization: false }, "fp", async (...args) => { invoked = true; return fake(...args); }, now));
  assert.equal(invoked, false);
});
