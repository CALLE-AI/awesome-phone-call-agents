/**
 * Curated Harbor inbound-queue fixtures. Run:
 *   node --experimental-strip-types lib/console/fixtures/catalog.ts
 * to rewrite leads.json + calls.json. Runtime reads those JSON files.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  BehaviorSnapshot,
  CallStatus,
  ConciergeCta,
  FieldSource,
  IntentLevel,
  IntentSignal,
  LeadQueueItem,
  OpportunityPriority,
  OpportunityProfile,
  SourcedField,
  SundialCallRecord,
  TranscriptEntry,
  WebSessionContext
} from "../../types.ts";

/** Fixture clock. Loader shifts every ISO timestamp so this instant maps to Date.now(). */
export const FIXTURE_NOW_ISO = "2026-09-05T22:00:00.000Z";

function field<T>(value: T, source: FieldSource, confidence: number): SourcedField<T> {
  return { value, source, confidence };
}

function at(offsetMs: number): string {
  return new Date(Date.parse(FIXTURE_NOW_ISO) + offsetMs).toISOString();
}

const hour = 3_600_000;
const minute = 60_000;
const day = 86_400_000;

function signals(
  ...items: Array<[string, string, number]>
): IntentSignal[] {
  return items.map(([type, source, confidence]) => ({ type, source, confidence }));
}

function behavior(
  pages: Array<[string, number, number]>,
  extras: { returning: boolean; sessionSec: number; visits: number }
): BehaviorSnapshot {
  const pagesViewed = pages.map(([path]) => path);
  const pageViewCounts: Record<string, number> = {};
  const hoverSecByPath: Record<string, number> = {};
  for (const [path, views, hover] of pages) {
    pageViewCounts[path] = views;
    hoverSecByPath[path] = hover;
  }
  return {
    pagesViewed,
    pageViewCounts,
    hoverSecByPath,
    returningVisitor: extras.returning,
    sessionDurationSec: extras.sessionSec,
    visitCount: extras.visits
  };
}

function opp(partial: {
  priority: OpportunityPriority;
  intent: number;
  pain: number;
  urgency: number;
  fit: number;
  value: number;
  overall: number;
  currentUsers?: number | string;
  expectedUsers?: number | string;
  companySize?: string;
  companyDescription?: string;
  primaryPain?: string;
  useCase?: string;
  timeline?: string;
  alternatives?: string[];
  decisionMaker?: string;
  objections?: string[];
  recommendedAction: string;
  wantsHumanFollowUp: boolean;
  currentUsersSource?: FieldSource;
  callSummary?: string;
  leadWants?: string;
  nextActions?: string[];
}): OpportunityProfile {
  const src = (explicit: boolean): FieldSource => (explicit ? "explicit" : "inferred");
  return {
    priority: partial.priority,
    scores: {
      intent: field(partial.intent, "score", 0.9),
      pain: field(partial.pain, "inferred", 0.86),
      urgency: field(partial.urgency, partial.timeline ? "explicit" : "inferred", 0.88),
      fit: field(partial.fit, "inferred", 0.84),
      potentialValue: field(partial.value, "inferred", 0.82),
      overall: field(partial.overall, "score", 0.9)
    },
    currentUsers:
      partial.currentUsers !== undefined
        ? field(partial.currentUsers, partial.currentUsersSource || "explicit", 0.95)
        : undefined,
    expectedUsers:
      partial.expectedUsers !== undefined ? field(partial.expectedUsers, "explicit", 0.9) : undefined,
    companySize: partial.companySize
      ? field(partial.companySize, "explicit", 0.94)
      : undefined,
    companyDescription: partial.companyDescription
      ? field(partial.companyDescription, src(true), 0.92)
      : undefined,
    primaryPain: partial.primaryPain ? field(partial.primaryPain, "explicit", 0.95) : undefined,
    painCategory: partial.primaryPain ? field(partial.primaryPain, "explicit", 0.95) : undefined,
    useCase: partial.useCase ? field(partial.useCase, "explicit", 0.93) : undefined,
    timeline: partial.timeline ? field(partial.timeline, "explicit", 0.9) : undefined,
    alternatives: partial.alternatives ? field(partial.alternatives, "explicit", 0.88) : undefined,
    decisionMaker: partial.decisionMaker ? field(partial.decisionMaker, "inferred", 0.72) : undefined,
    objections: partial.objections ? field(partial.objections, "explicit", 0.86) : undefined,
    recommendedAction: field(partial.recommendedAction, "inferred", 0.9),
    wantsHumanFollowUp: field(partial.wantsHumanFollowUp, "explicit", 0.95),
    callSummary: partial.callSummary ? field(partial.callSummary, "explicit", 0.9) : undefined,
    leadWants: partial.leadWants ? field(partial.leadWants, "explicit", 0.9) : undefined,
    nextActions: partial.nextActions ? field(partial.nextActions, "explicit", 0.9) : undefined
  };
}

type LeadSpec = {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  companySize?: string;
  useCase?: string;
  score: number;
  level: IntentLevel;
  signals: IntentSignal[];
  behavior: BehaviorSnapshot;
  interest: string[];
  priority: OpportunityPriority;
  lastSeenAt: string;
  latestCallId?: string;
  latestCallStatus?: CallStatus;
  opportunity?: OpportunityProfile;
};

function lead(spec: LeadSpec): LeadQueueItem {
  return {
    visitorId: spec.id,
    accountId: "harbor",
    lead: {
      name: spec.name,
      email: spec.email,
      phone: spec.phone,
      company: spec.company,
      companySize: spec.companySize,
      useCase: spec.useCase
    },
    intent: { score: spec.score, level: spec.level, signals: spec.signals },
    behavior: spec.behavior,
    declaredInterest: spec.interest,
    latestCallId: spec.latestCallId,
    latestCallStatus: spec.latestCallStatus,
    opportunity: spec.opportunity,
    priority: spec.priority,
    lastSeenAt: spec.lastSeenAt
  };
}

function session(
  id: string,
  visitorId: string,
  landingUrl: string,
  extras: {
    referrer?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    timeOnPageSec: number;
    hovered?: string[];
    cta?: string;
    pageType?: string;
  }
): WebSessionContext {
  return {
    id,
    visitorId,
    accountId: "harbor",
    landingUrl,
    referrer: extras.referrer,
    utmSource: extras.utmSource,
    utmMedium: extras.utmMedium,
    utmCampaign: extras.utmCampaign,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    timeOnPageSec: extras.timeOnPageSec,
    hoveredSections: extras.hovered,
    leadContext: {
      pageType: extras.pageType || "harbor-site",
      icp: "b2b-saas",
      sourceCta: extras.cta
    },
    detectedLocale: "en-US"
  };
}

/** Third field is CALL-E `offset_seconds` as a string (`"1"`, `"8"`), not an ISO clock. */
function turns(
  rows: Array<[TranscriptEntry["speaker"], string, string]>
): TranscriptEntry[] {
  return rows.map(([speaker, text, timestamp]) => ({ speaker, text, timestamp }));
}

function fullTranscript(entries: TranscriptEntry[]): string {
  return entries.map((row) => `[${row.speaker.toUpperCase()}]: ${row.text}`).join("\n\n");
}

type CallSpec = Omit<SundialCallRecord, "dryRun" | "dispatchMode" | "agentId"> & {
  dryRun?: boolean;
  dispatchMode?: SundialCallRecord["dispatchMode"];
  agentId?: string;
};

function call(spec: CallSpec): SundialCallRecord {
  return {
    dryRun: true,
    dispatchMode: "ai_qualify",
    agentId: "sundial_default",
    ...spec
  };
}

const IDS = {
  northline: "11111111-1111-4111-8111-111111111111",
  pinnacle: "22222222-2222-4222-8222-222222222222",
  bright: "33333333-3333-4333-8333-333333333333",
  quorum: "44444444-4444-4444-8444-444444444444",
  ledger: "55555555-5555-4555-8555-555555555555",
  fieldnote: "66666666-6666-4666-8666-666666666666",
  castellan: "77777777-7777-4777-8777-777777777777",
  amber: "88888888-8888-4888-8888-888888888888",
  sable: "99999999-9999-4999-8999-999999999999",
  orchid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  maple: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  rivet: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  kite: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  soft: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  tide: "10101010-1010-4101-8101-101010101010",
  campus: "12121212-1212-4121-8121-121212121212"
} as const;

const CALLS = {
  northMiss1: "11111111-0001-4000-8000-000000000001",
  northMiss2: "11111111-0002-4000-8000-000000000002",
  northDone: "11111111-0003-4000-8000-000000000003",
  pinnacle: "22222222-0001-4000-8000-000000000001",
  brightMiss: "33333333-0001-4000-8000-000000000001",
  brightRetry: "33333333-0002-4000-8000-000000000002",
  quorumLive: "44444444-0001-4000-8000-000000000001",
  ledger: "55555555-0001-4000-8000-000000000001",
  fieldnote: "66666666-0001-4000-8000-000000000001",
  castellanMiss: "77777777-0001-4000-8000-000000000001",
  castellanRetry: "77777777-0002-4000-8000-000000000002",
  amberDial: "88888888-0001-4000-8000-000000000001",
  sable: "99999999-0001-4000-8000-000000000001",
  maple: "bbbbbbbb-0001-4000-8000-000000000001",
  rivet: "cccccccc-0001-4000-8000-000000000001",
  tide: "10101010-0001-4000-8000-000000000001",
  campus: "12121212-0001-4000-8000-000000000001"
} as const;

