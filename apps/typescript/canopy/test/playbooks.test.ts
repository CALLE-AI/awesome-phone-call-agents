import assert from "node:assert/strict";
import { test } from "node:test";
import { matchNwsAlerts } from "../src/feeds/nws.js";
import { evaluateHeatThreshold, summarizeApparentTemperature } from "../src/feeds/open-meteo.js";
import { disclosureLine, languageName, loadPlaybooks, renderEscalationTask, renderWaveTask } from "../src/playbooks.js";
import { ESCALATION_RESULT_SCHEMA, RECIPIENT_RESULT_SCHEMA, TASK_RESULT_SCHEMA, assertSupportedSchema } from "../src/schemas.js";
import type { HazardEvent, Person } from "../src/types.js";

const event: HazardEvent = {
  id: "heat-test",
  hazard: "heat",
  area: "Maricopa County, AZ",
  severity: "Extreme",
  headline: "Extreme Heat Warning",
  source: "manual",
  startedAt: "2026-07-04T18:00:00Z",
  org: "Test County Emergency Management",
  emergencyNumber: "911",
  resource: "Burton Barr Library, 1221 N Central Ave",
};

const person: Person = {
  id: "p1",
  name: "Kamla Devi",
  phone: "+14155550103",
  locale: "hi-IN",
  region: "US",
  age: 81,
  livesAlone: true,
  hasCooling: "no",
  medicalRisks: ["diabetes"],
  address: null,
  lat: null,
  lng: null,
  contactName: "Anil Sharma",
  contactPhone: "+14155550113",
  contactLocale: "hi-IN",
  consent: true,
  consentDate: "2026-06-01",
  notes: null,
  scenario: null,
};

test("all five playbooks load and validate", () => {
  const playbooks = loadPlaybooks();
  assert.deepEqual([...playbooks.keys()].sort(), ["boil-water", "flood", "heat", "outage-medical", "smoke"]);
});

test("the wave task opens with the disclosure, names the language, recites the emergency number, and never includes a phone number", () => {
  const heat = loadPlaybooks().get("heat");
  assert.ok(heat);
  const task = renderWaveTask(heat, event, [person]);
  assert.ok(task.includes(disclosureLine(event.org, heat.hazard_noun)));
  assert.ok(task.includes("emergencies like this extreme heat."));
  assert.ok(task.includes("Kamla Devi (Hindi"));
  assert.ok(task.includes("call 911 now"));
  assert.ok(task.includes("Burton Barr Library"));
  assert.ok(task.includes("Do not diagnose"));
  assert.ok(!task.includes("+1415"));
});

test("the escalation task shares only the listed facts and asks for a commitment", () => {
  const heat = loadPlaybooks().get("heat");
  assert.ok(heat);
  const task = renderEscalationTask(heat, event, person, "red", ["confusion suspected"], 1);
  assert.ok(task.includes("Anil Sharma"));
  assert.ok(task.includes("reported warning signs during our welfare call: confusion suspected"));
  assert.ok(task.includes("Can you go and check on them"));
  assert.ok(task.includes("Do not share any other health, address or identity details"));
  assert.ok(!task.includes("+1415"));
});

test("language names fall back to English", () => {
  assert.equal(languageName("hi-IN"), "Hindi");
  assert.equal(languageName("es-US"), "Spanish");
  assert.equal(languageName("xx-YY"), "English");
});

test("schemas use only CALL-E supported keywords and declare unknown enum values", () => {
  for (const schema of [RECIPIENT_RESULT_SCHEMA, TASK_RESULT_SCHEMA, ESCALATION_RESULT_SCHEMA]) {
    assert.doesNotThrow(() => assertSupportedSchema(schema));
    assert.equal(schema["additionalProperties"], false);
  }
  const props = RECIPIENT_RESULT_SCHEMA["properties"] as Record<string, { enum?: string[] }>;
  assert.ok(props["is_cool"]?.enum?.includes("unknown"));
  assert.ok(props["answered_by"]?.enum?.includes("unknown"));
  assert.throws(() => assertSupportedSchema({ type: "object", properties: { a: { oneOf: [] } } }));
  assert.throws(() => assertSupportedSchema({ type: "object", additionalProperties: true }));
});

test("NWS alerts map to playbooks by event name", () => {
  const playbooks = loadPlaybooks();
  const events = matchNwsAlerts(
    [
      { id: "https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.abc", properties: { event: "Extreme Heat Warning", headline: "Extreme Heat Warning until 8 PM", severity: "Extreme", areaDesc: "Maricopa County", onset: "2026-07-04T10:00:00-07:00", expires: null } },
      { id: "x2", properties: { event: "Wind Advisory", headline: null, severity: "Minor", areaDesc: "Pinal", onset: null, expires: null } },
      { id: "x3", properties: { event: "Flash Flood Warning", headline: null, severity: "Severe", areaDesc: "Pima", onset: null, expires: null } },
    ],
    playbooks,
    "Org",
    "911",
  );
  assert.deepEqual(events.map((e) => e.hazard), ["heat", "flood"]);
  assert.equal(events[0]?.id, "nws-urn:oid:2.49.0.1.840.0.abc");
  assert.equal(events[0]?.area, "Maricopa County");
});

test("Open-Meteo heat threshold triggers only at or above the playbook threshold", () => {
  const heat = loadPlaybooks().get("heat");
  assert.ok(heat);
  const forecast = summarizeApparentTemperature(["2026-07-04T12:00", "2026-07-04T15:00"], [38.2, 43.9]);
  assert.equal(forecast.maxApparentC, 43.9);
  assert.equal(forecast.peakAt, "2026-07-04T15:00");
  assert.equal(evaluateHeatThreshold(forecast, heat, "Ahmedabad", "Org", "108")?.hazard, "heat");
  assert.equal(evaluateHeatThreshold({ maxApparentC: 36, peakAt: null }, heat, "Ahmedabad", "Org", "108"), null);
});
