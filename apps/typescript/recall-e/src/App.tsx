import React, { useState } from 'react';
import { 
  Navbar, 
  NavTabType 
} from './components/Navbar';
import { 
  MetricsOverview 
} from './components/MetricsOverview';
import { 
  AttentionAlertBanner 
} from './components/AttentionAlertBanner';
import { 
  CallLogsView 
} from './components/CallLogsView';
import { 
  ResidentRosterView 
} from './components/ResidentRosterView';
import { 
  ScheduleQueueView 
} from './components/ScheduleQueueView';
import { 
  CallDetailModal 
} from './components/CallDetailModal';
import { 
  LiveCallSimulatorModal 
} from './components/LiveCallSimulatorModal';
import { 
  FacilityEconomicsModal 
} from './components/FacilityEconomicsModal';
import { 
  ResidentProfileModal 
} from './components/ResidentProfileModal';
import { 
  NurseStationHandoffView 
} from './components/NurseStationHandoffView';
import { 
  FamilyAnchorPortalModal 
} from './components/FamilyAnchorPortalModal';
import { 
  EhrTelephonyHubModal 
} from './components/EhrTelephonyHubModal';
import { 
  ReminiscenceHeroBanner 
} from './components/ReminiscenceHeroBanner';

import { 
  RealCallModal 
} from './components/RealCallModal';