const SESS = {
  north1: "11111111-aaaa-4aaa-8aaa-000000000001",
  north2: "11111111-aaaa-4aaa-8aaa-000000000002",
  north3: "11111111-aaaa-4aaa-8aaa-000000000003",
  pinnacle: "22222222-aaaa-4aaa-8aaa-000000000001",
  bright1: "33333333-aaaa-4aaa-8aaa-000000000001",
  bright2: "33333333-aaaa-4aaa-8aaa-000000000002",
  quorum: "44444444-aaaa-4aaa-8aaa-000000000001",
  ledger: "55555555-aaaa-4aaa-8aaa-000000000001",
  fieldnote: "66666666-aaaa-4aaa-8aaa-000000000001",
  castellan1: "77777777-aaaa-4aaa-8aaa-000000000001",
  castellan2: "77777777-aaaa-4aaa-8aaa-000000000002",
  amber: "88888888-aaaa-4aaa-8aaa-000000000001",
  sable: "99999999-aaaa-4aaa-8aaa-000000000001",
  maple: "bbbbbbbb-aaaa-4aaa-8aaa-000000000001",
  rivet: "cccccccc-aaaa-4aaa-8aaa-000000000001",
  tide: "10101010-aaaa-4aaa-8aaa-000000000001",
  campus: "12121212-aaaa-4aaa-8aaa-000000000001"
} as const;

const northOpp = opp({
  priority: "very_high",
  intent: 9,
  pain: 8,
  urgency: 9,
  fit: 9,
  value: 10,
  overall: 9,
  currentUsers: 80,
  expectedUsers: 150,
  companySize: "80 current users, planning 150",
  companyDescription: "B2B revenue platform",
  primaryPain: "Manual CRM admin",
  useCase: "Replace Salesforce",
  timeline: "1–2 months",
  alternatives: ["Salesforce", "HubSpot"],
  decisionMaker: "VP Sales",
  objections: ["Migration effort", "Need security review"],
  recommendedAction: "Sales rep follow-up within 1 hour",
  wantsHumanFollowUp: true,
  callSummary:
    "Maya is replacing Salesforce admin work as Northline scales from 80 to 150 CRM users. She can sign a pilot; CFO joins for full rollout. Migration effort and a HubSpot comparison are the remaining blockers.",
  leadWants: "A cleaner inbound motion on Harbor, with a 1–2 month pilot if security review clears.",
  nextActions: [
    "Send a Salesforce-to-Harbor migration outline today",
    "Loop security into the 1–2 month pilot plan",
    "Confirm VP Sales / CFO join for the rollout conversation"
  ]
});

const pinnacleOpp = opp({
  priority: "very_high",
  intent: 8,
  pain: 8,
  urgency: 8,
  fit: 8,
  value: 8,
  overall: 8,
  currentUsers: 45,
  expectedUsers: 70,
  companySize: "45-person RevOps team",
  companyDescription: "RevOps consultancy",
  primaryPain: "Lead routing lag",
  useCase: "Inbound lead routing",
  timeline: "This quarter",
  alternatives: ["HubSpot"],
  decisionMaker: "Head of RevOps",
  objections: ["Need security review"],
  recommendedAction: "Share routing playbook on follow-up",
  wantsHumanFollowUp: true
});

const brightOpp = opp({
  priority: "very_high",
  intent: 8,
  pain: 7,
  urgency: 8,
  fit: 8,
  value: 8,
  overall: 8,
  companySize: "120 freight ops seats",
  companyDescription: "Mid-market freight TMS",
  primaryPain: "Manual administration",
  useCase: "CRM replacement",
  timeline: "This week",
  alternatives: ["Salesforce"],
  decisionMaker: "Head of Sales Ops",
  recommendedAction: "They did not pick up. Retry the discovery call.",
  wantsHumanFollowUp: true
});

const quorumOpp = opp({
  priority: "very_high",
  intent: 8,
  pain: 7,
  urgency: 7,
  fit: 8,
  value: 9,
  overall: 8,
  companySize: "200 analytics seats",
  companyDescription: "Product analytics for PLG",
  primaryPain: "No call context",
  useCase: "Inbound qualification",
  timeline: "1–2 months",
  alternatives: ["Salesforce", "Pipedrive"],
  decisionMaker: "Director of Sales",
  recommendedAction: "Finish the live discovery call",
  wantsHumanFollowUp: true
});

const ledgerOpp = opp({
  priority: "very_high",
  intent: 8,
  pain: 8,
  urgency: 8,
  fit: 8,
  value: 9,
  overall: 8,
  currentUsers: 28,
  expectedUsers: 60,
  companySize: "28 AEs today",
  companyDescription: "Vertical SaaS for accountants",
  primaryPain: "Forecast guesswork",
  useCase: "Expansion motion",
  timeline: "This quarter",
  alternatives: ["HubSpot"],
  decisionMaker: "Founder",
  objections: ["Migration cost"],
  recommendedAction: "Founder asked for a Harbor rep today",
  wantsHumanFollowUp: true
});

const fieldnoteOpp = opp({
  priority: "high",
  intent: 7,
  pain: 7,
  urgency: 6,
  fit: 7,
  value: 7,
  overall: 7,
  companySize: "11–50",
  companyDescription: "Field sales notebook app",
  primaryPain: "Spreadsheet pipeline",
  useCase: "Replace spreadsheets",
  timeline: "1–2 months",
  alternatives: ["HubSpot"],
  decisionMaker: "Sales Manager",
  objections: ["Migration cost"],
  recommendedAction: "Send a mid-market packaging brief",
  wantsHumanFollowUp: true
});

const castellanOpp = opp({
  priority: "high",
  intent: 7,
  pain: 6,
  urgency: 7,
  fit: 7,
  value: 7,
  overall: 7,
  companySize: "90 revenue staff",
  companyDescription: "Health-system revenue cycle",
  primaryPain: "Slow inbound routing",
  useCase: "Inbound lead routing",
  timeline: "This quarter",
  alternatives: ["Salesforce"],
  decisionMaker: "Revenue Lead",
  recommendedAction: "They did not pick up. Retry the discovery call.",
  wantsHumanFollowUp: true
});

const amberOpp = opp({
  priority: "high",
  intent: 7,
  pain: 6,
  urgency: 7,
  fit: 7,
  value: 8,
  overall: 7,
  companySize: "60 GTM seats",
  companyDescription: "DTC commerce ops platform",
  primaryPain: "Fragmented customer data",
  useCase: "CRM replacement",
  timeline: "This week",
  alternatives: ["Salesforce", "HubSpot"],
  decisionMaker: "CRO",
  recommendedAction: "Stay on the line through connect",
  wantsHumanFollowUp: true
});

const sableOpp = opp({
  priority: "high",
  intent: 6,
  pain: 7,
  urgency: 6,
  fit: 7,
  value: 6,
  overall: 6,
  currentUsers: 22,
  companySize: "22 Pipedrive seats",
  companyDescription: "Devtools billing platform",
  primaryPain: "Weak reporting",
  useCase: "Pipedrive migration",
  timeline: "1–2 months",
  alternatives: ["Pipedrive"],
  decisionMaker: "RevOps lead",
  objections: ["Migration effort"],
  recommendedAction: "Offer a Pipedrive import walkthrough",
  wantsHumanFollowUp: false
});

const mapleOpp = opp({
  priority: "nurture",
  intent: 4,
  pain: 4,
  urgency: 3,
  fit: 5,
  value: 5,
  overall: 4,
  companySize: "1–10",
  companyDescription: "Boutique PE advisors",
  primaryPain: "Forecast guesswork",
  useCase: "Light CRM for partners",
  timeline: "About 3 months",
  alternatives: ["HubSpot"],
  decisionMaker: "Partner",
  recommendedAction: "Nurture with a quarterly check-in",
  wantsHumanFollowUp: false
});

const rivetOpp = opp({
  priority: "nurture",
  intent: 4,
  pain: 4,
  urgency: 3,
  fit: 4,
  value: 4,
  overall: 4,
  companySize: "8 designers",
  companyDescription: "Brand studio",
  primaryPain: "Spreadsheet pipeline",
  useCase: "Simple pipeline tracking",
  recommendedAction: "They did not pick up. Retry the discovery call.",
  wantsHumanFollowUp: true
});

const tideOpp = opp({
  priority: "nurture",
  intent: 4,
  pain: 5,
  urgency: 3,
  fit: 5,
  value: 5,
  overall: 4,
  companySize: "18 sellers",
  companyDescription: "Podcast ad network",
  primaryPain: "No call context",
  useCase: "Sales operations",
  timeline: "About 3 months",
  alternatives: ["Pipedrive"],
  decisionMaker: "Sales ops lead",
  objections: ["Need security review"],
  recommendedAction: "Send a one-pager; revisit next quarter",
  wantsHumanFollowUp: false
});

