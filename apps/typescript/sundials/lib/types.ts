export type CallStatus =
  | "queued"
  | "dialing"
  | "in_progress"
  | "completed"
  | "failed"
  | "no_answer";

export type IntentTier = "hot" | "nurture" | "disqualified";
export type IntentLevel = "low" | "medium" | "high";
export type OpportunityPriority = "very_high" | "high" | "nurture" | "disqualified";
export type FieldSource = "explicit" | "inferred" | "score";
export type ConciergeCta = "talk_to_sales" | "get_demo" | "learn_more";

export interface SourcedField<T> {
  value: T;
  source: FieldSource;
  confidence: number;
}

export interface IntentSignal {
  type: string;
  source: string;
  confidence: number;
}

export interface IntentProfile {
  score: number;
  level: IntentLevel;
  signals: IntentSignal[];
}

export interface BehaviorSnapshot {
  pagesViewed: string[];
  pageViewCounts: Record<string, number>;
  hoverSecByPath: Record<string, number>;
  returningVisitor: boolean;
  sessionDurationSec: number;
  visitCount: number;
}

export interface IdentifiedLead {
  email?: string;
  phone?: string;
  company?: string;
  name?: string;
  companySize?: string;
  useCase?: string;
}

export interface LeadContext {
  pageType?: string;
  caseStudy?: string;
  icp?: string;
  sourceCta?: string;
}

export interface WebSessionContext {
  id: string;
  landingUrl: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  ipHash?: string;
  userAgent?: string;
  timeOnPageSec: number;
  hoveredSections?: string[];
  leadContext?: LeadContext;
  detectedLocale?: string;
  visitorId?: string;
  accountId?: string;
}

export interface CallConsent {
  /** Compact E.164 the lead agreed to be called at. */
  e164: string;
  acceptedAt: string;
  /** At most one host follow-up if nobody answers. */
  allowOneRetry: boolean;
}

export interface DispatchCallRequest {
  phoneNumber: string;
  contactEmail: string;
  contactName?: string;
  company?: string;
  companySize?: string;
  useCase?: string;
  visitorId?: string;
  sessionId?: string;
  accountId?: string;
  declaredCta?: ConciergeCta;
  sessionContext: WebSessionContext;
  customPromptContext?: Record<string, string>;
  turnstileToken?: string;
  callConsent?: CallConsent;
}

export interface DispatchCallResponse {
  success: boolean;
  taskId: string;
  status: CallStatus;
  estimatedSecondsToRing: number;
  statusUrl: string;
  message?: string;
  speedToDialSec?: number;
  intent?: IntentProfile;
}

export interface LeadDossier {
  id: string;
  callId: string;
  warmthScore: number;
  intentTier: IntentTier;
  triggerPain: string;
  scopeRequirement: string;
  urgencyTimeline: string;
  estimatedBudget: string;
  decisionAuthority: string;
  nextStep: string;
  crmSynced?: boolean;
  createdAt: string;
}

export interface OpportunityProfile {
  priority: OpportunityPriority;
  scores: {
    intent: SourcedField<number>;
    pain: SourcedField<number>;
    urgency: SourcedField<number>;
    fit: SourcedField<number>;
    potentialValue: SourcedField<number>;
    overall: SourcedField<number>;
  };
  currentUsers?: SourcedField<number | string>;
  expectedUsers?: SourcedField<number | string>;
  companySize?: SourcedField<string>;
  companyDescription?: SourcedField<string>;
  primaryPain?: SourcedField<string>;
  useCase?: SourcedField<string>;
  timeline?: SourcedField<string>;
  alternatives?: SourcedField<string[]>;
  decisionMaker?: SourcedField<string>;
  objections?: SourcedField<string[]>;
  recommendedAction?: SourcedField<string>;
  wantsHumanFollowUp?: SourcedField<boolean>;
  /** Gemini Flash post-call briefing: what the conversation was about. */
  callSummary?: SourcedField<string>;
  /** Gemini Flash post-call briefing: what the lead wants. */
  leadWants?: SourcedField<string>;
  /** Gemini Flash post-call briefing: salesperson next steps. */
  nextActions?: SourcedField<string[]>;
  /** Account-catalog pain label, at most 3 words. Used by analytics. */
  painCategory?: SourcedField<string>;
  extractedGoals?: Record<string, SourcedField<string | string[] | number | boolean>>;
}

export interface TranscriptEntry {
  speaker: "agent" | "user" | "system";
  text: string;
  timestamp?: string;
}

