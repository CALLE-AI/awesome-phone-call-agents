import React from 'react';
import {
  PhoneCall,
  Users,
  Calendar,
  Plus,
  Database
} from 'lucide-react';

export type NavTabType = 'calls' | 'station' | 'residents' | 'schedule' | 'economics';

interface NavbarProps {
  activeTab: NavTabType;
  setActiveTab: (tab: NavTabType) => void;
  onOpenNewResident: () => void;
  onOpenEhrHub: () => void;
  flaggedCount: number;
  pendingAlertsCount: number;
  facilityName?: string;
  residentCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  onOpenNewResident,
  onOpenEhrHub,
  flaggedCount,
  pendingAlertsCount,
  facilityName = 'Willowbrook Memory Care',
  residentCount = 0,
}) => {
  return (
    <header className="relative bg-white/95 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-30 shadow-2xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-3">

          {/* Brand & Telephony Status Indicator */}
          <div className="flex items-center gap-3">
            <div className="relative w-9 h-9 rounded-xl bg-gradient-to-tr from-teal-900 to-teal-700 text-white flex items-center justify-center shadow-xs border border-teal-600/30">
              <PhoneCall className="w-4.5 h-4.5" />
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full ring-2 ring-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-(family-name:--font-display) text-base font-extrabold tracking-tight text-slate-900">RECALL-E</span>
                <span className="hidden sm:inline-flex items-center text-[9px] font-bold uppercase tracking-wider text-teal-700 bg-teal-50 border border-teal-200 px-1.5 py-0.3 rounded">
                  Telehealth Platform
                </span>
              </div>
              <p className="text-[11px] text-slate-500 hidden md:block">
                {facilityName} • {residentCount} resident{residentCount === 1 ? '' : 's'} enrolled
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="hidden lg:flex items-center gap-1 bg-slate-100/90 p-1 rounded-xl text-xs font-semibold text-slate-600">
            <button
              onClick={() => setActiveTab('calls')}
              id="nav-tab-calls"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
                activeTab === 'calls'
                  ? 'bg-white text-teal-800 shadow-2xs font-bold'
                  : 'hover:text-slate-900'
              }`}
            >
              <PhoneCall className="w-3.5 h-3.5" />
              <span>Shift Feed</span>
              {flaggedCount > 0 && (
                <span className="bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                  {flaggedCount}
                </span>
              )}
            </button>


            <button
              onClick={() => setActiveTab('residents')}
              id="nav-tab-residents"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
                activeTab === 'residents'
                  ? 'bg-white text-teal-800 shadow-2xs font-bold'
                  : 'hover:text-slate-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Residents & Anchors</span>
            </button>

            <button
              onClick={() => setActiveTab('schedule')}
              id="nav-tab-schedule"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
                activeTab === 'schedule'
                  ? 'bg-white text-teal-800 shadow-2xs font-bold'
                  : 'hover:text-slate-900'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Schedule</span>
            </button>
          </nav>

          {/* Action Buttons: EHR Hub, Live Demo & New Resident */}
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenEhrHub}
              id="btn-open-ehr-telephony"
              className="hidden sm:flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-semibold px-3 py-1.5 rounded-lg transition cursor-pointer"
              title="PointClickCare FHIR, VoIP Gateway, and HIPAA Logs"
            >
              <Database className="w-3.5 h-3.5 text-teal-700" />
              <span>EHR & Telephony</span>
            </button>

            <button
              onClick={onOpenNewResident}
              id="btn-add-resident"
              className="hidden md:flex items-center gap-1 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-medium px-2.5 py-1.5 rounded-lg transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-slate-500" />
              <span>Add Resident</span>
            </button>
          </div>

        </div>

        {/* Mobile Nav Tabs */}
        <div className="flex lg:hidden border-t border-slate-100 py-1.5 gap-1 overflow-x-auto text-xs">
          <button
            onClick={() => setActiveTab('calls')}
            className={`px-2.5 py-1 rounded-md whitespace-nowrap ${
              activeTab === 'calls' ? 'bg-teal-700 text-white font-semibold' : 'text-slate-600'
            }`}
          >
            Shift Feed ({flaggedCount})
          </button>
          <button
            onClick={() => setActiveTab('station')}
            className={`px-2.5 py-1 rounded-md whitespace-nowrap font-medium ${
              activeTab === 'station' ? 'bg-slate-900 text-white' : 'text-slate-700 bg-slate-100'
            }`}
          >
            Nurse Station {pendingAlertsCount > 0 && `(${pendingAlertsCount})`}
          </button>
          <button
            onClick={() => setActiveTab('residents')}
            className={`px-2.5 py-1 rounded-md whitespace-nowrap ${
              activeTab === 'residents' ? 'bg-teal-700 text-white font-semibold' : 'text-slate-600'
            }`}
          >
            Residents
          </button>
          <button
            onClick={() => setActiveTab('schedule')}
            className={`px-2.5 py-1 rounded-md whitespace-nowrap ${
              activeTab === 'schedule' ? 'bg-teal-700 text-white font-semibold' : 'text-slate-600'
            }`}
          >
            Schedule
          </button>
          <button
            onClick={() => setActiveTab('economics')}
            className={`px-2.5 py-1 rounded-md whitespace-nowrap ${
              activeTab === 'economics' ? 'bg-teal-700 text-white font-semibold' : 'text-slate-600'
            }`}
          >
            Facility ROI
          </button>
          <button
            onClick={onOpenEhrHub}
            className="px-2.5 py-1 rounded-md whitespace-nowrap text-teal-800 bg-teal-50 border border-teal-200 font-semibold"
          >
            EHR & Telephony
          </button>
        </div>

      </div>
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-teal-600 via-sky-500 to-teal-600" />
    </header>
  );
};