const campusOpp = opp({
  priority: "disqualified",
  intent: 2,
  pain: 2,
  urgency: 1,
  fit: 1,
  value: 1,
  overall: 1,
  companySize: "Student project",
  companyDescription: "Campus club CRM classwork",
  primaryPain: "Class assignment",
  useCase: "School project",
  timeline: "Unspecified",
  decisionMaker: "Student",
  objections: ["No budget"],
  recommendedAction: "Do not pursue from this conversation.",
  wantsHumanFollowUp: false
});

const northTranscript = turns([
  [
    "system",
    "Harbor sales discovery for Northline Revenue. Intent score 72 (high).",
    "1"
  ],
  [
    "agent",
    "Hi Maya, this is an automated assistant calling on behalf of Harbor sales. You asked to talk with our team about Harbor CRM. This call may be recorded. What are you hoping Harbor can help with?",
    "5"
  ],
  [
    "user",
    "We are drowning in Salesforce admin. Eighty people in the CRM today, heading toward one hundred fifty, and I need a cleaner inbound motion.",
    "19"
  ],
  [
    "agent",
    "Got it — replacing Salesforce and scaling the team. What breaks first today: reporting, routing, or day-to-day admin?",
    "33"
  ],
  [
    "user",
    "Admin and routing. Reps rebuild views every week, and inbound form fills sit in a shared inbox until an SDR notices them.",
    "48"
  ],
  [
    "agent",
    "Understood. When someone hits Talk to sales on pricing, how long before a human calls back?",
    "62"
  ],
  [
    "user",
    "Honestly, forty minutes on a good day. High-intent leads from paid search wait even longer if the queue is busy.",
    "78"
  ],
  [
    "agent",
    "That helps. What does a good timeline look like for a pilot?",
    "92"
  ],
  [
    "user",
    "One to two months if security review clears. I can sign for the pilot; our CFO joins for the full rollout.",
    "108"
  ],
  [
    "agent",
    "On migration — are you moving contacts and open deals only, or activity history and reporting too?",
    "124"
  ],
  [
    "user",
    "Contacts, open opportunities, and twelve months of activity history. We can leave ancient closed-won in a read-only archive.",
    "142"
  ],
  [
    "agent",
    "Who owns RevOps tooling decisions, and who has to bless security?",
    "158"
  ],
  [
    "user",
    "I own the evaluation. Our CFO signs anything over eighty seats. She is skeptical of rip-and-replace but open if security passes.",
    "176"
  ],
  [
    "agent",
    "Besides HubSpot, is Salesforce staying on the table because of reporting or integrations?",
    "192"
  ],
  [
    "user",
    "Reporting and a custom CPQ bolt-on. Harbor would need to show how forecasting survives the move.",
    "208"
  ],
  [
    "agent",
    "For security, do you need SOC 2, SSO, and a written review before a pilot touches real pipeline?",
    "224"
  ],
  [
    "user",
    "Yes — US workspace, SSO with Okta, and a written security review before we pilot with live inbound leads.",
    "242"
  ],
  [
    "agent",
    "If the pilot works, would you start with one squad or all eighty seats?",
    "258"
  ],
  [
    "user",
    "Start with twenty SDRs and ten AEs on inbound. Roll the rest after Q4 planning.",
    "274"
  ],
  [
    "agent",
    "Thanks. Migration effort and HubSpot are the other options — anything we should not miss?",
    "290"
  ],
  [
    "user",
    "Migration effort is the main objection. HubSpot is the other option on the table. Send a side-by-side on migration and a forecast demo with our field names before Thursday.",
    "308"
  ],
  [
    "agent",
    "Perfect — I will make sure Harbor sales has your notes and those follow-ups. Appreciate the time, Maya.",
    "324"
  ]
]);

const pinnacleTranscript = turns([
  [
    "system",
    "Harbor sales discovery for Pinnacle Ops. Intent score 64 (high).",
    "1"
  ],
  [
    "agent",
    "Hi Jordan, this is an automated assistant calling on behalf of Harbor sales. This call may be recorded. What can we help you with today?",
    "5"
  ],
  [
    "user",
    "Inbound leads sit for hours before a human sees them. We need routing that actually fires.",
    "17"
  ],
  [
    "agent",
    "Lead routing lag — understood. Are you comparing other tools?",
    "30"
  ],
  [
    "user",
    "HubSpot is the incumbent. Forty-five people on RevOps today, maybe seventy next year. This quarter if we can get a security review.",
    "47"
  ]
]);

const ledgerTranscript = turns([
  [
    "system",
    "Harbor sales discovery for Ledgerline. Intent score 58 (high).",
    "1"
  ],
  [
    "agent",
    "Hi Tobias, this is an automated assistant calling on behalf of Harbor sales. This call may be recorded. What are you hoping Harbor can help with?",
    "5"
  ],
  [
    "user",
    "Forecasts are guesswork. Twenty-eight AEs, we want sixty. I want a person from Harbor to walk our board through it this week.",
    "23"
  ],
  [
    "agent",
    "Understood — expansion and a human follow-up. Any other tools in the mix?",
    "37"
  ],
  [
    "user",
    "HubSpot. Migration cost is the worry, not the product.",
    "47"
  ]
]);

const fieldnoteTranscript = turns([
  [
    "system",
    "Harbor sales discovery for Fieldnote Software. Intent score 48 (high).",
    "1"
  ],
  [
    "agent",
    "Hi Sam, this is an automated assistant calling on behalf of Harbor sales. This call may be recorded. How can we help?",
    "5"
  ],
  [
    "user",
    "The team still runs pipeline in spreadsheets. HubSpot feels heavy. We are about thirty people.",
    "19"
  ],
  [
    "agent",
    "Replace spreadsheets, mid-market size. Timeline?",
    "31"
  ],
  [
    "user",
    "One to two months. I manage the sales team; I am the buyer if the price is sane.",
    "43"
  ]
]);

const sableTranscript = turns([
  [
    "system",
    "Harbor sales discovery for Sable Stack. Intent score 41 (high).",
    "1"
  ],
  [
    "agent",
    "Hi Chris, this is an automated assistant calling on behalf of Harbor sales. This call may be recorded. What can we help you with today?",
    "5"
  ],
  [
    "user",
    "Pipedrive reporting is weak. Twenty-two seats. We can migrate in a month if imports are clean.",
    "19"
  ],
  [
    "agent",
    "Pipedrive migration and reporting. Should a Harbor rep follow up?",
    "31"
  ],
  [
    "user",
    "Not yet. Send the import guide and I will ping you.",
    "39"
  ]
]);

const mapleTranscript = turns([
  [
    "system",
    "Harbor sales discovery for Maple Court Advisors. Intent score 22 (medium).",
    "1"
  ],
  [
    "agent",
    "Hi Owen, this is an automated assistant calling on behalf of Harbor sales. This call may be recorded. What can we help you with today?",
    "5"
  ],
  [
    "user",
    "We are a five-partner shop. Curious, not rushing. Maybe a light CRM in a few months.",
    "17"
  ]
]);

const tideTranscript = turns([
  [
    "system",
    "Harbor sales discovery for Tidepool Media. Intent score 20 (medium).",
    "1"
  ],
  [
    "agent",
    "Hi Iris, this is an automated assistant calling on behalf of Harbor sales. This call may be recorded. How can we help?",
    "5"
  ],
  [
    "user",
    "Eighteen sellers, no context when a call lands. Pipedrive is fine for now. Revisit in a quarter after security review.",
    "21"
  ]
]);

const campusTranscript = turns([
  [
    "system",
    "Harbor sales discovery for CampusLoop. Intent score 8 (low).",
    "1"
  ],
  [
    "agent",
    "Hi Ben, this is an automated assistant calling on behalf of Harbor sales. This call may be recorded. What can we help you with today?",
    "5"
  ],
  [
    "user",
    "This is for a class project. No budget, no company. I just needed a demo of a CRM.",
    "17"
  ],
  [
    "agent",
    "Thanks for saying that. I will note this is not a sales opportunity.",
    "25"
  ]
]);

const quorumLiveTranscript = turns([
  [
    "system",
    "Harbor sales discovery for Quorum Analytics. Intent score 61 (high).",
    "1"
  ],
  [
    "agent",
    "Hi Priya, this is an automated assistant calling on behalf of Harbor sales. This call may be recorded. What can we help you with today?",
    "21"
  ],
  [
    "user",
    "Our AEs join calls with no context. Two hundred people. We are looking at Salesforce and Pipedrive too.",
    "43"
  ]
]);