export interface SundialCallRecord {
  id: string;
  sessionId: string;
  visitorId?: string;
  phoneNumber: string;
  rawPhoneNumber?: string;
  contactEmail?: string;
  rawContactEmail?: string;
  contactName?: string;
  company?: string;
  companySize?: string;
  useCase?: string;
  declaredCta?: ConciergeCta;
  declaredInterest?: string[];
  dryRun?: boolean;
  status: CallStatus;
  dispatchMode: "ai_qualify" | "instant_bridge";
  agentId: string;
  requestedAt: string;
  dialedAt?: string;
  connectedAt?: string;
  endedAt?: string;
  speedToDialSec?: number;
  durationSec: number;
  calleCallId?: string;
  recordingUrl?: string;
  fullTranscript?: string;
  transcript?: TranscriptEntry[];
  leadDossier?: LeadDossier;
  opportunityProfile?: OpportunityProfile;
  brainExtractedAt?: string;
  intentSnapshot?: IntentProfile;
  behaviorSnapshot?: BehaviorSnapshot;
  session: WebSessionContext;
  errorReason?: string;
  retryOfCallId?: string;
  retryCount?: number;
  retryScheduledAt?: string;
  retryDueAt?: string;
  retryFiredAt?: string;
  retryCancelReason?: string;
  /** Failed/no-speech outcomes stay in the inbox for a human — no automatic follow-up. */
  needsReconciliation?: boolean;
  callConsentE164?: string;
  callConsentAt?: string;
  callConsentAllowOneRetry?: boolean;
}

export interface SpeedToLeadMetrics {
  avgSpeedToDialSec: number;
  totalCallsToday: number;
  hotLeadsCount: number;
  conversionRatePercent: number;
  inFlightCallsCount: number;
}

export interface SundialEvent {
  id: string;
  accountId: string;
  visitorId: string;
  sessionId: string;
  event: string;
  properties: Record<string, unknown>;
  timestamp: string;
}

export interface VisitorRecord {
  visitorId: string;
  accountId: string;
  email?: string;
  rawEmail?: string;
  phone?: string;
  rawPhone?: string;
  company?: string;
  name?: string;
  companySize?: string;
  useCase?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  identifiedAt?: string;
}

export interface EventIngestRequest {
  accountId: string;
  visitorId: string;
  sessionId: string;
  events: Array<{
    event: string;
    properties?: Record<string, unknown>;
    timestamp?: string;
  }>;
}

export interface CountBucket {
  label: string;
  count: number;
}

export interface FunnelMetrics {
  inboundVisitors: number;
  highIntentVisitors: number;
  callRequests: number;
  callsCompleted: number;
  salesQualified: number;
  humanFollowUps: number;
}

export interface IntelligenceAggregates {
  topPainPoints: CountBucket[];
  commonUseCases: CountBucket[];
  companySizeDistribution: CountBucket[];
  timelines: CountBucket[];
  competitors: CountBucket[];
  objections: CountBucket[];
}

export interface AnalyticsSnapshot {
  funnel: FunnelMetrics;
  kpis: {
    inboundLeads: number;
    highIntentLeads: number;
    callsRequested: number;
    callsCompleted: number;
    avgResponseTimeSec: number;
    salesQualifiedLeads: number;
    avgIntentScore: number;
    avgOpportunityScore: number;
  };
  intelligence: IntelligenceAggregates;
  series: DailyPoint[];
}

export interface DailyPoint {
  date: string;
  visitors: number;
  highIntent: number;
  calls: number;
  completed: number;
}

export type DataSource = "live" | "mock";

export interface WorkspaceSettings {
  dataSource: DataSource;
}

export type BrainGoalPriority = "high" | "medium" | "low";
export type BrainSuggestionType = "new_goal" | "prompt_optimization";
export type BrainSourceKind = "url" | "file";

export interface BrainGoal {
  id: string;
  label: string;
  targetField: string;
  priority: BrainGoalPriority;
  enabled: boolean;
  guidance: string;
  naturalTrigger?: string;
  exampleAsk?: string;
}

export interface BrainSuggestion {
  id: string;
  type: BrainSuggestionType;
  title: string;
  reason: string;
  proposedGoal?: Pick<BrainGoal, "label" | "targetField"> & Partial<Omit<BrainGoal, "label" | "targetField">>;
  proposedDirective?: string;
}

export interface BrainSource {
  id: string;
  kind: BrainSourceKind;
  label: string;
  url?: string;
  fileName?: string;
  ingestedAt: string;
  excerpt: string;
}

export interface BrainConfig {
  accountId: string;
  productName: string;
  /** Company / product summary scraped from a site or file. Not voice or tone. */
  companyAbout: string;
  /** Qualification brief drafted from sources. Editable as a report. */
  qualificationReport: string;
  sources: BrainSource[];
  agentIdentity: string;
  tonePersona: string;
  openingScript: string;
  /** Last spoken wrap-up. Keep to one or two sentences. */
  closingScript: string;
  playbookNotes?: string;
  goals: BrainGoal[];
  suggestions: BrainSuggestion[];
  lastClusteredCompletedCount?: number;
  /** Growing unique 1–3 word pain categories for this Sundials account. Gemini reuses or appends. */
  painCategories?: string[];
  /** Hours until one host-side retry. Missing hydrates to 1. `null` or out of 0.25–48 skips retry. */
  retryDelayHours?: number | null;
}

export interface LeadQueueItem {
  visitorId: string;
  accountId: string;
  lead: IdentifiedLead;
  intent: IntentProfile;
  behavior: BehaviorSnapshot;
  declaredInterest: string[];
  latestCallId?: string;
  latestCallStatus?: CallStatus;
  opportunity?: OpportunityProfile;
  priority: OpportunityPriority;
  lastSeenAt: string;
}
