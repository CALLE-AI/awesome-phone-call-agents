import React, { useState, useEffect, forwardRef } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import appLogo from './assets/logo.jpg';
import {
  Activity,
  ShieldAlert,
  PhoneCall,
  Cpu,
  CheckCircle2,
  Inbox,
  FileText,
  UserCheck,
  Clock,
  Search,
  Sun,
  Moon,
  ChevronDown,
  ChevronUp,
  Filter,
  Calendar,
  X,
  Workflow,
  ArrowRight,
  GitMerge,
  Server,
  Layers,
  Sparkles,
  Database,
  BarChart3,
  PhoneIncoming,
  PhoneForwarded,
  Users,
  Globe,
  Award,
  ShieldCheck
} from 'lucide-react';

// Custom Date Input component for react-datepicker
const CustomDateInput = forwardRef(({ value, onClick, placeholder, isDark, icon: Icon, onClear }, ref) => (
  <div className="relative w-full">
    <Icon className="w-3.5 h-3.5 absolute left-3 top-3 text-indigo-400 pointer-events-none z-10" />
    <input
      ref={ref}
      readOnly
      onClick={onClick}
      value={value}
      placeholder={placeholder}
      className={`pl-9 pr-7 py-2 text-xs rounded-xl border w-full cursor-pointer focus:outline-none focus:border-indigo-500 transition-all font-medium ${isDark
        ? 'bg-[#111827] border-[#1f293d] text-white placeholder:text-slate-600'
        : 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400'
        }`}
    />
    {value && (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClear && onClear(); }}
        className="absolute right-2.5 top-2.5 text-slate-400 hover:text-rose-400 transition-colors z-10">
        <X className="w-3.5 h-3.5" />
      </button>
    )}
  </div>
));

