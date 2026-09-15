'use client';

import React, { useState, useEffect, useRef } from 'react';
import { TranscriptTurn, VerificationRecord } from '@/lib/types';
import {
  Phone,
  Volume2,
  VolumeX,
  ShieldCheck,
  ShieldAlert,
  Play,
  Pause,
  RotateCcw,
  User,
  Radio,
  Hash,
  Lock,
  FileCheck2,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';

interface PhoneCallSimulatorProps {
  vendorName: string;
  targetPhone: string;
  officerName: string;
  officerTitle: string;
  challengeToken: string;
  expectedTaxId: string;
  transcript: TranscriptTurn[];
  disposition: string;
  onCallComplete?: () => void;
  // Scenario switcher props
  records?: VerificationRecord[];
  selectedRecordId?: string;
  onSelectRecord?: (id: string) => void;
  onViewCertificate?: (record: VerificationRecord) => void;
  activeRecord?: VerificationRecord;
  onOpenLiveCallModal?: () => void;
}

export const PhoneCallSimulator: React.FC<PhoneCallSimulatorProps> = ({
  vendorName,
  targetPhone,
  officerName,
  officerTitle,
  challengeToken,
  expectedTaxId,
  transcript,
  disposition,
  records,
  selectedRecordId,
  onSelectRecord,
  onViewCertificate,
  activeRecord,
  onOpenLiveCallModal,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTurnIndex, setCurrentTurnIndex] = useState(0);
  const [callElapsed, setCallElapsed] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakingNow, setIsSpeakingNow] = useState(false);
  const [audioTestActive, setAudioTestActive] = useState(false);
  const [manualTurnPlaying, setManualTurnPlaying] = useState<number | null>(null);

  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const turnTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const isPlayingRef = useRef<boolean>(false);
  isPlayingRef.current = isPlaying;

  // Pre-load available speech synthesis voices on component mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
      };
    }
  }, []);

  // Web Audio API Dual-Tone VoIP Connect Chime
  const playVoipChime = () => {
    try {
      if (typeof window === 'undefined') return;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      if (!audioContextRef.current || audioContextRef.current.state === 'suspended') {
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(440, ctx.currentTime);
      osc2.frequency.setValueAtTime(880, ctx.currentTime);

      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start();
      osc2.start();
      osc1.stop(ctx.currentTime + 0.4);
      osc2.stop(ctx.currentTime + 0.4);
    } catch {
      // AudioContext restriction fallback
    }
  };

  // Play realistic DTMF phone button tone when token or tax id is exchanged
  const playDtmfTone = (freq1: number = 941, freq2: number = 1336) => {
    try {
      if (typeof window === 'undefined' || isMuted) return;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      if (!audioContextRef.current || audioContextRef.current.state === 'suspended') {
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(freq1, ctx.currentTime);
      osc2.frequency.setValueAtTime(freq2, ctx.currentTime);

      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start();
      osc2.start();
      osc1.stop(ctx.currentTime + 0.18);
      osc2.stop(ctx.currentTime + 0.18);
    } catch {
      // Fallback
    }
  };

  // Speak text using Web Speech API with Chromium GC protection and persona selection
  const speakText = (text: string, speaker: 'agent' | 'callee', onEnd?: () => void) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || isMuted) {
      if (onEnd) {
        turnTimeoutRef.current = setTimeout(onEnd, 3500);
      }
      return;
    }

    try {
      // Cancel previous speech safely and un-pause
      window.speechSynthesis.cancel();
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }

      // Check if text mentions tokens or numbers to play DTMF audio effect
      if (text.includes('Zulu') || text.includes('Tax ID') || text.includes('9210')) {
        playDtmfTone();
      }

      const cleanText = text.replace(/[*_#"`]/g, '').trim();
      const utterance = new SpeechSynthesisUtterance(cleanText);

      // Pin reference to prevent Chromium garbage collection bug
      activeUtteranceRef.current = utterance;
      (window as any).__activeSpeechUtterance = utterance;

      // Select distinct voices for AI agent vs Corporate Callee
      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length > 0) {
        const enVoices = voices.filter((v) => v.lang.startsWith('en'));
        if (speaker === 'agent') {
          // AI Agent: clear, professional, higher pitch
          const aiVoice =
            enVoices.find(
              (v) =>
                v.name.includes('Hazel') ||
                v.name.includes('Zira') ||
                v.name.includes('Google') ||
                v.name.includes('Samantha') ||
                v.name.includes('Jenny') ||
                v.name.includes('Natural')
            ) || enVoices[0];
          if (aiVoice) utterance.voice = aiVoice;
          utterance.pitch = 1.08;
          utterance.rate = 1.02;
        } else {
          // Corporate Callee: deep, natural officer voice
          const humanVoice =
            enVoices.find(
              (v) =>
                v.name.includes('George') ||
                v.name.includes('David') ||
                v.name.includes('Daniel') ||
                v.name.includes('Mark') ||
                v.name.includes('Guy') ||
                v.name.includes('Susan')
            ) ||
            enVoices[enVoices.length - 1] ||
            enVoices[0];
          if (humanVoice) utterance.voice = humanVoice;
          utterance.pitch = 0.92;
          utterance.rate = 0.98;
        }
      } else {
        utterance.pitch = speaker === 'agent' ? 1.08 : 0.92;
        utterance.rate = speaker === 'agent' ? 1.02 : 0.98;
      }

      let finished = false;
      const handleFinish = () => {
        if (!finished) {
          finished = true;
          setIsSpeakingNow(false);
          setManualTurnPlaying(null);
          activeUtteranceRef.current = null;
          if (onEnd && isPlayingRef.current) {
            // Natural conversational cadence pause between turns
            turnTimeoutRef.current = setTimeout(onEnd, 700);
          }
        }
      };

      utterance.onstart = () => {
        setIsSpeakingNow(true);
      };
      utterance.onend = handleFinish;
      utterance.onerror = (e) => {
        // Chromium cancel() fires 'interrupted' or 'canceled' - DO NOT advance turn on cancel
        if (e.error === 'interrupted' || e.error === 'canceled') {
          setIsSpeakingNow(false);
          setManualTurnPlaying(null);
          return;
        }
        handleFinish();
      };

      // Brief tick to ensure Chromium cancel has flushed from audio queue
      setTimeout(() => {
        if (isPlayingRef.current || manualTurnPlaying !== null) {
          window.speechSynthesis.speak(utterance);
        }
      }, 60);
    } catch {
      if (onEnd) {
        turnTimeoutRef.current = setTimeout(onEnd, 3500);
      }
    }
  };

  // Chromium keep-alive heartbeat pulse to prevent Chrome 15s pause bug
  useEffect(() => {
    if (!isPlaying) return;
    const pulseInterval = setInterval(() => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
          window.speechSynthesis.pause();
          window.speechSynthesis.resume();
        }
      }
    }, 7000);
    return () => clearInterval(pulseInterval);
  }, [isPlaying]);

  // One-click audio sound test for judges
  const handleTestAudio = () => {
    setAudioTestActive(true);
    playVoipChime();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      const testUtter = new SpeechSynthesisUtterance(
        `CALL-E voice defense online. Streaming verified for ${officerName} at ${vendorName}.`
      );
      testUtter.pitch = 1.06;
      testUtter.rate = 1.02;

      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length > 0) {
        const aiVoice =
          voices.find(
            (v) =>
              v.name.includes('Hazel') ||
              v.name.includes('Zira') ||
              v.name.includes('Google') ||
              v.name.includes('Samantha')
          ) || voices[0];
        if (aiVoice) testUtter.voice = aiVoice;
      }

      testUtter.onend = () => setAudioTestActive(false);
      testUtter.onerror = () => setAudioTestActive(false);
      activeUtteranceRef.current = testUtter;
      (window as any).__activeSpeechUtterance = testUtter;

      setTimeout(() => {
        window.speechSynthesis.speak(testUtter);
      }, 60);
    } else {
      setTimeout(() => setAudioTestActive(false), 2500);
    }
  };

  // Click to speak individual turn on demand
  const handleSpeakSingleTurn = (turnIndex: number) => {
    const targetTurn = transcript[turnIndex];
    if (!targetTurn) return;

    // Pause automated playback if running
    if (isPlaying) {
      setIsPlaying(false);
    }

    setManualTurnPlaying(turnIndex);
    setCurrentTurnIndex(turnIndex);
    speakText(targetTurn.text, targetTurn.speaker, () => {
      setManualTurnPlaying(null);
    });
  };

  // Stopwatch timer for call elapsed
  useEffect(() => {
    let timer: any;
    if (isPlaying) {
      timer = setInterval(() => {
        setCallElapsed((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isPlaying]);

  // Automated Turn Speaking & Progression
  useEffect(() => {
    if (!isPlaying) {
      if (turnTimeoutRef.current) clearTimeout(turnTimeoutRef.current);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setIsSpeakingNow(false);
      return;
    }

    const currentTurn = transcript[currentTurnIndex];
    if (!currentTurn) {
      setIsPlaying(false);
      return;
    }

    // Play VoIP chime at the start of call, wait 300ms before first sentence
    if (currentTurnIndex === 0 && callElapsed === 0) {
      playVoipChime();
      const initialDelay = setTimeout(() => {
        speakText(currentTurn.text, currentTurn.speaker, () => {
          setCurrentTurnIndex((prev) => {
            if (prev < transcript.length - 1) {
              return prev + 1;
            } else {
              setIsPlaying(false);
              return prev;
            }
          });
        });
      }, 350);
      return () => clearTimeout(initialDelay);
    }

    // Speak subsequent turn text aloud
    speakText(currentTurn.text, currentTurn.speaker, () => {
      setCurrentTurnIndex((prev) => {
        if (prev < transcript.length - 1) {
          return prev + 1;
        } else {
          setIsPlaying(false);
          return prev;
        }
      });
    });

    return () => {
      if (turnTimeoutRef.current) clearTimeout(turnTimeoutRef.current);
    };
  }, [isPlaying, currentTurnIndex, isMuted, transcript]);

  // Clean up speech on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (turnTimeoutRef.current) clearTimeout(turnTimeoutRef.current);
    };
  }, []);

  // Auto-scroll transcript container to active turn
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [currentTurnIndex]);

  // Scenario change reset
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTurnIndex(0);
    setCallElapsed(0);
    setManualTurnPlaying(null);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, [vendorName, targetPhone]);

  const handlePlayPause = () => {
    if (currentTurnIndex >= transcript.length - 1) {
      setCurrentTurnIndex(0);
      setCallElapsed(0);
    }
    setIsPlaying(!isPlaying);
  };

  const handleReset = () => {
    setIsPlaying(false);
    setCurrentTurnIndex(0);
    setCallElapsed(0);
    setManualTurnPlaying(null);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const handleToggleMute = () => {
    if (!isMuted) {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    }
    setIsMuted(!isMuted);
  };

  const activeTurn = transcript[currentTurnIndex] || transcript[0];
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="w-full space-y-4">
      {/* Top Mission Control Command Bar: Scenario Switcher + Instant Audio Test + SOX Certificate */}
      <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-900/95 border border-slate-800 shadow-2xl backdrop-blur-md flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="h-10 w-10 rounded-xl bg-accent-cyan/15 border border-accent-cyan/40 flex items-center justify-center shrink-0 shadow-md">
            <Phone className="h-5 w-5 text-accent-cyan animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
              <span className="font-mono text-xs font-bold text-accent-cyan tracking-wider uppercase">
                CALL-E Autonomous Voice Lab
              </span>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-950 border border-emerald-500/60 text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 mr-1.5 animate-ping" />
                LIVE VOIP RIG
              </span>
              <span className="hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-mono text-cyan-300 bg-cyan-950/60 border border-cyan-800/40">
                🔊 Spoken Telephony Audio Active
              </span>
            </div>
            <h2 className="text-base sm:text-lg font-black text-white tracking-tight pt-0.5">
              Air-Gapped Out-of-Band Telephony Replay Station
            </h2>
          </div>
        </div>

        {/* 3 Benchmark Scenario Switcher Buttons + Audio Test Button + SOX Certificate */}
        <div className="flex flex-wrap items-center gap-2">
          {records &&
            records.map((r) => {
              const isSelected = r.id === selectedRecordId;
              const isFraud = r.id === 'VER-APEX-9942';
              const isHold = r.id === 'VER-MERID-5510';

              return (
                <button
                  key={r.id}
                  onClick={() => onSelectRecord && onSelectRecord(r.id)}
                  className={`px-3.5 py-2 rounded-xl font-mono text-xs font-bold transition-all flex items-center space-x-2 ${
                    isSelected
                      ? isFraud
                        ? 'bg-rose-950/90 border-2 border-rose-500 text-rose-200 ring-2 ring-rose-500/30 shadow-lg shadow-rose-950/40 scale-105'
                        : isHold
                        ? 'bg-amber-950/90 border-2 border-amber-500 text-amber-200 ring-2 ring-amber-500/30 shadow-lg shadow-amber-950/40 scale-105'
                        : 'bg-emerald-950/90 border-2 border-emerald-500 text-emerald-200 ring-2 ring-emerald-500/30 shadow-lg shadow-emerald-950/40 scale-105'
                      : 'bg-slate-950/80 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700 hover:bg-slate-900'
                  }`}
                >
                  <span>
                    {isFraud
                      ? '🚨 Apex BEC Fraud ($785K)'
                      : isHold
                      ? '⚠️ Meridian Gatekeeper ($125K)'
                      : '✅ CyberShield Clean ($240K)'}
                  </span>
                </button>
              );
            })}

          {/* Quick Audio Test Button for Judges */}
          <button
            onClick={handleTestAudio}
            title="Test real spoken voice output"
            className="px-3.5 py-2 rounded-xl text-xs font-mono font-bold bg-cyan-950/90 hover:bg-cyan-900 border-2 border-accent-cyan/60 text-accent-cyan transition-all shadow-md flex items-center space-x-1.5 hover:scale-105"
          >
            <Volume2 className={`h-4 w-4 ${audioTestActive ? 'animate-bounce text-emerald-400' : ''}`} />
            <span>{audioTestActive ? 'Speaking Live...' : '🔊 Test Sound'}</span>
          </button>

          {activeRecord && activeRecord.certificate && onViewCertificate && (
            <button
              onClick={() => onViewCertificate(activeRecord)}
              className="px-3.5 py-2 rounded-xl font-mono text-xs font-bold bg-emerald-950/90 hover:bg-emerald-900 border border-emerald-600 text-emerald-300 transition-all shadow-md flex items-center space-x-1.5 hover:scale-105"
            >
              <FileCheck2 className="h-4 w-4" />
              <span>SOX Certificate</span>
            </button>
          )}

          {/* Real Outbound Carrier Call Button */}
          {onOpenLiveCallModal && (
            <button
              onClick={onOpenLiveCallModal}
              title="Dial your real physical phone using official @call-e/calle SDK"
              className="px-3.5 py-2 rounded-xl font-mono text-xs font-bold bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 border-2 border-rose-400 text-white transition-all shadow-lg shadow-rose-950/60 flex items-center space-x-1.5 hover:scale-105 animate-pulse"
            >
              <Phone className="h-4 w-4 fill-current" />
              <span>🔴 Dial My Real Phone</span>
            </button>
          )}
        </div>
      </div>

      {/* Dual Column Command Station: Flagship Handset Rig (Left) + Forensics & Transcript (Right) */}
      <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-5 xl:gap-7 items-start">
        {/* Left Column: Flagship Physical Phone Handset Rig */}
        <div className="lg:col-span-5 xl:col-span-5 flex justify-center items-center">
          <div className="relative w-full max-w-[440px] h-[540px] bg-slate-950 rounded-[48px] p-4 shadow-[0_20px_60px_-15px_rgba(6,182,212,0.25)] border-4 border-slate-700/80 flex flex-col justify-between overflow-hidden">
            {/* Ambient Handset Glow */}
            <div className="absolute inset-0 bg-gradient-to-b from-cyan-950/20 via-transparent to-indigo-950/20 pointer-events-none" />

            {/* Phone Dynamic Island & Camera */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-5 bg-slate-900 rounded-b-2xl z-20 flex items-center justify-center space-x-2 border-b border-x border-slate-800 shadow-md">
              <div className="h-2 w-2 rounded-full bg-slate-700" />
              <div className="h-2 w-2 rounded-full bg-accent-cyan animate-pulse" />
              <span className="text-[9px] font-mono text-cyan-400/80 font-bold">SECURE PBX</span>
            </div>

            {/* Screen Top Status Bar */}
            <div className="pt-2 px-2 flex items-center justify-between text-xs font-mono text-slate-400 z-10">
              <span className="font-bold text-slate-100 text-sm">{formatTime(callElapsed)}</span>
              <div className="flex items-center space-x-1.5 bg-slate-900/80 px-2.5 py-1 rounded-full border border-slate-800">
                <Radio className="h-3.5 w-3.5 text-accent-cyan animate-pulse" />
                <span className="text-[11px] text-accent-cyan font-bold tracking-wider">
                  CALL-E HD ENCLAVE
                </span>
              </div>
            </div>

            {/* Callee Identity Profile Card */}
            <div className="text-center pt-1 pb-1 z-10 space-y-1">
              <div className="relative h-14 w-14 mx-auto rounded-full bg-gradient-to-tr from-slate-800 via-slate-700 to-slate-600 border-2 border-cyan-500/50 flex items-center justify-center shadow-lg">
                <User className="h-7 w-7 text-cyan-200" />
                {isPlaying && (
                  <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-emerald-500 border-2 border-slate-950 flex items-center justify-center">
                    <span className="h-2 w-2 rounded-full bg-white animate-ping" />
                  </span>
                )}
              </div>
              <h4 className="text-lg sm:text-xl font-black text-white tracking-tight pt-0.5">{officerName}</h4>
              <p className="text-xs text-slate-300 font-mono font-medium">{officerTitle}</p>
              <div className="inline-block">
                <span className="text-xs font-mono font-bold text-accent-cyan bg-slate-900/90 px-3 py-0.5 rounded-full border border-slate-800 flex items-center space-x-1">
                  <Lock className="h-3 w-3 text-accent-cyan mr-1" />
                  <span>{targetPhone}</span>
                </span>
              </div>
            </div>

            {/* Real-Time Spoken Audio Spectrum Equalizer (Animated) */}
            <div className="px-2 py-1 z-10">
              <div className="p-2 rounded-2xl bg-slate-900/95 border border-slate-800 flex flex-col items-center space-y-1.5 shadow-inner">
                <div className="flex items-center justify-center space-x-1 sm:space-x-1.5 h-8 w-full">
                  {[
                    30, 65, 95, 60, 35, 80, 100, 75, 45, 90, 65, 40, 85, 55, 95, 70, 45, 85, 100, 60,
                    35, 75, 90, 50, 80, 40,
                  ].map((height, i) => (
                    <div
                      key={i}
                      style={{
                        height:
                          isPlaying && isSpeakingNow
                            ? `${Math.max(25, (height * (i % 2 === 0 ? 0.9 : 1.15)) % 100)}%`
                            : isPlaying
                            ? '35%'
                            : '18%',
                      }}
                      className={`w-1 sm:w-1.5 rounded-full transition-all duration-300 ${
                        activeTurn?.speaker === 'agent'
                          ? 'bg-gradient-to-t from-accent-cyan via-cyan-300 to-accent-indigo'
                          : 'bg-gradient-to-t from-emerald-500 via-teal-300 to-emerald-200'
                      } ${isPlaying && isSpeakingNow ? 'animate-pulse' : 'opacity-40'}`}
                    />
                  ))}
                </div>

                <div className="flex items-center justify-between w-full text-[10px] font-mono px-2 text-slate-300">
                  <span className="flex items-center space-x-1.5">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        activeTurn?.speaker === 'agent' ? 'bg-accent-indigo shadow-sm shadow-indigo-400' : 'bg-emerald-400 shadow-sm shadow-emerald-400'
                      }`}
                    />
                    <span className="font-bold text-slate-100">
                      {activeTurn?.speaker === 'agent' ? 'CALL-E AI Voice' : `${officerName} (Callee)`}
                    </span>
                  </span>
                  <span className="font-extrabold text-accent-cyan flex items-center space-x-1.5">
                    {isPlaying ? (
                      <>
                        <Volume2 className="h-3.5 w-3.5 animate-pulse text-emerald-400" />
                        <span className={isMuted ? 'text-rose-400' : 'text-emerald-300'}>
                          {isMuted ? 'MUTED' : 'STREAMING AUDIO'}
                        </span>
                      </>
                    ) : (
                      <>
                        <VolumeX className="h-3.5 w-3.5 text-slate-400" />
                        <span className="text-slate-400">READY TO STREAM</span>
                      </>
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Live Spoken Caption Bubble */}
            <div className="px-2 py-0.5 flex-1 flex items-center justify-center z-10">
              <div className="w-full min-h-[68px] p-3 rounded-2xl bg-slate-900/95 border border-slate-800 text-xs text-slate-100 leading-relaxed shadow-inner flex flex-col justify-center">
                <div className="text-[10px] font-mono uppercase text-accent-cyan font-bold tracking-wider mb-1 flex items-center justify-between">
                  <span className="flex items-center space-x-1">
                    <Sparkles className="h-3 w-3 text-accent-cyan mr-1" />
                    <span>Active Telephony Utterance</span>
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[9px]">
                    {activeTurn?.speaker === 'agent' ? 'AI Agent' : 'Corporate Officer'}
                  </span>
                </div>
                <p className="italic font-sans text-xs sm:text-sm font-medium line-clamp-2 text-white">
                  "{activeTurn ? activeTurn.text : 'Call initialized. Click Start Conversation Stream below.'}"
                </p>
              </div>
            </div>

            {/* Audio Hardware Status Bar */}
            <div className="px-3 py-1 z-10 flex items-center justify-between text-[10px] font-mono">
              <span className="text-slate-400 flex items-center space-x-1.5">
                <span className={`h-2 w-2 rounded-full ${isMuted ? 'bg-rose-500' : 'bg-emerald-400 animate-ping'}`} />
                <span className="font-semibold text-slate-300">
                  {isMuted ? 'Muted' : 'Native Browser Web Speech Active'}
                </span>
              </span>
              <span className="text-cyan-400 font-bold bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/40">
                48kHz PCM VoIP
              </span>
            </div>

            {/* Phone Hardware Dial & Audio Playback Controls */}
            <div className="pb-1 px-4 pt-1 z-10 flex items-center justify-around gap-2">
              <button
                onClick={handleToggleMute}
                title={isMuted ? 'Unmute conversation speech' : 'Mute conversation speech'}
                className={`p-3 rounded-full border transition-all flex items-center justify-center ${
                  isMuted
                    ? 'bg-rose-950/90 border-rose-500 text-rose-300 shadow-lg shadow-rose-950/40'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>

              <button
                onClick={handlePlayPause}
                title={isPlaying ? 'Pause conversation' : 'Start / Resume spoken conversation'}
                className={`px-5 py-3 rounded-full font-black text-xs font-mono shadow-2xl transition-all hover:scale-105 flex items-center space-x-2 ${
                  isPlaying
                    ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/40 ring-4 ring-amber-500/20'
                    : 'bg-gradient-to-r from-emerald-400 via-cyan-400 to-indigo-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 shadow-cyan-500/40 ring-4 ring-cyan-500/20'
                }`}
              >
                {isPlaying ? (
                  <>
                    <Pause className="h-5 w-5 fill-current" />
                    <span>PAUSE STREAM</span>
                  </>
                ) : (
                  <>
                    <Play className="h-5 w-5 fill-current ml-0.5" />
                    <span>START CALL STREAM</span>
                  </>
                )}
              </button>

              <button
                onClick={handleReset}
                title="Reset conversation to turn 1"
                className="p-3 rounded-full bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors flex items-center justify-center"
              >
                <RotateCcw className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Forensic Telemetry Deck & Interactive Transcript */}
        <div className="lg:col-span-7 xl:col-span-7 min-h-[540px] flex flex-col justify-between space-y-3 min-w-0">
          {/* Top Row: 4 High-Impact Live Telemetry Matrix Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1 shadow-sm">
              <span className="text-[10px] font-mono uppercase text-slate-400 flex items-center justify-between">
                <span>Cryptographic Token</span>
                <Lock className="h-3.5 w-3.5 text-accent-cyan" />
              </span>
              <span className="font-mono font-black text-sm sm:text-base text-accent-cyan block truncate">
                {challengeToken}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1 shadow-sm">
              <span className="text-[10px] font-mono uppercase text-slate-400 flex items-center justify-between">
                <span>Expected Tax ID</span>
                <Hash className="h-3.5 w-3.5 text-emerald-400" />
              </span>
              <span className="font-mono font-black text-sm sm:text-base text-emerald-400 block">
                EIN ****{expectedTaxId}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1 shadow-sm">
              <span className="text-[10px] font-mono uppercase text-slate-400 flex items-center justify-between">
                <span>Airgap PBX Route</span>
                <Phone className="h-3.5 w-3.5 text-indigo-400" />
              </span>
              <span className="font-mono font-black text-sm sm:text-base text-indigo-300 block truncate">
                {targetPhone}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1 shadow-sm">
              <span className="text-[10px] font-mono uppercase text-slate-400 flex items-center justify-between">
                <span>Model Enclave</span>
                <Cpu className="h-3.5 w-3.5 text-cyan-400" />
              </span>
              <span className="font-mono font-black text-sm sm:text-base text-cyan-300 block truncate">
                CALL-E Live 2.5
              </span>
            </div>
          </div>

          {/* Interactive Spoken Transcript Stream Station */}
          <div className="space-y-2 flex-1 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs font-mono text-slate-300 px-1">
              <span className="font-bold flex items-center space-x-2">
                <span>Conversational Spoken Turns ({transcript.length} turns recorded)</span>
                <span className="text-[10px] text-slate-400 font-normal hidden sm:inline">
                  (Click any turn to hear it spoken)
                </span>
              </span>
              <span className="text-accent-cyan font-bold text-xs flex items-center space-x-1.5">
                {isPlaying ? (
                  <>
                    <Volume2 className="h-3.5 w-3.5 animate-pulse text-emerald-400" />
                    <span className="text-emerald-400">Streaming Voice Output</span>
                  </>
                ) : (
                  <span>Click Play to Stream Audio</span>
                )}
              </span>
            </div>

            <div className="h-[255px] sm:h-[270px] overflow-y-auto space-y-2.5 p-3.5 rounded-2xl bg-slate-950/95 border border-slate-800 shadow-inner custom-scrollbar">
              {transcript.map((turn, idx) => {
                const isActive = idx === currentTurnIndex;
                const isPast = idx < currentTurnIndex;
                const isAgent = turn.speaker === 'agent';
                const isFraudTurn =
                  turn.text.toLowerCase().includes('fraud') ||
                  turn.text.toLowerCase().includes('never') ||
                  turn.text.toLowerCase().includes('hold');
                const isCurrentlyPlayingThis = manualTurnPlaying === idx || (isActive && isPlaying);

                return (
                  <div
                    key={idx}
                    ref={isActive ? transcriptEndRef : null}
                    className={`p-3.5 rounded-xl border text-xs sm:text-sm leading-relaxed transition-all ${
                      isActive
                        ? isFraudTurn
                          ? 'bg-rose-950/70 border-rose-500 ring-2 ring-rose-500/50 shadow-xl shadow-rose-950/40'
                          : 'bg-cyan-950/60 border-accent-cyan ring-2 ring-accent-cyan/50 shadow-xl shadow-cyan-950/40'
                        : isPast
                        ? 'bg-slate-900/60 border-slate-800/80 opacity-90'
                        : 'bg-slate-900/20 border-slate-900 opacity-50'
                    }`}
                  >
                    <div className="flex items-center justify-between font-mono text-xs mb-1.5">
                      <span className="flex items-center space-x-2">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            isAgent
                              ? 'bg-accent-indigo shadow-sm shadow-indigo-500'
                              : isFraudTurn
                              ? 'bg-rose-400 shadow-sm shadow-rose-500'
                              : 'bg-accent-emerald shadow-sm shadow-emerald-500'
                          }`}
                        />
                        <strong
                          className={
                            isAgent
                              ? 'text-indigo-300 font-bold'
                              : isFraudTurn
                              ? 'text-rose-300 font-bold'
                              : 'text-emerald-300 font-bold'
                          }
                        >
                          {isAgent ? 'CALL-E AI Autonomous Agent' : `${officerName} (Controller)`}
                        </strong>
                      </span>

                      <div className="flex items-center space-x-2 text-slate-400">
                        <span className="font-mono text-[11px] font-bold">
                          +{Math.round(turn.timestampOffsetMs / 1000)}s
                        </span>

                        {/* Interactive Click-to-Speak button on each turn */}
                        <button
                          onClick={() => handleSpeakSingleTurn(idx)}
                          title="Click to speak this turn aloud"
                          className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold border transition-colors flex items-center space-x-1 ${
                            isCurrentlyPlayingThis
                              ? 'bg-cyan-950 border-accent-cyan text-accent-cyan animate-pulse'
                              : 'bg-slate-800/80 hover:bg-slate-700 border-slate-700 text-slate-300 hover:text-white'
                          }`}
                        >
                          <Volume2 className="h-3 w-3" />
                          <span>{isCurrentlyPlayingThis ? 'SPEAKING' : 'PLAY TURN'}</span>
                        </button>
                      </div>
                    </div>

                    <p
                      className={`font-sans ${
                        isActive ? 'text-white font-semibold text-sm' : 'text-slate-200 text-xs sm:text-sm'
                      }`}
                    >
                      "{turn.text}"
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Telephony Stream Completion Progress Bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-mono text-slate-300">
              <span className="flex items-center space-x-2">
                <span className="font-bold">Audio Stream Progression</span>
                <span className="text-slate-500">
                  (Turn {currentTurnIndex + 1} of {transcript.length})
                </span>
              </span>
              <span className="font-bold text-accent-cyan">
                {Math.round(((currentTurnIndex + 1) / transcript.length) * 100)}% Complete
              </span>
            </div>

            <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden shadow-inner">
              <div
                style={{
                  width: `${((currentTurnIndex + 1) / transcript.length) * 100}%`,
                }}
                className="bg-gradient-to-r from-accent-cyan via-accent-indigo to-accent-emerald h-full transition-all duration-500 rounded-full"
              />
            </div>
          </div>

          {/* Reconciled Security Verdict Banner */}
          <div
            className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xl ${
              disposition === 'CONFIRMED_VALID'
                ? 'bg-emerald-950/60 border-emerald-500/70 text-emerald-300 shadow-emerald-950/30'
                : disposition === 'FRAUD_INTERCEPTED'
                ? 'bg-rose-950/70 border-rose-500/80 text-rose-300 shadow-rose-950/40'
                : 'bg-amber-950/60 border-amber-500/70 text-amber-300 shadow-amber-950/30'
            }`}
          >
            <div className="flex items-center space-x-3">
              {disposition === 'CONFIRMED_VALID' ? (
                <div className="h-10 w-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0">
                  <ShieldCheck className="h-6 w-6 text-emerald-400" />
                </div>
              ) : disposition === 'FRAUD_INTERCEPTED' ? (
                <div className="h-10 w-10 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center shrink-0">
                  <ShieldAlert className="h-6 w-6 text-rose-400" />
                </div>
              ) : (
                <div className="h-10 w-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
                  <AlertTriangle className="h-6 w-6 text-amber-400" />
                </div>
              )}
              <div>
                <span className="text-[10px] font-mono uppercase block text-slate-400 font-bold">
                  SOX 404 Cryptographic Decision
                </span>
                <span className="font-mono font-black text-sm sm:text-base tracking-wide text-white">
                  {disposition}
                </span>
                <span className="text-xs font-mono text-slate-300 block">
                  {disposition === 'FRAUD_INTERCEPTED'
                    ? 'Unauthorized bank modification detected • Wire release halted • Zero capital lost'
                    : disposition === 'CONFIRMED_VALID'
                    ? 'Dual-factor airgap voice verified • Cryptographic certificate sealed'
                    : 'Suspicious gatekeeper response • Multi-officer escalation active'}
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              <span className="text-xs font-mono font-bold px-3 py-1.5 rounded-xl bg-black/60 border border-slate-800 text-slate-200">
                {currentTurnIndex >= transcript.length - 1
                  ? 'CALL CONCLUDED'
                  : isPlaying
                  ? 'STREAMING AUDIO'
                  : 'PAUSED'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
