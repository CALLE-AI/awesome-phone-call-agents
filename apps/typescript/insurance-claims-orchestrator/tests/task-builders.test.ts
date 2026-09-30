// tests/task-builders.test.ts
// Tests for Call 1 (loss report) and Call 2 (adjuster notification) task builders.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLossReportStep } from "../src/call1-loss-report.js";
import { buildCoverageVerifyStep } from "../src/call2-coverage-verify.js";
import type { ChainContext } from "../src/ClaimChain.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const FULL_LOSS_RESULT = {
  outcome: "completed",
  incident_description: "My car was rear-ended at a red light on Route 50.",
  incident_date: "2026-09-10T14:30:00",
  estimated_damage: "4200",
  policy_number_confirmed: "POL-TEST-7890",
  incident_location: "Route 50 and Main St, Springfield",
  injuries_or_safety_concerns: "No injuries reported.",
  property_damaged: "Rear bumper and trunk of 2021 Honda Civic.",
  damage_description: "Bumper is cracked and trunk will not close properly.",
  cause_of_incident: "Other driver failed to stop in time.",
  witnesses: "Jane Doe, +15550009999",
  official_report_filed: "yes",
  official_report_number: "BPD-2026-09-10-5678",
  photos_or_videos_taken: "yes",
  steps_to_prevent_further_damage: "Taped the trunk shut.",
  emergency_services_performed: "Vehicle towed to Springfield Auto.",
  existing_estimates_or_invoices: "Estimate from Springfield Auto: $4200.",
  other_parties_involved: "Mike Johnson, +15550008888, insured with StateFarm.",
  additional_information: "",
};

const MINIMAL_LOSS_RESULT = {
  outcome: "completed",
  incident_description: "Pipe burst in basement.",
  incident_date: "2026-09-11",
  estimated_damage: "",
  policy_number_confirmed: "POL-TEST-0001",
  incident_location: "",
  injuries_or_safety_concerns: "",
  property_damaged: "",
  damage_description: "",
  cause_of_incident: "",
  witnesses: "",
  official_report_filed: "no",
  official_report_number: "",
  photos_or_videos_taken: "no",
  steps_to_prevent_further_damage: "",
  emergency_services_performed: "",
  existing_estimates_or_invoices: "",
  other_parties_involved: "",
  additional_information: "",
};

function makeCtx(lossResult?: object): ChainContext {
  return {
    phone: "+15550001234",
    results: lossResult ? { loss_report: lossResult } : {},
  };
}

// ─── Call 1: Loss Report step ────────────────────────────────────────────────

describe("buildLossReportStep — step config", () => {
  it("has id 'loss_report'", () => {
    assert.equal(buildLossReportStep().id, "loss_report");
  });

  it("retries on no_answer", () => {
    assert.deepEqual(buildLossReportStep().retryOnOutcome, ["no_answer"]);
  });

  it("maxRetries is 2", () => {
    assert.equal(buildLossReportStep().maxRetries, 2);
  });

  it("has no dependsOn", () => {
    assert.equal(buildLossReportStep().dependsOn, undefined);
  });
});

