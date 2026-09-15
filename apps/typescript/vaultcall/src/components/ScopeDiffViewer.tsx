'use client';

import React from 'react';
import { VerificationRecord } from '@/lib/types';
import { ShieldCheck, ShieldAlert, AlertTriangle, PhoneOff, CheckCircle2, XCircle } from 'lucide-react';

interface ScopeDiffViewerProps {
  record: VerificationRecord;
}

export const ScopeDiffViewer: React.FC<ScopeDiffViewerProps> = ({ record }) => {
  const { request, vendor, airgapResult, evidenceFields, status } = record;

  const exposureFormatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(request.totalExposureAmountUsd);

  return (
    <div className="bg-panel border border-panel-border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-panel-border bg-slate-900/50 flex items-center justify-between">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-300">
          Airgap Scope & Assertion Matrix
        </h3>
        <span className="text-xs font-mono text-slate-400">
          Challenge: <span className="text-accent-cyan font-bold">{airgapResult.challengeToken}</span>
        </span>
      </div>

      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left Column: Requested vs Permitted Channel Scope */}
        <div className="space-y-4">
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Channel Gating & Anti-Spoofing
          </h4>

          <div className="p-3.5 rounded-lg bg-background border border-panel-border space-y-2.5">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">Incoming Channel:</span>
              <span className="font-mono text-slate-200">{request.incomingChannel}</span>
            </div>

            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">Requested Exposure:</span>
              <span className="font-mono font-bold text-white">{exposureFormatted}</span>
            </div>

            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">Target Bank Update:</span>
              <span className="font-mono text-accent-cyan">{request.newBankName}</span>
            </div>

            {/* If attacker provided a phone number, highlight the Airgap block! */}
            {airgapResult.disallowedPhoneAttempted ? (
              <div className="p-2 rounded border border-rose-800/60 bg-rose-950/40 text-xs flex items-start space-x-2">
                <PhoneOff className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-rose-300 block">Attacker Phone Intercepted</span>
                  <span className="font-mono text-slate-400 text-[11px]">
                    Payload claimed {airgapResult.disallowedPhoneAttempted} —{' '}
                    <span className="text-rose-400 font-bold underline">STRIPPED BY AIRGAP</span>
                  </span>
                </div>
              </div>
            ) : null}

            <div className="flex justify-between items-center text-xs pt-1 border-t border-slate-800">
              <span className="text-slate-400">Dialed Official PBX:</span>
              <span className="font-mono text-emerald-400 font-bold">{airgapResult.targetDialNumber}</span>
            </div>
          </div>
        </div>

        {/* Right Column: Evidence Assertion Breakdown (Strikes through ungrounded claims!) */}
        <div className="space-y-4">
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Verbatim Transcript Evidence Proofs
          </h4>

          <div className="space-y-2">
            {evidenceFields.length === 0 ? (
              <p className="text-xs text-slate-500 italic">Call pending; evidence matrix will populate upon dial.</p>
            ) : (
              evidenceFields.map((field, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-lg border text-xs transition-colors ${
                    field.supported
                      ? 'bg-slate-900/60 border-slate-800'
                      : 'bg-rose-950/20 border-rose-900/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-medium text-slate-300">
                      {field.field}
                    </span>
                    {field.supported ? (
                      <span className="flex items-center space-x-1 text-emerald-400 text-[11px] font-mono">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>GROUNDED</span>
                      </span>
                    ) : (
                      <span className="flex items-center space-x-1 text-rose-400 text-[11px] font-mono">
                        <XCircle className="h-3.5 w-3.5" />
                        <span>UNSUBSTANTIATED</span>
                      </span>
                    )}
                  </div>

                  {/* If unsupported, strike through the claimed value! */}
                  <div className="mt-1 text-[11px]">
                    <span className="text-slate-400">Model claim: </span>
                    <span
                      className={`font-mono font-semibold ${
                        !field.supported
                          ? 'line-through text-rose-400 opacity-75'
                          : 'text-slate-200'
                      }`}
                    >
                      {String(field.claimedValue)}
                    </span>
                  </div>

                  {field.transcriptQuote ? (
                    <div className="mt-1.5 p-1.5 rounded bg-background/80 border border-slate-800/80 font-mono text-[11px] text-slate-300 italic">
                      "{field.transcriptQuote}"
                    </div>
                  ) : (
                    <div className="mt-1 text-[11px] text-rose-400/80 italic">
                      No matching spoken utterance found in callee turns.
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
