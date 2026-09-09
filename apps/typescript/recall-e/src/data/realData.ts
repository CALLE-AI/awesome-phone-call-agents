import { useEffect, useRef, useState } from 'react';
import {
  ResidentProfile,
  CallLog,
  CallTurn,
  ScheduledCallItem,
  FacilityStats,
  NurseAlert,
  HipaaAuditRecord,
  MoodTag,
} from '../types';
import { getLanguageFlag } from '../lib/language';

// ── Raw shapes from the JSON files ─────────────────────────────────────────

interface RawProfile {
  id: string;
  name: string;
  pronoun?: string;
  room?: string;
  language?: string;
  topics: { label: string }[];
  familyReferences?: { name: string; relation: string }[];
  otherReferences?: { label: string }[];
  consent?: { consentOnFile?: boolean };
}

interface RawCall {
  date?: string;
  callDate?: string;
  time?: string;
  callTime?: string;
  durationSec?: number;
  mood: 'positive' | 'neutral' | 'flagged_for_review';
  distressFlagged: boolean;
  summary: string;
  topicsCovered?: string[];
  transcript?: string | null;
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function moodToTag(mood: string): MoodTag {
  if (mood === 'positive') return 'Uplifted & Joyful';
  if (mood === 'flagged_for_review') return 'Flagged: Needs Attention';
  return 'Peaceful & Reminiscent';
}

function moodToScore(mood: string): number {
  if (mood === 'positive') return 9;
  if (mood === 'flagged_for_review') return 3;
  return 6;
}

function parseTranscript(raw?: string | null): CallTurn[] {
  if (!raw) return [];
  const pattern = /^\[(\d{2}:\d{2}:\d{2})\]\s*(BOT|USER):\s*(.*)$/;
  const turns: CallTurn[] = [];
  for (const line of raw.split('\n')) {
    const m = line.trim().match(pattern);
    if (m) {
      turns.push({
        speaker: m[2] === 'BOT' ? 'CALL-E' : 'Resident',
        text: m[3],
        timestamp: m[1],
        sentiment: m[2] === 'BOT' ? 'warm' : 'reminiscent',
      });
    }
  }
  return turns;
}

function formatDateTime(dateStr: string, timeStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${timeStr}`;
}

// Telephony/EHR fields derived the same way for a resident's call logs and
// their profile record.
function deriveTelephonyMeta(profileId: string, room: string) {
  return {
    roomExtension: `x${room}`,
    wing: 'Main Wing',
    ehrPatientId: `PCC-${profileId.slice(-3).toUpperCase()}`,
  };
}

export interface RealDashboardData {
  residents: ResidentProfile[];
  callLogs: CallLog[];
  schedule: ScheduledCallItem[];
  facilityStats: FacilityStats;
  nurseAlerts: NurseAlert[];
  hipaaAuditLogs: HipaaAuditRecord[];
}

export async function loadRealDashboardData(): Promise<{
  data: RealDashboardData;
  isLive: boolean;
  realCallCount: number;
}> {
  const profilesFile = await fetchJson<{ residents: RawProfile[] }>('residents.json');
  const sampleFile = await fetchJson<Record<string, { calls: RawCall[] }>>('sample_call_history.json');
  const logFile = await fetchJson<{ calls: (RawCall & { residentId: string; residentName?: string })[] }>('call_log.json');

  const isLive = profilesFile !== null;
  const profiles = profilesFile?.residents ?? [];
  const sampleHistory = sampleFile ?? {};
  const realCalls = logFile?.calls ?? [];

  const residents: ResidentProfile[] = [];
  const callLogs: CallLog[] = [];
  const schedule: ScheduledCallItem[] = [];

  let totalCalls = 0;
  let positiveCalls = 0;
  let flaggedCount = 0;
  let completedToday = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const profile of profiles) {
    const topic = profile.topics?.[0]?.label ?? 'Life memories';
    const room = profile.room ?? '—';
    const language = profile.language && profile.language !== 'English' ? profile.language : 'English';
    const family = profile.familyReferences ?? [];
    const other = profile.otherReferences ?? [];

    const residentRealCalls = realCalls.filter((c) => c.residentId === profile.id);
    const residentSampleCalls = sampleHistory[profile.id]?.calls ?? [];
    const usingReal = residentRealCalls.length > 0;
    const rawCalls = usingReal ? residentRealCalls : residentSampleCalls;

    const normalized = rawCalls
      .map((c) => ({
        date: c.date ?? c.callDate ?? '',
        time: c.time ?? c.callTime ?? '',
        durationSec: c.durationSec ?? 0,
        mood: c.mood,
        distressFlagged: c.distressFlagged,
        summary: c.summary,
        topicsCovered: c.topicsCovered ?? [],
        transcript: c.transcript ?? null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const telephonyMeta = deriveTelephonyMeta(profile.id, room);

    for (const c of normalized) {
      totalCalls++;
      if (c.mood === 'positive') positiveCalls++;
      if (c.distressFlagged) flaggedCount++;
      if (c.date === today) completedToday++;

      const callId = `${profile.id}_${c.date}_${c.time}`.replace(/[^a-zA-Z0-9_]/g, '');
      callLogs.push({
        id: callId,
        residentId: profile.id,
        residentName: profile.name,
        preferredName: profile.name,
        roomNumber: room,
        ...telephonyMeta,
        callDateTime: formatDateTime(c.date, c.time),
        durationMinutes: c.durationSec ? Math.round(c.durationSec / 60) : 0,
        languageUsed: language,
        topicGrounding: topic,
        moodTag: moodToTag(c.mood),
        moodScore: moodToScore(c.mood),
        alertnessScore: c.distressFlagged ? 5 : 8,
        needsAttention: c.distressFlagged,
        // Short, distinct trigger label — kept separate from clinicalSummary
        // below (which is the fuller paragraph) so staff aren't shown the
        // same text twice in the shift feed.
        attentionReason: c.distressFlagged
          ? c.topicsCovered.length > 0
            ? c.topicsCovered.join(', ').replace(/^./, (ch) => ch.toUpperCase())
            : 'Distress detected during call'
          : null,
        recommendedAction: c.distressFlagged ? 'Staff check-in recommended; review transcript below.' : null,
        clinicalSummary: c.summary,
        emotionalTrajectory: c.distressFlagged
          ? 'Some confusion or distress -> gently redirected by CALL-E'
          : 'Warm engagement throughout',
        keyMemoriesRecalled: [topic],
        validationMomentsCount: c.distressFlagged ? 1 : 0,
        transcript: parseTranscript(c.transcript),
        staffFollowUpStatus: 'Pending Review',
        // Honest placeholders: this build does not have a real EHR or
        // audio-retention pipeline wired up, so these reflect that rather
        // than claiming a sync that hasn't happened.
        ehrSyncStatus: 'Pending Sync',
        audioRetentionDaysRemaining: 7,
      });
    }

    const mostRecent = normalized[normalized.length - 1];

    residents.push({
      id: profile.id,
      name: profile.name,
      preferredName: profile.name,
      roomNumber: room,
      ...telephonyMeta,
      ehrProvider: 'PointClickCare',
      firstLanguage: language,
      languageFlag: getLanguageFlag(language),
      // Placeholder: real clinical staging isn't part of this build's data.
      dementiaStage: 'Moderate Memory Care',
      reminiscenceTopic: topic,
      careerBackground: topic,
      childhoodHometown: 'Not yet documented',
      familyMembers: family.map((f) => ({ name: f.name, relation: f.relation })),
      favoriteSensoryAnchors: other.map((o) => o.label),
      knownTriggers: [],
      redirectionStrategy: `Validate feelings, never correct, gently redirect toward ${topic}.`,
      preferredCallTime: mostRecent ? mostRecent.time : 'Not yet scheduled',
      scheduledFrequency: '3x weekly',
      status: 'Active Enrolled',
      avatarSeed: profile.name,
      totalCallsCompleted: normalized.length,
      lastCallDate: mostRecent ? formatDateTime(mostRecent.date, mostRecent.time) : 'No calls yet',
      lastMood: mostRecent ? moodToTag(mostRecent.mood) : 'Peaceful & Reminiscent',
      needsAttention: normalized.some((c) => c.distressFlagged),
      sipStatus: 'Idle',
    });

    schedule.push({
      id: `sched_${profile.id}`,
      residentId: profile.id,
      residentName: profile.name,
      roomNumber: room,
      roomExtension: `x${room}`,
      wing: 'Main Wing',
      scheduledTime: mostRecent ? mostRecent.time : 'Not yet scheduled',
      status: !mostRecent ? 'Scheduled' : mostRecent.distressFlagged ? 'Completed' : 'Completed',
      topic,
      firstLanguage: language,
      durationTarget: '5-10 min',
      sundowningCritical: false,
    });
  }

  const facilityStats: FacilityStats = {
    facilityName: 'Willowbrook Memory Care',
    enrolledResidents: profiles.length,
    completedToday,
    scheduledToday: profiles.length,
    flaggedForAttention: flaggedCount,
    averageUpliftPercent: totalCalls ? Math.round((positiveCalls / totalCalls) * 100) : 0,
    // Illustrative pitch-model assumptions for the Economics tab, not a
    // claim about this specific demo facility's actual current savings.
    staffHoursSavedMonth: totalCalls * 0.5,
    subscriptionPricePerResident: 59,
    caregiverHourlyRate: 26,
    ehrSyncSuccessRate: 0,
    activeExtensions: profiles.length,
  };

  return {
    data: {
      residents,
      callLogs,
      schedule,
      facilityStats,
      // No real nurse-pager or HIPAA-audit system is wired up in this
      // build, so these stay empty rather than showing fabricated events.
      nurseAlerts: [],
      hipaaAuditLogs: [],
    },
    isLive,
    realCallCount: realCalls.length,
  };
}

export function useRealDashboardData(pollMs = 8000) {
  const [data, setData] = useState<RealDashboardData | null>(null);
  const [isLive, setIsLive] = useState(true);
  const [realCallCount, setRealCallCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const signatureRef = useRef('');

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      const result = await loadRealDashboardData();
      if (cancelled) return;
      const signature = JSON.stringify(result.data);
      setIsLive(result.isLive);
      setRealCallCount(result.realCallCount);
      if (signature !== signatureRef.current) {
        signatureRef.current = signature;
        setData(result.data);
      }
      setLoading(false);
    }

    tick();
    const interval = setInterval(tick, pollMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pollMs]);

  return { data, isLive, realCallCount, loading };
}