export const fixtureLeads: LeadQueueItem[] = [
  lead({
    id: IDS.northline,
    name: "Maya Example",
    email: "maya.chen@example.com",
    phone: "+15550101001",
    company: "Northline Revenue",
    companySize: "80 current users, planning 150",
    useCase: "Replace Salesforce",
    score: 72,
    level: "high",
    signals: signals(
      ["email_provided", "identify", 0.99],
      ["phone_provided", "identify", 0.99],
      ["returning_visitor", "behavior", 0.9],
      ["sales_intent", "cta", 0.95],
      ["talk_to_sales", "cta", 0.95],
      ["pricing_interest", "page_view", 0.88],
      ["page_hover", "behavior", 0.7]
    ),
    behavior: behavior(
      [
        ["/demo", 2, 18],
        ["/demo/pricing", 5, 142],
        ["/demo/reviews", 2, 34],
        ["/demo/faq", 1, 12]
      ],
      { returning: true, sessionSec: 540, visits: 3 }
    ),
    interest: ["talk_to_sales", "pricing"],
    priority: "very_high",
    lastSeenAt: at(-1 * day - 5 * hour + 120_000),
    latestCallId: CALLS.northDone,
    latestCallStatus: "completed",
    opportunity: northOpp
  }),
  lead({
    id: IDS.pinnacle,
    name: "Jordan Example",
    email: "jordan.hale@example.com",
    phone: "+15550101002",
    company: "Pinnacle Ops",
    companySize: "45-person RevOps team",
    useCase: "Inbound lead routing",
    score: 64,
    level: "high",
    signals: signals(
      ["email_provided", "identify", 0.98],
      ["returning_visitor", "behavior", 0.86],
      ["sales_intent", "cta", 0.9],
      ["pricing_interest", "page_view", 0.8],
      ["page_hover", "behavior", 0.62]
    ),
    behavior: behavior(
      [
        ["/demo", 1, 14],
        ["/demo/pricing", 3, 88],
        ["/demo/faq", 2, 41]
      ],
      { returning: true, sessionSec: 310, visits: 2 }
    ),
    interest: ["talk_to_sales", "pricing"],
    priority: "very_high",
    lastSeenAt: at(-2 * day - 3 * hour + 90_000),
    latestCallId: CALLS.pinnacle,
    latestCallStatus: "completed",
    opportunity: pinnacleOpp
  }),
  lead({
    id: IDS.bright,
    name: "Elena Example",
    email: "elena.voss@example.com",
    phone: "+15550101003",
    company: "Bright Harbor Freight",
    companySize: "120 freight ops seats",
    useCase: "CRM replacement",
    score: 61,
    level: "high",
    signals: signals(
      ["email_provided", "identify", 0.97],
      ["phone_provided", "identify", 0.97],
      ["get_demo", "cta", 0.9],
      ["pricing_interest", "page_view", 0.78],
      ["page_hover", "behavior", 0.6]
    ),
    behavior: behavior(
      [
        ["/demo", 2, 22],
        ["/demo/pricing", 4, 96],
        ["/demo/contact", 1, 28]
      ],
      { returning: true, sessionSec: 260, visits: 2 }
    ),
    interest: ["get_demo", "pricing"],
    priority: "very_high",
    lastSeenAt: at(-22 * minute),
    latestCallId: CALLS.brightRetry,
    latestCallStatus: "queued",
    opportunity: brightOpp
  }),
  lead({
    id: IDS.quorum,
    name: "Priya Example",
    email: "priya.nair@example.com",
    phone: "+15550101004",
    company: "Quorum Analytics",
    companySize: "200 analytics seats",
    useCase: "Inbound qualification",
    score: 61,
    level: "high",
    signals: signals(
      ["email_provided", "identify", 0.96],
      ["talk_to_sales", "cta", 0.92],
      ["pricing_interest", "page_view", 0.74],
      ["page_hover", "behavior", 0.58]
    ),
    behavior: behavior(
      [
        ["/demo", 1, 16],
        ["/demo/pricing", 2, 54],
        ["/demo/reviews", 3, 71]
      ],
      { returning: false, sessionSec: 190, visits: 1 }
    ),
    interest: ["talk_to_sales", "reviews"],
    priority: "very_high",
    lastSeenAt: at(-40_000),
    latestCallId: CALLS.quorumLive,
    latestCallStatus: "in_progress",
    opportunity: quorumOpp
  }),
  lead({
    id: IDS.ledger,
    name: "Tobias Example",
    email: "tobias.reed@example.com",
    phone: "+15550101005",
    company: "Ledgerline",
    companySize: "28 AEs today",
    useCase: "Expansion motion",
    score: 58,
    level: "high",
    signals: signals(
      ["email_provided", "identify", 0.95],
      ["phone_provided", "identify", 0.95],
      ["returning_visitor", "behavior", 0.84],
      ["sales_intent", "cta", 0.88],
      ["pricing_interest", "page_view", 0.7]
    ),
    behavior: behavior(
      [
        ["/demo", 3, 40],
        ["/demo/pricing", 3, 77],
        ["/demo/faq", 1, 19]
      ],
      { returning: true, sessionSec: 400, visits: 4 }
    ),
    interest: ["talk_to_sales", "pricing", "enterprise"],
    priority: "very_high",
    lastSeenAt: at(-4 * hour + 70_000),
    latestCallId: CALLS.ledger,
    latestCallStatus: "completed",
    opportunity: ledgerOpp
  }),
  lead({
    id: IDS.fieldnote,
    name: "Sam Example",
    email: "sam.okonkwo@example.com",
    phone: "+15550101006",
    company: "Fieldnote Software",
    companySize: "11–50",
    useCase: "Replace spreadsheets",
    score: 48,
    level: "high",
    signals: signals(
      ["email_provided", "identify", 0.93],
      ["get_demo", "cta", 0.86],
      ["pricing_interest", "page_view", 0.72],
      ["page_hover", "behavior", 0.55]
    ),
    behavior: behavior(
      [
        ["/demo", 1, 11],
        ["/demo/pricing", 3, 63],
        ["/demo/reviews", 1, 24]
      ],
      { returning: false, sessionSec: 210, visits: 1 }
    ),
    interest: ["get_demo", "pricing"],
    priority: "high",
    lastSeenAt: at(-1 * day - 2 * hour + 80_000),
    latestCallId: CALLS.fieldnote,
    latestCallStatus: "completed",
    opportunity: fieldnoteOpp
  }),
  lead({
    id: IDS.castellan,
    name: "Riley Example",
    email: "riley.park@example.com",
    phone: "+15550101007",
    company: "Castellan Health",
    companySize: "90 revenue staff",
    useCase: "Inbound lead routing",
    score: 44,
    level: "high",
    signals: signals(
      ["email_provided", "identify", 0.92],
      ["phone_provided", "identify", 0.9],
      ["talk_to_sales", "cta", 0.84],
      ["page_hover", "behavior", 0.5]
    ),
    behavior: behavior(
      [
        ["/demo", 2, 20],
        ["/demo/pricing", 2, 39],
        ["/demo/contact", 2, 33]
      ],
      { returning: true, sessionSec: 180, visits: 2 }
    ),
    interest: ["talk_to_sales"],
    priority: "high",
    lastSeenAt: at(-28 * minute),
    latestCallId: CALLS.castellanRetry,
    latestCallStatus: "queued",
    opportunity: castellanOpp
  }),
  lead({
    id: IDS.amber,
    name: "Nina Example",
    email: "nina.alvarez@example.com",
    phone: "+15550101008",
    company: "Amberwave Commerce",
    companySize: "60 GTM seats",
    useCase: "CRM replacement",
    score: 52,
    level: "high",
    signals: signals(
      ["email_provided", "identify", 0.94],
      ["phone_provided", "identify", 0.94],
      ["talk_to_sales", "cta", 0.9],
      ["pricing_interest", "page_view", 0.76],
      ["page_hover", "behavior", 0.64]
    ),
    behavior: behavior(
      [
        ["/demo", 1, 9],
        ["/demo/pricing", 4, 101],
        ["/demo/faq", 1, 15]
      ],
      { returning: false, sessionSec: 240, visits: 1 }
    ),
    interest: ["talk_to_sales", "pricing"],
    priority: "high",
    lastSeenAt: at(-18_000),
    latestCallId: CALLS.amberDial,
    latestCallStatus: "dialing",
    opportunity: amberOpp
  }),
  lead({
    id: IDS.sable,
    name: "Chris Example",
    email: "chris.nguyen@example.com",
    phone: "+15550101009",
    company: "Sable Stack",
    companySize: "22 Pipedrive seats",
    useCase: "Pipedrive migration",
    score: 41,
    level: "high",
    signals: signals(
      ["email_provided", "identify", 0.9],
      ["pricing_interest", "page_view", 0.68],
      ["page_hover", "behavior", 0.48]
    ),
    behavior: behavior(
      [
        ["/demo", 1, 8],
        ["/demo/pricing", 2, 44],
        ["/demo/faq", 2, 27]
      ],
      { returning: false, sessionSec: 150, visits: 1 }
    ),
    interest: ["pricing", "learn_more"],
    priority: "high",
    lastSeenAt: at(-2 * day - 6 * hour + 60_000),
    latestCallId: CALLS.sable,
    latestCallStatus: "completed",
    opportunity: sableOpp
  }),
  lead({
    id: IDS.orchid,
    name: "Dana Example",
    email: "dana.kim@example.com",
    phone: "+15550101010",
    company: "Orchid Labs",
    companySize: "35 AEs",
    useCase: "Inbound qualification",
    score: 46,
    level: "high",
    signals: signals(
      ["email_provided", "identify", 0.91],
      ["returning_visitor", "behavior", 0.8],
      ["pricing_interest", "page_view", 0.75],
      ["page_hover", "behavior", 0.66]
    ),
    behavior: behavior(
      [
        ["/demo", 2, 25],
        ["/demo/pricing", 4, 118],
        ["/demo/reviews", 1, 20],
        ["/demo/contact", 1, 14]
      ],
      { returning: true, sessionSec: 360, visits: 3 }
    ),
    interest: ["pricing", "talk_to_sales"],
    priority: "high",
    lastSeenAt: at(-35 * minute)
  }),
  lead({
    id: IDS.maple,
    name: "Owen Example",
    email: "owen.blake@example.com",
    phone: "+15550101011",
    company: "Maple Court Advisors",
    companySize: "1–10",
    useCase: "Light CRM for partners",
    score: 22,
    level: "medium",
    signals: signals(
      ["email_provided", "identify", 0.8],
      ["pricing_interest", "page_view", 0.5],
      ["page_hover", "behavior", 0.4]
    ),
    behavior: behavior(
      [
        ["/demo", 1, 10],
        ["/demo/pricing", 1, 21]
      ],
      { returning: false, sessionSec: 90, visits: 1 }
    ),
    interest: ["learn_more"],
    priority: "nurture",
    lastSeenAt: at(-3 * day - 1 * hour + 40_000),
    latestCallId: CALLS.maple,
    latestCallStatus: "completed",
    opportunity: mapleOpp
  }),
  lead({
    id: IDS.rivet,
    name: "Harper Example",
    email: "harper.quinn@example.com",
    phone: "+15550101012",
    company: "Rivet Studio",
    companySize: "8 designers",
    useCase: "Simple pipeline tracking",
    score: 18,
    level: "medium",
    signals: signals(
      ["email_provided", "identify", 0.78],
      ["page_hover", "behavior", 0.42]
    ),
    behavior: behavior(
      [
        ["/demo", 2, 16],
        ["/demo/reviews", 1, 19]
      ],
      { returning: false, sessionSec: 70, visits: 1 }
    ),
    interest: ["learn_more"],
    priority: "nurture",
    lastSeenAt: at(-5 * hour),
    latestCallId: CALLS.rivet,
    latestCallStatus: "no_answer",
    opportunity: rivetOpp
  }),
  lead({
    id: IDS.kite,
    name: "Leah Example",
    email: "leah.strom@example.com",
    phone: "+15550101013",
    company: "Kite & Co",
    companySize: "14 ops",
    score: 16,
    level: "medium",
    signals: signals(
      ["email_provided", "identify", 0.76],
      ["page_hover", "behavior", 0.38]
    ),
    behavior: behavior(
      [
        ["/demo", 1, 12],
        ["/demo/faq", 2, 29]
      ],
      { returning: false, sessionSec: 80, visits: 1 }
    ),
    interest: ["learn_more"],
    priority: "nurture",
    lastSeenAt: at(-7 * hour)
  }),
  lead({
    id: IDS.soft,
    name: "Felix Example",
    email: "felix.ward@example.com",
    phone: "+15550101014",
    company: "Softcurrent",
    companySize: "20 PMs",
    score: 14,
    level: "low",
    signals: signals(
      ["email_provided", "identify", 0.7],
      ["page_hover", "behavior", 0.35]
    ),
    behavior: behavior(
      [
        ["/demo", 1, 7],
        ["/demo/reviews", 2, 26]
      ],
      { returning: false, sessionSec: 55, visits: 1 }
    ),
    interest: ["learn_more"],
    priority: "nurture",
    lastSeenAt: at(-9 * hour)
  }),
  lead({
    id: IDS.tide,
    name: "Iris Example",
    email: "iris.cho@example.com",
    phone: "+15550101015",
    company: "Tidepool Media",
    companySize: "18 sellers",
    useCase: "Sales operations",
    score: 20,
    level: "medium",
    signals: signals(
      ["email_provided", "identify", 0.8],
      ["pricing_interest", "page_view", 0.45],
      ["page_hover", "behavior", 0.4]
    ),
    behavior: behavior(
      [
        ["/demo", 1, 13],
        ["/demo/pricing", 1, 18],
        ["/demo/faq", 1, 11]
      ],
      { returning: false, sessionSec: 100, visits: 1 }
    ),
    interest: ["pricing"],
    priority: "nurture",
    lastSeenAt: at(-4 * day - 2 * hour + 40_000),
    latestCallId: CALLS.tide,
    latestCallStatus: "completed",
    opportunity: tideOpp
  }),
  lead({
    id: IDS.campus,
    name: "Ben Example",
    email: "ben.ortiz@example.com",
    phone: "+15550101016",
    company: "CampusLoop",
    companySize: "Student project",
    useCase: "School project",
    score: 8,
    level: "low",
    signals: signals(
      ["email_provided", "identify", 0.6],
      ["page_hover", "behavior", 0.3]
    ),
    behavior: behavior([["/demo", 1, 6], ["/demo/pricing", 1, 9]], {
      returning: false,
      sessionSec: 40,
      visits: 1
    }),
    interest: ["learn_more"],
    priority: "disqualified",
    lastSeenAt: at(-2 * day - 8 * hour + 40_000),
    latestCallId: CALLS.campus,
    latestCallStatus: "completed",
    opportunity: campusOpp
  })
];

