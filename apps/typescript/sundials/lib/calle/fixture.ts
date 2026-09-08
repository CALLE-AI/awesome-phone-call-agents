import type {
  IntentProfile,
  LeadDossier,
  SundialCallRecord,
  TranscriptEntry,
  WebSessionContext
} from "../types.ts";
import { maskEmail, maskPhoneNumber, compactE164 } from "./security.ts";
import { harborFixtureOpportunity } from "../intent/opportunity.ts";
import { newEntityId } from "../ids.ts";

export function createFixtureCallRecord(
  phoneNumber: string,
  session: WebSessionContext,
  contactName?: string,
  contactEmail?: string,
  extras?: {
    company?: string;
    companySize?: string;
    useCase?: string;
    visitorId?: string;
    declaredCta?: SundialCallRecord["declaredCta"];
    declaredInterest?: string[];
    intent?: IntentProfile;
    behavior?: SundialCallRecord["behaviorSnapshot"];
  }
): SundialCallRecord {
  const compactPhone = compactE164(phoneNumber);
  const callId = newEntityId();
  const speedToDial = parseFloat((18 + Math.random() * 9).toFixed(1));
  const duration = Math.floor(78 + Math.random() * 25);
  const name = contactName || "there";
  const email = contactEmail || "lead@example.com";
  const company = extras?.company || "Acme Corp";

  const transcript: TranscriptEntry[] = [
    {
      speaker: "system",
      text: `Harbor sales discovery for ${company}. Intent score ${extras?.intent?.score ?? 47} (${extras?.intent?.level ?? "high"}).`
    },
    {
      speaker: "agent",
      text: `Hi ${name}, this is an automated assistant calling on behalf of Harbor sales. You asked to talk with our team about Harbor CRM. This call may be recorded. What are you hoping Harbor can help with?`
    },
    {
      speaker: "user",
      text: "We are drowning in manual admin. Eighty people in the CRM today, we will be about one hundred fifty by year end, and Salesforce is the other option on the table."
    },
    {
      speaker: "agent",
      text: "Got it — replacing spreadsheets with a shared CRM, evaluating Salesforce as well. What does a good timeline look like?"
    },
    {
      speaker: "user",
      text: "One to two months if we can get a security review done. I am not the final signer; I need our VP of Sales on the follow-up."
    },
    {
      speaker: "agent",
      text: "Thanks for walking me through that. I will make sure the Harbor team has your notes. Anything we should not miss?"
    },
    {
      speaker: "user",
      text: "Migration effort is the main objection. We also need a written security review."
    }
  ];

  const fullTranscript = transcript.map((t) => `[${t.speaker.toUpperCase()}]: ${t.text}`).join("\n\n");
  const opportunity = harborFixtureOpportunity(extras?.intent);

  const dossier: LeadDossier = {
    id: `lead_${Date.now().toString(36)}`,
    callId,
    warmthScore: 9.2,
    intentTier: "hot",
    triggerPain: "Manual administration across 80 CRM users",
    scopeRequirement: "Replace spreadsheets; scale toward 150 users",
    urgencyTimeline: "1–2 months pending security review",
    estimatedBudget: "Professional / Enterprise CRM seat expansion",
    decisionAuthority: "Requester plus VP of Sales",
    nextStep: "Sales rep follow-up within 1 hour",
    crmSynced: false,
    createdAt: new Date().toISOString()
  };

  return {
    id: callId,
    sessionId: session.id,
    visitorId: extras?.visitorId || session.visitorId,
    phoneNumber: maskPhoneNumber(compactPhone),
    rawPhoneNumber: compactPhone,
    contactEmail: maskEmail(email),
    contactName: contactName || "Inbound lead",
    company,
    companySize: extras?.companySize,
    useCase: extras?.useCase || "CRM replacement",
    declaredCta: extras?.declaredCta,
    declaredInterest: extras?.declaredInterest || ["talk_to_sales", "pricing"],
    dryRun: true,
    status: "completed",
    dispatchMode: "ai_qualify",
    agentId: "sundial_default",
    requestedAt: new Date(Date.now() - duration * 1000 - speedToDial * 1000).toISOString(),
    dialedAt: new Date(Date.now() - duration * 1000).toISOString(),
    connectedAt: new Date(Date.now() - duration * 1000 + speedToDial * 1000).toISOString(),
    endedAt: new Date().toISOString(),
    speedToDialSec: speedToDial,
    durationSec: duration,
    calleCallId: `calle_${Math.random().toString(36).slice(2, 10)}`,
    recordingUrl: "https://storage.sundials.dev/recordings/sample-call.mp3",
    fullTranscript,
    transcript,
    leadDossier: dossier,
    opportunityProfile: opportunity,
    intentSnapshot: extras?.intent,
    behaviorSnapshot: extras?.behavior,
    session,
    callConsentE164: compactPhone,
    callConsentAt: new Date().toISOString(),
    callConsentAllowOneRetry: true
  };
}