describe("buildLossReportStep — schema shape", () => {
  const schema = buildLossReportStep().resultSchema as any;

  it("type is object", () => {
    assert.equal(schema.type, "object");
  });

  it("additionalProperties is false", () => {
    assert.equal(schema.additionalProperties, false);
  });

  const expectedRequired = [
    "outcome",
    "incident_description",
    "incident_date",
    "estimated_damage",
    "policy_number_confirmed",
    "incident_location",
    "injuries_or_safety_concerns",
    "property_damaged",
    "damage_description",
    "cause_of_incident",
    "witnesses",
    "official_report_filed",
    "official_report_number",
    "photos_or_videos_taken",
    "steps_to_prevent_further_damage",
    "emergency_services_performed",
    "existing_estimates_or_invoices",
    "other_parties_involved",
    "additional_information",
  ];

  for (const field of expectedRequired) {
    it(`requires field '${field}'`, () => {
      assert.ok(
        schema.required.includes(field),
        `Expected '${field}' to be in required array`
      );
    });
  }

  it("outcome enum covers all terminal states", () => {
    assert.deepEqual(schema.properties.outcome.enum, [
      "completed", "voicemail", "no_answer", "refused", "unclear",
    ]);
  });

  it("official_report_filed is enum yes/no/unknown", () => {
    assert.deepEqual(schema.properties.official_report_filed.enum, ["yes", "no", "unknown"]);
  });

  it("photos_or_videos_taken is enum yes/no/unknown", () => {
    assert.deepEqual(schema.properties.photos_or_videos_taken.enum, ["yes", "no", "unknown"]);
  });

  it("all other fields are type string", () => {
    const stringFields = [
      "incident_description", "incident_date", "estimated_damage",
      "policy_number_confirmed", "incident_location", "injuries_or_safety_concerns",
      "property_damaged", "damage_description", "cause_of_incident", "witnesses",
      "official_report_number", "steps_to_prevent_further_damage",
      "emergency_services_performed", "existing_estimates_or_invoices",
      "other_parties_involved", "additional_information",
    ];
    for (const f of stringFields) {
      assert.equal(
        schema.properties[f].type,
        "string",
        `Expected '${f}' to have type 'string'`
      );
    }
  });
});

describe("buildLossReportStep — task text", () => {
  const ctx = makeCtx();
  const task = buildLossReportStep().taskText(ctx);

  it("contains AI disclosure", () => {
    assert.ok(task.includes("automated assistant"), "Missing AI disclosure");
  });

  it("contains all 17 questions", () => {
    for (let i = 1; i <= 17; i++) {
      assert.ok(task.includes(`${i}.`), `Missing question ${i}`);
    }
  });

  it("asks for incident description", () => {
    assert.ok(task.includes("describe what happened"));
  });

  it("asks for incident date and time", () => {
    assert.ok(task.includes("date and approximately what time"));
  });

  it("asks for location", () => {
    assert.ok(task.includes("Where did the incident occur"));
  });

  it("asks about injuries or safety concerns", () => {
    assert.ok(task.includes("injured") || task.includes("safety concern"));
  });

  it("asks about property damaged", () => {
    assert.ok(task.includes("property, vehicle, or other items were damaged"));
  });

  it("asks for detailed damage description", () => {
    assert.ok(task.includes("describe the damage in a little more detail"));
  });

  it("asks about cause of incident", () => {
    assert.ok(task.includes("caused the incident"));
  });

  it("asks about witnesses", () => {
    assert.ok(task.includes("witnesses"));
  });

  it("asks about official report", () => {
    assert.ok(task.includes("official report"));
  });

  it("asks about photos or videos", () => {
    assert.ok(task.includes("photos or videos"));
  });

  it("asks about steps to prevent further damage", () => {
    assert.ok(task.includes("prevent further damage"));
  });

  it("asks about emergency services already performed", () => {
    assert.ok(task.includes("repair, cleanup, towing, or emergency service"));
  });

  it("asks about existing estimates or invoices", () => {
    assert.ok(task.includes("estimates, invoices"));
  });

  it("asks about other parties involved", () => {
    assert.ok(task.includes("other person, vehicle, property, or organization"));
  });

  it("asks for estimated damage amount", () => {
    assert.ok(task.includes("estimate of the total damage or loss"));
  });

  it("asks for policy number", () => {
    assert.ok(task.includes("policy number"));
  });

  it("asks for additional information", () => {
    assert.ok(task.includes("additional information"));
  });

  it("hard rules forbid SSN collection", () => {
    assert.ok(task.includes("SSN"));
  });

  it("hard rules cover voicemail behavior", () => {
    assert.ok(task.includes("voicemail"));
  });

  it("hard rules require reading policy number back", () => {
    assert.ok(task.includes("Read the policy number back"));
  });
});

// ─── Call 2: Adjuster Notification step ─────────────────────────────────────