function dossier(
  id: string,
  callId: string,
  createdAt: string,
  extras: {
    warmth: number;
    tier: "hot" | "nurture" | "disqualified";
    pain: string;
    scope: string;
    timeline: string;
    budget: string;
    authority: string;
    next: string;
  }
): NonNullable<SundialCallRecord["leadDossier"]> {
  return {
    id,
    callId,
    warmthScore: extras.warmth,
    intentTier: extras.tier,
    triggerPain: extras.pain,
    scopeRequirement: extras.scope,
    urgencyTimeline: extras.timeline,
    estimatedBudget: extras.budget,
    decisionAuthority: extras.authority,
    nextStep: extras.next,
    crmSynced: false,
    createdAt
  };
}

export const fixtureCalls: SundialCallRecord[] = [
  call({
    id: CALLS.northMiss1,
    sessionId: SESS.north1,
    visitorId: IDS.northline,
    phoneNumber: "+15550101001",
    rawPhoneNumber: "+15550101001",
    contactEmail: "maya.chen@example.com",
    rawContactEmail: "maya.chen@example.com",
    contactName: "Maya Example",
    company: "Northline Revenue",
    companySize: "80 current users, planning 150",
    useCase: "Replace Salesforce",
    declaredCta: "talk_to_sales",
    declaredInterest: ["talk_to_sales", "pricing"],
    status: "no_answer",
    requestedAt: at(-3 * day - 7 * hour),
    dialedAt: at(-3 * day - 7 * hour + 21_000),
    endedAt: at(-3 * day - 7 * hour + 48_000),
    speedToDialSec: 21,
    durationSec: 0,
    transcript: [],
    fullTranscript: "",
    opportunityProfile: {
      ...northOpp,
      priority: "very_high",
      callSummary: undefined,
      leadWants: undefined,
      nextActions: undefined,
      recommendedAction: field("They did not pick up. Retry the discovery call.", "inferred", 0.9)
    },
    intentSnapshot: { score: 68, level: "high", signals: [] },
    behaviorSnapshot: behavior(
      [
        ["/demo", 2, 18],
        ["/demo/pricing", 3, 90]
      ],
      { returning: true, sessionSec: 280, visits: 2 }
    ),
    session: session(SESS.north1, IDS.northline, "/demo/pricing", {
      referrer: "https://www.linkedin.com/",
      utmSource: "linkedin",
      utmMedium: "social",
      timeOnPageSec: 140,
      hovered: ["pricing-table"],
      cta: "talk_to_sales"
    }),
    retryCount: 0
  }),
  call({
    id: CALLS.northMiss2,
    sessionId: SESS.north2,
    visitorId: IDS.northline,
    phoneNumber: "+15550101001",
    rawPhoneNumber: "+15550101001",
    contactEmail: "maya.chen@example.com",
    rawContactEmail: "maya.chen@example.com",
    contactName: "Maya Example",
    company: "Northline Revenue",
    companySize: "80 current users, planning 150",
    useCase: "Replace Salesforce",
    declaredCta: "talk_to_sales",
    declaredInterest: ["talk_to_sales", "pricing"],
    status: "no_answer",
    requestedAt: at(-2 * day - 11 * hour),
    dialedAt: at(-2 * day - 11 * hour + 19_000),
    endedAt: at(-2 * day - 11 * hour + 41_000),
    speedToDialSec: 19,
    durationSec: 0,
    transcript: [],
    fullTranscript: "",
    retryOfCallId: CALLS.northMiss1,
    retryCount: 1,
    retryScheduledAt: at(-2 * day - 12 * hour),
    retryDueAt: at(-2 * day - 11 * hour),
    retryFiredAt: at(-2 * day - 11 * hour),
    opportunityProfile: {
      ...northOpp,
      callSummary: undefined,
      leadWants: undefined,
      nextActions: undefined,
      recommendedAction: field("They did not pick up. Retry the discovery call.", "inferred", 0.9)
    },
    intentSnapshot: { score: 70, level: "high", signals: [] },
    behaviorSnapshot: behavior(
      [
        ["/demo", 2, 18],
        ["/demo/pricing", 4, 120]
      ],
      { returning: true, sessionSec: 400, visits: 3 }
    ),
    session: session(SESS.north2, IDS.northline, "/demo/pricing", {
      referrer: "https://www.linkedin.com/",
      utmSource: "linkedin",
      utmMedium: "social",
      timeOnPageSec: 160,
      hovered: ["pricing-table"],
      cta: "talk_to_sales"
    })
  }),
  call({
    id: CALLS.northDone,
    sessionId: SESS.north3,
    visitorId: IDS.northline,
    phoneNumber: "+15550101001",
    rawPhoneNumber: "+15550101001",
    contactEmail: "maya.chen@example.com",
    rawContactEmail: "maya.chen@example.com",
    contactName: "Maya Example",
    company: "Northline Revenue",
    companySize: "80 current users, planning 150",
    useCase: "Replace Salesforce",
    declaredCta: "talk_to_sales",
    declaredInterest: ["talk_to_sales", "pricing"],
    status: "completed",
    requestedAt: at(-1 * day - 5 * hour),
    dialedAt: at(-1 * day - 5 * hour + 19_000),
    connectedAt: at(-1 * day - 5 * hour + 22_000),
    endedAt: at(-1 * day - 5 * hour + 354_000),
    speedToDialSec: 19,
    durationSec: 332,
    calleCallId: "calle_northline_done",
    recordingUrl: "https://storage.sundials.dev/recordings/northline-maya.mp3",
    transcript: northTranscript,
    fullTranscript: fullTranscript(northTranscript),
    leadDossier: dossier("lead-northline", CALLS.northDone, at(-1 * day - 5 * hour + 214_000), {
      warmth: 9.2,
      tier: "hot",
      pain: "Manual CRM admin",
      scope: "Replace Salesforce; scale toward 150 users",
      timeline: "1–2 months pending security review",
      budget: "Professional / Enterprise CRM seat expansion",
      authority: "VP Sales plus CFO for rollout",
      next: "Sales rep follow-up within 1 hour"
    }),
    opportunityProfile: northOpp,
    brainExtractedAt: at(-1 * day - 5 * hour + 360_000),
    intentSnapshot: { score: 72, level: "high", signals: [] },
    behaviorSnapshot: behavior(
      [
        ["/demo", 2, 18],
        ["/demo/pricing", 5, 142],
        ["/demo/reviews", 2, 34],
        ["/demo/faq", 1, 12]
      ],
      { returning: true, sessionSec: 540, visits: 3 }
    ),
    session: session(SESS.north3, IDS.northline, "/demo/pricing", {
      referrer: "https://www.linkedin.com/",
      utmSource: "linkedin",
      utmMedium: "social",
      utmCampaign: "q3-inbound",
      timeOnPageSec: 200,
      hovered: ["pricing-table", "security"],
      cta: "talk_to_sales"
    })
  }),
  call({
    id: CALLS.pinnacle,
    sessionId: SESS.pinnacle,
    visitorId: IDS.pinnacle,
    phoneNumber: "+15550101002",
    rawPhoneNumber: "+15550101002",
    contactEmail: "jordan.hale@example.com",
    rawContactEmail: "jordan.hale@example.com",
    contactName: "Jordan Example",
    company: "Pinnacle Ops",
    companySize: "45-person RevOps team",
    useCase: "Inbound lead routing",
    declaredCta: "talk_to_sales",
    declaredInterest: ["talk_to_sales", "pricing"],
    status: "completed",
    requestedAt: at(-2 * day - 3 * hour),
    dialedAt: at(-2 * day - 3 * hour + 24_000),
    connectedAt: at(-2 * day - 3 * hour + 27_000),
    endedAt: at(-2 * day - 3 * hour + 168_000),
    speedToDialSec: 24,
    durationSec: 141,
    calleCallId: "calle_pinnacle_done",
    transcript: pinnacleTranscript,
    fullTranscript: fullTranscript(pinnacleTranscript),
    leadDossier: dossier("lead-pinnacle", CALLS.pinnacle, at(-2 * day - 3 * hour + 168_000), {
      warmth: 8.4,
      tier: "hot",
      pain: "Lead routing lag",
      scope: "Inbound routing for a 45-person RevOps team",
      timeline: "This quarter pending security review",
      budget: "Mid-market RevOps tooling",
      authority: "Head of RevOps",
      next: "Share routing playbook on follow-up"
    }),
    opportunityProfile: pinnacleOpp,
    intentSnapshot: { score: 64, level: "high", signals: [] },
    behaviorSnapshot: behavior(
      [
        ["/demo", 1, 14],
        ["/demo/pricing", 3, 88],
        ["/demo/faq", 2, 41]
      ],
      { returning: true, sessionSec: 310, visits: 2 }
    ),
    session: session(SESS.pinnacle, IDS.pinnacle, "/demo/pricing", {
      referrer: "https://www.google.com/",
      utmSource: "google",
      utmMedium: "cpc",
      timeOnPageSec: 170,
      hovered: ["pricing-table"],
      cta: "talk_to_sales"
    })
  }),
  call({
    id: CALLS.brightMiss,
    sessionId: SESS.bright1,
    visitorId: IDS.bright,
    phoneNumber: "+15550101003",
    rawPhoneNumber: "+15550101003",
    contactEmail: "elena.voss@example.com",
    rawContactEmail: "elena.voss@example.com",
    contactName: "Elena Example",
    company: "Bright Harbor Freight",
    companySize: "120 freight ops seats",
    useCase: "CRM replacement",
    declaredCta: "get_demo",
    declaredInterest: ["get_demo", "pricing"],
    status: "no_answer",
    requestedAt: at(-50 * minute),
    dialedAt: at(-50 * minute + 18_000),
    endedAt: at(-50 * minute + 40_000),
    speedToDialSec: 18,
    durationSec: 0,
    transcript: [],
    fullTranscript: "",
    opportunityProfile: brightOpp,
    intentSnapshot: { score: 61, level: "high", signals: [] },
    behaviorSnapshot: behavior(
      [
        ["/demo", 2, 22],
        ["/demo/pricing", 4, 96],
        ["/demo/contact", 1, 28]
      ],
      { returning: true, sessionSec: 260, visits: 2 }
    ),
    session: session(SESS.bright1, IDS.bright, "/demo/contact", {
      referrer: "https://www.google.com/",
      utmSource: "google",
      utmMedium: "organic",
      timeOnPageSec: 95,
      hovered: ["contact-form"],
      cta: "get_demo"
    })
  }),
  call({
    id: CALLS.brightRetry,
    sessionId: SESS.bright2,
    visitorId: IDS.bright,
    phoneNumber: "+15550101003",
    rawPhoneNumber: "+15550101003",
    contactEmail: "elena.voss@example.com",
    rawContactEmail: "elena.voss@example.com",
    contactName: "Elena Example",
    company: "Bright Harbor Freight",
    companySize: "120 freight ops seats",
    useCase: "CRM replacement",
    declaredCta: "get_demo",
    declaredInterest: ["get_demo", "pricing"],
    status: "queued",
    requestedAt: at(-49 * minute),
    durationSec: 0,
    retryOfCallId: CALLS.brightMiss,
    retryCount: 1,
    retryScheduledAt: at(-49 * minute),
    retryDueAt: at(40 * minute),
    opportunityProfile: brightOpp,
    intentSnapshot: { score: 61, level: "high", signals: [] },
    behaviorSnapshot: behavior(
      [
        ["/demo", 2, 22],
        ["/demo/pricing", 4, 96]
      ],
      { returning: true, sessionSec: 260, visits: 2 }
    ),
    session: session(SESS.bright2, IDS.bright, "/demo/pricing", {
      timeOnPageSec: 40,
      cta: "get_demo"
    })
  }),
  call({
    id: CALLS.quorumLive,
    sessionId: SESS.quorum,
    visitorId: IDS.quorum,
    phoneNumber: "+15550101004",
    rawPhoneNumber: "+15550101004",
    contactEmail: "priya.nair@example.com",
    rawContactEmail: "priya.nair@example.com",
    contactName: "Priya Example",
    company: "Quorum Analytics",
    companySize: "200 analytics seats",
    useCase: "Inbound qualification",
    declaredCta: "talk_to_sales",
    declaredInterest: ["talk_to_sales", "reviews"],
    status: "in_progress",
    requestedAt: at(-110_000),
    dialedAt: at(-88_000),
    connectedAt: at(-82_000),
    speedToDialSec: 22,
    durationSec: 0,
    transcript: quorumLiveTranscript,
    fullTranscript: fullTranscript(quorumLiveTranscript),
    opportunityProfile: quorumOpp,
    intentSnapshot: { score: 61, level: "high", signals: [] },
    behaviorSnapshot: behavior(
      [
        ["/demo", 1, 16],
        ["/demo/pricing", 2, 54],
        ["/demo/reviews", 3, 71]
      ],
      { returning: false, sessionSec: 190, visits: 1 }
    ),
    session: session(SESS.quorum, IDS.quorum, "/demo/reviews", {
      referrer: "https://www.g2.com/",
      utmSource: "g2",
      utmMedium: "referral",
      timeOnPageSec: 88,
      hovered: ["reviews"],
      cta: "talk_to_sales"
    })
  }),
  call({
    id: CALLS.ledger,
    sessionId: SESS.ledger,
    visitorId: IDS.ledger,
    phoneNumber: "+15550101005",
    rawPhoneNumber: "+15550101005",
    contactEmail: "tobias.reed@example.com",
    rawContactEmail: "tobias.reed@example.com",
    contactName: "Tobias Example",
    company: "Ledgerline",
    companySize: "28 AEs today",
    useCase: "Expansion motion",
    declaredCta: "talk_to_sales",
    declaredInterest: ["talk_to_sales", "pricing", "enterprise"],
    status: "completed",
    requestedAt: at(-4 * hour),
    dialedAt: at(-4 * hour + 16_000),
    connectedAt: at(-4 * hour + 20_000),
    endedAt: at(-4 * hour + 148_000),
    speedToDialSec: 16,
    durationSec: 128,
    calleCallId: "calle_ledger_done",
    transcript: ledgerTranscript,
    fullTranscript: fullTranscript(ledgerTranscript),
    leadDossier: dossier("lead-ledger", CALLS.ledger, at(-4 * hour + 148_000), {
      warmth: 8.1,
      tier: "hot",
      pain: "Forecast guesswork",
      scope: "Expand from 28 to 60 AEs",
      timeline: "This quarter",
      budget: "Founder-led expansion",
      authority: "Founder",
      next: "Founder asked for a Harbor rep today"
    }),
    opportunityProfile: ledgerOpp,
    intentSnapshot: { score: 58, level: "high", signals: [] },
    behaviorSnapshot: behavior(
      [
        ["/demo", 3, 40],
        ["/demo/pricing", 3, 77],
        ["/demo/faq", 1, 19]
      ],
      { returning: true, sessionSec: 400, visits: 4 }
    ),
    session: session(SESS.ledger, IDS.ledger, "/demo/pricing", {
      referrer: "https://www.google.com/",
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "enterprise",
      timeOnPageSec: 210,
      hovered: ["pricing-table", "enterprise"],
      cta: "talk_to_sales"
    })
  }),
  call({
    id: CALLS.fieldnote,
    sessionId: SESS.fieldnote,
    visitorId: IDS.fieldnote,
    phoneNumber: "+15550101006",
    rawPhoneNumber: "+15550101006",
    contactEmail: "sam.okonkwo@example.com",
    rawContactEmail: "sam.okonkwo@example.com",
    contactName: "Sam Example",
    company: "Fieldnote Software",
    companySize: "11–50",
    useCase: "Replace spreadsheets",
    declaredCta: "get_demo",
    declaredInterest: ["get_demo", "pricing"],
    status: "completed",
    requestedAt: at(-1 * day - 2 * hour),
    dialedAt: at(-1 * day - 2 * hour + 26_000),
    connectedAt: at(-1 * day - 2 * hour + 29_000),
    endedAt: at(-1 * day - 2 * hour + 131_000),
    speedToDialSec: 26,
    durationSec: 102,
    calleCallId: "calle_fieldnote_done",
    transcript: fieldnoteTranscript,
    fullTranscript: fullTranscript(fieldnoteTranscript),
    leadDossier: dossier("lead-fieldnote", CALLS.fieldnote, at(-1 * day - 2 * hour + 131_000), {
      warmth: 7.2,
      tier: "hot",
      pain: "Spreadsheet pipeline",
      scope: "Replace spreadsheets for ~30 people",
      timeline: "1–2 months",
      budget: "Mid-market CRM",
      authority: "Sales Manager",
      next: "Send a mid-market packaging brief"
    }),
    opportunityProfile: fieldnoteOpp,
    intentSnapshot: { score: 48, level: "high", signals: [] },
    behaviorSnapshot: behavior(
      [
        ["/demo", 1, 11],
        ["/demo/pricing", 3, 63],
        ["/demo/reviews", 1, 24]
      ],
      { returning: false, sessionSec: 210, visits: 1 }
    ),
    session: session(SESS.fieldnote, IDS.fieldnote, "/demo/pricing", {
      referrer: "https://www.producthunt.com/",
      utmSource: "producthunt",
      utmMedium: "referral",
      timeOnPageSec: 130,
      hovered: ["pricing-table"],
      cta: "get_demo"
    })
  }),
  call({
    id: CALLS.castellanMiss,
    sessionId: SESS.castellan1,
    visitorId: IDS.castellan,
    phoneNumber: "+15550101007",
    rawPhoneNumber: "+15550101007",
    contactEmail: "riley.park@example.com",
    rawContactEmail: "riley.park@example.com",
    contactName: "Riley Example",
    company: "Castellan Health",
    companySize: "90 revenue staff",
    useCase: "Inbound lead routing",
    declaredCta: "talk_to_sales",
    declaredInterest: ["talk_to_sales"],
    status: "no_answer",
    requestedAt: at(-70 * minute),
    dialedAt: at(-70 * minute + 20_000),
    endedAt: at(-70 * minute + 44_000),
    speedToDialSec: 20,
    durationSec: 0,
    transcript: [],
    fullTranscript: "",
    opportunityProfile: castellanOpp,
    intentSnapshot: { score: 44, level: "high", signals: [] },
    behaviorSnapshot: behavior(
      [
        ["/demo", 2, 20],
        ["/demo/pricing", 2, 39],
        ["/demo/contact", 2, 33]
      ],
      { returning: true, sessionSec: 180, visits: 2 }
    ),
    session: session(SESS.castellan1, IDS.castellan, "/demo/contact", {
      referrer: "https://www.bing.com/",
      utmSource: "bing",
      utmMedium: "cpc",
      timeOnPageSec: 70,
      cta: "talk_to_sales"
    })
  }),
  call({
    id: CALLS.castellanRetry,
    sessionId: SESS.castellan2,
    visitorId: IDS.castellan,
    phoneNumber: "+15550101007",
    rawPhoneNumber: "+15550101007",
    contactEmail: "riley.park@example.com",
    rawContactEmail: "riley.park@example.com",
    contactName: "Riley Example",
    company: "Castellan Health",
    companySize: "90 revenue staff",
    useCase: "Inbound lead routing",
    declaredCta: "talk_to_sales",
    declaredInterest: ["talk_to_sales"],
    status: "queued",
    requestedAt: at(-69 * minute),
    durationSec: 0,
    retryOfCallId: CALLS.castellanMiss,
    retryCount: 1,
    retryScheduledAt: at(-69 * minute),
    retryDueAt: at(28 * minute),
    opportunityProfile: castellanOpp,
    intentSnapshot: { score: 44, level: "high", signals: [] },
    session: session(SESS.castellan2, IDS.castellan, "/demo/contact", {
      timeOnPageSec: 20,
      cta: "talk_to_sales"
    })
  }),
  call({
    id: CALLS.amberDial,
    sessionId: SESS.amber,
    visitorId: IDS.amber,
    phoneNumber: "+15550101008",
    rawPhoneNumber: "+15550101008",
    contactEmail: "nina.alvarez@example.com",
    rawContactEmail: "nina.alvarez@example.com",
    contactName: "Nina Example",
    company: "Amberwave Commerce",
    companySize: "60 GTM seats",
    useCase: "CRM replacement",
    declaredCta: "talk_to_sales",
    declaredInterest: ["talk_to_sales", "pricing"],
    status: "dialing",
    requestedAt: at(-28_000),
    dialedAt: at(-10_000),
    speedToDialSec: 18,
    durationSec: 0,
    opportunityProfile: amberOpp,
    intentSnapshot: { score: 52, level: "high", signals: [] },
    behaviorSnapshot: behavior(
      [
        ["/demo", 1, 9],
        ["/demo/pricing", 4, 101],
        ["/demo/faq", 1, 15]
      ],
      { returning: false, sessionSec: 240, visits: 1 }
    ),
    session: session(SESS.amber, IDS.amber, "/demo/pricing", {
      referrer: "https://www.google.com/",
      utmSource: "google",
      utmMedium: "cpc",
      timeOnPageSec: 120,
      hovered: ["pricing-table"],
      cta: "talk_to_sales"
    })
  }),
  call({
    id: CALLS.sable,
    sessionId: SESS.sable,
    visitorId: IDS.sable,
    phoneNumber: "+15550101009",
    rawPhoneNumber: "+15550101009",
    contactEmail: "chris.nguyen@example.com",
    rawContactEmail: "chris.nguyen@example.com",
    contactName: "Chris Example",
    company: "Sable Stack",
    companySize: "22 Pipedrive seats",
    useCase: "Pipedrive migration",
    declaredCta: "learn_more" as ConciergeCta,
    declaredInterest: ["pricing", "learn_more"],
    status: "completed",
    requestedAt: at(-2 * day - 6 * hour),
    dialedAt: at(-2 * day - 6 * hour + 23_000),
    connectedAt: at(-2 * day - 6 * hour + 27_000),
    endedAt: at(-2 * day - 6 * hour + 109_000),
    speedToDialSec: 23,
    durationSec: 82,
    calleCallId: "calle_sable_done",
    transcript: sableTranscript,
    fullTranscript: fullTranscript(sableTranscript),
    leadDossier: dossier("lead-sable", CALLS.sable, at(-2 * day - 6 * hour + 109_000), {
      warmth: 6.4,
      tier: "nurture",
      pain: "Weak reporting",
      scope: "Pipedrive import for 22 seats",
      timeline: "1–2 months",
      budget: "Team CRM",
      authority: "RevOps lead",
      next: "Offer a Pipedrive import walkthrough"
    }),
    opportunityProfile: sableOpp,
    intentSnapshot: { score: 41, level: "high", signals: [] },
    behaviorSnapshot: behavior(
      [
        ["/demo", 1, 8],
        ["/demo/pricing", 2, 44],
        ["/demo/faq", 2, 27]
      ],
      { returning: false, sessionSec: 150, visits: 1 }
    ),
    session: session(SESS.sable, IDS.sable, "/demo/faq", {
      timeOnPageSec: 85,
      hovered: ["faq-imports"],
      cta: "learn_more"
    })
  }),
  call({
    id: CALLS.maple,
    sessionId: SESS.maple,
    visitorId: IDS.maple,
    phoneNumber: "+15550101011",
    rawPhoneNumber: "+15550101011",
    contactEmail: "owen.blake@example.com",
    rawContactEmail: "owen.blake@example.com",
    contactName: "Owen Example",
    company: "Maple Court Advisors",
    companySize: "1–10",
    useCase: "Light CRM for partners",
    declaredCta: "learn_more",
    declaredInterest: ["learn_more"],
    status: "completed",
    requestedAt: at(-3 * day - 1 * hour),
    dialedAt: at(-3 * day - 1 * hour + 31_000),
    connectedAt: at(-3 * day - 1 * hour + 35_000),
    endedAt: at(-3 * day - 1 * hour + 88_000),
    speedToDialSec: 31,
    durationSec: 53,
    calleCallId: "calle_maple_done",
    transcript: mapleTranscript,
    fullTranscript: fullTranscript(mapleTranscript),
    leadDossier: dossier("lead-maple", CALLS.maple, at(-3 * day - 1 * hour + 88_000), {
      warmth: 4.1,
      tier: "nurture",
      pain: "Forecast guesswork",
      scope: "Light CRM for five partners",
      timeline: "About 3 months",
      budget: "Unspecified",
      authority: "Partner",
      next: "Nurture with a quarterly check-in"
    }),
    opportunityProfile: mapleOpp,
    intentSnapshot: { score: 22, level: "medium", signals: [] },
    behaviorSnapshot: behavior(
      [
        ["/demo", 1, 10],
        ["/demo/pricing", 1, 21]
      ],
      { returning: false, sessionSec: 90, visits: 1 }
    ),
    session: session(SESS.maple, IDS.maple, "/demo", {
      timeOnPageSec: 55,
      cta: "learn_more"
    })
  }),
  call({
    id: CALLS.rivet,
    sessionId: SESS.rivet,
    visitorId: IDS.rivet,
    phoneNumber: "+15550101012",
    rawPhoneNumber: "+15550101012",
    contactEmail: "harper.quinn@example.com",
    rawContactEmail: "harper.quinn@example.com",
    contactName: "Harper Example",
    company: "Rivet Studio",
    companySize: "8 designers",
    useCase: "Simple pipeline tracking",
    declaredCta: "learn_more",
    declaredInterest: ["learn_more"],
    status: "no_answer",
    requestedAt: at(-5 * hour - 10 * minute),
    dialedAt: at(-5 * hour - 10 * minute + 17_000),
    endedAt: at(-5 * hour - 10 * minute + 36_000),
    speedToDialSec: 17,
    durationSec: 0,
    transcript: [],
    fullTranscript: "",
    opportunityProfile: rivetOpp,
    intentSnapshot: { score: 18, level: "medium", signals: [] },
    behaviorSnapshot: behavior(
      [
        ["/demo", 2, 16],
        ["/demo/reviews", 1, 19]
      ],
      { returning: false, sessionSec: 70, visits: 1 }
    ),
    session: session(SESS.rivet, IDS.rivet, "/demo/reviews", {
      timeOnPageSec: 42,
      cta: "learn_more"
    })
  }),
  call({
    id: CALLS.tide,
    sessionId: SESS.tide,
    visitorId: IDS.tide,
    phoneNumber: "+15550101015",
    rawPhoneNumber: "+15550101015",
    contactEmail: "iris.cho@example.com",
    rawContactEmail: "iris.cho@example.com",
    contactName: "Iris Example",
    company: "Tidepool Media",
    companySize: "18 sellers",
    useCase: "Sales operations",
    declaredCta: "learn_more",
    declaredInterest: ["pricing"],
    status: "completed",
    requestedAt: at(-4 * day - 2 * hour),
    dialedAt: at(-4 * day - 2 * hour + 29_000),
    connectedAt: at(-4 * day - 2 * hour + 33_000),
    endedAt: at(-4 * day - 2 * hour + 104_000),
    speedToDialSec: 29,
    durationSec: 71,
    calleCallId: "calle_tide_done",
    transcript: tideTranscript,
    fullTranscript: fullTranscript(tideTranscript),
    leadDossier: dossier("lead-tide", CALLS.tide, at(-4 * day - 2 * hour + 104_000), {
      warmth: 4.4,
      tier: "nurture",
      pain: "No call context",
      scope: "Sales ops for 18 sellers",
      timeline: "About 3 months",
      budget: "Team CRM",
      authority: "Sales ops lead",
      next: "Send a one-pager; revisit next quarter"
    }),
    opportunityProfile: tideOpp,
    intentSnapshot: { score: 20, level: "medium", signals: [] },
    behaviorSnapshot: behavior(
      [
        ["/demo", 1, 13],
        ["/demo/pricing", 1, 18],
        ["/demo/faq", 1, 11]
      ],
      { returning: false, sessionSec: 100, visits: 1 }
    ),
    session: session(SESS.tide, IDS.tide, "/demo/pricing", {
      timeOnPageSec: 60,
      cta: "learn_more"
    })
  }),
  call({
    id: CALLS.campus,
    sessionId: SESS.campus,
    visitorId: IDS.campus,
    phoneNumber: "+15550101016",
    rawPhoneNumber: "+15550101016",
    contactEmail: "ben.ortiz@example.com",
    rawContactEmail: "ben.ortiz@example.com",
    contactName: "Ben Example",
    company: "CampusLoop",
    companySize: "Student project",
    useCase: "School project",
    declaredCta: "learn_more",
    declaredInterest: ["learn_more"],
    status: "completed",
    requestedAt: at(-2 * day - 8 * hour),
    dialedAt: at(-2 * day - 8 * hour + 33_000),
    connectedAt: at(-2 * day - 8 * hour + 37_000),
    endedAt: at(-2 * day - 8 * hour + 78_000),
    speedToDialSec: 33,
    durationSec: 41,
    calleCallId: "calle_campus_done",
    transcript: campusTranscript,
    fullTranscript: fullTranscript(campusTranscript),
    leadDossier: dossier("lead-campus", CALLS.campus, at(-2 * day - 8 * hour + 78_000), {
      warmth: 1.2,
      tier: "disqualified",
      pain: "Class assignment",
      scope: "School project, no company",
      timeline: "Unspecified",
      budget: "None",
      authority: "Student",
      next: "Do not pursue from this conversation."
    }),
    opportunityProfile: campusOpp,
    intentSnapshot: { score: 8, level: "low", signals: [] },
    behaviorSnapshot: behavior([["/demo", 1, 6], ["/demo/pricing", 1, 9]], {
      returning: false,
      sessionSec: 40,
      visits: 1
    }),
    session: session(SESS.campus, IDS.campus, "/demo", {
      timeOnPageSec: 28,
      cta: "learn_more"
    })
  })
];

export const FIXTURE_IDS = { visitors: IDS, calls: CALLS };

function writeJson(): void {
  const dir = dirname(fileURLToPath(import.meta.url));
  writeFileSync(join(dir, "leads.json"), `${JSON.stringify(fixtureLeads, null, 2)}\n`);
  writeFileSync(join(dir, "calls.json"), `${JSON.stringify(fixtureCalls, null, 2)}\n`);
}

const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  writeJson();
}