import { useRealDashboardData } from './data/realData';
import { 
  ResidentProfile, 
  CallLog, 
  ScheduledCallItem, 
  FacilityStats,
  NurseAlert,
  HipaaAuditRecord
} from './types';
import { PhoneCall } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTabType>('calls');
  const [isHeroBannerCollapsed, setIsHeroBannerCollapsed] = useState<boolean>(false);

  const { data: realData, isLive, realCallCount, loading } = useRealDashboardData(8000);
  const seededRef = React.useRef(false);

  const [residents, setResidents] = useState<ResidentProfile[]>([]);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [schedule, setSchedule] = useState<ScheduledCallItem[]>([]);
  const [facilityStats, setFacilityStats] = useState<FacilityStats>({
    facilityName: '',
    enrolledResidents: 0,
    completedToday: 0,
    scheduledToday: 0,
    flaggedForAttention: 0,
    averageUpliftPercent: 0,
    staffHoursSavedMonth: 0,
    subscriptionPricePerResident: 59,
    caregiverHourlyRate: 26,
    ehrSyncSuccessRate: 0,
    activeExtensions: 0,
  });
  const [nurseAlerts, setNurseAlerts] = useState<NurseAlert[]>([]);
  const [auditLogs, setAuditLogs] = useState<HipaaAuditRecord[]>([]);

  // Seed local state from real data once it first loads. After that,
  // local mutations (marking follow-ups reviewed, appending a new real
  // call) are the source of truth, so a background poll doesn't clobber
  // in-progress staff edits.
  React.useEffect(() => {
    if (!loading && realData && !seededRef.current) {
      seededRef.current = true;
      setResidents(realData.residents);
      setCallLogs(realData.callLogs);
      setSchedule(realData.schedule);
      setFacilityStats(realData.facilityStats);
      setNurseAlerts(realData.nurseAlerts);
      setAuditLogs(realData.hipaaAuditLogs);
    }
  }, [loading, realData]);

  // Modals
  const [selectedCall, setSelectedCall] = useState<CallLog | null>(null);
  const [isLiveSimulatorOpen, setIsLiveSimulatorOpen] = useState(false);
  const [isRealCallOpen, setIsRealCallOpen] = useState(false);
  const [isEconomicsModalOpen, setIsEconomicsModalOpen] = useState(false);
  const [isEhrHubOpen, setIsEhrHubOpen] = useState(false);
  const [familyLedgerModalState, setFamilyLedgerModalState] = useState<{
    isOpen: boolean;
    resident: ResidentProfile | null;
  }>({
    isOpen: false,
    resident: null,
  });
  const [residentModalState, setResidentModalState] = useState<{
    isOpen: boolean;
    resident: ResidentProfile | null;
  }>({
    isOpen: false,
    resident: null,
  });

  // Flagged calls needing staff attention
  const flaggedCalls = callLogs.filter(
    (c) => c.needsAttention && c.staffFollowUpStatus !== 'Resolved'
  );

  const pendingNurseAlerts = nurseAlerts.filter((a) => a.status === 'Dispatched');

  // Handle follow up updates
  const handleUpdateFollowUp = (
    callId: string,
    status: 'Pending Review' | 'Followed Up' | 'Resolved',
    notes?: string
  ) => {
    setCallLogs((prev) =>
      prev.map((c) => {
        if (c.id === callId) {
          return {
            ...c,
            staffFollowUpStatus: status,
            staffNotes: notes !== undefined ? notes : c.staffNotes,
          };
        }
        return c;
      })
    );

    if (selectedCall && selectedCall.id === callId) {
      setSelectedCall((prev) =>
        prev
          ? {
              ...prev,
              staffFollowUpStatus: status,
              staffNotes: notes !== undefined ? notes : prev.staffNotes,
            }
          : null
      );
    }

    // Recalculate flagged count
    setFacilityStats((prev) => {
      const remainingFlagged = callLogs.filter(
        (c) => c.id !== callId && c.needsAttention && c.staffFollowUpStatus !== 'Resolved'
      ).length;
      return {
        ...prev,
        flaggedForAttention: remainingFlagged,
      };
    });
  };

  // Acknowledge Vocera/Ascom alert
  const handleAcknowledgeAlert = (alertId: string) => {
    setNurseAlerts((prev) =>
      prev.map((a) =>
        a.id === alertId
          ? { ...a, status: 'Acknowledged by CNA', acknowledgedByNurse: 'CNA On Duty (Logged)' }
          : a
      )
    );

    // Add to HIPAA audit log
    const targetAlert = nurseAlerts.find((a) => a.id === alertId);
    if (targetAlert) {
      const newAudit: HipaaAuditRecord = {
        id: `audit-${Date.now()}`,
        timestamp: 'Just Now',
        staffName: 'Staff Nurse on Duty',
        role: 'Station CNA',
        action: 'Nurse Pager Dispatched',
        residentName: `${targetAlert.residentName} (Rm ${targetAlert.roomNumber})`,
        ipAddress: '10.240.14.102 (Nurse Terminal)',
        details: `CNA acknowledged pager dispatch and conducted in-person room visit.`,
      };
      setAuditLogs((prev) => [newAudit, ...prev]);
    }
  };

  // Handle completion of a simulated live call
  const handleCallCompleted = (newCall: CallLog) => {
    setCallLogs((prev) => [newCall, ...prev]);

    // If call was flagged for somatic/acute distress, fire a Vocera nurse alert
    if (newCall.needsAttention) {
      const newAlert: NurseAlert = {
        id: `alert-${Date.now()}`,
        callId: newCall.id,
        residentName: newCall.residentName,
        roomNumber: newCall.roomNumber,
        wing: newCall.wing,
        timestamp: 'Just Now',
        severity: newCall.attentionReason?.toLowerCase().includes('pain') || newCall.attentionReason?.toLowerCase().includes('fall')
          ? 'Urgent Pain/Fall Risk'
          : 'Acute Agitation',
        triggerReason: newCall.attentionReason || 'Needs immediate staff check-in',
        dispatchMethod: 'Vocera Badge Pager',
        status: 'Dispatched',
      };
      setNurseAlerts((prev) => [newAlert, ...prev]);
    }

    // Auto-chart to EHR and record in audit log
    const ehrAudit: HipaaAuditRecord = {
      id: `audit-${Date.now()}`,
      timestamp: 'Just Now',
      staffName: 'CALL-E Automated Gateway',
      role: 'FHIR Connector',
      action: 'Synced to PointClickCare',
      residentName: `${newCall.residentName} (MRN: ${newCall.ehrPatientId || 'PCC-AUTO'})`,
      ipAddress: '10.240.12.8 (Facility Gateway)',
      details: `Pushed note #${newCall.ehrNoteId || 'PCC-NOTE'} to ${newCall.ehrSyncStatus || 'PointClickCare'}.`,
    };
    setAuditLogs((prev) => [ehrAudit, ...prev]);

    // Update resident stats
    setResidents((prev) =>
      prev.map((r) => {
        if (r.id === newCall.residentId) {
          return {
            ...r,
            totalCallsCompleted: r.totalCallsCompleted + 1,
            lastCallDate: 'Just Now',
            lastMood: newCall.moodTag,
            needsAttention: newCall.needsAttention,
          };
        }
        return r;
      })
    );

    // Update facility stats
    setFacilityStats((prev) => ({
      ...prev,
      completedToday: prev.completedToday + 1,
      flaggedForAttention: newCall.needsAttention
        ? prev.flaggedForAttention + 1
        : prev.flaggedForAttention,
    }));
  };

  // Save Resident (new or update)
  const handleSaveResident = (savedResident: ResidentProfile) => {
    setResidents((prev) => {
      const exists = prev.some((r) => r.id === savedResident.id);
      if (exists) {
        return prev.map((r) => (r.id === savedResident.id ? savedResident : r));
      } else {
        return [savedResident, ...prev];
      }
    });

    setFacilityStats((prev) => ({
      ...prev,
      enrolledResidents: prev.enrolledResidents + 1,
    }));

    setResidentModalState({ isOpen: false, resident: null });
  };

  // Save Family Anchor Ledger
  const handleSaveFamilyLedger = (updatedResident: ResidentProfile) => {
    setResidents((prev) =>
      prev.map((r) => (r.id === updatedResident.id ? updatedResident : r))
    );

    // Audit log
    const newAudit: HipaaAuditRecord = {
      id: `audit-${Date.now()}`,
      timestamp: 'Just Now',
      staffName: 'Family Portal Contributor',
      role: 'Authorized Power of Attorney',
      action: 'Modified Memory Anchor',
      residentName: `${updatedResident.name} (Rm ${updatedResident.roomNumber})`,
      ipAddress: 'Encrypted Family Portal Token',
      details: `Updated childhood memories, banned sensitive triggers, and preferred songs.`,
    };
    setAuditLogs((prev) => [newAudit, ...prev]);

    setFamilyLedgerModalState({ isOpen: false, resident: null });
  };

  // Trigger call from resident roster
  const handleTriggerCall = () => {
    setIsLiveSimulatorOpen(true);
  };

  if (loading && !seededRef.current) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-sm text-slate-500">Loading dashboard…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-teal-100 selection:text-teal-900">
      
      {/* Sleek Facility Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenNewResident={() => setResidentModalState({ isOpen: true, resident: null })}
        onOpenEhrHub={() => setIsEhrHubOpen(true)}
        flaggedCount={flaggedCalls.length}
        pendingAlertsCount={pendingNurseAlerts.length}
        facilityName={facilityStats.facilityName}
        residentCount={facilityStats.enrolledResidents}
      />

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex-1 w-full">

        {/* Live data status + real call trigger */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 bg-white border border-slate-200/80 rounded-xl px-4 py-2.5 shadow-2xs">
          <div className="flex items-center gap-2 text-xs">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: isLive ? '#10b981' : '#cbd5e1', animation: isLive ? 'pulse 2s ease-in-out infinite' : 'none' }}
            />
            <span className={`font-bold ${isLive ? 'text-emerald-700' : 'text-slate-500'}`}>
              {isLive ? 'Live' : 'Offline'}
            </span>
            <span className="text-slate-500">
              {isLive
                ? realCallCount > 0
                  ? `${realCallCount} real call(s) logged · refreshing every 8s`
                  : 'No real calls logged yet, showing sample data · refreshing every 8s'
                : 'Open via a local server for live data'}
            </span>
          </div>
          <button
            onClick={() => setIsRealCallOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-teal-700 hover:bg-teal-800 text-white transition cursor-pointer shadow-2xs"
          >
            <PhoneCall className="w-3.5 h-3.5" />
            Call a Resident
          </button>
        </div>

        {/* Warm Hero Visual & Facility Telephony Focus Banner (Shift Feed only) */}
        {activeTab === 'calls' && (
          <ReminiscenceHeroBanner
            onSimulateCall={() => setIsLiveSimulatorOpen(true)}
            isCollapsed={isHeroBannerCollapsed}
            onToggleCollapse={() => setIsHeroBannerCollapsed(!isHeroBannerCollapsed)}
          />
        )}

        {/* Operational Metrics Overview */}
        <MetricsOverview
          stats={facilityStats}
          onFilterFlagged={() => setActiveTab('calls')}
          onOpenEconomics={() => setIsEconomicsModalOpen(true)}
        />

        {/* Attention Alert Banner for Flagged Residents */}
        <AttentionAlertBanner
          flaggedCalls={flaggedCalls}
          onSelectCall={(call) => setSelectedCall(call)}
        />

        {/* 1. NURSE STATION & SUNDOWNING HANDOFF VIEW */}
        {activeTab === 'station' && (
          <NurseStationHandoffView
            residents={residents}
            callLogs={callLogs}
            nurseAlerts={nurseAlerts}
            onAcknowledgeAlert={handleAcknowledgeAlert}
            onSelectCall={(call) => setSelectedCall(call)}
            onOpenLiveSimulator={() => setIsLiveSimulatorOpen(true)}
            onSelectResident={(res) => setResidentModalState({ isOpen: true, resident: res })}
          />
        )}

        {/* 2. SHIFT FEED (Calls & Reminiscence Transcripts) */}
        {activeTab === 'calls' && (
          <div className="space-y-4">
            <CallLogsView
              callLogs={callLogs}
              onSelectCall={(call) => setSelectedCall(call)}
              onOpenLiveSimulator={() => setIsLiveSimulatorOpen(true)}
            />
          </div>
        )}

        {/* 3. RESIDENTS & FAMILY ANCHOR LEDGER */}
        {activeTab === 'residents' && (
          <ResidentRosterView
            residents={residents}
            onSelectResident={(resident) =>
              setResidentModalState({ isOpen: true, resident })
            }
            onTriggerCall={handleTriggerCall}
            onOpenNewResident={() =>
              setResidentModalState({ isOpen: true, resident: null })
            }
            onOpenFamilyLedger={(resident) =>
              setFamilyLedgerModalState({ isOpen: true, resident })
            }
          />
        )}

        {/* 4. SCHEDULE QUEUE */}
        {activeTab === 'schedule' && (
          <ScheduleQueueView
            schedule={schedule}
            onTriggerCall={() => setIsLiveSimulatorOpen(true)}
          />
        )}

        {/* 5. FACILITY ECONOMICS */}
        {activeTab === 'economics' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200/80 p-6 shadow-2xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Facility ROI & Per-Resident Subscription Model
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    B2B enterprise model replacing CNA 1-on-1 activities labor directly
                  </p>
                </div>
                <button
                  onClick={() => setIsEconomicsModalOpen(true)}
                  className="bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold px-4 py-2 rounded-lg transition cursor-pointer shadow-2xs"
                >
                  Open Interactive ROI Calculator
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                  <h4 className="font-bold text-slate-900 mb-1">
                    Direct Staff Hour Replacement
                  </h4>
                  <p className="text-slate-600 leading-relaxed">
                    Replaces ~14 hours of 1-on-1 CNA reminiscence time per resident monthly. Frees nursing staff to focus on medication, mobility, and personal hygiene.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                  <h4 className="font-bold text-slate-900 mb-1">
                    Sold to Facilities ($59/bed/mo)
                  </h4>
                  <p className="text-slate-600 leading-relaxed">
                    Facilities subscribe at $59/bed/month from their existing activities and CNA overtime budget, rather than burdening resident families.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                  <h4 className="font-bold text-slate-900 mb-1">
                    Multilingual Sundowning Soother
                  </h4>
                  <p className="text-slate-600 leading-relaxed">
                    Memory care facilities rarely have multilingual staff on late shifts. CALL-E speaks fluent Spanish and Italian, unlocking comforting early memories.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* Clean, Subtle Footer */}
      <footer className="bg-white border-t border-slate-200/80 py-3.5 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span className="font-bold text-slate-800">RECALL-E</span>
          <span className="text-[11px] text-slate-400">
            Built on CALL-E for a hackathon prototype
          </span>
        </div>
      </footer>

      {/* Modals */}
      {selectedCall && (
        <CallDetailModal
          call={selectedCall}
          onClose={() => setSelectedCall(null)}
          onUpdateFollowUp={handleUpdateFollowUp}
        />
      )}

      {isLiveSimulatorOpen && (
        <LiveCallSimulatorModal
          residents={residents}
          isOpen={isLiveSimulatorOpen}
          onClose={() => setIsLiveSimulatorOpen(false)}
          onCallCompleted={handleCallCompleted}
        />
      )}

      {isRealCallOpen && (
        <RealCallModal
          residents={residents}
          isOpen={isRealCallOpen}
          onClose={() => setIsRealCallOpen(false)}
          onCallCompleted={handleCallCompleted}
        />
      )}

      {isEconomicsModalOpen && (
        <FacilityEconomicsModal
          isOpen={isEconomicsModalOpen}
          onClose={() => setIsEconomicsModalOpen(false)}
          stats={facilityStats}
        />
      )}

      {isEhrHubOpen && (
        <EhrTelephonyHubModal
          isOpen={isEhrHubOpen}
          onClose={() => setIsEhrHubOpen(false)}
          auditLogs={auditLogs}
        />
      )}

      {familyLedgerModalState.isOpen && familyLedgerModalState.resident && (
        <FamilyAnchorPortalModal
          resident={familyLedgerModalState.resident}
          isOpen={familyLedgerModalState.isOpen}
          onClose={() => setFamilyLedgerModalState({ isOpen: false, resident: null })}
          onSaveAnchorLedger={handleSaveFamilyLedger}
        />
      )}

      {residentModalState.isOpen && (
        <ResidentProfileModal
          resident={residentModalState.resident}
          isOpen={residentModalState.isOpen}
          onClose={() => setResidentModalState({ isOpen: false, resident: null })}
          onSave={handleSaveResident}
        />
      )}

    </div>
  );
}
