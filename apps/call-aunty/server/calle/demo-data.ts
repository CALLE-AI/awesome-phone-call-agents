/**
 * Synthetic beneficiaries for demo/hackathon only.
 * All numbers are fictional reserved-looking demo E.164 values.
 */
export type DemoBeneficiary = {
  id: string;
  displayName: string;
  locale: string;
  region: string;
  /** Synthetic — never a real patient number */
  demoE164: string;
  consent: "granted" | "missing" | "expired" | "revoked";
  triageState: "routine" | "contact_chw_today" | "urgent_in_person_care";
  purpose: "follow_up_after_check_in" | "appointment_coordination" | "callback_confirmation";
  scenario: string;
  priority: "low" | "normal" | "high";
};

export const DEMO_BENEFICIARIES: DemoBeneficiary[] = [
  {
    id: "demo-ben-001",
    displayName: "Asha Demo",
    locale: "en",
    region: "US",
    demoE164: "+15555550101",
    consent: "granted",
    triageState: "contact_chw_today",
    purpose: "follow_up_after_check_in",
    scenario: "instant_success",
    priority: "normal",
  },
  {
    id: "demo-ben-002",
    displayName: "Noora Demo",
    locale: "en",
    region: "US",
    demoE164: "+15555550102",
    consent: "granted",
    triageState: "routine",
    purpose: "appointment_coordination",
    scenario: "no_answer",
    priority: "normal",
  },
  {
    id: "demo-ben-003",
    displayName: "Maya Demo",
    locale: "es",
    region: "US",
    demoE164: "+15555550103",
    consent: "granted",
    triageState: "contact_chw_today",
    purpose: "callback_confirmation",
    scenario: "busy",
    priority: "high",
  },
  {
    id: "demo-ben-004",
    displayName: "Lina Demo",
    locale: "en",
    region: "CA",
    demoE164: "+15555550104",
    consent: "granted",
    triageState: "routine",
    purpose: "follow_up_after_check_in",
    scenario: "voicemail",
    priority: "low",
  },
  {
    id: "demo-ben-005",
    displayName: "Priya Demo",
    locale: "en",
    region: "GB",
    demoE164: "+15555550105",
    consent: "granted",
    triageState: "contact_chw_today",
    purpose: "follow_up_after_check_in",
    scenario: "provider_error",
    priority: "normal",
  },
  {
    id: "demo-ben-006",
    displayName: "Sana Demo",
    locale: "en",
    region: "US",
    demoE164: "+15555550106",
    consent: "granted",
    triageState: "contact_chw_today",
    purpose: "follow_up_after_check_in",
    scenario: "safety_escalation",
    priority: "high",
  },
  {
    id: "demo-ben-007",
    displayName: "Hana Demo",
    locale: "fr",
    region: "CA",
    demoE164: "+15555550107",
    consent: "granted",
    triageState: "routine",
    purpose: "appointment_coordination",
    scenario: "needs_review",
    priority: "normal",
  },
  {
    id: "demo-ben-008",
    displayName: "Zara Demo",
    locale: "en",
    region: "AU",
    demoE164: "+15555550108",
    consent: "granted",
    triageState: "contact_chw_today",
    purpose: "callback_confirmation",
    scenario: "human_handoff",
    priority: "high",
  },
  {
    id: "demo-ben-009",
    displayName: "Consent Missing Demo",
    locale: "en",
    region: "US",
    demoE164: "+15555550109",
    consent: "missing",
    triageState: "routine",
    purpose: "follow_up_after_check_in",
    scenario: "instant_success",
    priority: "low",
  },
  {
    id: "demo-ben-010",
    displayName: "Urgent Human Demo",
    locale: "en",
    region: "US",
    demoE164: "+15555550110",
    consent: "granted",
    triageState: "urgent_in_person_care",
    purpose: "follow_up_after_check_in",
    scenario: "safety_escalation",
    priority: "high",
  },
  {
    id: "demo-ben-011",
    displayName: "Farhana Demo",
    locale: "bn",
    region: "US",
    demoE164: "+15555550111",
    consent: "granted",
    triageState: "urgent_in_person_care",
    purpose: "follow_up_after_check_in",
    scenario: "safety_escalation",
    priority: "high",
  },
  {
    id: "demo-ben-012",
    displayName: "Yasmin Demo",
    locale: "bn",
    region: "US",
    demoE164: "+15555550112",
    consent: "granted",
    triageState: "contact_chw_today",
    purpose: "follow_up_after_check_in",
    scenario: "busy",
    priority: "normal",
  },
  {
    id: "demo-ben-013",
    displayName: "Nasrin Demo",
    locale: "en",
    region: "US",
    demoE164: "+15555550113",
    consent: "granted",
    triageState: "routine",
    purpose: "appointment_coordination",
    scenario: "instant_success",
    priority: "low",
  },
  {
    id: "demo-ben-014",
    displayName: "Rumana Demo",
    locale: "bn",
    region: "US",
    demoE164: "+15555550114",
    consent: "granted",
    triageState: "contact_chw_today",
    purpose: "callback_confirmation",
    scenario: "voicemail",
    priority: "normal",
  },
  {
    id: "demo-ben-015",
    displayName: "Jannat Demo",
    locale: "hi",
    region: "US",
    demoE164: "+15555550115",
    consent: "granted",
    triageState: "routine",
    purpose: "follow_up_after_check_in",
    scenario: "instant_success",
    priority: "low",
  },
];

export function getDemoBeneficiary(id: string): DemoBeneficiary | undefined {
  return DEMO_BENEFICIARIES.find((b) => b.id === id);
}

export function listDemoBeneficiaries() {
  return DEMO_BENEFICIARIES.map((b) => ({
    id: b.id,
    displayName: b.displayName,
    locale: b.locale,
    region: b.region,
    consent: b.consent,
    triageState: b.triageState,
    purpose: b.purpose,
    scenario: b.scenario,
    priority: b.priority,
    /** Masked for client diagnostics */
    demoE164Masked: `${b.demoE164.slice(0, 3)}***${b.demoE164.slice(-2)}`,
  }));
}
