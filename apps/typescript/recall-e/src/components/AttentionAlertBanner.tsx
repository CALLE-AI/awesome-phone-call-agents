import React, { useState } from 'react';
import { AlertCircle, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
import { CallLog } from '../types';

interface AttentionAlertBannerProps {
  flaggedCalls: CallLog[];
  onSelectCall: (call: CallLog) => void;
}

export const AttentionAlertBanner: React.FC<AttentionAlertBannerProps> = ({
  flaggedCalls,
  onSelectCall,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (flaggedCalls.length === 0) return null;

  return (
    <div className="mb-5 bg-rose-50/90 border border-rose-200/90 rounded-xl p-3 sm:p-3.5 shadow-2xs transition">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        
        {/* Left: Compact alert title & resident summary */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
            <AlertCircle className="w-4 h-4" />
          </div>
          <div className="truncate">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-rose-950">
                Staff Check-In Recommended ({flaggedCalls.length} Resident{flaggedCalls.length > 1 ? 's' : ''})
              </span>
              <span className="text-[11px] text-rose-700 hidden md:inline">
                • CALL-E de-escalated successfully; in-person visit suggested
              </span>
            </div>
          </div>
        </div>

        {/* Right: Quick action buttons for the flagged residents */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0">
          {flaggedCalls.slice(0, 2).map((call) => (
            <button
              key={call.id}
              onClick={() => onSelectCall(call)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-white hover:bg-rose-100/50 text-rose-900 border border-rose-200 rounded-lg text-xs font-semibold transition cursor-pointer"
            >
              <span>{call.residentName} (Rm {call.roomNumber})</span>
              <ChevronRight className="w-3 h-3 text-rose-600" />
            </button>
          ))}

          {flaggedCalls.length > 2 && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-xs font-bold text-rose-800 hover:text-rose-950 px-1 py-1 flex items-center gap-0.5 cursor-pointer"
            >
              <span>+{flaggedCalls.length - 2} more</span>
              {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
        </div>

      </div>

      {/* Expanded list if user wants to see all flagged */}
      {isExpanded && flaggedCalls.length > 2 && (
        <div className="mt-2.5 pt-2.5 border-t border-rose-200 grid grid-cols-1 sm:grid-cols-3 gap-2">
          {flaggedCalls.slice(2).map((call) => (
            <div
              key={call.id}
              onClick={() => onSelectCall(call)}
              className="flex items-center justify-between p-2 bg-white rounded-lg border border-rose-200 hover:border-rose-300 transition cursor-pointer text-xs"
            >
              <div>
                <span className="font-bold text-slate-900 block">{call.residentName}</span>
                <span className="text-[11px] text-rose-700 truncate block">
                  {call.attentionReason || 'Needs visit'}
                </span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-rose-500 shrink-0" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
