import React, { useState } from 'react';
import {
  Search,
  AlertTriangle,
  PhoneCall,
  Sparkles,
  Info
} from 'lucide-react';
import { CallLog } from '../types';

interface CallLogsViewProps {
  callLogs: CallLog[];
  onSelectCall: (call: CallLog) => void;
  onOpenLiveSimulator: () => void;
}

export const CallLogsView: React.FC<CallLogsViewProps> = ({
  callLogs,
  onSelectCall,
  onOpenLiveSimulator,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'flagged' | 'today' | 'spanish' | 'italian'>('all');

  const filteredLogs = callLogs.filter((log) => {
    const matchesSearch =
      log.residentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.roomNumber.includes(searchTerm) ||
      log.topicGrounding.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.clinicalSummary.toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;

    if (filterMode === 'flagged') return log.needsAttention;
    if (filterMode === 'today') return log.callDateTime.toLowerCase().includes('today') || log.callDateTime.toLowerCase().includes('just now');
    if (filterMode === 'spanish') return log.languageUsed.toLowerCase().includes('span');
    if (filterMode === 'italian') return log.languageUsed.toLowerCase().includes('ital');

    return true;
  });

  const getMoodPill = (call: CallLog) => {
    if (call.needsAttention) {
      return (
        <span className="inline-flex items-center gap-1 bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold px-2.5 py-0.5 rounded-full">
          <AlertTriangle className="w-3 h-3" />
          <span>Needs Check-In</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-800 border border-emerald-200/80 text-xs font-semibold px-2.5 py-0.5 rounded-full">
        <Sparkles className="w-3 h-3 text-emerald-600" />
        <span>{call.moodTag}</span>
      </span>
    );
  };

  return (
    <div className="space-y-3.5">
      
      {/* Clean Search & Filter Controls */}
      <div className="bg-white rounded-xl border border-slate-200/80 p-3 shadow-2xs">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5">
          
          {/* Search Box */}
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search resident, room, topic..."
              className="w-full text-xs pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-teal-600 focus:bg-white transition"
            />
          </div>

          {/* Clean Quick Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-0.5 sm:pb-0 text-xs font-medium">
            <button
              onClick={() => setFilterMode('all')}
              className={`px-3 py-1 rounded-lg whitespace-nowrap transition cursor-pointer ${
                filterMode === 'all'
                  ? 'bg-slate-900 text-white font-semibold'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All Calls ({callLogs.length})
            </button>

            <button
              onClick={() => setFilterMode('flagged')}
              className={`px-3 py-1 rounded-lg whitespace-nowrap transition cursor-pointer flex items-center gap-1 ${
                filterMode === 'flagged'
                  ? 'bg-rose-700 text-white font-semibold'
                  : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200/80'
              }`}
            >
              <AlertTriangle className="w-3 h-3" />
              <span>Flags ({callLogs.filter((c) => c.needsAttention).length})</span>
            </button>

            <button
              onClick={() => setFilterMode('today')}
              className={`px-3 py-1 rounded-lg whitespace-nowrap transition cursor-pointer ${
                filterMode === 'today'
                  ? 'bg-slate-900 text-white font-semibold'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Today
            </button>

            <button
              onClick={() => setFilterMode('spanish')}
              className={`px-3 py-1 rounded-lg whitespace-nowrap transition cursor-pointer ${
                filterMode === 'spanish'
                  ? 'bg-slate-900 text-white font-semibold'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              🇪🇸 Spanish
            </button>

            <button
              onClick={() => setFilterMode('italian')}
              className={`px-3 py-1 rounded-lg whitespace-nowrap transition cursor-pointer ${
                filterMode === 'italian'
                  ? 'bg-slate-900 text-white font-semibold'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              🇮🇹 Italian
            </button>
          </div>

        </div>
      </div>

      {/* Advisory label: mood tags below are AI-generated, not clinical */}
      <div className="flex items-center gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
        <Info className="w-3.5 h-3.5 shrink-0" />
        <span>
          Mood tags are unverified, AI-generated interpretations for staff review, not clinical
          assessments.
        </span>
      </div>

      {/* Clean Call Feed */}
      <div className="space-y-2.5">
        {filteredLogs.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
            <PhoneCall className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <h4 className="text-sm font-bold text-slate-700">No Reminiscence Calls Found</h4>
            <p className="text-xs text-slate-400 mt-0.5 max-w-sm mx-auto">
              Try adjusting your search, or place a call to get started.
            </p>
            <button
              onClick={onOpenLiveSimulator}
              className="mt-3 bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold px-4 py-1.5 rounded-lg transition cursor-pointer"
            >
              Simulate Live Call
            </button>
          </div>
        ) : (
          filteredLogs.map((call) => (
            <div
              key={call.id}
              onClick={() => onSelectCall(call)}
              className="cursor-pointer"
            >
              <div
                className={`bg-white rounded-xl border transition p-4 shadow-2xs hover:shadow-md ${
                  call.needsAttention
                    ? 'border-l-4 border-l-rose-500 border-t-slate-200 border-r-slate-200 border-b-slate-200 hover:border-rose-300'
                    : 'border-l-4 border-l-teal-600 border-t-slate-200 border-r-slate-200 border-b-slate-200 hover:border-teal-400'
                }`}
              >
                {/* Top Row: Resident Identity + Mood Pill */}
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                        call.needsAttention
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-teal-50 text-teal-800'
                      }`}
                    >
                      {call.residentName[0]}
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-slate-500">
                      <span className="font-bold text-sm text-slate-900">
                        {call.residentName}
                      </span>
                      <span>Rm {call.roomNumber}</span>
                      {call.languageUsed !== 'English' && <span>· {call.languageUsed}</span>}
                      <span>· {call.callDateTime} ({call.durationMinutes}m)</span>
                    </div>
                  </div>

                  <div className="shrink-0">
                    {getMoodPill(call)}
                  </div>
                </div>

                {/* Middle Row: Crisp Caregiver Shift Summary */}
                <p className="text-xs sm:text-sm text-slate-700 leading-relaxed line-clamp-2 sm:line-clamp-none">
                  {call.clinicalSummary}
                </p>

                {/* Staff Attention Alert Note if Flagged */}
                {call.needsAttention && call.attentionReason && (
                  <div className="mt-2 text-xs text-rose-800 leading-relaxed">
                    <strong>Needs review:</strong> {call.attentionReason}
                  </div>
                )}

                {/* Bottom Row: Grounding topic + Action */}
                <div className="flex items-center justify-between gap-3 text-[11px] text-slate-500 pt-2.5 mt-2 border-t border-slate-100">
                  <span>{call.topicGrounding}</span>

                  <button
                    type="button"
                    className="text-xs font-semibold text-teal-700 hover:text-teal-900 shrink-0"
                  >
                    View transcript
                  </button>
                </div>

              </div>
            </div>
          ))
        )}
      </div>

    </div>
  );
};