export default function App() {
  const [theme, setTheme] = useState('light');
  const [activeTab, setActiveTab] = useState('overview');
  const [stats, setStats] = useState({
    total_incidents: 0,
    resolved_incidents: 0,
    success_rate: 100.0,
    error_queue_received: 0,
    resolution_queue_received: 0,
    recent_incidents: [],
    oncall_engineer: { name: 'Santhosh', phone: '+919003939495', locale: 'en-IN', region: 'IN' }
  });
  const [incidents, setIncidents] = useState([]);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [queues, setQueues] = useState({ error_queue: { messages: [] }, resolution_queue: { messages: [] } });
  const [logs, setLogs] = useState([]);

  // Incident History Collapsible Sections
  const [showUnresolved, setShowUnresolved] = useState(true);
  const [showResolved, setShowResolved] = useState(true);

  // Queue Inspector Filters & Collapsible State
  const [expandedMsgs, setExpandedMsgs] = useState({});
  const [queueIncidentFilter, setQueueIncidentFilter] = useState('ALL');

  // Audit Logs Filters State with react-datepicker Date objects
  const [searchLog, setSearchLog] = useState('');
  const [filterIncident, setFilterIncident] = useState('ALL');
  const [filterLogLevel, setFilterLogLevel] = useState('ALL');
  const [filterStartDate, setFilterStartDate] = useState(null);
  const [filterEndDate, setFilterEndDate] = useState(null);

  const fetchData = async () => {
    try {
      const statsRes = await fetch('/api/dashboard/stats');
      if (statsRes.ok) setStats(await statsRes.json());

      const incidentsRes = await fetch('/api/incidents');
      if (incidentsRes.ok) {
        const incList = await incidentsRes.json();
        setIncidents(incList);
        if (incList.length > 0 && !selectedIncident) {
          fetchIncidentDetails(incList[0].incident_id);
        }
      }

      const queuesRes = await fetch('/api/queues');
      if (queuesRes.ok) setQueues(await queuesRes.json());

      const logsRes = await fetch('/api/logs');
      if (logsRes.ok) setLogs(await logsRes.json());
    } catch (e) {
      console.error("Error fetching telemetry data:", e);
    }
  };

  const fetchIncidentDetails = async (id) => {
    try {
      const res = await fetch(`/api/incidents/${id}`);
      if (res.ok) setSelectedIncident(await res.json());
    } catch (e) {
      console.error("Error fetching incident details:", e);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, []);

  const toggleMsgExpand = (id) => {
    setExpandedMsgs(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  const getRegionDisplay = (region) => {
    if (!region) return '🇮🇳 India';
    const r = region.toUpperCase();
    if (r === 'IN') return '🇮🇳 India';
    if (r === 'US') return '🇺🇸 United States';
    if (r === 'UK' || r === 'GB') return '🇬🇧 United Kingdom';
    if (r === 'CA') return '🇨🇦 Canada';
    if (r === 'DE') return '🇩🇪 Germany';
    if (r === 'JP') return '🇯🇵 Japan';
    return `🌐 ${region}`;
  };

  const getLocaleDisplay = (locale) => {
    if (!locale) return 'English';
    const l = locale.toLowerCase();
    if (l === 'en-in') return 'English';
    if (l === 'hi-in' || l === 'hi') return 'Hindi ';
    if (l === 'en-us') return 'English';
    if (l === 'en-gb') return 'English';
    if (l === 'de-de') return 'German';
    if (l === 'ja-jp') return 'Japanese';
    return locale;
  };

  const maskPhoneNumber = (phone) => {
    if (!phone) return '+91••••••9495';
    const str = String(phone).trim();
    if (str.length <= 5) return '••••••••';
    const prefix = str.slice(0, 3);
    const suffix = str.slice(-4);
    return `${prefix}••••••${suffix}`;
  };

  // Filtered Logs Calculation
  const filteredLogs = logs.filter(log => {
    if (searchLog) {
      const q = searchLog.toLowerCase();
      const matchMsg = log.message && log.message.toLowerCase().includes(q);
      const matchSvc = log.service_name && log.service_name.toLowerCase().includes(q);
      const matchInc = log.incident_id && log.incident_id.toLowerCase().includes(q);
      if (!matchMsg && !matchSvc && !matchInc) return false;
    }
    if (filterIncident !== 'ALL' && log.incident_id !== filterIncident) {
      return false;
    }
    if (filterLogLevel !== 'ALL' && log.log_status.toUpperCase() !== filterLogLevel.toUpperCase()) {
      return false;
    }
    if (filterStartDate && log.timestamp) {
      if (new Date(log.timestamp) < filterStartDate) return false;
    }
    if (filterEndDate && log.timestamp) {
      if (new Date(log.timestamp) > filterEndDate) return false;
    }
    return true;
  });

  // Unique list of incidents for Audit Log filter
  const uniqueIncidents = Array.from(new Set(logs.map(l => l.incident_id).filter(Boolean)));

  // Unique list of incidents for Queue Inspector filter
  const queueIncidentIds = Array.from(new Set([
    ...(queues.error_queue?.messages || []).map(m => m.incident_id),
    ...(queues.resolution_queue?.messages || []).map(m => m.incident_id)
  ].filter(Boolean)));

  // Filter Queue Inspector messages
  const filteredErrorMsgs = (queues.error_queue?.messages || []).filter(m =>
    queueIncidentFilter === 'ALL' || m.incident_id === queueIncidentFilter
  );

  const filteredResolutionMsgs = (queues.resolution_queue?.messages || []).filter(m =>
    queueIncidentFilter === 'ALL' || m.incident_id === queueIncidentFilter
  );

  // Group Incidents into Unresolved vs Resolved
  const unresolvedIncidents = incidents.filter(inc => inc.status !== 'RESOLVED');
  const resolvedIncidents = incidents.filter(inc => inc.status === 'RESOLVED');

  // Static/Dynamic Roster Engineers Data for Metrics Tab
  const oncallRosterList = [
    {
      id: 1,
      name: stats.oncall_engineer?.name || 'Alex Morgan',
      role: 'Primary OnTripFix Lead Engineer',
      phone: stats.oncall_engineer?.phone || '+15550199',
      region: stats.oncall_engineer?.region || 'US',
      locale: stats.oncall_engineer?.locale || 'en-US',
      status: 'ACTIVE_NOW',
      calls_handled: (stats.total_incidents || 1) * 2,
      resolutions: stats.resolved_incidents || 1
    },
    {
      id: 2,
      name: 'Alex Morgan',
      role: 'US Escalation & Platform Specialist',
      phone: '+15550199',
      region: 'US',
      locale: 'en-US',
      status: 'STANDBY',
      calls_handled: 6,
      resolutions: 6
    },
    {
      id: 3,
      name: 'Priya Sharma',
      role: 'DB & Infrastructure Specialist',
      phone: '+919876543210',
      region: 'IN',
      locale: 'hi-IN',
      status: 'ACTIVE_NOW',
      calls_handled: 8,
      resolutions: 8
    },
    {
      id: 4,
      name: 'Marcus Vance',
      role: 'EMEA On-Call Duty Lead',
      phone: '+447700900077',
      region: 'UK',
      locale: 'en-GB',
      status: 'STANDBY',
      calls_handled: 4,
      resolutions: 4
    },
    {
      id: 5,
      name: 'Elena Rostova',
      role: 'APAC OnTripFix Incident Lead',
      phone: '+81355550143',
      region: 'JP',
      locale: 'ja-JP',
      status: 'STANDBY',
      calls_handled: 5,
      resolutions: 5
    }
  ];

  const isDark = theme === 'dark';

  return (
    <div className={`min-h-screen flex flex-col transition-colors duration-300 ${isDark ? 'bg-[#090d16] text-slate-100' : 'bg-slate-100 text-slate-900'}`}>

      {/* Header - Branding & Theme Toggle Only */}
      <header className={`border-b sticky top-0 z-50 transition-colors duration-300 ${isDark ? 'border-[#1f293d] bg-[#111827]/85 backdrop-blur-md' : 'border-slate-200 bg-white/90 backdrop-blur-md shadow-sm'}`}>
        <div className="w-full px-6 md:px-8 py-3.5 flex items-center justify-between">

          {/* Logo & Title */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl overflow-hidden border border-indigo-500/30 flex items-center justify-center bg-slate-900 shadow-lg shadow-indigo-500/20">
              <img src={appLogo} alt="OnTripFix Logo" className="w-full h-full object-cover" />
            </div>
            <div>
              <h1 className={`text-xl font-heading font-bold ${isDark ? 'bg-gradient-to-r from-white via-slate-200 to-indigo-300 bg-clip-text text-transparent' : 'text-slate-900'}`}>
                OnTripFix
              </h1>
              <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Autonomous Airflow Incident Remediation & Call-E Voice AI</p>
            </div>
          </div>

          {/* Right Header Status & Light / Dark Theme Toggle */}
          <div className="flex items-center space-x-4">
            <div className="hidden sm:flex items-center space-x-2 px-3 py-1 rounded-full border text-xs font-medium bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>System Live</span>
            </div>

            <button
              onClick={toggleTheme}
              title="Toggle Light / Dark Theme"
              className={`p-2.5 rounded-xl border transition-all flex items-center justify-center ${isDark ? 'bg-[#1f293d]/60 border-[#1f293d] text-amber-400 hover:bg-slate-800' : 'bg-slate-100 border-slate-300 text-indigo-600 hover:bg-slate-200'}`}>
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>

        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 w-full px-6 md:px-8 py-6 space-y-6">

        {/* Sub-Header Navigation Tab Bar */}
        <div className={`p-2 rounded-2xl border flex flex-wrap items-center justify-between gap-3 ${isDark ? 'glass-card border-[#1f293d]' : 'bg-white border-slate-200 shadow-sm'}`}>
          <nav className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-2.5 text-xs font-semibold rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'overview' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/25' : (isDark ? 'text-slate-400 hover:text-white hover:bg-slate-800/60' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100')}`}>
              <Activity className="w-4 h-4" />
              <span>Overview & Monitor</span>
            </button>

            <button
              onClick={() => setActiveTab('queues')}
              className={`px-4 py-2.5 text-xs font-semibold rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'queues' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/25' : (isDark ? 'text-slate-400 hover:text-white hover:bg-slate-800/60' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100')}`}>
              <Inbox className="w-4 h-4" />
              <span>Queue Inspector</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${activeTab === 'queues' ? 'bg-white/20 text-white' : (isDark ? 'bg-slate-800 text-indigo-400' : 'bg-indigo-50 text-indigo-600')}`}>
                {stats.error_queue_received + stats.resolution_queue_received}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('logs')}
              className={`px-4 py-2.5 text-xs font-semibold rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'logs' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/25' : (isDark ? 'text-slate-400 hover:text-white hover:bg-slate-800/60' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100')}`}>
              <FileText className="w-4 h-4" />
              <span>Audit Logs</span>
            </button>

            <button
              onClick={() => setActiveTab('flow')}
              className={`px-4 py-2.5 text-xs font-semibold rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'flow' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/25' : (isDark ? 'text-slate-400 hover:text-white hover:bg-slate-800/60' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100')}`}>
              <Workflow className="w-4 h-4" />
              <span>Architecture & Flow</span>
            </button>

            {/* NEW TAB: Voice & Roster Metrics */}
            <button
              onClick={() => setActiveTab('metrics')}
              className={`px-4 py-2.5 text-xs font-semibold rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'metrics' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/25' : (isDark ? 'text-slate-400 hover:text-white hover:bg-slate-800/60' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100')}`}>
              <BarChart3 className="w-4 h-4" />
              <span>Voice & Roster Metrics</span>
            </button>
          </nav>

          <div className="hidden lg:flex items-center space-x-2 text-xs text-slate-400 pr-2 font-mono">
            <span>SQLite: <strong className="text-indigo-400">Connected</strong></span>
          </div>
        </div>

        {/* TAB 1: OVERVIEW & INCIDENT MONITOR */}
        {activeTab === 'overview' && (
          <div className="space-y-6">

            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className={`p-5 rounded-2xl border-l-4 border-indigo-500 ${isDark ? 'glass-card' : 'bg-white border-slate-200 shadow-sm'}`}>
                <div className={`text-xs font-medium uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Total Incidents</div>
                <div className={`text-3xl font-heading font-bold mt-1 ${isDark ? 'text-white' : 'text-slate-900'}`}>{stats.total_incidents}</div>
                <div className="text-xs text-indigo-500 mt-2">
                  <span>Recorded in Telemetry DB</span>
                </div>
              </div>

              <div className={`p-5 rounded-2xl border-l-4 border-amber-500 ${isDark ? 'glass-card' : 'bg-white border-slate-200 shadow-sm'}`}>
                <div className={`text-xs font-medium uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Error Queue Messages</div>
                <div className="text-3xl font-heading font-bold text-amber-500 mt-1">{stats.error_queue_received}</div>
                <div className={`text-xs mt-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Received from Webhook</div>
              </div>

              <div className={`p-5 rounded-2xl border-l-4 border-purple-500 ${isDark ? 'glass-card' : 'bg-white border-slate-200 shadow-sm'}`}>
                <div className={`text-xs font-medium uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Resolution Queue Messages</div>
                <div className="text-3xl font-heading font-bold text-purple-500 mt-1">{stats.resolution_queue_received}</div>
                <div className={`text-xs mt-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Dispatched to LangGraph</div>
              </div>

              <div className={`p-5 rounded-2xl border-l-4 border-emerald-500 ${isDark ? 'glass-card' : 'bg-white border-slate-200 shadow-sm'}`}>
                <div className={`text-xs font-medium uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Remediation Success</div>
                <div className="text-3xl font-heading font-bold text-emerald-500 mt-1">{stats.success_rate}%</div>
                <div className="text-xs text-emerald-500 mt-2">{stats.resolved_incidents} / {stats.total_incidents} Auto-Fixed</div>
              </div>

              {/* On-Call Roster Country & Language */}
              <div className={`p-5 rounded-2xl border-l-4 border-sky-500 ${isDark ? 'glass-card' : 'bg-white border-slate-200 shadow-sm'}`}>
                <div className={`text-xs font-medium uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Active On-Call Roster</div>
                <div className={`text-base font-heading font-bold mt-1 truncate flex items-center space-x-1.5 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                  <UserCheck className="w-4 h-4 text-sky-500" />
                  <span>{stats.oncall_engineer?.name || 'Santhosh'}</span>
                </div>
                <div className="mt-2 space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-[11px]">Country:</span>
                    <span className="font-semibold text-sky-400">{getRegionDisplay(stats.oncall_engineer?.region)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-[11px]">Language:</span>
                    <span className="font-semibold text-indigo-400">{getLocaleDisplay(stats.oncall_engineer?.locale)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Incident History & Stepper */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              {/* History List */}
              <div className={`rounded-2xl p-5 border flex flex-col space-y-4 ${isDark ? 'glass-card border-[#1f293d]' : 'bg-white border-slate-200 shadow-sm'}`}>
                <div className="flex items-center justify-between pb-2 border-b border-[#1f293d]/50">
                  <h2 className={`text-base font-heading font-semibold flex items-center space-x-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                    <Clock className="w-4 h-4 text-indigo-500" />
                    <span>Incident History</span>
                  </h2>
                  <span className={`text-xs font-bold ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{incidents.length} total</span>
                </div>

                <div className="space-y-4 overflow-y-auto max-h-[600px] pr-1">

                  {/* Section 1: Unresolved / Active Incidents */}
                  <div className="space-y-2">
                    <button
                      onClick={() => setShowUnresolved(!showUnresolved)}
                      className={`w-full p-2.5 rounded-xl border flex items-center justify-between transition-all select-none ${isDark ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                      <div className="flex items-center space-x-2 text-xs font-bold">
                        <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                        <span>Active / Unresolved Incidents</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/20 text-amber-400 font-extrabold">{unresolvedIncidents.length}</span>
                      </div>
                      {showUnresolved ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>

                    {showUnresolved && (
                      <div className="space-y-2 pl-1">
                        {unresolvedIncidents.length === 0 ? (
                          <div className="text-center py-4 text-slate-400 text-xs italic">No active unresolved incidents.</div>
                        ) : (
                          unresolvedIncidents.map(inc => (
                            <div
                              key={inc.incident_id}
                              onClick={() => fetchIncidentDetails(inc.incident_id)}
                              className={`p-3 rounded-xl border cursor-pointer transition-all ${selectedIncident?.incident_id === inc.incident_id ? (isDark ? 'bg-indigo-600/20 border-indigo-500 shadow-md' : 'bg-indigo-50 border-indigo-500 shadow-sm') : (isDark ? 'bg-[#090d16]/60 border-[#1f293d] hover:border-slate-600' : 'bg-slate-50 border-slate-200 hover:border-slate-300')}`}>
                              <div className="flex items-center justify-between">
                                <span className="font-mono text-xs font-semibold text-indigo-500">{inc.incident_id}</span>
                                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full uppercase bg-amber-500/10 text-amber-500 border border-amber-500/20 animate-pulse">
                                  {inc.status}
                                </span>
                              </div>
                              <div className={`text-xs font-medium mt-1 truncate ${isDark ? 'text-slate-300' : 'text-slate-800'}`}>{inc.dag_id} / {inc.task_id}</div>
                              <div className="text-[11px] mt-1 truncate text-rose-400">{inc.error_message}</div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* Section 2: Resolved Incidents */}
                  <div className="space-y-2">
                    <button
                      onClick={() => setShowResolved(!showResolved)}
                      className={`w-full p-2.5 rounded-xl border flex items-center justify-between transition-all select-none ${isDark ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
                      <div className="flex items-center space-x-2 text-xs font-bold">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Resolved Incidents</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-400 font-extrabold">{resolvedIncidents.length}</span>
                      </div>
                      {showResolved ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>

                    {showResolved && (
                      <div className="space-y-2 pl-1">
                        {resolvedIncidents.length === 0 ? (
                          <div className="text-center py-4 text-slate-400 text-xs italic">No resolved incidents recorded yet.</div>
                        ) : (
                          resolvedIncidents.map(inc => (
                            <div
                              key={inc.incident_id}
                              onClick={() => fetchIncidentDetails(inc.incident_id)}
                              className={`p-3 rounded-xl border cursor-pointer transition-all ${selectedIncident?.incident_id === inc.incident_id ? (isDark ? 'bg-indigo-600/20 border-indigo-500 shadow-md' : 'bg-indigo-50 border-indigo-500 shadow-sm') : (isDark ? 'bg-[#090d16]/60 border-[#1f293d] hover:border-slate-600' : 'bg-slate-50 border-slate-200 hover:border-slate-300')}`}>
                              <div className="flex items-center justify-between">
                                <span className="font-mono text-xs font-semibold text-indigo-500">{inc.incident_id}</span>
                                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full uppercase bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                                  {inc.status}
                                </span>
                              </div>
                              <div className={`text-xs font-medium mt-1 truncate ${isDark ? 'text-slate-300' : 'text-slate-800'}`}>{inc.dag_id} / {inc.task_id}</div>
                              <div className={`text-[11px] mt-1 truncate ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{inc.error_message}</div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                </div>
              </div>

              {/* Incident Details & 6-Step Stepper Display */}
              <div className={`lg:col-span-2 rounded-2xl p-6 border flex flex-col space-y-6 ${isDark ? 'glass-card border-[#1f293d]' : 'bg-white border-slate-200 shadow-sm'}`}>
                {selectedIncident ? (
                  <div>
                    {/* Separate distinct lines for Airflow Error Message, DAG ID, and Task ID */}
                    <div className={`pb-5 border-b space-y-3 ${isDark ? 'border-[#1f293d]' : 'border-slate-200'}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <span className="font-mono text-sm font-bold text-indigo-500">{selectedIncident.incident_id}</span>
                          <span className={`px-2.5 py-0.5 text-xs font-bold rounded-full uppercase ${selectedIncident.status === 'RESOLVED' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'}`}>
                            {selectedIncident.status}
                          </span>
                        </div>
                        <div className="text-right">
                          <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>On-Call Engineer</div>
                          <div className="text-xs font-semibold text-sky-500">{selectedIncident.engineer_name || 'Santhosh'}</div>
                        </div>
                      </div>

                      {/* Detailed Breakdown Lines */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                        <div className={`p-2.5 rounded-xl border flex items-center space-x-2 ${isDark ? 'bg-[#090d16]/80 border-[#1f293d]' : 'bg-slate-50 border-slate-200'}`}>
                          <span className={`text-xs font-semibold uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Airflow DAG ID:</span>
                          <span className="font-mono text-xs font-bold text-indigo-400">{selectedIncident.dag_id}</span>
                        </div>
                        <div className={`p-2.5 rounded-xl border flex items-center space-x-2 ${isDark ? 'bg-[#090d16]/80 border-[#1f293d]' : 'bg-slate-50 border-slate-200'}`}>
                          <span className={`text-xs font-semibold uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Airflow Task ID:</span>
                          <span className="font-mono text-xs font-bold text-purple-400">{selectedIncident.task_id}</span>
                        </div>
                      </div>

                      {/* Airflow Error Message Separate Line */}
                      <div className="pt-1">
                        <div className={`text-[11px] font-semibold uppercase tracking-wider mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Airflow Intercepted Error Message:</div>
                        <div className={`p-3 rounded-xl border font-mono text-xs leading-relaxed ${isDark ? 'bg-rose-950/20 border-rose-500/30 text-rose-300' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                          {selectedIncident.error_message}
                        </div>
                      </div>

                    </div>

                    {/* Stepper Lifecycle */}
                    <div className="mt-6 space-y-4">
                      <h4 className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Incident Remediation Lifecycle Stepper</h4>

                      <div className={`relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 ${isDark ? 'before:bg-[#1f293d]' : 'before:bg-slate-200'}`}>

                        {/* Step 1 */}
                        <div className="relative flex items-start space-x-3">
                          <div className="absolute -left-6 top-0.5 w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center text-[10px] text-white font-bold">1</div>
                          <div className={`flex-1 p-3.5 rounded-xl border ${isDark ? 'bg-[#090d16]/80 border-[#1f293d]' : 'bg-slate-50 border-slate-200'}`}>
                            <div className="flex justify-between text-xs font-semibold text-indigo-500">
                              <span className="flex items-center space-x-1.5"><ShieldAlert className="w-3.5 h-3.5 text-rose-500" /><span>Airflow Webhook Intercepted</span></span>
                              <span className="text-slate-400 text-[10px]">Step 1</span>
                            </div>
                            <div className={`text-xs mt-1 font-mono p-2 rounded border ${isDark ? 'bg-black/40 border-white/5 text-slate-300' : 'bg-white border-slate-200 text-slate-800'}`}>
                              {selectedIncident.error_message}
                            </div>
                          </div>
                        </div>

                        {/* Step 2 */}
                        <div className="relative flex items-start space-x-3">
                          <div className="absolute -left-6 top-0.5 w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center text-[10px] text-white font-bold">2</div>
                          <div className={`flex-1 p-3.5 rounded-xl border ${isDark ? 'bg-[#090d16]/80 border-[#1f293d]' : 'bg-slate-50 border-slate-200'}`}>
                            <div className="flex justify-between text-xs font-semibold text-indigo-500">
                              <span className="flex items-center space-x-1.5"><Search className="w-3.5 h-3.5 text-amber-500" /><span>Telemetry & Runbook Discovery</span></span>
                              <span className="text-slate-400 text-[10px]">Step 2</span>
                            </div>
                            <div className={`text-xs mt-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                              Runbook Source: <span className="text-emerald-500 font-mono font-semibold">{selectedIncident.playbook_source || 'langchain_ai_diagnosis'}</span>
                            </div>
                            <div className={`text-xs mt-1 ${isDark ? 'text-slate-300' : 'text-slate-800'}`}>
                              Suggested SQL: <span className="font-mono text-amber-500 font-medium">{selectedIncident.recommended_sql}</span>
                            </div>
                          </div>
                        </div>

                        {/* Step 3 */}
                        <div className="relative flex items-start space-x-3">
                          <div className="absolute -left-6 top-0.5 w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center text-[10px] text-white font-bold">3</div>
                          <div className={`flex-1 p-3.5 rounded-xl border ${isDark ? 'bg-[#090d16]/80 border-[#1f293d]' : 'bg-slate-50 border-slate-200'}`}>
                            <div className="flex justify-between text-xs font-semibold text-indigo-500">
                              <span className="flex items-center space-x-1.5"><PhoneCall className="w-3.5 h-3.5 text-sky-500" /><span>Call-E Outbound Voice AI Contact</span></span>
                              <span className="text-slate-400 text-[10px]">Step 3</span>
                            </div>
                            <div className={`text-xs mt-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                              Voice Call placed to <span className="text-sky-500 font-semibold">{selectedIncident.engineer_name || 'Santhosh'}</span> ({maskPhoneNumber(selectedIncident.engineer_phone || '+919003939495')}). Approved resolution queued.
                            </div>
                          </div>
                        </div>

                        {/* Step 4 */}
                        <div className="relative flex items-start space-x-3">
                          <div className="absolute -left-6 top-0.5 w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center text-[10px] text-white font-bold">4</div>
                          <div className={`flex-1 p-3.5 rounded-xl border ${isDark ? 'bg-[#090d16]/80 border-[#1f293d]' : 'bg-slate-50 border-slate-200'}`}>
                            <div className="flex justify-between text-xs font-semibold text-indigo-500">
                              <span className="flex items-center space-x-1.5"><Inbox className="w-3.5 h-3.5 text-purple-500" /><span>Resolution Queue Dispatch</span></span>
                              <span className="text-slate-400 text-[10px]">Step 4</span>
                            </div>
                            <div className={`text-xs mt-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                              Instructions payload enqueued to Resolution Queue for LangGraph execution.
                            </div>
                          </div>
                        </div>

                        {/* Step 5 */}
                        <div className="relative flex items-start space-x-3">
                          <div className="absolute -left-6 top-0.5 w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center text-[10px] text-white font-bold">5</div>
                          <div className={`flex-1 p-3.5 rounded-xl border ${isDark ? 'bg-[#090d16]/80 border-[#1f293d]' : 'bg-slate-50 border-slate-200'}`}>
                            <div className="flex justify-between text-xs font-semibold text-indigo-500">
                              <span className="flex items-center space-x-1.5"><Cpu className="w-3.5 h-3.5 text-indigo-500" /><span>LangGraph StateGraph & Gemini Tools</span></span>
                              <span className="text-slate-400 text-[10px]">Step 5</span>
                            </div>
                            <div className={`text-xs mt-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                              Executed SQL patch on SQLite DB ➔ Re-triggered Airflow DAG ➔ Validated store records.
                            </div>
                          </div>
                        </div>

                        {/* Step 6 */}
                        <div className="relative flex items-start space-x-3">
                          <div className="absolute -left-6 top-0.5 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-[10px] text-white font-bold">6</div>
                          <div className={`flex-1 p-3.5 rounded-xl border ${isDark ? 'bg-[#090d16]/80 border-emerald-500/30' : 'bg-emerald-50 border-emerald-200'}`}>
                            <div className="flex justify-between text-xs font-semibold text-emerald-500">
                              <span className="flex items-center space-x-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /><span>Call-E Post-Validation Follow-up Call</span></span>
                              <span className="text-slate-400 text-[10px]">Step 6</span>
                            </div>
                            <div className={`text-xs mt-1 ${isDark ? 'text-slate-300' : 'text-slate-800'}`}>
                              Confirmation voice call placed to engineer. Operational status verified GREEN.
                            </div>
                          </div>
                        </div>

                      </div>
                    </div>

                  </div>
                ) : (
                  <div className="text-center py-20 text-slate-400 text-sm">Select an incident from the left to view the 6-step remediation timeline.</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: QUEUE INSPECTOR WITH INCIDENT FILTER */}
        {activeTab === 'queues' && (
          <div className="space-y-6">

            {/* Queue Inspector Incident Filter Bar */}
            <div className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${isDark ? 'glass-card border-[#1f293d]' : 'bg-white border-slate-200 shadow-sm'}`}>
              <div className="flex items-center space-x-2">
                <Filter className="w-4 h-4 text-indigo-500" />
                <span className={`text-xs font-heading font-semibold ${isDark ? 'text-white' : 'text-slate-900'}`}>Filter Queue Messages by Incident ID:</span>
              </div>
              <div className="flex items-center space-x-3 w-full sm:w-auto">
                <select
                  value={queueIncidentFilter}
                  onChange={(e) => setQueueIncidentFilter(e.target.value)}
                  className={`px-3 py-1.5 text-xs rounded-lg border focus:outline-none focus:border-indigo-500 w-full sm:w-64 ${isDark ? 'bg-[#111827] border-[#1f293d] text-white' : 'bg-white border-slate-300 text-slate-900'}`}>
                  <option value="ALL">All Incidents ({queueIncidentIds.length})</option>
                  {queueIncidentIds.map(incId => (
                    <option key={incId} value={incId}>{incId}</option>
                  ))}
                </select>
                {queueIncidentFilter !== 'ALL' && (
                  <button
                    onClick={() => setQueueIncidentFilter('ALL')}
                    className="p-1.5 rounded-lg text-xs bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* Error Queue Widget */}
              <div className={`rounded-2xl p-6 border flex flex-col space-y-4 ${isDark ? 'glass-card border-[#1f293d]' : 'bg-white border-slate-200 shadow-sm'}`}>
                <div className={`flex items-center justify-between border-b pb-3 ${isDark ? 'border-[#1f293d]' : 'border-slate-200'}`}>
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 font-bold">📥</div>
                    <div>
                      <h2 className={`text-sm font-heading font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Error Queue Messages</h2>
                      <p className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Received Airflow failure webhooks</p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20">
                    {filteredErrorMsgs.length} messages
                  </span>
                </div>

                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                  {filteredErrorMsgs.length === 0 ? (
                    <div className="text-center py-10 text-slate-400 text-xs">No Error Queue messages match selected incident filter.</div>
                  ) : (
                    filteredErrorMsgs.map(msg => {
                      const isExpanded = !!expandedMsgs[`err_${msg.id}`];
                      return (
                        <div key={msg.id} className={`rounded-xl border transition-all ${isDark ? 'bg-[#090d16]/80 border-[#1f293d]' : 'bg-slate-50 border-slate-200'}`}>
                          {/* Collapsible Header */}
                          <div
                            onClick={() => toggleMsgExpand(`err_${msg.id}`)}
                            className="p-3.5 flex items-center justify-between cursor-pointer select-none">
                            <div className="flex items-center space-x-2.5 min-w-0">
                              <span className="font-mono text-xs font-semibold text-indigo-500">{msg.incident_id}</span>
                              <span className={`px-2 py-0.5 text-[10px] font-bold rounded ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-200 text-slate-700'}`}>{msg.action}</span>
                              <span className={`text-xs truncate ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                                {msg.payload?.dag_id || 'DAG'} / {msg.payload?.task_id || 'Task'}
                              </span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <span className="text-[10px] text-slate-400">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                              {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                            </div>
                          </div>

                          {/* Collapsed Preview Line */}
                          {!isExpanded && (
                            <div className={`px-3.5 pb-3 text-xs font-mono truncate cursor-pointer ${isDark ? 'text-slate-400' : 'text-slate-600'}`} onClick={() => toggleMsgExpand(`err_${msg.id}`)}>
                              Error: {msg.payload?.error_message || 'Airflow DAG execution error payload'}
                            </div>
                          )}

                          {/* Expanded Full Payload JSON */}
                          {isExpanded && (
                            <div className={`px-3.5 pb-3.5 border-t pt-2.5 ${isDark ? 'border-[#1f293d]' : 'border-slate-200'}`}>
                              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Full JSON Message Payload:</div>
                              <pre className={`text-xs font-mono p-3 rounded-lg overflow-x-auto text-[11px] ${isDark ? 'bg-black/60 text-amber-300 border border-white/5' : 'bg-slate-900 text-amber-300'}`}>
                                {JSON.stringify(msg.payload, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Resolution Queue Widget */}
              <div className={`rounded-2xl p-6 border flex flex-col space-y-4 ${isDark ? 'glass-card border-[#1f293d]' : 'bg-white border-slate-200 shadow-sm'}`}>
                <div className={`flex items-center justify-between border-b pb-3 ${isDark ? 'border-[#1f293d]' : 'border-slate-200'}`}>
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-500 font-bold">📤</div>
                    <div>
                      <h2 className={`text-sm font-heading font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Resolution Queue Messages</h2>
                      <p className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Dispatched resolution payloads for LangGraph</p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-purple-500/10 text-purple-500 border border-purple-500/20">
                    {filteredResolutionMsgs.length} messages
                  </span>
                </div>

                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                  {filteredResolutionMsgs.length === 0 ? (
                    <div className="text-center py-10 text-slate-400 text-xs">No Resolution Queue messages match selected incident filter.</div>
                  ) : (
                    filteredResolutionMsgs.map(msg => {
                      const isExpanded = !!expandedMsgs[`res_${msg.id}`];
                      return (
                        <div key={msg.id} className={`rounded-xl border transition-all ${isDark ? 'bg-[#090d16]/80 border-[#1f293d]' : 'bg-slate-50 border-slate-200'}`}>
                          {/* Collapsible Header */}
                          <div
                            onClick={() => toggleMsgExpand(`res_${msg.id}`)}
                            className="p-3.5 flex items-center justify-between cursor-pointer select-none">
                            <div className="flex items-center space-x-2.5 min-w-0">
                              <span className="font-mono text-xs font-semibold text-indigo-500">{msg.incident_id}</span>
                              <span className={`px-2 py-0.5 text-[10px] font-bold rounded ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-200 text-slate-700'}`}>{msg.action}</span>
                              <span className={`text-xs truncate ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                                Approved: {msg.payload?.approved ? 'YES' : 'NO'}
                              </span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <span className="text-[10px] text-slate-400">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                              {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                            </div>
                          </div>

                          {/* Collapsed Preview Line */}
                          {!isExpanded && (
                            <div className={`px-3.5 pb-3 text-xs font-mono truncate cursor-pointer ${isDark ? 'text-slate-400' : 'text-slate-600'}`} onClick={() => toggleMsgExpand(`res_${msg.id}`)}>
                              SQL: {msg.payload?.resolution_instructions || 'Approved SQL resolution payload'}
                            </div>
                          )}

                          {/* Expanded Full Payload JSON */}
                          {isExpanded && (
                            <div className={`px-3.5 pb-3.5 border-t pt-2.5 ${isDark ? 'border-[#1f293d]' : 'border-slate-200'}`}>
                              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Full JSON Message Payload:</div>
                              <pre className={`text-xs font-mono p-3 rounded-lg overflow-x-auto text-[11px] ${isDark ? 'bg-black/60 text-purple-300 border border-white/5' : 'bg-slate-900 text-purple-300'}`}>
                                {JSON.stringify(msg.payload, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

            </div>
          </div>
        )}

        {/* TAB 3: AUDIT LOGS WITH REACT-DATEPICKER FRAMEWORK */}
        {activeTab === 'logs' && (
          <div className={`rounded-2xl p-6 border space-y-5 ${isDark ? 'glass-card border-[#1f293d]' : 'bg-white border-slate-200 shadow-sm'}`}>

            {/* Centered Heading */}
            <div className="text-center border-b pb-4 border-[#1f293d]">
              <h2 className={`text-xl font-heading font-bold text-center ${isDark ? 'text-white' : 'text-slate-900'}`}>Microservices Telemetry Audit Logs</h2>
              <p className={`text-xs text-center mt-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Real-time audit log stream stored in SQLite telemetry database ({filteredLogs.length} matching logs)
              </p>
            </div>

            {/* Filter Bar Controls & Quick Time Presets */}
            <div className={`p-4 rounded-2xl border space-y-4 ${isDark ? 'bg-[#090d16]/70 border-[#1f293d]' : 'bg-slate-50 border-slate-200'}`}>

              {/* Top Row: Quick Presets */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#1f293d]/50">
                <div className="flex items-center space-x-2 text-xs font-semibold text-indigo-400">
                  <Calendar className="w-4 h-4" />
                  <span>Quick Time Presets:</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => { setFilterStartDate(null); setFilterEndDate(null); }}
                    className={`px-3 py-1 text-xs rounded-lg border font-medium transition-all ${!filterStartDate && !filterEndDate ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm' : (isDark ? 'bg-[#111827] border-[#1f293d] text-slate-400 hover:text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100')}`}>
                    All Time
                  </button>
                  <button
                    onClick={() => { setFilterStartDate(new Date(Date.now() - 15 * 60 * 1000)); setFilterEndDate(null); }}
                    className={`px-3 py-1 text-xs rounded-lg border font-medium transition-all ${filterStartDate && !filterEndDate ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm' : (isDark ? 'bg-[#111827] border-[#1f293d] text-slate-400 hover:text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100')}`}>
                    Last 15 Mins
                  </button>
                  <button
                    onClick={() => { setFilterStartDate(new Date(Date.now() - 60 * 60 * 1000)); setFilterEndDate(null); }}
                    className={`px-3 py-1 text-xs rounded-lg border font-medium transition-all ${isDark ? 'bg-[#111827] border-[#1f293d] text-slate-400 hover:text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'}`}>
                    Last 1 Hour
                  </button>
                  <button
                    onClick={() => { setFilterStartDate(new Date(new Date().setHours(0, 0, 0, 0))); setFilterEndDate(null); }}
                    className={`px-3 py-1 text-xs rounded-lg border font-medium transition-all ${isDark ? 'bg-[#111827] border-[#1f293d] text-slate-400 hover:text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'}`}>
                    Today
                  </button>
                </div>
              </div>

              {/* Main Filter Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 items-end">

                {/* 1. Keyword Search */}
                <div className="flex flex-col space-y-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center space-x-1">
                    <Search className="w-3 h-3 text-indigo-400" />
                    <span>Search Keyword</span>
                  </label>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search logs..."
                      value={searchLog}
                      onChange={(e) => setSearchLog(e.target.value)}
                      className={`pl-9 pr-3 py-2 text-xs rounded-xl border w-full focus:outline-none focus:border-indigo-500 transition-all ${isDark ? 'bg-[#111827] border-[#1f293d] text-white placeholder:text-slate-600' : 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400'}`}
                    />
                  </div>
                </div>

                {/* 2. Incident Filter */}
                <div className="flex flex-col space-y-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center space-x-1">
                    <Filter className="w-3 h-3 text-indigo-400" />
                    <span>Incident ID</span>
                  </label>
                  <select
                    value={filterIncident}
                    onChange={(e) => setFilterIncident(e.target.value)}
                    className={`px-3 py-2 text-xs rounded-xl border w-full focus:outline-none focus:border-indigo-500 transition-all ${isDark ? 'bg-[#111827] border-[#1f293d] text-white' : 'bg-white border-slate-300 text-slate-900'}`}>
                    <option value="ALL">All Incidents</option>
                    {uniqueIncidents.map(incId => (
                      <option key={incId} value={incId}>{incId}</option>
                    ))}
                  </select>
                </div>

                {/* 3. Log Severity */}
                <div className="flex flex-col space-y-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center space-x-1">
                    <ShieldAlert className="w-3 h-3 text-amber-400" />
                    <span>Log Severity</span>
                  </label>
                  <select
                    value={filterLogLevel}
                    onChange={(e) => setFilterLogLevel(e.target.value)}
                    className={`px-3 py-2 text-xs rounded-xl border w-full focus:outline-none focus:border-indigo-500 transition-all ${isDark ? 'bg-[#111827] border-[#1f293d] text-white' : 'bg-white border-slate-300 text-slate-900'}`}>
                    <option value="ALL">All Log Levels</option>
                    <option value="INFO">INFO</option>
                    <option value="SUCCESS">SUCCESS</option>
                    <option value="WARNING">WARNING</option>
                    <option value="ERROR">ERROR</option>
                  </select>
                </div>

                {/* 4. Start Date/Time Picker */}
                <div className="flex flex-col space-y-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center space-x-1">
                    <Calendar className="w-3 h-3 text-sky-400" />
                    <span>Start Date & Time</span>
                  </label>
                  <div className={isDark ? 'dark-datepicker' : ''}>
                    <DatePicker
                      selected={filterStartDate}
                      onChange={(date) => setFilterStartDate(date)}
                      showTimeSelect
                      timeFormat="HH:mm"
                      timeIntervals={15}
                      dateFormat="MMM d, yyyy h:mm aa"
                      placeholderText="Start datetime..."
                      customInput={
                        <CustomDateInput
                          placeholder="Start datetime..."
                          isDark={isDark}
                          icon={Calendar}
                          onClear={() => setFilterStartDate(null)}
                        />
                      }
                    />
                  </div>
                </div>

                {/* 5. End Date/Time Picker */}
                <div className="flex flex-col space-y-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center space-x-1">
                    <Clock className="w-3 h-3 text-sky-400" />
                    <span>End Date & Time</span>
                  </label>
                  <div className={isDark ? 'dark-datepicker' : ''}>
                    <DatePicker
                      selected={filterEndDate}
                      onChange={(date) => setFilterEndDate(date)}
                      showTimeSelect
                      timeFormat="HH:mm"
                      timeIntervals={15}
                      dateFormat="MMM d, yyyy h:mm aa"
                      placeholderText="End datetime..."
                      customInput={
                        <CustomDateInput
                          placeholder="End datetime..."
                          isDark={isDark}
                          icon={Clock}
                          onClear={() => setFilterEndDate(null)}
                        />
                      }
                    />
                  </div>
                </div>

                {/* 6. Clear Filters Button */}
                <div className="flex flex-col justify-end">
                  <button
                    disabled={!searchLog && filterIncident === 'ALL' && filterLogLevel === 'ALL' && !filterStartDate && !filterEndDate}
                    onClick={() => { setSearchLog(''); setFilterIncident('ALL'); setFilterLogLevel('ALL'); setFilterStartDate(null); setFilterEndDate(null); }}
                    className={`w-full py-2 px-3 text-xs font-semibold rounded-xl border transition-all flex items-center justify-center space-x-1.5 ${(searchLog || filterIncident !== 'ALL' || filterLogLevel !== 'ALL' || filterStartDate || filterEndDate) ? 'bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20 shadow-sm cursor-pointer' : (isDark ? 'bg-slate-800/40 border-slate-800 text-slate-600 cursor-not-allowed' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed')}`}>
                    <X className="w-3.5 h-3.5" />
                    <span>Clear Filters</span>
                  </button>
                </div>

              </div>

            </div>

            {/* Audit Log Stream */}
            <div className="space-y-2 max-h-[550px] overflow-y-auto pr-1">
              {filteredLogs.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-xs">No telemetry audit logs match the selected filters.</div>
              ) : (
                filteredLogs.map(log => (
                  <div key={log.id} className={`p-3 rounded-xl border flex items-start space-x-3 text-xs transition-colors ${isDark ? 'bg-[#090d16]/70 border-[#1f293d]' : 'bg-slate-50 border-slate-200'}`}>
                    <span className={`px-2 py-0.5 font-mono text-[10px] font-bold rounded uppercase shrink-0 ${log.service_name === 'AIRFLOW' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' : log.service_name === 'CALLE_VOICE' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : log.service_name === 'LANGGRAPH' ? 'bg-purple-500/10 text-purple-500 border border-purple-500/20' : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'}`}>
                      {log.service_name}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className={`font-medium ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{log.message}</div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5 flex items-center space-x-2">
                        <span>Incident: <strong className="text-indigo-400">{log.incident_id}</strong></span>
                        <span>•</span>
                        <span>Event: {log.event_type}</span>
                        <span>•</span>
                        <span className={`font-bold ${log.log_status === 'ERROR' ? 'text-rose-500' : log.log_status === 'WARNING' ? 'text-amber-500' : 'text-emerald-500'}`}>{log.log_status}</span>
                      </div>
                    </div>
                    <div className="text-[10px] text-slate-400 whitespace-nowrap shrink-0">{new Date(log.timestamp).toLocaleTimeString()}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 4: ARCHITECTURE & SYSTEM FLOW DIAGRAM */}
        {activeTab === 'flow' && (
          <div className={`rounded-2xl p-6 border space-y-8 ${isDark ? 'glass-card border-[#1f293d]' : 'bg-white border-slate-200 shadow-sm'}`}>

            {/* Header Title */}
            <div className="text-center border-b pb-4 border-[#1f293d]">
              <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 mb-2">
                <Workflow className="w-3.5 h-3.5" />
                <span>End-to-End System Architecture</span>
              </div>
              <h2 className={`text-2xl font-heading font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                Autonomous Incident Remediation Pipeline
              </h2>
              <p className={`text-xs mt-1 max-w-2xl mx-auto ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Interactive flow diagram showing how Airflow DAG failures trigger Call-E Voice AI calls, LangGraph StateGraph SQL execution, and post-validation verification calls.
              </p>
            </div>

            {/* Architecture Node Flow Diagram */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">

              {/* Node 1 */}
              <div className={`p-5 rounded-2xl border relative flex flex-col space-y-3 transition-all hover:scale-[1.02] ${isDark ? 'bg-[#090d16]/80 border-[#1f293d]' : 'bg-slate-50 border-slate-200 shadow-sm'}`}>
                <div className="flex items-center justify-between">
                  <span className="w-7 h-7 rounded-xl bg-blue-500/20 text-blue-400 font-bold text-xs flex items-center justify-center border border-blue-500/30">1</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">AIRFLOW</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Server className="w-5 h-5 text-blue-400 shrink-0" />
                  <h3 className={`text-sm font-heading font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Airflow Failure Webhook</h3>
                </div>
                <p className={`text-xs leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  Airflow DAG task fails during execution. The custom failure callback intercepts the error details and posts a JSON payload to FastAPI.
                </p>
                <div className="pt-2 flex items-center text-xs font-mono text-blue-400 space-x-1">
                  <span>DAG Failure</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </div>

              {/* Node 2 */}
              <div className={`p-5 rounded-2xl border relative flex flex-col space-y-3 transition-all hover:scale-[1.02] ${isDark ? 'bg-[#090d16]/80 border-[#1f293d]' : 'bg-slate-50 border-slate-200 shadow-sm'}`}>
                <div className="flex items-center justify-between">
                  <span className="w-7 h-7 rounded-xl bg-amber-500/20 text-amber-400 font-bold text-xs flex items-center justify-center border border-amber-500/30">2</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">FASTAPI & DB</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Database className="w-5 h-5 text-amber-400 shrink-0" />
                  <h3 className={`text-sm font-heading font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Telemetry & Error Queue</h3>
                </div>
                <p className={`text-xs leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  FastAPI logs event into SQLite telemetry database and enqueues payload into Error Queue for automated diagnosis.
                </p>
                <div className="pt-2 flex items-center text-xs font-mono text-amber-400 space-x-1">
                  <span>Enqueued to Error Queue</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </div>

              {/* Node 3 */}
              <div className={`p-5 rounded-2xl border relative flex flex-col space-y-3 transition-all hover:scale-[1.02] ${isDark ? 'bg-[#090d16]/80 border-[#1f293d]' : 'bg-slate-50 border-slate-200 shadow-sm'}`}>
                <div className="flex items-center justify-between">
                  <span className="w-7 h-7 rounded-xl bg-purple-500/20 text-purple-400 font-bold text-xs flex items-center justify-center border border-purple-500/30">3</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">TELEMETRY & AI</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Sparkles className="w-5 h-5 text-purple-400 shrink-0" />
                  <h3 className={`text-sm font-heading font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Runbook & AI SQL Diagnosis</h3>
                </div>
                <p className={`text-xs leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  Searches Jira/Confluence runbooks. If unlisted, invokes Gemini & LangChain to generate dynamic SQL query patch to fix root cause.
                </p>
                <div className="pt-2 flex items-center text-xs font-mono text-purple-400 space-x-1">
                  <span>Suggested SQL Patch</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </div>

              {/* Node 4 */}
              <div className={`p-5 rounded-2xl border relative flex flex-col space-y-3 transition-all hover:scale-[1.02] ${isDark ? 'bg-[#090d16]/80 border-[#1f293d]' : 'bg-slate-50 border-slate-200 shadow-sm'}`}>
                <div className="flex items-center justify-between">
                  <span className="w-7 h-7 rounded-xl bg-sky-500/20 text-sky-400 font-bold text-xs flex items-center justify-center border border-sky-500/30">4</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-sky-500/10 text-sky-400 border border-sky-500/20">CALL-E VOICE AI</span>
                </div>
                <div className="flex items-center space-x-2">
                  <PhoneCall className="w-5 h-5 text-sky-400 shrink-0" />
                  <h3 className={`text-sm font-heading font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Call-E Voice AI Contact</h3>
                </div>
                <p className={`text-xs leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  Call-E places outbound phone call to on-call engineer (Santhosh). Reads error summary & SQL fix, waiting for verbal approval.
                </p>
                <div className="pt-2 flex items-center text-xs font-mono text-sky-400 space-x-1">
                  <span>Verbal Approval</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </div>

              {/* Node 5 */}
              <div className={`p-5 rounded-2xl border relative flex flex-col space-y-3 transition-all hover:scale-[1.02] ${isDark ? 'bg-[#090d16]/80 border-[#1f293d]' : 'bg-slate-50 border-slate-200 shadow-sm'}`}>
                <div className="flex items-center justify-between">
                  <span className="w-7 h-7 rounded-xl bg-indigo-500/20 text-indigo-400 font-bold text-xs flex items-center justify-center border border-indigo-500/30">5</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">RESOLUTION QUEUE</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Inbox className="w-5 h-5 text-indigo-400 shrink-0" />
                  <h3 className={`text-sm font-heading font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Resolution Queue Dispatch</h3>
                </div>
                <p className={`text-xs leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  Upon engineer approval, Call-E enqueues instructions payload to Resolution Queue for automated multi-step execution.
                </p>
                <div className="pt-2 flex items-center text-xs font-mono text-indigo-400 space-x-1">
                  <span>Enqueued to LangGraph</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </div>

              {/* Node 6 */}
              <div className={`p-5 rounded-2xl border relative flex flex-col space-y-3 transition-all hover:scale-[1.02] ${isDark ? 'bg-[#090d16]/80 border-[#1f293d]' : 'bg-slate-50 border-slate-200 shadow-sm'}`}>
                <div className="flex items-center justify-between">
                  <span className="w-7 h-7 rounded-xl bg-purple-500/20 text-purple-400 font-bold text-xs flex items-center justify-center border border-purple-500/30">6</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">LANGGRAPH</span>
                </div>
                <div className="flex items-center space-x-2">
                  <GitMerge className="w-5 h-5 text-purple-400 shrink-0" />
                  <h3 className={`text-sm font-heading font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>LangGraph StateGraph Execution</h3>
                </div>
                <p className={`text-xs leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  LangGraph executes StateGraph nodes: runs SQL patch on database ➔ re-triggers Airflow DAG ➔ verifies record consistency.
                </p>
                <div className="pt-2 flex items-center text-xs font-mono text-purple-400 space-x-1">
                  <span>DB & Airflow Patched</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </div>

              {/* Node 7 */}
              <div className={`p-5 rounded-2xl border relative flex flex-col space-y-3 transition-all hover:scale-[1.02] lg:col-span-2 ${isDark ? 'bg-[#090d16]/80 border-emerald-500/30' : 'bg-emerald-50/70 border-emerald-200 shadow-sm'}`}>
                <div className="flex items-center justify-between">
                  <span className="w-7 h-7 rounded-xl bg-emerald-500/20 text-emerald-400 font-bold text-xs flex items-center justify-center border border-emerald-500/30">7</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">CONFIRMATION & RESOLUTION</span>
                </div>
                <div className="flex items-center space-x-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                  <h3 className={`text-sm font-heading font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Call-E Post-Validation Follow-up Call</h3>
                </div>
                <p className={`text-xs leading-relaxed ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                  Call-E places confirmation follow-up voice call to the engineer verifying operational status GREEN. Telemetry marks incident as <strong>RESOLVED</strong> in SQLite database.
                </p>
                <div className="pt-2 flex items-center text-xs font-mono text-emerald-500 space-x-1 font-bold">
                  <span>Incident Auto-Remediated & Verified GREEN 🟢</span>
                </div>
              </div>

            </div>

            {/* Component Mapping */}
            <div className={`p-6 rounded-2xl border space-y-4 ${isDark ? 'bg-[#090d16]/60 border-[#1f293d]' : 'bg-slate-50 border-slate-200'}`}>
              <h3 className={`text-base font-heading font-bold flex items-center space-x-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                <Layers className="w-4 h-4 text-indigo-400" />
                <span>Microservice Component Mapping</span>
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div className={`p-4 rounded-xl border ${isDark ? 'bg-[#111827] border-[#1f293d]' : 'bg-white border-slate-200'}`}>
                  <div className="font-bold text-indigo-400 mb-1">FastAPI Telemetry Hub</div>
                  <div className={`text-[11px] leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    Port 7071 web server exposing REST API endpoints (`/api/dashboard/stats`, `/api/incidents`, `/api/queues`, `/api/logs`) and hosting the Vite React SPA bundle.
                  </div>
                </div>

                <div className={`p-4 rounded-xl border ${isDark ? 'bg-[#111827] border-[#1f293d]' : 'bg-white border-slate-200'}`}>
                  <div className="font-bold text-sky-400 mb-1">Call-E Voice AI SDK</div>
                  <div className={`text-[11px] leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    Handles outbound phone calls to on-call engineers using locale-aware speech synthesis (`en-IN` / `hi-IN`) and processes real-time verbal confirmation responses.
                  </div>
                </div>

                <div className={`p-4 rounded-xl border ${isDark ? 'bg-[#111827] border-[#1f293d]' : 'bg-white border-slate-200'}`}>
                  <div className="font-bold text-purple-400 mb-1">LangGraph & Gemini Agent</div>
                  <div className={`text-[11px] leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    StateGraph node graph utilizing Gemini AI tools to execute SQL patches against SQLite DB, clear Airflow state, and trigger DAG re-runs automatically.
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* TAB 5: VOICE & ON-CALL METRICS & ROSTER DIRECTORY */}
        {activeTab === 'metrics' && (
          <div className={`rounded-2xl p-6 border space-y-8 ${isDark ? 'glass-card border-[#1f293d]' : 'bg-white border-slate-200 shadow-sm'}`}>

            {/* Header Title */}
            <div className="text-center border-b pb-4 border-[#1f293d]">
              <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20 mb-2">
                <BarChart3 className="w-3.5 h-3.5" />
                <span>Voice AI & On-Call Analytics</span>
              </div>
              <h2 className={`text-2xl font-heading font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                Voice Calls & On-Call Support Roster Metrics
              </h2>
              <p className={`text-xs mt-1 max-w-2xl mx-auto ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Comprehensive metrics on outbound Call-E voice calls, pickup rates, response speed, and registered global support engineers.
              </p>
            </div>

            {/* Voice Metrics KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">

              <div className={`p-5 rounded-2xl border-l-4 border-indigo-500 ${isDark ? 'bg-[#090d16]/80 border-t border-r border-b border-[#1f293d]' : 'bg-slate-50 border-t border-r border-b border-slate-200 shadow-sm'}`}>
                <div className="flex items-center justify-between text-indigo-500 mb-1">
                  <span className={`text-xs font-medium uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Calls Placed</span>
                  <PhoneForwarded className="w-4 h-4" />
                </div>
                <div className={`text-3xl font-heading font-bold mt-1 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                  {(stats.total_incidents || 1) * 2}
                </div>
                <div className="text-xs text-indigo-400 mt-2 font-medium">
                  Outbound Initial & Follow-up
                </div>
              </div>

              <div className={`p-5 rounded-2xl border-l-4 border-emerald-500 ${isDark ? 'bg-[#090d16]/80 border-t border-r border-b border-[#1f293d]' : 'bg-slate-50 border-t border-r border-b border-slate-200 shadow-sm'}`}>
                <div className="flex items-center justify-between text-emerald-500 mb-1">
                  <span className={`text-xs font-medium uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Calls Picked Up</span>
                  <PhoneIncoming className="w-4 h-4" />
                </div>
                <div className="text-3xl font-heading font-bold text-emerald-500 mt-1">
                  {(stats.resolved_incidents || 1) * 2}
                </div>
                <div className="text-xs text-emerald-400 mt-2 font-medium">
                  Answered & Verbal Confirmed
                </div>
              </div>

              <div className={`p-5 rounded-2xl border-l-4 border-purple-500 ${isDark ? 'bg-[#090d16]/80 border-t border-r border-b border-[#1f293d]' : 'bg-slate-50 border-t border-r border-b border-slate-200 shadow-sm'}`}>
                <div className="flex items-center justify-between text-purple-500 mb-1">
                  <span className={`text-xs font-medium uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Answer Speed</span>
                  <Clock className="w-4 h-4" />
                </div>
                <div className="text-3xl font-heading font-bold text-purple-400 mt-1">
                  12.4s
                </div>
                <div className="text-xs text-purple-400 mt-2 font-medium">
                  Avg On-Call Answer Delay
                </div>
              </div>

              <div className={`p-5 rounded-2xl border-l-4 border-sky-500 ${isDark ? 'bg-[#090d16]/80 border-t border-r border-b border-[#1f293d]' : 'bg-slate-50 border-t border-r border-b border-slate-200 shadow-sm'}`}>
                <div className="flex items-center justify-between text-sky-500 mb-1">
                  <span className={`text-xs font-medium uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Support Roster</span>
                  <Users className="w-4 h-4" />
                </div>
                <div className={`text-3xl font-heading font-bold mt-1 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                  {oncallRosterList.length}
                </div>
                <div className="text-xs text-sky-400 mt-2 font-medium">
                  Engineers Across 4 Regions
                </div>
              </div>

              <div className={`p-5 rounded-2xl border-l-4 border-amber-500 ${isDark ? 'bg-[#090d16]/80 border-t border-r border-b border-[#1f293d]' : 'bg-slate-50 border-t border-r border-b border-slate-200 shadow-sm'}`}>
                <div className="flex items-center justify-between text-amber-500 mb-1">
                  <span className={`text-xs font-medium uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Call Success Rate</span>
                  <Award className="w-4 h-4" />
                </div>
                <div className="text-3xl font-heading font-bold text-amber-400 mt-1">
                  100.0%
                </div>
                <div className="text-xs text-amber-400 mt-2 font-medium">
                  Voice Connection Reliability
                </div>
              </div>

            </div>

            {/* Voice AI Health & Telemetry Info Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

              <div className={`p-5 rounded-2xl border flex flex-col justify-between ${isDark ? 'bg-[#090d16]/80 border-[#1f293d]' : 'bg-slate-50 border-slate-200 shadow-sm'}`}>
                <div className="flex items-center justify-between pb-3 border-b border-[#1f293d]">
                  <div className="flex items-center space-x-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-500" />
                    <span className={`text-xs font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Call-E Voice AI SDK Status</span>
                  </div>
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                    ONLINE 🟢
                  </span>
                </div>
                <div className="space-y-2 mt-3 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">SDK Engine:</span>
                    <span className="font-semibold text-indigo-400">Call-E Voice Agent v1.0</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Speech Latency:</span>
                    <span className="font-semibold text-emerald-400">120ms</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Supported Locales:</span>
                    <span className="font-semibold text-sky-400">en-IN, hi-IN, en-US, ja-JP</span>
                  </div>
                </div>
              </div>

              <div className={`p-5 rounded-2xl border flex flex-col justify-between ${isDark ? 'bg-[#090d16]/80 border-[#1f293d]' : 'bg-slate-50 border-slate-200 shadow-sm'}`}>
                <div className="flex items-center justify-between pb-3 border-b border-[#1f293d]">
                  <div className="flex items-center space-x-2">
                    <PhoneCall className="w-4 h-4 text-indigo-500" />
                    <span className={`text-xs font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Call Type Distribution</span>
                  </div>
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    Active
                  </span>
                </div>
                <div className="space-y-2 mt-3 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Initial Outbound Calls:</span>
                    <span className="font-mono font-bold text-amber-400">{stats.total_incidents || 1} calls</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Post-Fix Follow-up Calls:</span>
                    <span className="font-mono font-bold text-emerald-400">{stats.resolved_incidents || 1} calls</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Failed / Dropped Calls:</span>
                    <span className="font-mono font-bold text-slate-500">0 calls</span>
                  </div>
                </div>
              </div>

              <div className={`p-5 rounded-2xl border flex flex-col justify-between ${isDark ? 'bg-[#090d16]/80 border-[#1f293d]' : 'bg-slate-50 border-slate-200 shadow-sm'}`}>
                <div className="flex items-center justify-between pb-3 border-b border-[#1f293d]">
                  <div className="flex items-center space-x-2">
                    <Globe className="w-4 h-4 text-sky-500" />
                    <span className={`text-xs font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Global Regional Roster</span>
                  </div>
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
                    24/7 Coverage
                  </span>
                </div>
                <div className="space-y-2 mt-3 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">🇮🇳 India (APAC West):</span>
                    <span className="font-semibold text-sky-400">2 Engineers</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">🇺🇸 United States (Americas):</span>
                    <span className="font-semibold text-indigo-400">1 Engineer</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">🇬🇧 UK & 🇯🇵 Japan:</span>
                    <span className="font-semibold text-purple-400">2 Engineers</span>
                  </div>
                </div>
              </div>

            </div>

            {/* Bottom Section: Registered On-Call Support Engineers Directory Table */}
            <div className={`rounded-2xl border overflow-hidden ${isDark ? 'bg-[#090d16]/60 border-[#1f293d]' : 'bg-white border-slate-200 shadow-sm'}`}>
              <div className={`p-5 border-b flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${isDark ? 'border-[#1f293d] bg-[#111827]/40' : 'border-slate-200 bg-slate-50'}`}>
                <div>
                  <h3 className={`text-base font-heading font-bold flex items-center space-x-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                    <Users className="w-4.5 h-4.5 text-indigo-500" />
                    <span>Global On-Call Support Engineers Roster Directory</span>
                  </h3>
                  <p className={`text-xs mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    Registered engineers eligible for automated Call-E Voice AI dispatch during on-call incidents
                  </p>
                </div>
                <span className="px-3 py-1 text-xs font-bold rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  {oncallRosterList.length} Active Engineers
                </span>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className={`border-b text-xs font-semibold uppercase tracking-wider ${isDark ? 'border-[#1f293d] bg-[#111827] text-slate-400' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                      <th className="py-3.5 px-4">Engineer Name</th>
                      <th className="py-3.5 px-4">Role & Duty Shift</th>
                      <th className="py-3.5 px-4">Country & Region</th>
                      <th className="py-3.5 px-4">Language / Locale</th>
                      <th className="py-3.5 px-4">Masked Phone Number</th>
                      <th className="py-3.5 px-4">Status</th>
                      <th className="py-3.5 px-4 text-right">Calls & Fixed</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y text-xs font-medium ${isDark ? 'divide-[#1f293d] text-slate-200' : 'divide-slate-200 text-slate-800'}`}>
                    {oncallRosterList.map((eng) => (
                      <tr key={eng.id} className={`transition-colors ${isDark ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'}`}>
                        {/* Engineer Name */}
                        <td className="py-4 px-4 font-semibold text-indigo-400">
                          <div className="flex items-center space-x-2">
                            <div className="w-7 h-7 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center font-bold text-indigo-400 text-xs shrink-0">
                              {eng.name.charAt(0)}
                            </div>
                            <span>{eng.name}</span>
                          </div>
                        </td>

                        {/* Role & Duty Shift */}
                        <td className="py-4 px-4">
                          <div className="font-medium">{eng.role}</div>
                        </td>

                        {/* Country & Region */}
                        <td className="py-4 px-4 font-semibold">
                          {getRegionDisplay(eng.region)}
                        </td>

                        {/* Language / Locale */}
                        <td className="py-4 px-4 font-mono text-indigo-400">
                          {getLocaleDisplay(eng.locale)}
                        </td>

                        {/* Masked Phone Number */}
                        <td className="py-4 px-4 font-mono text-slate-400">
                          {maskPhoneNumber(eng.phone)}
                        </td>

                        {/* Status */}
                        <td className="py-4 px-4">
                          <span className={`px-2.5 py-1 text-[10px] font-extrabold rounded-full ${eng.status === 'ACTIVE_NOW' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 animate-pulse' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>
                            {eng.status === 'ACTIVE_NOW' ? '🟢 Active On-Call' : '🟡 Standby'}
                          </span>
                        </td>

                        {/* Calls & Fixed */}
                        <td className="py-4 px-4 text-right font-mono font-bold text-emerald-400">
                          {eng.calls_handled} calls ({eng.resolutions} fixed)
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

            </div>

          </div>
        )}

      </main>

      {/* Footer */}
      <footer className={`border-t py-4 text-center text-xs transition-colors ${isDark ? 'border-[#1f293d] bg-[#111827]/40 text-slate-400' : 'border-slate-200 bg-white text-slate-600'}`}>
        OnTripFix Powered by CALL-E
      </footer>
    </div>
  );
}
