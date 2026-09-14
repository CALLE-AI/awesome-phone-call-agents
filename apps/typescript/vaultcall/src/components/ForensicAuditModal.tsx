'use client';

import React, { useState } from 'react';
import { VerificationRecord } from '@/lib/types';
import { ScopeDiffViewer } from './ScopeDiffViewer';
import { TranscriptReel } from './TranscriptReel';
import {
  X,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Play,
  RotateCcw,
  FileText,
  PhoneCall,
  Terminal,
} from 'lucide-react';

interface ForensicAuditModalProps {
  record: VerificationRecord;
  onClose: () => void;
  onDispatch: (id: string, scenario?: string) => Promise<void>;
  onViewCertificate: (record: VerificationRecord) => void;
}

export const ForensicAuditModal: React.FC<ForensicAuditModalProps> = ({
  record,
  onClose,
  onDispatch,
  onViewCertificate,
}) => {
  const [running, setRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<'matrix' | 'transcript' | 'prompt'>('matrix');

  const handleDispatchScenario = async (scenario: string) => {
    setRunning(true);
    try {
      await onDispatch(record.id, scenario);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl max-h-[92vh] bg-slate-950 border border-panel-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-panel-border bg-slate-900/60 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-accent-cyan/10 text-accent-cyan font-mono text-sm font-bold">
              {record.id}
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center space-x-2">
                <span>{record.vendor.name}</span>
                <span className="text-xs font-mono text-slate-400 font-normal">
                  (EIN: ****{record.vendor.taxEinLast4})
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Out-of-Band Security Forensic Audit & Transcript Verification
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {record.certificate ? (
              <button
                onClick={() => onViewCertificate(record)}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium bg-emerald-950/70 border border-emerald-700/60 text-emerald-300 hover:bg-emerald-900 transition-colors"
              >
                <FileText className="h-3.5 w-3.5" />
                <span>View Certificate</span>
              </button>
            ) : null}

            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Action Toolbar for Judges & Operators */}
        <div className="px-6 py-2.5 bg-slate-900/40 border-b border-panel-border flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center space-x-2">
            <span className="font-mono text-slate-400 text-[11px] uppercase tracking-wider">
              Judge Simulation Triggers:
            </span>
            <button
              disabled={running}
              onClick={() => handleDispatchScenario('CONFIRM_VALID')}
              className="px-2.5 py-1 rounded bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-800/60 text-emerald-300 font-mono text-[11px] transition-colors"
            >
              Test Clean Approval
            </button>
            <button
              disabled={running}
              onClick={() => handleDispatchScenario('SIMULATE_FRAUD')}
              className="px-2.5 py-1 rounded bg-rose-950/60 hover:bg-rose-900/80 border border-rose-800/60 text-rose-300 font-mono text-[11px] transition-colors"
            >
              Test Fraud Caught
            </button>
            <button
              disabled={running}
              onClick={() => handleDispatchScenario('SIMULATE_GATEKEEPER')}
              className="px-2.5 py-1 rounded bg-amber-950/60 hover:bg-amber-900/80 border border-amber-800/60 text-amber-300 font-mono text-[11px] transition-colors"
            >
              Test Gatekeeper Hold
            </button>
          </div>

          <div className="flex items-center space-x-1 border border-panel-border rounded-lg p-0.5 bg-background">
            <button
              onClick={() => setActiveTab('matrix')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                activeTab === 'matrix' ? 'bg-panel-hover text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Scope Matrix
            </button>
            <button
              onClick={() => setActiveTab('transcript')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                activeTab === 'transcript' ? 'bg-panel-hover text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Audio Transcript ({record.transcript.length})
            </button>
            <button
              onClick={() => setActiveTab('prompt')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                activeTab === 'prompt' ? 'bg-panel-hover text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              CALL-E Prompt Spec
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {activeTab === 'matrix' ? (
            <ScopeDiffViewer record={record} />
          ) : activeTab === 'transcript' ? (
            <TranscriptReel
              transcript={record.transcript}
              durationSeconds={record.callDurationSeconds}
            />
          ) : (
            <div className="p-4 rounded-xl bg-slate-900 border border-panel-border font-mono text-xs space-y-4">
              <div>
                <span className="text-slate-400 block text-[11px] uppercase tracking-wider mb-1">
                  CALL-E Task System Prompt
                </span>
                <pre className="p-3 bg-black/60 rounded-lg text-slate-300 whitespace-pre-wrap font-sans text-xs leading-relaxed border border-slate-800">
                  {`You are an automated security agent calling on behalf of Enterprise Accounts Payable & Treasury.
Calling ${record.vendor.name} at verified PBX ${record.vendor.verifiedPbxPhone}.
Challenge Token: ${record.airgapResult.challengeToken}
Expected Tax ID: ****${record.vendor.taxEinLast4}
Requested Bank: ${record.request.newBankName} (Exposure: $${record.request.totalExposureAmountUsd.toLocaleString()})`}
                </pre>
              </div>

              <div>
                <span className="text-slate-400 block text-[11px] uppercase tracking-wider mb-1">
                  Strict Result Extraction Schema
                </span>
                <pre className="p-3 bg-black/60 rounded-lg text-accent-cyan whitespace-pre-wrap text-[11px] border border-slate-800">
                  {JSON.stringify(
                    {
                      spoke_with_authorized_officer: 'boolean',
                      officer_name_stated: 'string',
                      ein_last4_matched: 'boolean',
                      verbal_bank_change_status: ['CONFIRMED_VALID', 'FRAUD_REJECTED', 'UNKNOWN_NO_RECORD', 'CALL_BACK_REQUESTED'],
                      challenge_token_acknowledged: 'boolean',
                      direct_quote_reason: 'string',
                      confidence_score: 'number (0.0-1.0)',
                    },
                    null,
                    2
                  )}
                </pre>
              </div>
            </div>
          )}

          {/* Audit Trail Notes */}
          <div className="p-4 rounded-xl bg-panel border border-panel-border space-y-2">
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-300 block">
              Forensic Audit Log
            </span>
            <div className="space-y-1.5 text-xs font-mono">
              {record.auditNotes.map((note, i) => (
                <div key={i} className="flex items-start space-x-2 text-slate-300">
                  <span className="text-accent-cyan">▸</span>
                  <span>{note}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
