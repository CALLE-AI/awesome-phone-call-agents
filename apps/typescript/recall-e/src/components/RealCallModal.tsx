import React, { useState } from 'react';
import { X, PhoneCall, Loader2, CheckCircle2, AlertTriangle, Eye } from 'lucide-react';
import { ResidentProfile, CallLog } from '../types';

interface RealCallModalProps {
  residents: ResidentProfile[];
  isOpen: boolean;
  onClose: () => void;
  onCallCompleted: (newCall: CallLog) => void;
}

export const RealCallModal: React.FC<RealCallModalProps> = ({
  residents,
  isOpen,
  onClose,
  onCallCompleted,
}) => {
  const [selectedResidentId, setSelectedResidentId] = useState<string>(residents[0]?.id || '');
  const [consentChecked, setConsentChecked] = useState(false);
  const [state, setState] = useState<'idle' | 'calling' | 'done' | 'preview' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [resultSummary, setResultSummary] = useState<string>('');
  const [previewData, setPreviewData] = useState<{ maskedPhone: string; callGoal: string } | null>(null);

  if (!isOpen) return null;

  const selectedResident = residents.find((r) => r.id === selectedResidentId);

  const placeCall = async () => {
    if (!selectedResidentId || !consentChecked) return;
    setState('calling');
    setErrorMessage('');

    // A fresh key per attempt. If this exact request were retried (e.g. a
    // flaky network double-submit), the server would return the original
    // result instead of placing a second real call.
    const idempotencyKey =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}_${Math.random()}`;

    try {
      const res = await fetch('/api/calls/place-real-call', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ residentId: selectedResidentId, consent_confirmed: true }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setState('error');
        setErrorMessage(data.error || 'The call could not be placed.');
        return;
      }

      // The server defaults to dry-run mode (DRY_RUN unset or "true" in
      // .env): no call is placed, just a preview of what would be sent.
      if (data.dryRun) {
        setPreviewData({ maskedPhone: data.preview.maskedPhone, callGoal: data.preview.callGoal });
        setState('preview');
        return;
      }

      const record = data.record;
      setResultSummary(record.summary || 'Call completed.');
      setState('done');

      const moodTag =
        record.mood === 'positive'
          ? 'Uplifted & Joyful'
          : record.distressFlagged
          ? 'Flagged: Needs Attention'
          : 'Peaceful & Reminiscent';

      const newCall: CallLog = {
        id: `real_${Date.now()}`,
        residentId: selectedResidentId,
        residentName: selectedResident?.name || record.residentName,
        preferredName: selectedResident?.preferredName || record.residentName,
        roomNumber: selectedResident?.roomNumber || '—',
        wing: selectedResident?.wing,
        ehrPatientId: selectedResident?.ehrPatientId,
        callDateTime: 'Just now',
        durationMinutes: 0,
        languageUsed: selectedResident?.firstLanguage || 'English',
        topicGrounding: selectedResident?.reminiscenceTopic || '',
        moodTag,
        moodScore: record.mood === 'positive' ? 9 : record.distressFlagged ? 3 : 6,
        alertnessScore: record.distressFlagged ? 5 : 8,
        needsAttention: record.distressFlagged,
        attentionReason: record.distressFlagged ? record.summary : null,
        recommendedAction: record.distressFlagged ? 'Staff check-in recommended; review transcript.' : null,
        clinicalSummary: record.summary || '',
        emotionalTrajectory: record.distressFlagged
          ? 'Some confusion or distress -> gently redirected by CALL-E'
          : 'Warm engagement throughout',
        keyMemoriesRecalled: selectedResident ? [selectedResident.reminiscenceTopic] : [],
        validationMomentsCount: record.distressFlagged ? 1 : 0,
        transcript: parseTranscript(record.transcript),
        staffFollowUpStatus: 'Pending Review',
        ehrSyncStatus: 'Pending Sync',
        audioRetentionDaysRemaining: 7,
      };

      onCallCompleted(newCall);
    } catch (err) {
      setState('error');
      setErrorMessage('Could not reach the local server. Is npm run dev still running?');
    }
  };

  function parseTranscript(raw?: string | null) {
    if (!raw) return [];
    const pattern = /^\[(\d{2}:\d{2}:\d{2})\]\s*(BOT|USER):\s*(.*)$/;
    const turns: { speaker: 'CALL-E' | 'Resident'; text: string; timestamp: string }[] = [];
    for (const line of raw.split('\n')) {
      const m = line.trim().match(pattern);
      if (m) {
        turns.push({ speaker: m[2] === 'BOT' ? 'CALL-E' : 'Resident', text: m[3], timestamp: m[1] });
      }
    }
    return turns;
  }

  const resetToIdle = () => {
    setState('idle');
    setConsentChecked(false);
    setPreviewData(null);
  };

  return (
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 mb-1">
          <PhoneCall className="w-5 h-5 text-teal-700" />
          <h2 className="text-lg font-bold text-slate-900">Call a Resident</h2>
        </div>
        <p className="text-xs text-slate-500 mb-5">
          This dials out through CALL-E for real, unless dry-run mode is on (the default). Your
          phone (or whichever number is on file for this resident) will actually ring.
        </p>

        {state === 'idle' && (
          <>
            <label className="text-xs font-semibold text-slate-600 mb-1.5 block">Resident</label>
            <select
              value={selectedResidentId}
              onChange={(e) => setSelectedResidentId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-4"
            >
              {residents.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} — Room {r.roomNumber}
                </option>
              ))}
            </select>

            <label className="flex items-start gap-2.5 mb-5 cursor-pointer">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-xs text-slate-600 leading-relaxed">
                I confirm consent is on file to call this resident, and I want to place this call
                now.
              </span>
            </label>

            <button
              onClick={placeCall}
              disabled={!selectedResidentId || !consentChecked}
              className="w-full bg-teal-700 hover:bg-teal-800 text-white text-sm font-bold py-2.5 rounded-lg transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Call Now
            </button>
          </>
        )}

        {state === 'calling' && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Loader2 className="w-8 h-8 text-teal-700 animate-spin" />
            <p className="text-sm text-slate-600 text-center">
              Dialing {selectedResident?.name}… this can take up to a couple of minutes while the
              call happens and CALL-E reports back.
            </p>
          </div>
        )}

        {state === 'preview' && previewData && (
          <div className="py-2">
            <div className="flex items-center gap-2 mb-3">
              <Eye className="w-5 h-5 text-slate-500" />
              <p className="text-sm font-semibold text-slate-900">Dry-run preview, no call placed</p>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Phone: <span className="font-mono">{previewData.maskedPhone}</span>
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600 leading-relaxed max-h-40 overflow-y-auto mb-4">
              {previewData.callGoal}
            </div>
            <p className="text-[11px] text-slate-400 mb-4">
              Set <span className="font-mono">DRY_RUN=false</span> in <span className="font-mono">.env</span> to
              allow real calls.
            </p>
            <button
              onClick={resetToIdle}
              className="w-full text-sm font-bold text-teal-700 hover:text-teal-900 cursor-pointer"
            >
              Close preview
            </button>
          </div>
        )}

        {state === 'done' && (
          <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-600" />
            <p className="text-sm font-semibold text-slate-900">Call completed</p>
            <p className="text-xs text-slate-600">{resultSummary}</p>
            <button
              onClick={onClose}
              className="mt-2 text-sm font-bold text-teal-700 hover:text-teal-900 cursor-pointer"
            >
              Close
            </button>
          </div>
        )}

        {state === 'error' && (
          <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
            <AlertTriangle className="w-8 h-8 text-rose-600" />
            <p className="text-sm font-semibold text-slate-900">Call could not be placed</p>
            <p className="text-xs text-slate-600">{errorMessage}</p>
            <button
              onClick={resetToIdle}
              className="mt-2 text-sm font-bold text-teal-700 hover:text-teal-900 cursor-pointer"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
