import React from 'react';
import { Clock, CheckCircle2, PhoneCall } from 'lucide-react';
import { ScheduledCallItem } from '../types';

interface ScheduleQueueViewProps {
  schedule: ScheduledCallItem[];
  onTriggerCall: (residentName: string) => void;
}

export const ScheduleQueueView: React.FC<ScheduleQueueViewProps> = ({
  schedule,
  onTriggerCall,
}) => {
  return (
    <div className="space-y-4">
      
      {/* Schedule Header Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-900">
              Autonomous Call Schedule & Dispatch Queue
            </h3>
            <span className="bg-teal-50 text-teal-700 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-teal-200">
              Auto-Pilot Active
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            CALL-E calls residents in their rooms at their scheduled time slots. If a resident does not pick up or is busy with dining, CALL-E automatically retries in 25 minutes.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
          <Clock className="w-4 h-4 text-teal-700" />
          <span>Next Call Batch: <strong>06:45 PM (Sundowning Buffer)</strong></span>
        </div>
      </div>

      {/* Timeline Schedule Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-4">Scheduled Window</th>
                <th className="py-3 px-4">Resident & Room</th>
                <th className="py-3 px-4">Language</th>
                <th className="py-3 px-4">Reminiscence Topic Grounding</th>
                <th className="py-3 px-4">Duration</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {schedule.map((item) => {
                const isCompleted = item.status === 'Completed';
                const isCallingNow = item.status === 'Calling Now';

                return (
                  <tr
                    key={item.id}
                    className={`hover:bg-slate-50/70 transition ${
                      isCallingNow ? 'bg-teal-50/60 font-medium' : ''
                    }`}
                  >
                    <td className="py-3.5 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {item.scheduledTime}
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900 text-xs sm:text-sm">
                        {item.residentName}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Room {item.roomNumber} ({item.wing})
                      </div>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap font-medium text-slate-700">
                      {item.firstLanguage}
                    </td>

                    <td className="py-3.5 px-4 max-w-xs text-slate-700 truncate">
                      {item.topic}
                    </td>

                    <td className="py-3.5 px-4 text-slate-500 whitespace-nowrap font-medium">
                      {item.durationTarget}
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {isCompleted ? (
                        <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 w-fit">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>Completed</span>
                        </span>
                      ) : isCallingNow ? (
                        <span className="bg-teal-100 text-teal-900 border border-teal-300 text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 w-fit animate-pulse">
                          <PhoneCall className="w-3 h-3 text-teal-700" />
                          <span>Calling Now...</span>
                        </span>
                      ) : (
                        <span className="bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1 w-fit">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span>Scheduled</span>
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onTriggerCall(item.residentName)}
                        className="text-xs font-semibold text-teal-700 hover:text-teal-900 bg-teal-50 hover:bg-teal-100 px-2.5 py-1 rounded-md border border-teal-200 transition cursor-pointer"
                      >
                        {isCompleted ? 'Redial Test' : 'Trigger Early'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
