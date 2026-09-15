import React, { useState, useEffect, useRef } from 'react';
import {
  Phone,
  PhoneOff,
  Volume2,
  VolumeX,
  ShieldCheck,
  Send,
  Loader2,
  CheckCircle2
} from 'lucide-react';
import { ResidentProfile, CallTurn, CallLog } from '../types';
import { ModalShell } from './ui/ModalShell';
import { getSpeechLangCode, getSpeechVoiceParams } from '../lib/speech';

interface LiveCallSimulatorModalProps {
  residents: ResidentProfile[];
  isOpen: boolean;
  onClose: () => void;
  onCallCompleted: (newCall: CallLog) => void;
}

export const LiveCallSimulatorModal: React.FC<LiveCallSimulatorModalProps> = ({
  residents,
  isOpen,
  onClose,
  onCallCompleted,
}) => {
  const [selectedResidentId, setSelectedResidentId] = useState<string>(residents[0]?.id || 'res-1');
  const [scenario, setScenario] = useState<'standard' | 'bus_panic' | 'deceased_spouse' | 'somatic_pain'>('bus_panic');
  const [callState, setCallState] = useState<'idle' | 'calling' | 'connected' | 'analyzing' | 'finished'>('idle');
  
  const [transcript, setTranscript] = useState<CallTurn[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isAiResponding, setIsAiResponding] = useState(false);
  const [callDurationSeconds, setCallDurationSeconds] = useState(0);
  const [audioEnabled, setAudioEnabled] = useState(true);

  const [lastRedirectionStatus, setLastRedirectionStatus] = useState<string | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const selectedResident = residents.find((r) => r.id === selectedResidentId) || residents[0];

  // Auto-scroll transcript
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript, isAiResponding]);

  // Call timer
  useEffect(() => {
    if (callState === 'connected') {
      timerRef.current = setInterval(() => {
        setCallDurationSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callState]);

  // Cleanup speech synthesis on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  if (!isOpen) return null;

  const speakText = (text: string, isCallee = true) => {
    if (!audioEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = getSpeechLangCode(selectedResident?.firstLanguage || 'English');
    const { rate, pitch } = getSpeechVoiceParams(isCallee);
    utterance.rate = rate;
    utterance.pitch = pitch;

    window.speechSynthesis.speak(utterance);
  };

  const startCall = async () => {
    setCallState('calling');
    setTranscript([]);
    setCallDurationSeconds(0);
    setLastRedirectionStatus(null);

    // Initial greeting based on language
    const isSpanish = (selectedResident?.firstLanguage || '').toLowerCase().includes('span');
    const isItalian = (selectedResident?.firstLanguage || '').toLowerCase().includes('ital');
    const isFrench = (selectedResident?.firstLanguage || '').toLowerCase().includes('fren');

    let initialGreeting = `Good morning, ${selectedResident.preferredName || selectedResident.name}! It is so wonderful to hear from you today. How is the morning treating you?`;
    if (isSpanish) {
      initialGreeting = `¡Hola ${selectedResident.preferredName || selectedResident.name}! Qué alegría saludarte hoy. ¿Cómo te sientes esta hermosa mañana?`;
    } else if (isItalian) {
      initialGreeting = `Buongiorno, ${selectedResident.preferredName || selectedResident.name}! Che gioia salutarti oggi. Come ti senti questa mattina?`;
    } else if (isFrench) {
      initialGreeting = `Bonjour, ${selectedResident.preferredName || selectedResident.name}! C’est un grand plaisir d’échanger avec vous ce matin. Comment allez-vous ?`;
    }

    setTimeout(() => {
      setCallState('connected');
      const firstTurn: CallTurn = {
        speaker: 'CALL-E',
        text: initialGreeting,
        timestamp: '00:02',
        sentiment: 'warm',
        redirectApplied: false,
      };
      setTranscript([firstTurn]);
      speakText(initialGreeting, true);

      // Pre-populate realistic resident prompt based on scenario
      setTimeout(() => {
        if (scenario === 'bus_panic') {
          if (isSpanish) {
            setUserInput('Hola... tengo prisa porque perdí las llaves de la panadería y los clientes van a llegar.');
          } else {
            setUserInput('Oh hello. I need to get out to the bus stop right now or I will be late for my shift at the depot!');
          }
        } else if (scenario === 'deceased_spouse') {
          if (isSpanish) {
            setUserInput('¿Has visto a mi esposo Mateo? Salió temprano en su bicicleta y ya debería estar aquí...');
          } else {
            setUserInput('Have you seen Dorothy? She went to the store and hasn’t come back yet. I’m getting worried.');
          }
        } else if (scenario === 'somatic_pain') {
          setUserInput('I feel all turned around and my knee is throbbing. Where is everyone?');
        } else {
          if (isSpanish) {
            setUserInput('Buenos días. Hoy me desperté pensando en el olor a vainilla y canela recién horneada.');
          } else {
            setUserInput('I’m doing alright. Just looking at the old train pictures on my dresser.');
          }
        }
      }, 1000);

    }, 2000);
  };

  const handleSendUtterance = async (overrideText?: string) => {
    const textToSend = overrideText || userInput;
    if (!textToSend.trim() || isAiResponding) return;

    const currentSecs = callDurationSeconds;
    const formattedTime = `${String(Math.floor(currentSecs / 60)).padStart(2, '0')}:${String(currentSecs % 60).padStart(2, '0')}`;

    const residentTurn: CallTurn = {
      speaker: 'Resident',
      text: textToSend.trim(),
      timestamp: formattedTime,
      sentiment: textToSend.toLowerCase().includes('hurry') || textToSend.toLowerCase().includes('prisa') ? 'anxious' : 'reminiscent',
    };

    const updatedTranscript = [...transcript, residentTurn];
    setTranscript(updatedTranscript);
    setUserInput('');
    setIsAiResponding(true);

    try {
      const res = await fetch('/api/calls/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resident: selectedResident,
          transcript: updatedTranscript,
          userUtterance: textToSend.trim(),
        }),
      });

      const data = await res.json();
      const replyTime = `${String(Math.floor((currentSecs + 3) / 60)).padStart(2, '0')}:${String((currentSecs + 3) % 60).padStart(2, '0')}`;

      const aiTurn: CallTurn = {
        speaker: 'CALL-E',
        text: data.reply || 'You have always been so caring. Let’s take a deep breath together and remember those warm memories.',
        timestamp: replyTime,
        sentiment: data.sentiment || 'validating',
        redirectApplied: data.redirectTriggered || false,
      };

      if (data.redirectTriggered) {
        setLastRedirectionStatus('Gentle Redirection Applied: Validated emotion without arguing, pivoting to safe memory anchor.');
      }

      setTranscript((prev) => [...prev, aiTurn]);
      speakText(aiTurn.text, true);
    } catch (err) {
      console.warn('API error in call simulation:', err);
    } finally {
      setIsAiResponding(false);
    }
  };

  const endCallAndAnalyze = async () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    setCallState('analyzing');

    try {
      const res = await fetch('/api/calls/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resident: selectedResident,
          transcript,
        }),
      });

      const analysis = await res.json();

      const newCallLog: CallLog = {
        id: `call-live-${Date.now()}`,
        residentId: selectedResident.id,
        residentName: selectedResident.name,
        preferredName: selectedResident.preferredName || selectedResident.name,
        roomNumber: selectedResident.roomNumber,
        roomExtension: selectedResident.roomExtension,
        wing: selectedResident.wing,
        ehrPatientId: selectedResident.ehrPatientId,
        callDateTime: 'Just Now',
        durationMinutes: Math.max(1, Number((callDurationSeconds / 60).toFixed(1))),
        languageUsed: selectedResident.firstLanguage,
        topicGrounding: selectedResident.reminiscenceTopic,
        moodTag: analysis.needsAttention ? 'Flagged: Needs Attention' : 'Uplifted & Joyful',
        moodScore: analysis.moodScore || 8.5,
        alertnessScore: analysis.alertnessScore || 8.0,
        needsAttention: analysis.needsAttention || false,
        attentionReason: analysis.attentionReason || null,
        recommendedAction: analysis.recommendedAction || 'Continue scheduled reminiscence cadence.',
        clinicalSummary: analysis.clinicalSummary || `Resident participated in a ${Math.ceil(callDurationSeconds / 60)}-minute reminiscence session in ${selectedResident.firstLanguage}. Validated effectively with no argumentation.`,
        emotionalTrajectory: analysis.emotionalTrajectory || 'Greeting -> Memory Activation -> Calm conclusion',
        keyMemoriesRecalled: analysis.keyMemoriesRecalled || [selectedResident.reminiscenceTopic],
        validationMomentsCount: analysis.redirectionCount || 1,
        transcript,
        staffFollowUpStatus: analysis.needsAttention ? 'Pending Review' : 'Resolved',
        staffNotes: 'Live test call executed by staff caregiver via PBX extension.',
        ehrSyncStatus: selectedResident.ehrProvider === 'MatrixCare' ? 'Synced to MatrixCare' : 'Synced to PointClickCare',
        ehrNoteId: `PCC-NOTE-${Math.floor(1000 + Math.random() * 9000)}`,
        fhirSyncTimestamp: 'Just Now',
        audioRetentionDaysRemaining: 7,
        nursePagerDispatched: analysis.needsAttention || false,
      };

      onCallCompleted(newCallLog);
      setCallState('finished');
    } catch (err) {
      console.warn('Analysis error:', err);
      setCallState('idle');
      onClose();
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <ModalShell
      onClose={onClose}
      maxWidthClassName="max-w-3xl"
      icon={<Phone className="w-4 h-4 animate-bounce" />}
      title="CALL-E Reminiscence Phone Simulator"
      titleBadge={
        <span className="text-[10px] font-bold uppercase tracking-wider bg-teal-900/90 text-teal-300 border border-teal-700/60 px-2 py-0.5 rounded-full">
          Validation Therapy Engine
        </span>
      }
      subtitle="Experience real-time AI memory care calls with native language & gentle distress redirection"
      bodyClassName="p-6 space-y-5 text-slate-800"
    >
          {/* Setup screen if call is idle */}
          {callState === 'idle' && (
            <div className="space-y-4">
              <div className="p-4 bg-teal-50 border border-teal-200 rounded-xl">
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="w-5 h-5 text-teal-700 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-bold text-teal-950 uppercase tracking-wider">
                      Validation Therapy Guardrails In Effect
                    </h4>
                    <p className="text-xs text-teal-800 mt-1 leading-relaxed">
                      CALL-E is trained to <strong>never argue, contradict, or reality-test</strong> a resident. If a resident believes they are 30 years younger, waiting for a deceased spouse, or late for work, CALL-E validates their emotion with dignity and smoothly pivots to a sensory reminiscence topic.
                    </p>
                  </div>
                </div>
              </div>

              {/* Select Resident */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                  Select Resident to Call
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {residents.map((r) => (
                    <div
                      key={r.id}
                      onClick={() => setSelectedResidentId(r.id)}
                      className={`p-3 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                        selectedResidentId === r.id
                          ? 'bg-teal-50/80 border-teal-600 ring-2 ring-teal-600/30'
                          : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-xs text-slate-900 truncate">{r.name}</span>
                          <span className="text-[11px] text-slate-500">Rm {r.roomNumber}</span>
                        </div>
                        <p className="text-[11px] text-slate-500 truncate mt-0.5">
                          {r.reminiscenceTopic}
                        </p>
                      </div>
                      <span className="text-sm shrink-0 ml-2" title={r.firstLanguage}>
                        {r.languageFlag}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Scenario Preset */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                  Simulation Challenge Scenario
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setScenario('bus_panic')}
                    className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                      scenario === 'bus_panic'
                        ? 'bg-slate-900 text-white border-slate-800'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-bold mb-0.5">1. Panic About Being Late / Lost Keys</div>
                    <div className={`text-[11px] ${scenario === 'bus_panic' ? 'text-slate-300' : 'text-slate-500'}`}>
                      Tests gentle redirection when resident worries about opening business or catching bus.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setScenario('deceased_spouse')}
                    className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                      scenario === 'deceased_spouse'
                        ? 'bg-slate-900 text-white border-slate-800'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-bold mb-0.5">2. Searching for Deceased Spouse</div>
                    <div className={`text-[11px] ${scenario === 'deceased_spouse' ? 'text-slate-300' : 'text-slate-500'}`}>
                      Tests validation without correcting death or arguing; comforts with loving memories.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setScenario('standard')}
                    className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                      scenario === 'standard'
                        ? 'bg-slate-900 text-white border-slate-800'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-bold mb-0.5">3. Standard Warm Reminiscence</div>
                    <div className={`text-[11px] ${scenario === 'standard' ? 'text-slate-300' : 'text-slate-500'}`}>
                      Relaxed sensory reminiscence grounded in career and childhood hobbies.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setScenario('somatic_pain')}
                    className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                      scenario === 'somatic_pain'
                        ? 'bg-slate-900 text-white border-slate-800'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-bold mb-0.5">4. Sundowning Somatic Disorientation</div>
                    <div className={`text-[11px] ${scenario === 'somatic_pain' ? 'text-slate-300' : 'text-slate-500'}`}>
                      Resident reports physical ache and disorientation; tests staff check-in flagging.
                    </div>
                  </button>
                </div>
              </div>

              {/* Start Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={startCall}
                  id="btn-dial-resident-call"
                  className="w-full bg-gradient-to-r from-teal-700 to-emerald-600 hover:from-teal-800 hover:to-emerald-700 text-white font-bold py-3.5 px-6 rounded-xl shadow-md transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Phone className="w-5 h-5" />
                  <span>Dial Call to {selectedResident.name} ({selectedResident.firstLanguage})</span>
                </button>
              </div>
            </div>
          )}

          {/* Calling animation state */}
          {callState === 'calling' && (
            <div className="py-16 text-center space-y-4">
              <div className="relative inline-flex">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-60"></span>
                <div className="w-20 h-20 rounded-full bg-teal-700 text-white flex items-center justify-center shadow-lg relative">
                  <Phone className="w-9 h-9 animate-pulse" />
                </div>
              </div>
              <div>
                <h4 className="text-base font-bold text-slate-900">
                  Dialing {selectedResident.name} (Room {selectedResident.roomNumber})...
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  Connecting via CALL-E Voice Gateway • Priming {selectedResident.firstLanguage} Language Model
                </p>
              </div>
            </div>
          )}

          {/* Active Call UI */}
          {callState === 'connected' && (
            <div className="space-y-4">
              
              {/* Phone Header Strip */}
              <div className="bg-slate-900 text-white rounded-xl p-4 flex items-center justify-between shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-600/30 text-emerald-400 border border-emerald-500/50 flex items-center justify-center font-bold">
                    <Phone className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-white">{selectedResident.name}</span>
                      <span className="text-[11px] bg-slate-800 px-2 py-0.5 rounded text-teal-300 border border-slate-700">
                        {selectedResident.firstLanguage}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                      <span>Active Reminiscence Call • {formatTimer(callDurationSeconds)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAudioEnabled(!audioEnabled)}
                    className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition cursor-pointer"
                    title={audioEnabled ? 'Voice output enabled' : 'Voice output muted'}
                  >
                    {audioEnabled ? <Volume2 className="w-4 h-4 text-teal-400" /> : <VolumeX className="w-4 h-4" />}
                  </button>

                  <button
                    type="button"
                    onClick={endCallAndAnalyze}
                    id="btn-end-call-analyze"
                    className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-3.5 py-2 rounded-lg shadow-xs transition cursor-pointer"
                  >
                    <PhoneOff className="w-3.5 h-3.5" />
                    <span>End & Analyze Call</span>
                  </button>
                </div>
              </div>

              {/* Redirection banner if fired */}
              {lastRedirectionStatus && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-xs text-emerald-900 animate-in fade-in duration-200">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="font-medium">{lastRedirectionStatus}</span>
                </div>
              )}

              {/* Live Transcript Stream */}
              <div 
                ref={scrollRef}
                className="h-64 overflow-y-auto space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs"
              >
                {transcript.map((turn, idx) => {
                  const isCallee = turn.speaker === 'CALL-E';
                  return (
                    <div
                      key={idx}
                      className={`flex flex-col ${isCallee ? 'items-start' : 'items-end'}`}
                    >
                      <div className="flex items-center gap-1.5 mb-1 text-[10px] text-slate-400">
                        <span>{isCallee ? 'CALL-E (AI Companion)' : selectedResident.name}</span>
                        <span>•</span>
                        <span>{turn.timestamp}</span>
                        {turn.redirectApplied && (
                          <span className="text-emerald-700 font-bold bg-emerald-100 px-1.5 py-0.2 rounded">
                            Validation Redirection
                          </span>
                        )}
                      </div>
                      <div
                        className={`max-w-[85%] p-3 rounded-xl leading-relaxed text-xs sm:text-sm ${
                          isCallee
                            ? 'bg-white border border-teal-200 text-slate-800 shadow-2xs'
                            : 'bg-teal-700 text-white'
                        }`}
                      >
                        {turn.text}
                      </div>
                    </div>
                  );
                })}

                {isAiResponding && (
                  <div className="flex items-center gap-2 text-slate-500 text-xs italic py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-600" />
                    <span>CALL-E is validating and formulating warm response...</span>
                  </div>
                )}
              </div>

              {/* Resident Response Input Box */}
              <div className="bg-white border border-slate-300 rounded-xl p-2.5 shadow-2xs">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                  <span>Speak or Type as Resident ({selectedResident.name})</span>
                  <span className="text-[11px] text-teal-700 font-normal">
                    Grounding: {selectedResident.reminiscenceTopic}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendUtterance()}
                    placeholder={`e.g., "${selectedResident.firstLanguage.includes('Span') ? 'Me siento feliz de recordar el pan dulce...' : 'I used to drive that steam train early mornings...'}"`}
                    className="flex-1 text-xs sm:text-sm p-2 bg-slate-50 rounded-lg border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-teal-600 focus:bg-white"
                  />

                  <button
                    type="button"
                    onClick={() => handleSendUtterance()}
                    disabled={isAiResponding || !userInput.trim()}
                    className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white p-2 rounded-lg transition cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>

                {/* Quick Utterance Chips for testing dementia redirection */}
                <div className="mt-2.5 pt-2 border-t border-slate-100 flex flex-wrap gap-1.5 text-[11px]">
                  <span className="text-slate-400 self-center mr-1">Test Prompts:</span>
                  <button
                    type="button"
                    onClick={() => handleSendUtterance(selectedResident.firstLanguage.includes('Span') ? '¿Dónde están mis llaves? Necesito irme ya.' : 'Where are my work boots? I am going to be fired!')}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-md transition cursor-pointer"
                  >
                    ⚠️ Agitated / Late for Work
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendUtterance(selectedResident.firstLanguage.includes('Span') ? 'Cuéntame más sobre la panadería.' : 'Tell me more about the old neighborhood.')}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-md transition cursor-pointer"
                  >
                    🌸 Fond Nostalgia
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendUtterance(selectedResident.firstLanguage.includes('Span') ? 'Me siento muy confundida hoy.' : 'Everything is dark and I feel lost.')}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-md transition cursor-pointer"
                  >
                    ❓ Confusion / Disorientation
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendUtterance(selectedResident.firstLanguage.includes('Span') ? 'Me duele mucho la cadera y no puedo levantarme.' : 'My hip hurts terribly after getting out of bed and I cannot walk.')}
                    className="bg-rose-100 hover:bg-rose-200 text-rose-800 font-semibold px-2.5 py-1 rounded-md transition cursor-pointer"
                  >
                    🚨 Somatic Pain (Triggers Vocera Pager)
                  </button>
                </div>
              </div>

            </div>
          )}

          {/* Analyzing State */}
          {callState === 'analyzing' && (
            <div className="py-16 text-center space-y-4">
              <Loader2 className="w-10 h-10 animate-spin text-teal-600 mx-auto" />
              <div>
                <h4 className="text-base font-bold text-slate-900">
                  Generating Clinical Reminiscence Shift Summary...
                </h4>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  CALL-E is processing resident mood scores, cognitive alertness, key memories recalled, and scanning for attention flags so staff don't have to listen to the call audio.
                </p>
              </div>
            </div>
          )}

          {/* Finished State */}
          {callState === 'finished' && (
            <div className="py-12 text-center space-y-4">
              <div className="w-14 h-14 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div>
                <h4 className="text-lg font-bold text-slate-900">
                  Call Completed & Logged to Facility Dashboard
                </h4>
                <p className="text-xs text-slate-600 mt-1 max-w-md mx-auto">
                  The clinical summary, mood rating, alertness score, and timestamped transcript have been recorded. Staff can view it in Call Logs now.
                </p>
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold px-6 py-2.5 rounded-xl transition cursor-pointer shadow-xs"
                >
                  View in Dashboard
                </button>
              </div>
            </div>
          )}

    </ModalShell>
  );
};
