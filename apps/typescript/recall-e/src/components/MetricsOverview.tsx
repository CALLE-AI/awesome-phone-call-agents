import React from 'react';
import { PhoneCall, AlertTriangle, TrendingUp, Clock } from 'lucide-react';
import { FacilityStats } from '../types';

interface MetricsOverviewProps {
  stats: FacilityStats;
  onFilterFlagged: () => void;
  onOpenEconomics: () => void;
}

export const MetricsOverview: React.FC<MetricsOverviewProps> = ({
  stats,
  onFilterFlagged,
  onOpenEconomics,
}) => {
  const estimatedSavings = stats.staffHoursSavedMonth * stats.caregiverHourlyRate;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">

      {/* 1. Today's Sessions */}
      <div className="h-full">
        <div className="bg-white rounded-xl border border-t-4 border-t-sky-500 border-slate-200/80 p-3.5 shadow-2xs hover:border-slate-300 transition h-full flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate">CALL-E Calls Today</span>
              <span className="w-6 h-6 rounded-full bg-sky-50 border border-sky-200 flex items-center justify-center shrink-0">
                <PhoneCall className="w-3 h-3 text-sky-600" />
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl sm:text-2xl font-bold text-slate-900">{stats.completedToday}</span>
              <span className="text-xs text-slate-400 font-medium">/ {stats.scheduledToday} scheduled</span>
            </div>
          </div>
          <div className="text-[11px] text-slate-400 mt-1 truncate">
            &nbsp;
          </div>
        </div>
      </div>

      {/* 2. Mood Uplift Rate */}
      <div className="h-full">
        <div className="bg-white rounded-xl border border-t-4 border-t-emerald-500 border-slate-200/80 p-3.5 shadow-2xs hover:border-slate-300 transition h-full flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate">Validation Mood Uplift</span>
              <span className="w-6 h-6 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
                <TrendingUp className="w-3 h-3 text-emerald-600" />
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl sm:text-2xl font-bold text-slate-900">{stats.averageUpliftPercent}%</span>
              <span className="text-xs text-emerald-600 font-medium">calmed / joyful</span>
            </div>
          </div>
          <div className="text-[11px] text-slate-400 mt-1 truncate">
            &nbsp;
          </div>
        </div>
      </div>

      {/* 3. In-Person Attention Flags */}
      <div className="h-full">
        <div
          onClick={onFilterFlagged}
          className={`rounded-xl border border-t-4 p-3.5 shadow-2xs transition cursor-pointer h-full flex flex-col justify-between ${
            stats.flaggedForAttention > 0
              ? 'bg-rose-50/70 border-t-rose-500 border-rose-200 hover:border-rose-300'
              : 'bg-white border-t-rose-500 border-slate-200 hover:border-slate-300'
          }`}
          title="Filter calls needing staff attention"
        >
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${stats.flaggedForAttention > 0 ? 'text-rose-800' : 'text-slate-500'}`}>
                Care Flags
              </span>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border ${stats.flaggedForAttention > 0 ? 'bg-rose-100 border-rose-300' : 'bg-rose-50 border-rose-200'}`}>
                <AlertTriangle className={`w-3 h-3 ${stats.flaggedForAttention > 0 ? 'text-rose-600' : 'text-rose-400'}`} />
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className={`text-xl sm:text-2xl font-bold ${stats.flaggedForAttention > 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                {stats.flaggedForAttention}
              </span>
              <span className="text-xs text-rose-600 font-medium">residents to check</span>
            </div>
          </div>
          <div className="text-[11px] text-rose-700 font-semibold mt-1 flex items-center justify-between">
            <span>Review shift notes</span>
            <span>&rarr;</span>
          </div>
        </div>
      </div>

      {/* 4. Staff Labor Hours Replaced */}
      <div className="h-full">
        <div
          onClick={onOpenEconomics}
          className="bg-white rounded-xl border border-t-4 border-t-teal-600 border-slate-200/80 p-3.5 shadow-2xs hover:border-teal-300 transition cursor-pointer h-full flex flex-col justify-between"
          title="Open interactive Facility ROI & Subscription model"
        >
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate">Staff Hours Replaced</span>
              <span className="w-6 h-6 rounded-full bg-teal-50 border border-teal-200 flex items-center justify-center shrink-0">
                <Clock className="w-3 h-3 text-teal-600" />
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl sm:text-2xl font-bold text-slate-900">{stats.staffHoursSavedMonth} hrs</span>
              <span className="text-xs text-emerald-700 font-medium">${estimatedSavings.toLocaleString()} saved</span>
            </div>
          </div>
          <div className="text-[11px] text-teal-700 font-semibold mt-1 flex items-center justify-between">
            <span>$59/bed/mo model</span>
            <span>&rarr;</span>
          </div>
        </div>
      </div>

    </div>
  );
};