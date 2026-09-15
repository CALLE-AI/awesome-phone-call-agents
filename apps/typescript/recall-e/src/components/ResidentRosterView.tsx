import React, { useState } from 'react';
import {
  Search,
  Phone,
  Edit3,
  Plus,
  Heart,
  Briefcase
} from 'lucide-react';
import { ResidentProfile } from '../types';

interface ResidentRosterViewProps {
  residents: ResidentProfile[];
  onSelectResident: (resident: ResidentProfile) => void;
  onTriggerCall: (resident: ResidentProfile) => void;
  onOpenNewResident: () => void;
  onOpenFamilyLedger?: (resident: ResidentProfile) => void;
}

const STAGE_STYLES: Record<string, { border: string; dot: string; text: string }> = {
  'Mild Cognitive Impairment': { border: 'border-l-sky-500', dot: 'bg-sky-500', text: 'text-sky-800' },
  'Early-Stage Dementia': { border: 'border-l-amber-500', dot: 'bg-amber-500', text: 'text-amber-800' },
  'Moderate Memory Care': { border: 'border-l-teal-600', dot: 'bg-teal-600', text: 'text-teal-800' },
  'Advanced Validation Stage': { border: 'border-l-violet-500', dot: 'bg-violet-500', text: 'text-violet-800' },
};
const DEFAULT_STAGE_STYLE = { border: 'border-l-slate-300', dot: 'bg-slate-400', text: 'text-slate-700' };

export const ResidentRosterView: React.FC<ResidentRosterViewProps> = ({
  residents,
  onSelectResident,
  onTriggerCall,
  onOpenNewResident,
  onOpenFamilyLedger,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [stageFilter, setStageFilter] = useState('all');

  const filteredResidents = residents.filter((r) => {
    const matchesSearch =
      r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.preferredName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.roomNumber.includes(searchTerm) ||
      r.firstLanguage.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.reminiscenceTopic.toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;
    if (stageFilter !== 'all' && r.dementiaStage !== stageFilter) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      
      {/* Controls Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search residents, language, career, room..."
            className="w-full text-xs sm:text-sm pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-teal-600 focus:bg-white transition"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 font-medium focus:outline-hidden focus:ring-2 focus:ring-teal-600"
          >
            <option value="all">All Dementia Stages</option>
            <option value="Mild Cognitive Impairment">Mild Cognitive Impairment</option>
            <option value="Early-Stage Dementia">Early-Stage Dementia</option>
            <option value="Moderate Memory Care">Moderate Memory Care</option>
            <option value="Advanced Validation Stage">Advanced Validation Stage</option>
          </select>

          <button
            onClick={onOpenNewResident}
            className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold px-3.5 py-2 rounded-lg transition cursor-pointer shadow-2xs"
          >
            <Plus className="w-4 h-4" />
            <span>Add Resident</span>
          </button>
        </div>
      </div>

      {/* Grid of Resident Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredResidents.map((resident) => {
          const stageStyle = STAGE_STYLES[resident.dementiaStage] ?? DEFAULT_STAGE_STYLE;
          return (
          <div key={resident.id} className="h-full">
            <div className={`bg-white rounded-xl border border-l-4 ${stageStyle.border} border-slate-200 p-4.5 shadow-2xs hover:shadow-md transition flex flex-col justify-between h-full`}>
              <div>
                {/* Header: Name, Room & Language Flag */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-200 text-teal-800 font-bold flex items-center justify-center text-sm">
                      {resident.name[0]}
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                        <span>{resident.name}</span>
                        {resident.preferredName && resident.preferredName !== resident.name && (
                          <span className="text-xs font-normal text-slate-500">
                            ("{resident.preferredName}")
                          </span>
                        )}
                      </h3>
                      <div className="text-xs text-slate-500 flex items-center gap-1.5 flex-wrap">
                        <span>Room {resident.roomNumber}</span>
                        {resident.roomExtension && (
                          <span className="font-mono font-bold text-teal-800 bg-teal-50 px-1.5 py-0.2 rounded border border-teal-200">
                            {resident.roomExtension}
                          </span>
                        )}
                        <span>•</span>
                        <span>{resident.wing}</span>
                        {resident.ehrPatientId && (
                          <span className="text-[10px] font-mono text-slate-600 bg-slate-100 px-1.5 py-0.2 rounded border border-slate-200">
                            MRN {resident.ehrPatientId}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 bg-slate-100 px-2 py-1 rounded-md text-xs font-semibold text-slate-700">
                    <span>{resident.languageFlag}</span>
                    <span>{resident.firstLanguage}</span>
                  </div>
                </div>

                {/* Dementia Stage & Reminiscence Cadence */}
                <div className="flex items-center justify-between text-[11px] text-slate-500 mb-3 bg-slate-50 p-2 rounded-lg border border-slate-100">
                  <span className={`font-semibold flex items-center gap-1.5 ${stageStyle.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${stageStyle.dot}`} />
                    {resident.dementiaStage}
                  </span>
                  <span>{resident.preferredCallTime} ({resident.scheduledFrequency})</span>
                </div>

                {/* Primary Reminiscence Topic */}
                <div className="mb-3">
                  <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1 flex items-center gap-1">
                    <Briefcase className="w-3.5 h-3.5 text-teal-700" />
                    <span>Primary Reminiscence Topic</span>
                  </div>
                  <p className="text-xs text-slate-800 font-medium bg-teal-50/50 p-2 rounded border border-teal-100">
                    {resident.reminiscenceTopic}
                  </p>
                </div>

                {/* Known Anxiety Triggers & Redirection Guide */}
                <div className="space-y-1.5 mb-3 text-xs">
                  {resident.bannedSensitiveTopics && resident.bannedSensitiveTopics.length > 0 && (
                    <div className="bg-rose-50 p-1.5 rounded border border-rose-200 text-[10px] text-rose-900 font-medium">
                      <strong>Banned Trigger:</strong> {resident.bannedSensitiveTopics[0]}
                    </div>
                  )}

                  <div>
                    <span className="text-[11px] font-semibold text-slate-500">Validation & Redirection Anchor:</span>
                    <p className="text-[11px] text-slate-700 italic mt-0.5 bg-slate-50 p-1.5 rounded border border-slate-200">
                      "{resident.redirectionStrategy}"
                    </p>
                  </div>
                </div>
              </div>

              {/* Bottom Actions */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                <div className="text-[11px] text-slate-500">
                  <strong className="text-slate-800">{resident.totalCallsCompleted}</strong> calls logged
                </div>

                <div className="flex items-center gap-1.5">
                  {onOpenFamilyLedger && (
                    <button
                      type="button"
                      onClick={() => onOpenFamilyLedger(resident)}
                      className="px-2 py-1.5 rounded-lg text-teal-700 hover:bg-teal-50 border border-teal-200 font-semibold transition cursor-pointer flex items-center gap-1 text-[11px]"
                      title="Open Family Anchor Ledger"
                    >
                      <Heart className="w-3 h-3 text-teal-600" />
                      <span>Family Ledger</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onSelectResident(resident)}
                    className="px-2 py-1.5 rounded-lg text-slate-600 hover:bg-slate-100 font-medium transition cursor-pointer flex items-center gap-1 text-[11px]"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>Profile</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onTriggerCall(resident)}
                    className="px-2.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold transition cursor-pointer flex items-center gap-1 text-[11px] shadow-2xs"
                  >
                    <Phone className="w-3 h-3" />
                    <span>Call</span>
                  </button>
                </div>
              </div>

            </div>
          </div>
          );
        })}
      </div>

    </div>
  );
};