describe("buildCoverageVerifyStep — step config", () => {
  it("has id 'coverage_verify'", () => {
    assert.equal(buildCoverageVerifyStep().id, "coverage_verify");
  });

  it("dependsOn loss_report", () => {
    assert.equal(buildCoverageVerifyStep().dependsOn, "loss_report");
  });

  it("no retries", () => {
    assert.deepEqual(buildCoverageVerifyStep().retryOnOutcome, []);
  });

  it("maxRetries is 1", () => {
    assert.equal(buildCoverageVerifyStep().maxRetries, 1);
  });
});

describe("buildCoverageVerifyStep — schema shape", () => {
  const schema = buildCoverageVerifyStep().resultSchema as any;

  it("type is object", () => {
    assert.equal(schema.type, "object");
  });

  it("additionalProperties is false", () => {
    assert.equal(schema.additionalProperties, false);
  });

  it("requires outcome", () => assert.ok(schema.required.includes("outcome")));
  it("requires adjuster_notified", () => assert.ok(schema.required.includes("adjuster_notified")));
  it("requires claimant_confirmed_receipt", () => assert.ok(schema.required.includes("claimant_confirmed_receipt")));
  it("requires claimant_questions", () => assert.ok(schema.required.includes("claimant_questions")));

  it("adjuster_notified is enum yes/no", () => {
    assert.deepEqual(schema.properties.adjuster_notified.enum, ["yes", "no"]);
  });

  it("claimant_confirmed_receipt is enum yes/no/unclear", () => {
    assert.deepEqual(schema.properties.claimant_confirmed_receipt.enum, ["yes", "no", "unclear"]);
  });
});

describe("buildCoverageVerifyStep — task text with loss context", () => {
  it("injects incident description from loss_report result", () => {
    const ctx = makeCtx(FULL_LOSS_RESULT);
    const task = buildCoverageVerifyStep().taskText(ctx);
    assert.ok(
      task.includes("rear-ended at a red light"),
      "Expected incident description to appear in task"
    );
  });

  it("uses fallback when loss_report result is missing", () => {
    const ctx = makeCtx();
    const task = buildCoverageVerifyStep().taskText(ctx);
    assert.ok(task.includes("recently reported incident"));
  });

  it("uses fallback when incident_description is empty string", () => {
    const ctx = makeCtx({ ...MINIMAL_LOSS_RESULT, incident_description: "" });
    const task = buildCoverageVerifyStep().taskText(ctx);
    assert.ok(task.includes("recently reported incident"));
  });

  it("contains AI disclosure", () => {
    const ctx = makeCtx(FULL_LOSS_RESULT);
    const task = buildCoverageVerifyStep().taskText(ctx);
    assert.ok(task.includes("automated assistant"));
  });

  it("mentions adjuster follow-up timeline", () => {
    const ctx = makeCtx(FULL_LOSS_RESULT);
    const task = buildCoverageVerifyStep().taskText(ctx);
    assert.ok(task.includes("2 to 3 business days") || task.includes("2-3 business days"));
  });

  it("hard rules prohibit asking for policy number", () => {
    const ctx = makeCtx(FULL_LOSS_RESULT);
    const task = buildCoverageVerifyStep().taskText(ctx);
    assert.ok(task.includes("Do NOT ask the claimant to confirm any policy number"));
  });

  it("hard rules prohibit coverage data collection", () => {
    const ctx = makeCtx(FULL_LOSS_RESULT);
    const task = buildCoverageVerifyStep().taskText(ctx);
    assert.ok(task.includes("Do NOT ask about prior claims") || task.includes("coverage details"));
  });

  it("instructs voicemail behavior", () => {
    const ctx = makeCtx(FULL_LOSS_RESULT);
    const task = buildCoverageVerifyStep().taskText(ctx);
    assert.ok(task.includes("voicemail"));
  });
});

describe("buildCoverageVerifyStep — task text with minimal loss context", () => {
  it("handles empty optional fields gracefully", () => {
    const ctx = makeCtx(MINIMAL_LOSS_RESULT);
    const task = buildCoverageVerifyStep().taskText(ctx);
    // Should not throw and should produce a non-empty task
    assert.ok(task.length > 100);
  });
});
