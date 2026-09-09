import React, { useState, useEffect, useRef } from 'react';
import {
  PhoneCall,
  Volume2,
  Play,
  Pause,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  ShieldCheck,
  Globe2,
  Copy,
  Check,
  User,
  Bot,
  MessageSquare,
  HeartHandshake,
  FileText,
  Languages,
  Loader2
} from 'lucide-react';
import { CallLog } from '../types';
import { ModalShell } from './ui/ModalShell';
import { getSpeechLangCode, getSpeechVoiceParams } from '../lib/speech';

interface CallDetailModalProps {
  call: CallLog | null;
  onClose: () => void;
  onUpdateFollowUp: (callId: string, status: 'Pending Review' | 'Followed Up' | 'Resolved', notes?: string) => void;
}

export const CallDetailModal: React.FC<CallDetailModalProps> = ({
  call,
  onClose,
  onUpdateFollowUp,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTurnIndex, setCurrentTurnIndex] = useState<number | null>(null);
  const [caregiverNotes, setCaregiverNotes] = useState('');
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [translatedTexts, setTranslatedTexts] = useState<string[] | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (call) {
      setCaregiverNotes(call.staffNotes || '');
      setIsPlaying(false);
      setCurrentTurnIndex(null);
      setAudioProgress(0);
      setTranslatedTexts(null);
      setShowTranslation(false);
      setTranslateError(null);
    }
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [call]);

  if (!call) return null;

  // Audio Playback simulation using SpeechSynthesis or animated turns
  const togglePlayAudio = () => {
    if (isPlaying) {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      playFromTurn(currentTurnIndex !== null ? currentTurnIndex : 0);
    }
  };

  const playFromTurn = (index: number) => {
    if (index >= call.transcript.length) {
      setIsPlaying(false);
      setCurrentTurnIndex(null);
      return;
    }

    setCurrentTurnIndex(index);
    setAudioProgress(((index + 1) / call.transcript.length) * 100);

    const turn = call.transcript[index];
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(turn.text);

      utterance.lang = getSpeechLangCode(call.languageUsed);
      const { rate, pitch } = getSpeechVoiceParams(turn.speaker === 'CALL-E');
      utterance.rate = rate;
      utterance.pitch = pitch;

      utterance.onend = () => {
        setTimeout(() => {
          playFromTurn(index + 1);
        }, 600);
      };

      utterance.onerror = () => {
        // Fallback simulation timer if speech synthesis fails
        setTimeout(() => {
          playFromTurn(index + 1);
        }, 2200);
      };

      speechRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    } else {
      // Fallback timer
      setTimeout(() => {
        playFromTurn(index + 1);
      }, 2500);
    }
  };

  const stopAudio = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsPlaying(false);
    setCurrentTurnIndex(null);
    setAudioProgress(0);
  };

  const handleCopySummary = () => {
    const textToCopy = `RECALL-E Shift Summary - Resident: ${call.residentName} (Rm ${call.roomNumber})\nMood: ${call.moodTag} (Score: ${call.moodScore}/10)\nSummary: ${call.clinicalSummary}\nKey Memories Recalled: ${call.keyMemoriesRecalled.join(', ')}\nAction: ${call.recommendedAction || 'None required'}`;
    navigator.clipboard.writeText(textToCopy);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  const handleSaveNotes = () => {
    onUpdateFollowUp(call.id, 'Followed Up', caregiverNotes);
  };

  const handleToggleTranslation = async () => {
    if (translatedTexts) {
      setShowTranslation((prev) => !prev);
      return;
    }

    setIsTranslating(true);
    setTranslateError(null);
    try {
      const res = await fetch('/api/calls/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texts: call.transcript.map((t) => t.text),
          sourceLanguage: call.languageUsed,
        }),
      });
      const data = await res.json();
      if (Array.isArray(data.translations) && data.translations.length === call.transcript.length) {
        setTranslatedTexts(data.translations);
        setShowTranslation(true);
        if (data.translated === false) {
          setTranslateError('Translation service unavailable right now — showing original text.');
        }
      } else {
        setTranslateError('Could not translate this transcript.');
      }
    } catch {
      setTranslateError('Could not reach the translation service.');
    } finally {
      setIsTranslating(false);
    }
  };

  const getMoodColor = (mood: string) => {
    if (mood.includes('Needs Attention')) return 'bg-rose-100 text-rose-800 border-rose-300';
    if (mood.includes('Uplifted') || mood.includes('Joyful')) return 'bg-emerald-100 text-emerald-800 border-emerald-300';
    if (mood.includes('Calmed')) return 'bg-sky-100 text-sky-800 border-sky-300';
    return 'bg-teal-100 text-teal-800 border-teal-300';
  };

  return (
    <ModalShell
      onClose={onClose}
      maxWidthClassName="max-w-4xl"
      icon={<PhoneCall className="w-5 h-5" />}
      title={call.residentName}
      titleBadge={
        <>
          <span className="text-xs text-slate-300 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
            Room {call.roomNumber} ({call.wing})
          </span>
          <span className="text-xs text-teal-300 bg-teal-950/80 px-2 py-0.5 rounded border border-teal-800/80 flex items-center gap-1">
            <Globe2 className="w-3 h-3" />
            {call.languageUsed}
          </span>
        </>
      }
      subtitle={`${call.callDateTime} • Call Duration: ${call.durationMinutes} minutes • Topic: ${call.topicGrounding}`}
      footer={
        <>
          <span>CALL-E Telephony System • Call ID: {call.id}</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 text-white font-medium hover:bg-slate-700 transition cursor-pointer"
          >
            Close Call Review
          </button>
        </>
      }
    >
          {/* Actual Facility Telephony & EHR Sync Bar */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-teal-600" />
                <span>EHR Integration:</span>
              </span>
              <span className="font-mono text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded font-bold">
                {call.ehrSyncStatus || 'Synced to PointClickCare'} ({call.ehrNoteId || 'PCC-NOTE-7712'})
              </span>
              {call.roomExtension && (
                <span className="font-mono text-slate-700 bg-slate-200/80 px-2 py-0.5 rounded font-bold">
                  Bedside Line: {call.roomExtension}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded">
                Audio Retention: <strong>{call.audioRetentionDaysRemaining || 7} Days</strong> before Auto-Purge
              </span>
              {call.nursePagerDispatched && (
                <span className="text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded">
                  Vocera Paged
                </span>
              )}
            </div>
          </div>

          {/* Attention Banner if Flagged */}
          {call.needsAttention && (
            <div className="p-4 bg-rose-50 border border-rose-300 rounded-xl flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-rose-900">
                    Flagged for Caregiver In-Person Check-In
                  </h4>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-rose-200 text-rose-800">
                    {call.staffFollowUpStatus}
                  </span>
                </div>
                <p className="text-xs text-rose-800 mt-1 font-medium">
                  <strong>Trigger:</strong> {call.attentionReason}
                </p>
                <p className="text-xs text-rose-700 mt-1 bg-white/70 p-2 rounded border border-rose-200">
                  <strong>Recommended Staff Action:</strong> {call.recommendedAction}
                </p>
              </div>
            </div>
          )}

          {/* Mood & Metric Badges */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Overall Resident Mood
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${getMoodColor(call.moodTag)}`}>
                  {call.moodTag}
                </span>
                <span className="text-xs font-bold text-slate-700">
                  {call.moodScore} / 10
                </span>
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Cognitive Alertness Level
              </div>
              <div className="flex items-center gap-2">
                <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden flex-1">
                  <div 
                    className="bg-teal-600 h-2 rounded-full" 
                    style={{ width: `${call.alertnessScore * 10}%` }}
                  ></div>
                </div>
                <span className="text-xs font-bold text-slate-700">
                  {call.alertnessScore} / 10
                </span>
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Validation & Redirections
              </div>
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>{call.validationMomentsCount} Gentle Pivots (0 Arguments)</span>
              </div>
            </div>
          </div>

          {/* Clinical Shift Summary Box */}
          <div className="bg-teal-50/50 border border-teal-200/80 rounded-xl p-4.5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-teal-900 font-bold text-xs uppercase tracking-wider">
                <FileText className="w-4 h-4 text-teal-700" />
                <span>Clinical Post-Call Summary (Shift Log Ready)</span>
              </div>
              <button
                onClick={handleCopySummary}
                className="flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-900 bg-white px-2.5 py-1 rounded-md border border-teal-200 shadow-2xs transition cursor-pointer"
              >
                {copiedSummary ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy for EHR</span>
                  </>
                )}
              </button>
            </div>
            
            <p className="text-sm text-slate-800 leading-relaxed">
              {call.clinicalSummary}
            </p>

            <div className="mt-3 pt-3 border-t border-teal-200/60 flex flex-wrap items-center gap-y-1 gap-x-4 text-xs">
              <span className="text-teal-900 font-semibold">Emotional Arc:</span>
              <span className="text-slate-600 italic">{call.emotionalTrajectory}</span>
            </div>
          </div>

          {/* Key Memories Sparked */}
          <div>
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Key Reminiscence Anchors Recalled</span>
            </h4>
            <div className="flex flex-wrap gap-2">
              {call.keyMemoriesRecalled.map((memory, i) => (
                <span
                  key={i}
                  className="bg-amber-50 text-amber-900 text-xs font-medium px-3 py-1.5 rounded-lg border border-amber-200/80 flex items-center gap-1.5"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  {memory}
                </span>
              ))}
            </div>
          </div>

          {/* Audio Player & Speech Playback */}
          <div className="bg-slate-900 text-white rounded-xl p-4 border border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-teal-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Audio Playback Simulation ({call.languageUsed})
                </span>
              </div>
              <span className="text-[11px] text-slate-400">
                Staff can listen with 1-click or read transcript below
              </span>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={togglePlayAudio}
                id="btn-play-call-audio"
                className="w-10 h-10 rounded-full bg-teal-500 hover:bg-teal-400 text-slate-950 flex items-center justify-center font-bold shadow-md transition cursor-pointer shrink-0"
              >
                {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
              </button>

              <button
                onClick={stopAudio}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                title="Restart"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <div className="flex-1">
                <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-teal-400 to-emerald-400 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${audioProgress}%` }}
                  ></div>
                </div>
                <div className="flex justify-between text-[11px] text-slate-400 mt-1.5">
                  <span>
                    {currentTurnIndex !== null
                      ? `Playing Turn ${currentTurnIndex + 1} of ${call.transcript.length} (${call.transcript[currentTurnIndex].speaker})`
                      : 'Paused'}
                  </span>
                  <span>{call.durationMinutes} min recording</span>
                </div>
              </div>
            </div>
          </div>

          {/* Full Timestamped Transcript */}
          <div>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-teal-700" />
                <span>Full Timestamped Call Transcript</span>
              </h4>
              <div className="flex items-center gap-2">
                {call.languageUsed && call.languageUsed !== 'English' && (
                  <button
                    type="button"
                    onClick={handleToggleTranslation}
                    disabled={isTranslating}
                    id="btn-translate-transcript"
                    className="flex items-center gap-1.5 text-xs font-semibold text-teal-700 hover:text-teal-900 bg-teal-50 hover:bg-teal-100 px-2.5 py-1 rounded-md border border-teal-200 shadow-2xs transition cursor-pointer disabled:opacity-60 disabled:cursor-wait"
                  >
                    {isTranslating ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Languages className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {showTranslation && translatedTexts
                        ? 'Show Original'
                        : `Translate to English`}
                    </span>
                  </button>
                )}
                <span className="text-xs text-slate-500">
                  {call.transcript.length} dialogue turns
                </span>
              </div>
            </div>

            {translateError && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mb-3">
                {translateError}
              </p>
            )}

            <div className="space-y-3 bg-slate-50/70 p-4 rounded-xl border border-slate-200">
              {call.transcript.map((turn, idx) => {
                const isCallee = turn.speaker === 'CALL-E';
                const isCurrentlyActive = currentTurnIndex === idx;
                const displayText =
                  showTranslation && translatedTexts ? translatedTexts[idx] : turn.text;

                return (
                  <div
                    key={idx}
                    onClick={() => playFromTurn(idx)}
                    className={`p-3.5 rounded-xl transition cursor-pointer border ${
                      isCurrentlyActive
                        ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-400/40 shadow-xs'
                        : isCallee
                        ? 'bg-teal-50/60 border-teal-100 hover:bg-teal-50'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            isCallee ? 'bg-teal-700 text-white' : 'bg-slate-700 text-white'
                          }`}
                        >
                          {isCallee ? <Bot className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                        </span>
                        <span className="text-xs font-bold text-slate-900">
                          {turn.speaker === 'CALL-E' ? 'CALL-E (Reminiscence AI)' : call.residentName}
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono">
                          {turn.timestamp}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {turn.redirectApplied && (
                          <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-300 flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3" />
                            Gentle Redirection (Never Argued)
                          </span>
                        )}
                        {turn.sentiment && (
                          <span className="text-[10px] uppercase font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                            {turn.sentiment}
                          </span>
                        )}
                      </div>
                    </div>

                    <p className="text-xs sm:text-sm text-slate-800 pl-8 leading-relaxed">
                      "{displayText}"
                    </p>
                    {showTranslation && translatedTexts && (
                      <p className="text-[11px] text-slate-400 italic pl-8 mt-1">
                        Original ({call.languageUsed}): "{turn.text}"
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Caregiver Follow-Up Section */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <HeartHandshake className="w-4 h-4 text-teal-700" />
              <span>Staff Follow-Up & Caregiver Notes</span>
            </h4>
            
            <textarea
              value={caregiverNotes}
              onChange={(e) => setCaregiverNotes(e.target.value)}
              placeholder="Add notes about your in-person visit (e.g., 'Checked in at 5:15 PM with cup of chamomile tea; Art was relaxed and settled in recliner.')..."
              className="w-full text-xs sm:text-sm p-3 rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-teal-600 focus:border-transparent"
              rows={3}
            />

            <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Status:</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-200 text-slate-800">
                  {call.staffFollowUpStatus}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveNotes}
                  className="text-xs font-semibold bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 px-3 py-1.5 rounded-lg transition cursor-pointer"
                >
                  Save Notes
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateFollowUp(call.id, 'Resolved', caregiverNotes)}
                  className="text-xs font-bold bg-teal-700 hover:bg-teal-800 text-white px-4 py-1.5 rounded-lg shadow-xs transition cursor-pointer flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Mark Resolved & Followed Up</span>
                </button>
              </div>
            </div>
          </div>

    </ModalShell>
  );
};
