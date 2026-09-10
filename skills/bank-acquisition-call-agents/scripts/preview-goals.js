#!/usr/bin/env node
/**
 * scripts/preview-goals.js
 *
 * Dry-run: prints the CALL-E goal text for all three agents
 * WITHOUT placing any real call. Use this to inspect and tune
 * goal wording before going live.
 *
 * Usage:
 *   node scripts/preview-goals.js
 */

"use strict";

// ── Sample data (mirrors the demo lead in call-center/page.tsx) ──────────────
const BANK_NAME = "Apex Bank";   // change to your bank

const DEMO_LEAD = {
  id: "lead_001",
  name: "Priya Sharma",
  city: "Mumbai",
  preferredLanguage: "English",
  persona: { motivation: "Cashback & rewards" },
  segment: "Urban Growth",
  challengeSummary: "Looking for a better credit card with cashback benefits",
  score: { conversionProbability: 82, complianceRisk: 22 },
};

const DEMO_OFFERS = [
  {
    name: `${BANK_NAME} Smart Savings + Lifestyle Credit Card`,
    description: "A digital-first savings account paired with a rewards credit card.",
    benefitsTheme: "cashback",
    whyThisOffer: "High fit for cashback-focused urban customers.",
    policyStatus: "policy-compliant",
  },
  {
    name: `${BANK_NAME} Salary Plus Account + Starter Credit Card`,
    description: "Salary-linked account with entry-level credit card.",
    benefitsTheme: "reward",
    whyThisOffer: "Drives long-term deposit relationship.",
    policyStatus: "borderline",
  },
];

const DEMO_ONBOARDING = {
  status: "Manual Review",
  verificationDetails: "OCR confidence below threshold — manual check needed.",
  sessionId: "session_001",
};

// ── Goal builders (mirrors lib/callScriptEngine.ts) ──────────────────────────
function buildOutreachGoal(lead, bankName) {
  return (
    `You are a friendly, professional banking relationship manager calling on behalf of ${bankName}. ` +
    `Your goal is to introduce ${bankName} to ${lead.name} in ${lead.city}. ` +
    `The customer's main motivation is: ${lead.persona.motivation}. ` +
    `They belong to the '${lead.segment}' customer segment. ` +
    `Their key challenge is: ${lead.challengeSummary}. ` +
    `Speak in ${lead.preferredLanguage}. ` +
    `Do NOT pitch any product yet — only introduce yourself, ask if they have 2 minutes, ` +
    `and find out whether they are open to hearing about tailored banking solutions. ` +
    `Capture their interest level: interested, not interested, or prefer callback. ` +
    `If callback, ask for their preferred time. Always be respectful and concise.`
  );
}

function buildOfferExplainGoal(lead, offers, bankName) {
  const hasComplexOffers = offers.some((o) => o.policyStatus !== "policy-compliant");
  const offerLines = offers
    .slice(0, 3)
    .map(
      (o, i) =>
        `Offer ${i + 1}: "${o.name}" — ${o.description} ` +
        `Benefits focus: ${o.benefitsTheme}. Why it fits: ${o.whyThisOffer}.`
    )
    .join(" | ");

  const policyNote = hasComplexOffers
    ? `IMPORTANT: Before presenting any offer, read this compliance disclosure aloud: ` +
      `"Please note that some products may require additional verification by our compliance team. ` +
      `Your data is processed securely and in accordance with applicable regulations." `
    : "";

  return (
    `You are a ${bankName} banking advisor calling ${lead.name} in ${lead.city}. ` +
    `Speak in ${lead.preferredLanguage}. ` +
    policyNote +
    `Present the following personalised offers one by one: ${offerLines}. ` +
    `Handle objections naturally. If they agree to an offer, confirm which one verbally ` +
    `and say their digital KYC process will be initiated. Always close politely.`
  );
}

function buildSupportGoal(lead, onboarding, bankName) {
  return (
    `You are a ${bankName} customer support specialist calling ${lead.name}. ` +
    `Speak in ${lead.preferredLanguage}. ` +
    `Their KYC application status is: "${onboarding.status}". ` +
    `Verification details: "${onboarding.verificationDetails}". ` +
    `Session reference: ${onboarding.sessionId}. ` +
    `Answer questions about KYC status, the verification process, or their offer. ` +
    `If unresolvable after 3 attempts, say you are escalating and a specialist ` +
    `will call back within 4 business hours. Always be empathetic and professional.`
  );
}

// ── Print goals ───────────────────────────────────────────────────────────────
console.log("\n========== DRY-RUN GOAL PREVIEW ==========\n");

console.log("── Agent 1: Lead Outreach ──");
console.log(buildOutreachGoal(DEMO_LEAD, BANK_NAME));

console.log("\n── Agent 2: Offer Explanation ──");
console.log(buildOfferExplainGoal(DEMO_LEAD, DEMO_OFFERS, BANK_NAME));

console.log("\n── Agent 3: Customer Support ──");
console.log(buildSupportGoal(DEMO_LEAD, DEMO_ONBOARDING, BANK_NAME));

console.log("\n==========================================");
console.log("✓  No calls placed. Review the goals above before going live.");
console.log("✓  To place a real call: POST /api/calls/outreach  (see SKILL.md)");
