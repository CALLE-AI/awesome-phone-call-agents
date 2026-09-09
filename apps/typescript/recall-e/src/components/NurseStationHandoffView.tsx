import React, { useState } from 'react';
import {
  CheckCircle2,
  PhoneCall,
  Radio,
  Clock,
  Bell,
  Check,
  AlertTriangle
} from 'lucide-react';
import { ResidentProfile, CallLog, NurseAlert } from '../types';

interface NurseStationHandoffViewProps {
  residents: ResidentProfile[];
  callLogs: CallLog[];
  nurseAlerts: NurseAlert[];
  onAcknowledgeAlert: (alertId: string) => void;
  onSelectCall: (call: CallLog) => void;
  onOpenLiveSimulator: () => void;
  onSelectResident: (resident: ResidentProfile) => void;
}

export const NurseStationHandoffView: React.FC<NurseStationHandoffViewProps> = ({
  residents,
  callLogs,
  nurseAlerts,
  onAcknowledgeAlert,
  onSelectCall,
  onOpenLiveSimulator,
  onSelectResident,
}) => {
  const [selectedWing, setSelectedWing] = useState<'All' | 'Garden Terrace' | 'Heritage Hall' | 'Magnolia Wing'>('All');

  const filteredResidents = residents.filter(
    (r) => selectedWing === 'All' || r.wing === selectedWing
  );

  const pendingAlerts = nurseAlerts.filter((a) => a.status === 'Dispatched');

  return (
    <div className="space-y-5">
      
      {/* Station Banner: 4:00 PM – 7:30 PM Sundowning Shift Change Monitor */}
      <div className="bg-gradient-to-r from-slate-900 via-teal-950 to-slate-900 text-white rounded-2xl p-5 border border-teal-800/60 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="text-xs font-bold bg-amber-400/20 text-amber-300 border border-amber-400/40 px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                Shift Handoff Window: 4:00 PM – 7:30 PM Sundowning Crunch
              </span>
              <span className="text-xs text-teal-300 bg-teal-900/60 border border-teal-700/60 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <Radio className="w-3.5 h-3.5 text-teal-400 animate-pulse" />
                PBX Analog Extensions Active (VoIP ATA Gateway)
              </span>
            </div>
            
            <h2 className="text-xl font-bold text-white tracking-tight">
              Nurse Station Handoff & Room Monitoring Board
            </h2>
            <p className="text-xs text-slate-300 mt-1 max-w-3xl leading-relaxed">
              Real-time bedside landline telephony monitor. While CNAs distribute evening medications and dinner, CALL-E handles autonomous validation calls to soothe restless residents and dispatches instant pager alerts for physical needs.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onOpenLiveSimulator}
              className="bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-md transition cursor-pointer flex items-center gap-1.5 shrink-0"
            >
              <PhoneCall className="w-4 h-4 animate-pulse" />
              <span>Simulate Bedside Ring</span>
            </button>
          </div>
        </div>

        {/* Quick Shift Summary Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-800 text-xs">
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <div className="text-slate-400 text-[11px]">Concurrent Soothing Active</div>
            <div className="text-lg font-bold text-emerald-400">4 Rooms On Call</div>
            <div className="text-[10px] text-slate-400 mt-0.5">Saves ~1.8 CNA shift hours now</div>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <div className="text-slate-400 text-[11px]">Vocera / Ascom Pagers</div>
            <div className="text-lg font-bold text-teal-300">Connected (Port 5060)</div>
            <div className="text-[10px] text-slate-400 mt-0.5">&lt;3 sec dispatch latency</div>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <div className="text-slate-400 text-[11px]">EHR Auto-Charting</div>
            <div className="text-lg font-bold text-white">PointClickCare / MTX</div>
            <div className="text-[10px] text-emerald-400 mt-0.5">100% FHIR sync success</div>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <div className="text-slate-400 text-[11px]">High Priority Attention</div>
            <div className={`text-lg font-bold ${pendingAlerts.length > 0 ? 'text-rose-400' : 'text-slate-200'}`}>
              {pendingAlerts.length} Pager Alerts
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">Requires in-person CNA check</div>
          </div>
        </div>
      </div>

      {/* Active Nurse Pager Dispatches (Vocera / Ascom Alert Strip) */}
      {nurseAlerts.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700 px-1">
            <span className="flex items-center gap-1.5">
              <Bell className="w-4 h-4 text-rose-600 animate-bounce" />
              <span>Active Nurse Call Dispatches (Vocera / Ascom)</span>
            </span>
            <span className="text-slate-500 font-normal">
              Directly routed to on-duty CNA badges
            </span>
          </div>

          <div className="space-y-2">
            {nurseAlerts.map((alert) => (
              <div 
                key={alert.id}
                className="bg-rose-50/90 border border-rose-300 rounded-xl p-3.5 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-rose-600 text-white flex items-center justify-center shrink-0 font-bold text-xs mt-0.5">
                    !
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-rose-950">
                        Room {alert.roomNumber} • {alert.residentName}
                      </span>
                      <span className="text-xs bg-rose-200/80 text-rose-900 font-semibold px-2 py-0.5 rounded-md">
                        {alert.severity}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {alert.timestamp} via {alert.dispatchMethod}
                      </span>
                    </div>
                    <p className="text-xs text-rose-900 mt-1">
                      {alert.triggerReason}
                    </p>
                    {alert.acknowledgedByNurse && (
                      <div className="text-[11px] text-emerald-800 font-medium mt-1 flex items-center gap-1">
                        <Check className="w-3 h-3 text-emerald-600" />
                        <span>Acknowledged: {alert.acknowledgedByNurse}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {alert.status === 'Dispatched' ? (
                    <button
                      onClick={() => onAcknowledgeAlert(alert.id)}
                      className="bg-rose-700 hover:bg-rose-800 text-white font-bold text-xs px-3.5 py-1.5 rounded-lg shadow-2xs transition cursor-pointer flex items-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Acknowledge Visit</span>
                    </button>
                  ) : (
                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-lg">
                      Staff Dispatched
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Wing Filter Tabs */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 bg-slate-200/80 p-1 rounded-xl text-xs font-semibold text-slate-700">
          {(['All', 'Garden Terrace', 'Heritage Hall', 'Magnolia Wing'] as const).map((wing) => (
            <button
              key={wing}
              onClick={() => setSelectedWing(wing)}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                selectedWing === wing
                  ? 'bg-white text-teal-800 shadow-2xs font-bold'
                  : 'hover:text-slate-900'
              }`}
            >
              {wing}
            </button>
          ))}
        </div>

        <div className="text-xs text-slate-500 font-medium">
          Showing {filteredResidents.length} Room Bedside Telephony Extensions
        </div>
      </div>

      {/* Room Bedside Handset Status Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {filteredResidents.map((res) => {
          // Find latest call log
          const latestCall = callLogs.find((c) => c.residentId === res.id);

          return (
            <div key={res.id} className="h-full">
              <div className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-2xs hover:shadow-md transition flex flex-col justify-between h-full">
                
                {/* Header: Room Number, Bedside Extension & Status */}
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-extrabold text-slate-900">
                          Room {res.roomNumber}
                        </span>
                        <span className="text-xs font-mono font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200/70">
                          {res.roomExtension}
                        </span>
                        <span className="text-xs">{res.languageFlag}</span>
                      </div>
                      <div className="text-xs font-medium text-slate-600 mt-0.5">
                        {res.name} {res.preferredName && `("${res.preferredName}")`}
                      </div>
                    </div>

                    <div>
                      {res.needsAttention ? (
                        <span className="text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-rose-600" />
                          Needs Check
                        </span>
                      ) : (
                        <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          Calmed / Rested
                        </span>
                      )}
                    </div>
                  </div>

                  {/* EHR MRN & Wing */}
                  <div className="flex items-center justify-between text-[11px] text-slate-500 bg-slate-50 p-2 rounded-lg border border-slate-100 mb-2.5">
                    <span>Wing: <strong className="text-slate-700">{res.wing}</strong></span>
                    <span className="font-mono text-slate-600">MRN: {res.ehrPatientId} ({res.ehrProvider})</span>
                  </div>

                  {/* Anchor Topic & Redirection */}
                  <div className="space-y-1.5 text-xs mb-3">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Primary Anchor Memory
                      </span>
                      <p className="text-slate-800 text-[11px] font-medium truncate">
                        {res.reminiscenceTopic}
                      </p>
                    </div>

                    {res.bannedSensitiveTopics && res.bannedSensitiveTopics.length > 0 && (
                      <div className="bg-amber-50 p-1.5 rounded border border-amber-200/60 text-[10px] text-amber-900">
                        <strong>Banned Trigger:</strong> {res.bannedSensitiveTopics[0]}
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom Actions: Latest Call Summary & Connect */}
                <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                  <div className="text-[11px] text-slate-500 truncate">
                    <span>{res.lastCallDate}</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {latestCall && (
                      <button
                        onClick={() => onSelectCall(latestCall)}
                        className="px-2.5 py-1 rounded-lg text-slate-700 hover:bg-slate-100 border border-slate-200 transition font-medium cursor-pointer"
                        title="View clinical transcript & EHR sync"
                      >
                        Notes
                      </button>
                    )}

                    <button
                      onClick={() => onSelectResident(res)}
                      className="px-2.5 py-1 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold transition cursor-pointer flex items-center gap-1"
                    >
                      <PhoneCall className="w-3 h-3" />
                      <span>Ring Handset</span>
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
