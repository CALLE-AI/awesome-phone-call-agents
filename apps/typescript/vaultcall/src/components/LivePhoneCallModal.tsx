'use client';

import React, { useState } from 'react';
import { Phone, Lock, Sparkles, X, AlertTriangle, CheckCircle2, Loader2, ArrowRight } from 'lucide-react';
import { VerificationRecord } from '@/lib/types';

interface LivePhoneCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCallSuccess: (updatedRecord: VerificationRecord) => void;
  activeRecordId?: string;
}

export const LivePhoneCallModal: React.FC<LivePhoneCallModalProps> = ({
  isOpen,
  onClose,
  onCallSuccess,
  activeRecordId = 'VER-APEX-9942',
}) => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [apiKey, setApiKey] = useState('iams_live_hQ7FydZvAS6jD6iOGxNH_7f707aae5687e6c107f35d6a0f5a2ff6e4aa04fbfe5a768b27b6caea48c745e9');
  const [officerName, setOfficerName] = useState('');
  const [scenario, setScenario] = useState<'SIMULATE_FRAUD' | 'CONFIRM_VALID'>('SIMULATE_FRAUD');
  const [language, setLanguage] = useState<'hindi' | 'english'>('hindi');
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  if (!isOpen) return null;

  const handleInitiateCall = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!phoneNumber.trim().startsWith('+')) {
      setErrorMessage('Phone number must start with "+" and include country code (e.g. +91XXXXXXXXXX or +1XXXXXXXXXX).');
      return;
    }

    if (!apiKey.trim()) {
      setErrorMessage('CALL-E API Key is required. Get one at dashboard.heycall-e.com/account/api-keys.');
      return;
    }

    setIsLoading(true);
    setStatusMessage('Connecting to CALL-E PSTN Carrier gateway...');

    try {
      setStatusMessage('Placing outbound call... Watch your physical phone ring!');

      const res = await fetch(`/api/verifications/${activeRecordId}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          useLiveCalle: true,
          apiKeyOverride: apiKey.trim(),
          targetPhoneOverride: phoneNumber.trim(),
          officerNameOverride: officerName.trim(),
          simulationScenario: scenario,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to dispatch call.');
      }

      setStatusMessage('✅ Call completed successfully! Reconciling transcript...');
      setTimeout(() => {
        setIsLoading(false);
        onCallSuccess(data.record);
        onClose();
      }, 1000);
    } catch (err: any) {
      setIsLoading(false);
      setErrorMessage(err.message || 'Call failed.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-lg p-6 rounded-3xl bg-slate-900 border-2 border-cyan-500/40 shadow-2xl shadow-cyan-950/60 text-white space-y-5">
        {/* Close Button */}
        <button
          onClick={onClose}
          disabled={isLoading}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Modal Header */}
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center space-x-1">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-ping" />
              <span>REAL CELLULAR PHONE CALL</span>
            </span>
            <span className="text-xs font-mono text-cyan-400">@call-e/calle SDK</span>
          </div>
          <h3 className="text-xl font-black tracking-tight text-white flex items-center space-x-2">
            <Phone className="h-5 w-5 text-accent-cyan" />
            <span>Dial Your Real Mobile Phone</span>
          </h3>
          <p className="text-xs text-slate-300 leading-relaxed">
            Enter your mobile number and CALL-E API key. CALL-E will dial your physical phone over the telecom network to perform live voice authentication.
          </p>
        </div>

        {errorMessage && (
          <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-500/60 text-rose-200 text-xs flex items-start space-x-2">
            <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold block">Call Error:</span>
              <span>{errorMessage}</span>
            </div>
          </div>
        )}

        {statusMessage && (
          <div className="p-3 rounded-xl bg-cyan-950/80 border border-cyan-500/60 text-cyan-200 text-xs flex items-center space-x-2">
            <Loader2 className="h-4 w-4 text-cyan-400 animate-spin shrink-0" />
            <span className="font-mono">{statusMessage}</span>
          </div>
        )}

        <form onSubmit={handleInitiateCall} className="space-y-4">
          <div>
            <label className="block text-xs font-mono font-bold text-slate-300 mb-1">
              Your Mobile Phone Number (E.164 Format)
            </label>
            <div className="relative">
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+919876543210 or +14155550100"
                required
                disabled={isLoading}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-sm placeholder:text-slate-600 focus:outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan"
              />
              <span className="absolute right-3 top-2.5 text-[10px] font-mono text-slate-500">
                Country Code Required
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono font-bold text-slate-300 mb-1 flex items-center justify-between">
              <span>CALL-E API Key</span>
              <a
                href="https://dashboard.heycall-e.com/account/api-keys"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-accent-cyan hover:underline font-mono"
              >
                Get API Key ↗
              </a>
            </label>
            <div className="relative">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="calle_sk_..."
                required
                disabled={isLoading}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-sm placeholder:text-slate-600 focus:outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-mono font-bold text-slate-300 mb-1">
                Your Officer Name
              </label>
              <input
                type="text"
                value={officerName}
                onChange={(e) => setOfficerName(e.target.value)}
                placeholder="Corporate Controller"
                disabled={isLoading}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-xs placeholder:text-slate-600 focus:outline-none focus:border-accent-cyan"
              />
            </div>

            <div>
              <label className="block text-xs font-mono font-bold text-slate-300 mb-1">
                Language
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as any)}
                disabled={isLoading}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-cyan-300 font-mono text-xs focus:outline-none focus:border-accent-cyan font-bold"
              >
                <option value="hindi">🇮🇳 Hindi / Hinglish</option>
                <option value="english">🇺🇸 English</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-mono font-bold text-slate-300 mb-1">
                Test Wire Scenario
              </label>
              <select
                value={scenario}
                onChange={(e) => setScenario(e.target.value as any)}
                disabled={isLoading}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-accent-cyan"
              >
                <option value="SIMULATE_FRAUD">🚨 BEC Fraud ($785K)</option>
                <option value="CONFIRM_VALID">✅ Clean Wire ($240K)</option>
              </select>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] text-slate-400 space-y-1">
            <span className="font-bold text-slate-200 block">How the call will unfold:</span>
            <p>1. Your phone will ring from CALL-E's telecom carrier.</p>
            <p>2. Answer and hear the AI ask to authenticate the wire under security token <code className="text-cyan-300">Zulu-Echo-342</code>.</p>
            <p>3. State whether you authorized the payment. You can speak naturally!</p>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className={`w-full py-3.5 rounded-xl font-mono text-sm font-black transition-all flex items-center justify-center space-x-2 ${
              isLoading
                ? 'bg-slate-800 text-slate-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-rose-600 via-rose-500 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white shadow-lg shadow-rose-950/60 hover:scale-[1.02]'
            }`}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>DIALING CARRIER... (KEEP PHONE READY)</span>
              </>
            ) : (
              <>
                <Phone className="h-5 w-5 animate-pulse" />
                <span>DIAL MY REAL PHONE NOW</span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
