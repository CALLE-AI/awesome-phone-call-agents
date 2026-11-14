import React from 'react';
import {
  PhoneCall,
  FileSpreadsheet,
  Building2,
  Clock,
} from 'lucide-react';
import { VerificationTask } from '../types/index.js';
import { ExtractedFact } from './ExtractedFact.js';
import { ReconciliationPanel } from './ReconciliationPanel.js';
import { StatusBadge } from './StatusBadge.js';
import { Button } from './ui/Button.js';
import { api } from '../services/api.js';

interface LiveCallInspectorProps {
  task: VerificationTask | null;
  onVerify: (taskId: string) => void;
  isVerifying: boolean;
}

export const LiveCallInspector: React.FC<LiveCallInspectorProps> = ({
  task,
  onVerify,
  isVerifying,
}) => {
  if (!task) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center flex flex-col items-center justify-center h-full text-slate-400 shadow-xs">
        <Building2 className="w-10 h-10 text-slate-400 mb-3" />
        <h3 className="font-semibold text-slate-900 text-sm">No Task Selected</h3>
        <p className="text-xs text-slate-500 mt-1 max-w-xs">
          Select a task from the list or click "+ New Verification" to begin.
        </p>
      </div>
    );
  }

  const isActive =
    isVerifying ||
    task.callState === 'IN_PROGRESS' ||
    task.callState === 'QUEUED' ||
    task.callState === 'CALLING';

  const isCompleted =
    task.callState === 'COMPLETED' ||
    task.callState === 'FAILED' ||
    task.callState === 'CANCELED';

  return (
    <div className="space-y-4">
      {/* 1. Active Call Status Block (During Active Call) */}
      {isActive && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Call Status
            </span>
            <StatusBadge type="call" value={task.callState} size="sm" />
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-slate-500">Dialing Number:</span>
              <span className="font-mono text-slate-900 font-semibold">{task.target.phoneNumber}</span>
            </div>
            {task.callRecord?.durationSeconds !== undefined && (
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Duration:</span>
                <span className="font-mono text-blue-600 font-semibold flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {task.callRecord.durationSeconds}s
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. Completed Verification Results (After Call Finishes) */}
      {isCompleted && (
        <>
          {/* Main Reconciliation / Result Box */}
          <ReconciliationPanel
            digitalClaim={task.digitalClaim}
            structuredResult={task.structuredResult || task.callRecord?.structuredResult || null}
            reconciliation={task.reconciliation || null}
            reviewStatus={task.reviewStatus}
          />

          {/* Key Verified Facts (Compact Rows) */}
          <ExtractedFact
            structuredResult={task.structuredResult || task.callRecord?.structuredResult || null}
            questions={task.questions}
          />
        </>
      )}

      {/* 3. Action Toolbar (Excel Download & Re-Verify) */}
      <div className="flex items-center gap-2 pt-1">
        {task.callRecord && (
          <a
            href={api.exportTaskExcelUrl(task.id)}
            download
            className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-xs"
            title="Download full Excel audit report"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            Download Excel Report
          </a>
        )}

        {task.callState === 'IDLE' && (
          <Button
            size="sm"
            onClick={() => onVerify(task.id)}
            disabled={isActive}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs h-9 shadow-xs"
          >
            <PhoneCall className="w-3.5 h-3.5 mr-1.5" />
            {isActive ? 'Verifying...' : 'Trigger Verification Call'}
          </Button>
        )}
      </div>
    </div>
  );
};
