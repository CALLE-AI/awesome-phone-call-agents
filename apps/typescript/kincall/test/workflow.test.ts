import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildFamilyContextBrief,
  buildPersonNotificationBrief,
  contactBlockedReason,
  decideCompanionAction,
  eligibleContacts,
  handleFamilyResult,
  MAX_COMPANION_ATTEMPTS,
  type FamilyStructuredResult,
  type NormalizedCompanionResult,
  type TrustedContact,
} from "../src/index.js";

function checkIn(
  overrides: Partial<NormalizedCompanionResult> = {}
): NormalizedCompanionResult {
  return {
    neutralSummary: "they had a quiet morning",
    personReached: "yes",
    explicitHelpRequested: "no",
    fallMentioned: "no",
    mobilityDifficulty: "no",
    painOrInjuryMentioned: "no",
    unusualConfusion: "no",
    distressExpressed: "no",
    conversationEndedNormally: "yes",
    doesNotWantToDisturbFamily: "no",
    otherAttentionSignal: "no",
    attentionRequired: "no",
    attentionReasons: [],
    confidence: "high",
    ...overrides,
  };
}

function contact(overrides: Partial<TrustedContact> = {}): TrustedContact {
  return {
    id: "contact_1",
    firstName: "Bob",
    priority: 1,
    consentStatus: "confirmed",
    enabled: true,
    ...overrides,
  };
}

function familyResult(
  overrides: Partial<FamilyStructuredResult> = {}
): FamilyStructuredResult {
  return {
    contact_id: "contact_1",
    answered: "no",
    situation_understood: "unknown",
    can_intervene: "no",
    intervention_type: "other",
    estimated_time: "",
    contact_next_person: "yes",
    summary: "No answer.",
    ...overrides,
  };
}

const FIRST_ATTEMPT = { attemptNumber: 1 };
const FINAL_ATTEMPT = { attemptNumber: MAX_COMPANION_ATTEMPTS };

describe("decision tree", () => {
  it("closes only when every signal is positive", () => {
    const decision = decideCompanionAction(checkIn(), FIRST_ATTEMPT);
    assert.equal(decision.decision, "LOG_AND_CLOSE");
  });

  it("acts on an explicit request for help even when the agent saw nothing wrong", () => {
    // The agent judged attentionRequired "no". A stated request outranks that:
    // an agent that underrates a request must not be able to talk the workflow
    // out of acting.
    const decision = decideCompanionAction(
      checkIn({ explicitHelpRequested: "yes", attentionRequired: "no" }),
      FIRST_ATTEMPT
    );
    assert.equal(decision.decision, "CONTACT_TRUSTED_PERSON");
  });

  it("acts on any single stated signal", () => {
    for (const signal of [
      "fallMentioned",
      "mobilityDifficulty",
      "painOrInjuryMentioned",
      "unusualConfusion",
      "distressExpressed",
      "otherAttentionSignal",
    ] as const) {
      const decision = decideCompanionAction(
        checkIn({ [signal]: "yes" }),
        FIRST_ATTEMPT
      );
      assert.equal(decision.decision, "CONTACT_TRUSTED_PERSON", signal);
    }
  });

  it("never reads uncertainty as reassurance", () => {
    const decision = decideCompanionAction(
      checkIn({ attentionRequired: "unknown" }),
      FIRST_ATTEMPT
    );
    assert.equal(decision.decision, "CONTACT_TRUSTED_PERSON");
  });

  it("retries an unreached person once, then reaches the circle", () => {
    const first = decideCompanionAction(
      checkIn({ personReached: "no" }),
      FIRST_ATTEMPT
    );
    assert.equal(first.decision, "RETRY_CHECK_IN");

    const last = decideCompanionAction(
      checkIn({ personReached: "no" }),
      FINAL_ATTEMPT
    );
    assert.equal(last.decision, "CONTACT_TRUSTED_PERSON");
  });

  it("is deterministic — the same result always decides the same way", () => {
    const result = checkIn({ distressExpressed: "yes" });
    const decisions = Array.from({ length: 20 }, () =>
      decideCompanionAction(result, FIRST_ATTEMPT).decision
    );
    assert.equal(new Set(decisions).size, 1);
  });
});

