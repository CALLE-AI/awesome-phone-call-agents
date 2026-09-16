export type DementiaStage =
  | 'Mild Cognitive Impairment'
  | 'Early-Stage Dementia'
  | 'Moderate Memory Care'
  | 'Advanced Validation Stage';

export type MoodTag =
  | 'Uplifted & Joyful'
  | 'Peaceful & Reminiscent'
  | 'Calmed after Redirection'
  | 'Mild Confusion (Resolved)'
  | 'Flagged: Needs Attention';

export interface FamilyContributor {
  id: string;
  name: string;
  relation: string;
  phone: string;
  email: string;
  lastUpdatedDate: string;
  anchorMemoriesSubmitted: number;
}

export interface ResidentProfile {
  id: string;
  name: string;
  preferredName: string;
  roomNumber: string;
  roomExtension: string; // Analog VoIP extension e.g. "x204"
  wing: string;
  ehrPatientId: string; // PointClickCare / MatrixCare MRN e.g. "PCC-88219"
  ehrProvider: 'PointClickCare' | 'MatrixCare';
  firstLanguage: string;
  languageFlag: string;
  dementiaStage: DementiaStage;
  reminiscenceTopic: string;
  careerBackground: string;
  childhoodHometown: string;
  familyMembers: Array<{ name: string; relation: string; notes?: string }>;
  familyContributors?: FamilyContributor[];
  favoriteSensoryAnchors: string[];
  knownTriggers: string[];
  bannedSensitiveTopics?: string[]; // Topics that cause severe distress (e.g. deceased spouse, war)
  childhoodPets?: string[];
  favoriteSongs?: string[];
  redirectionStrategy: string;
  preferredCallTime: string;
  scheduledFrequency: string;
  status: 'Active Enrolled' | 'Paused' | 'Review Required';
  avatarSeed: string;
  totalCallsCompleted: number;
  lastCallDate: string;
  lastMood: MoodTag;
  needsAttention: boolean;
  sipStatus?: 'Idle' | 'Ringing' | 'Handset Lifted' | 'In Reminiscence Session';
}

export interface CallTurn {
  speaker: 'CALL-E' | 'Resident';
  text: string;
  timestamp: string;
  sentiment?: 'warm' | 'reassuring' | 'redirecting' | 'validating' | 'anxious' | 'confused' | 'reminiscent' | 'uplifted' | 'peaceful' | 'joyful' | 'restless' | string;
  redirectApplied?: boolean;
}

export interface CallLog {
  id: string;
  residentId: string;
  residentName: string;
  preferredName: string;
  roomNumber: string;
  roomExtension?: string;
  wing: string;
  ehrPatientId?: string;
  callDateTime: string;
  durationMinutes: number;
  languageUsed: string;
  topicGrounding: string;
  moodTag: MoodTag;
  moodScore: number; // 1 to 10
  alertnessScore: number; // 1 to 10
  needsAttention: boolean;
  attentionReason: string | null;
  recommendedAction: string | null;
  clinicalSummary: string;
  emotionalTrajectory: string;
  keyMemoriesRecalled: string[];
  validationMomentsCount: number;
  transcript: CallTurn[];
  staffFollowUpStatus: 'Pending Review' | 'Followed Up' | 'Resolved';
  staffNotes?: string;
  // Actual facility integrations:
  ehrSyncStatus: 'Synced to PointClickCare' | 'Synced to MatrixCare' | 'Pending Sync';
  ehrNoteId?: string;
  fhirSyncTimestamp?: string;
  audioRetentionDaysRemaining: number; // 7-day auto-purge policy
  nursePagerDispatched?: boolean; // Dispatched to Vocera/Ascom
}

export interface ScheduledCallItem {
  id: string;
  residentId: string;
  residentName: string;
  roomNumber: string;
  roomExtension: string;
  wing: string;
  scheduledTime: string;
  status: 'Scheduled' | 'Calling Now' | 'Completed' | 'Missed / Retrying';
  topic: string;
  firstLanguage: string;
  durationTarget: string;
  sundowningCritical: boolean; // Peak 4:00 PM - 7:30 PM window
}

export interface FacilityStats {
  facilityName: string;
  enrolledResidents: number;
  completedToday: number;
  scheduledToday: number;
  flaggedForAttention: number;
  averageUpliftPercent: number;
  staffHoursSavedMonth: number;
  subscriptionPricePerResident: number;
  caregiverHourlyRate: number;
  ehrSyncSuccessRate: number;
  activeExtensions: number;
}

export interface NurseAlert {
  id: string;
  callId: string;
  residentName: string;
  roomNumber: string;
  wing: string;
  timestamp: string;
  severity: 'Urgent Pain/Fall Risk' | 'Acute Agitation' | 'Mild Restlessness';
  triggerReason: string;
  dispatchMethod: 'Vocera Badge Pager' | 'Ascom Wireless' | 'Station Display';
  status: 'Dispatched' | 'Acknowledged by CNA' | 'Resolved';
  acknowledgedByNurse?: string;
}

export interface HipaaAuditRecord {
  id: string;
  timestamp: string;
  staffName: string;
  role: string;
  action: 'Viewed Call Transcript' | 'Synced to PointClickCare' | 'Modified Memory Anchor' | 'Audio Auto-Purged' | 'Nurse Pager Dispatched';
  residentName: string;
  ipAddress: string;
  details: string;
}
