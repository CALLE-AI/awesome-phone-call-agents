import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  PhoneCall,
  PhoneOff,
  Radio,
  Bot,
  UserCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  ShieldAlert,
  Volume2,
  Heart,
  Sparkles,
  PhoneForwarded,
} from 'lucide-react';
import { EmergencyReport, Responder } from '../types';
import { EmergencyDispatchService } from '../services/emergencyService';

interface CallInterfaceProps {
  report: Partial<EmergencyReport>;
  activeResponder: Responder;
  responderIndex: number;
  totalResponders: number;
  onResponderAccepted: (responder: Responder) => void;
  onResponderRejected: (responder: Responder) => void;
}

type CallPhase = 'initiating' | 'connected' | 'rejected_escalating';

export const CallInterface: React.FC<CallInterfaceProps> = ({
  report,
  activeResponder,
  responderIndex,
  totalResponders,
  onResponderAccepted,
  onResponderRejected,
}) => {
  const [callPhase, setCallPhase] = useState<CallPhase>('initiating');
  const [callDuration, setCallDuration] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState<string | null>(null);
  const [liveNotes, setLiveNotes] = useState<string | null>(null);

  // Generate automated AI dialogue prompt
  const aiDialogueText = EmergencyDispatchService.generateAiVoicePrompt(report, activeResponder);

  // Reset phase when responder changes (e.g. on escalation)
  useEffect(() => {
    setCallPhase('initiating');
    setCallDuration(0);
    setLiveTranscript(null);
    setLiveNotes(null);

    const connectTimer = setTimeout(() => {
      setCallPhase('connected');
    }, 2000);

    return () => clearTimeout(connectTimer);
  }, [activeResponder.id]);

  // Call timer counter
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (callPhase === 'connected') {
      interval = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [callPhase]);

  // Real-time backend status polling for CALL-E live responses
  useEffect(() => {
    if (!report.backendRequestId) return;

    let isSubscribed = true;
    const pollInterval = setInterval(async () => {
      if (!isSubscribed) return;
      const data = await EmergencyDispatchService.pollBackendRescueStatus(report.backendRequestId!);
      if (!data || !isSubscribed) return;

      if (data.transcript) {
        setLiveTranscript(data.transcript);
      }
      if (data.callResult?.notes || data.summary) {
        setLiveNotes(data.callResult?.notes || data.summary);
      }

      if (data.status === 'help_confirmed' || data.callResult?.response === 'yes') {
        clearInterval(pollInterval);
        onResponderAccepted(activeResponder);
      } else if (data.status === 'no_responder' || data.callResult?.response === 'no') {
        clearInterval(pollInterval);
        setCallPhase('rejected_escalating');
        setTimeout(() => {
          if (isSubscribed) {
            onResponderRejected(activeResponder);
          }
        }, 1500);
      } else if (data.status === 'unknown_response') {
        setLiveNotes('Response was inconclusive. Continuing emergency dispatch protocol...');
      }
    }, 1800);

    return () => {
      isSubscribed = false;
      clearInterval(pollInterval);
    };
  }, [report.backendRequestId, activeResponder, onResponderAccepted, onResponderRejected]);

  const handleSimulateYes = async () => {
    const result = await EmergencyDispatchService.simulateCall(activeResponder, report, 'accept');
    if (result.accepted) {
      onResponderAccepted(activeResponder);
    }
  };

  const handleSimulateNo = async () => {
    setCallPhase('rejected_escalating');
    await EmergencyDispatchService.simulateCall(activeResponder, report, 'reject');
    setTimeout(() => {
      onResponderRejected(activeResponder);
    }, 1600);
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center max-w-lg mx-auto px-4 py-4 w-full">
      {/* Escalation Queue Status Indicator */}
      <div className="w-full flex items-center justify-between text-xs px-2 mb-3">
        <div className="flex items-center gap-1.5 font-bold text-[#1A1412]">
          <span className="w-2.5 h-2.5 rounded-full bg-[#B83A20] animate-pulse" />
          <span>CALL-E Voice Dispatch Active</span>
        </div>
        <div className="bg-[#EDE3D6] px-3 py-1 rounded-full text-[#1A1412] font-black border border-[#D5C6B5]">
          Responder #{responderIndex + 1} of {totalResponders}
        </div>
      </div>

      {/* Main Calling Display Card */}
      <div className="w-full bg-[#FAF6F0] rounded-3xl shadow-xl border border-[#D5C6B5] overflow-hidden flex flex-col">
        {/* Top Active Call Banner */}
        <div className="p-6 bg-[#1A1412] text-white flex flex-col items-center justify-center relative overflow-hidden text-center">
          {/* Subtle background ring */}
          <div className="absolute -top-12 w-64 h-64 rounded-full border border-white/10 pointer-events-none" />

          {/* Animated Call Waves */}
          <div className="relative mb-4 flex items-center justify-center">
            <div
              className={`w-16 h-16 rounded-full flex items-center justify-center text-white shadow-lg transition-colors z-10 ${
                callPhase === 'initiating'
                  ? 'bg-[#B83A20]'
                  : callPhase === 'connected'
                  ? 'bg-[#1E4334]'
                  : 'bg-[#B45309]'
              }`}
            >
              <PhoneCall className="w-7 h-7" />
            </div>
          </div>

          {/* Call Status Label */}
          <div className="space-y-1 z-10">
            {callPhase === 'initiating' && (
              <>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/10 text-[#FED7AA] text-[11px] font-black border border-white/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#B83A20] animate-ping" />
                  CONNECTING VIA CALL-E
                </div>
                <h3 className="text-xl font-black text-white">Placing Outbound Call...</h3>
                <p className="text-xs text-[#D5C6B5] font-semibold">
                  Target Line: {report.callerPhone || activeResponder.phone}
                </p>
              </>
            )}

            {callPhase === 'connected' && (
              <>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#1E4334] text-[#EAF7EE] text-[11px] font-black border border-[#2B5442]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#48BB78] animate-pulse" />
                  CALL-E LIVE • {formatTimer(callDuration)}
                </div>
                <h3 className="text-xl font-black text-white">AI Voice Dispatch Active</h3>
                <p className="text-xs text-[#E5DACE] font-semibold">
                  Connected with {activeResponder.name}
                </p>
              </>
            )}

            {callPhase === 'rejected_escalating' && (
              <>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#78350F] text-[#FEF3C7] text-[11px] font-black border border-[#B45309]">
                  <AlertTriangle className="w-3 h-3 text-[#FBBF24]" />
                  RESPONDER UNAVAILABLE
                </div>
                <h3 className="text-xl font-black text-white">Escalating to Next Responder...</h3>
                <p className="text-xs text-[#E5DACE] font-semibold">Routing emergency request down queue</p>
              </>
            )}
          </div>
        </div>

        {/* Responder Card Details */}
        <div className="p-4 bg-[#F2EAE0] border-b border-[#D5C6B5] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#FAF6F0] border border-[#D5C6B5] shadow-2xs flex items-center justify-center text-[#B83A20] font-black">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-black text-[#1A1412] text-sm leading-tight">
                {activeResponder.name}
              </h4>
              <p className="text-xs font-semibold text-[#4A3F37]">{activeResponder.typeLabel}</p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-xs font-black text-[#B83A20] bg-[#F7EAE6] px-2.5 py-1 rounded-lg border border-[#EACEC5]">
              {activeResponder.distanceKm} km away
            </span>
            <span className="block text-[11px] text-[#4A3F37] font-bold mt-0.5">
              Rating: ★ {activeResponder.rating || 4.9}
            </span>
          </div>
        </div>

        {/* Live CALL-E AI Voice Conversation Transcript */}
        <div className="p-5 flex-1 space-y-4">
          <div className="flex items-center justify-between text-xs font-black text-[#1A1412] uppercase tracking-wider">
            <span className="flex items-center gap-1.5">
              <Bot className="w-4 h-4 text-[#B83A20]" />
              CALL-E AI Voice Task Prompt
            </span>
            {callPhase === 'connected' && (
              <span className="flex items-center gap-1 text-[#1E4334] lowercase font-bold">
                <Volume2 className="w-3.5 h-3.5 animate-pulse" />
                voice synthesis
              </span>
            )}
          </div>

          {/* Message Bubble */}
          <div className="p-4 rounded-2xl bg-[#EDE3D6] border border-[#D5C6B5] text-[#1A1412] text-sm leading-relaxed space-y-2">
            <div className="flex items-center justify-between font-black text-xs text-[#B83A20] uppercase tracking-wide">
              <span>PAWCALL AI DISPATCH</span>
              {report.backendRequestId && (
                <span className="text-[10px] text-[#4A3F37] font-mono lowercase">
                  id: {report.backendRequestId}
                </span>
              )}
            </div>
            <p className="text-[#1A1412] text-xs sm:text-sm font-semibold">
              "{aiDialogueText}"
            </p>

            {liveTranscript && (
              <div className="mt-3 pt-2 border-t border-[#D5C6B5]/60">
                <span className="text-[11px] font-black text-[#1E4334] block mb-1">
                  Live Response Audio Stream:
                </span>
                <p className="text-xs text-[#1A1412] italic bg-[#FAF6F0] p-2 rounded-lg border border-[#D5C6B5]">
                  "{liveTranscript}"
                </p>
              </div>
            )}

            {liveNotes && (
              <div className="mt-2 text-xs font-bold text-[#733F0C] bg-[#FAF1E4] p-2 rounded-lg border border-[#E8D4BE]">
                {liveNotes}
              </div>
            )}
          </div>

          {/* Simulation Controls / Live Voice Monitoring Container */}
          <div className="pt-2 border-t border-[#D5C6B5]">
            <div className="text-center mb-3">
              <span className="text-[11px] font-black uppercase tracking-wider text-[#1A1412] block">
                Awaiting Responder Voice Response:
              </span>
              <span className="text-[11px] text-[#4A3F37] font-semibold">
                Answer your phone and say "Yes, I can come" or click below for instant testing
              </span>
            </div>

            {callPhase === 'connected' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Simulated YES Button */}
                <button
                  id="simulate-accept-button"
                  onClick={handleSimulateYes}
                  className="py-3 px-4 rounded-xl bg-[#1E4334] hover:bg-[#153126] text-white font-black text-xs sm:text-sm shadow-md flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4 text-white" />
                  <span>YES, I CAN DISPATCH</span>
                </button>

                {/* Simulated NO Button */}
                <button
                  id="simulate-reject-button"
                  onClick={handleSimulateNo}
                  className="py-3 px-4 rounded-xl bg-[#FAF6F0] hover:bg-[#EAE0D3] text-[#1A1412] font-black text-xs sm:text-sm border-2 border-[#D5C6B5] flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <XCircle className="w-4 h-4 text-[#B83A20]" />
                  <span>NO, BUSY / UNAVAILABLE</span>
                </button>
              </div>
            )}

            {callPhase === 'initiating' && (
              <div className="py-3 text-center text-xs text-[#4A3F37] font-bold">
                Connecting phone line via CALL-E... Please wait.
              </div>
            )}

            {callPhase === 'rejected_escalating' && (
              <div className="p-3 rounded-xl bg-[#FAF1E4] border border-[#E8D4BE] text-center text-xs text-[#733F0C] font-bold">
                Responder #{responderIndex + 1} was unavailable. Moving to next responder in queue...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