describe("what a trusted contact is told", () => {
  it("carries the person's own words, whatever the situation is", () => {
    for (const summary of [
      "they would like help completing an administrative document",
      "their boiler has stopped working",
      "they cannot find their house keys",
    ]) {
      const brief = buildFamilyContextBrief(
        checkIn({ neutralSummary: summary, explicitHelpRequested: "yes" }),
        "Alice"
      );
      assert.ok(brief.sentence.includes(summary), summary);
      assert.ok(brief.sentence.startsWith("Alice"));
    }
  });

  it("degrades to a safe generic sentence rather than inventing a reason", () => {
    const brief = buildFamilyContextBrief(
      checkIn({ neutralSummary: "", explicitHelpRequested: "yes" }),
      "Alice"
    );
    assert.equal(brief.specific, false);
    assert.ok(brief.sentence.includes("Alice"));
  });

  it("never claims a help request nobody was there to make", () => {
    const brief = buildFamilyContextBrief(
      checkIn({ personReached: "no", explicitHelpRequested: "yes" }),
      "Alice"
    );
    assert.equal(brief.source, "not_reached");
    assert.ok(!/asked/i.test(brief.sentence));
  });
});

describe("trusted-circle cascade", () => {
  const bob = contact({ id: "contact_bob", firstName: "Bob", priority: 1 });
  const chloe = contact({ id: "contact_chloe", firstName: "Chloé", priority: 2 });
  const david = contact({ id: "contact_david", firstName: "David", priority: 3 });

  it("orders by priority and excludes anyone who has not consented", () => {
    const pending = contact({
      id: "contact_eve",
      firstName: "Eve",
      priority: 2,
      consentStatus: "pending",
    });
    const eligible = eligibleContacts([david, pending, bob]);
    assert.deepEqual(
      eligible.map((c) => c.id),
      ["contact_bob", "contact_david"]
    );
  });

  it("excludes a contact the family switched off", () => {
    const off = contact({ id: "contact_off", enabled: false });
    assert.deepEqual(eligibleContacts([off]), []);
    assert.match(String(contactBlockedReason(off)), /switched off/);
    assert.equal(contactBlockedReason(bob), null);
  });

  it("stops at the first explicit confirmation", () => {
    const outcome = handleFamilyResult(
      familyResult({ answered: "yes", can_intervene: "yes" }),
      [chloe, david]
    );
    assert.equal(outcome.kind, "confirmed");
  });

  it("never treats a vague answer as a commitment", () => {
    const outcome = handleFamilyResult(
      familyResult({ answered: "yes", can_intervene: "unknown" }),
      [chloe]
    );
    assert.equal(outcome.kind, "declined");
  });

  it("moves to the next contact and ends visibly when the circle runs out", () => {
    const next = handleFamilyResult(familyResult({ answered: "yes" }), [chloe]);
    assert.equal(next.kind, "declined");
    assert.equal(
      next.kind === "declined" ? next.nextContactId : null,
      "contact_chloe"
    );

    const exhausted = handleFamilyResult(familyResult({ answered: "yes" }), []);
    assert.equal(exhausted.kind, "declined_no_contacts_remaining");
  });
});

describe("what the monitored person hears at the end", () => {
  it("speaks in the second person and names the contact who committed", () => {
    const brief = buildPersonNotificationBrief({
      kind: "confirmed",
      personName: "Alice",
      contactName: "Chloé",
      estimatedTime: "this afternoon",
      interventionType: "visit",
      contactSummary: "",
    });
    assert.equal(
      brief.message,
      "Chloé confirmed that they will visit you this afternoon."
    );
    // She is the listener — never spoken about in the third person.
    assert.ok(!brief.message.includes("Alice"));
  });

  it("never claims the visit already happened or that she is safe", () => {
    const brief = buildPersonNotificationBrief({
      kind: "confirmed",
      personName: "Alice",
      contactName: "Chloé",
      estimatedTime: "",
      interventionType: "call",
      contactSummary: "",
    });
    assert.ok(!/already|has called|safe/i.test(brief.message));
    assert.ok(brief.message.includes("will call you"));
  });

  it("says nobody confirmed availability — never that nobody answered", () => {
    const brief = buildPersonNotificationBrief({
      kind: "unresolved",
      personName: "Alice",
    });
    assert.ok(brief.message.includes("confirmed that they were available"));
    assert.ok(!/nobody answered|no answer/i.test(brief.message));
    assert.ok(brief.guidance !== null);
  });
});
