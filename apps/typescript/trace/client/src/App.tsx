import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { ShieldCheck, History as HistoryIcon, Layers } from 'lucide-react';
import { Dashboard } from './pages/Dashboard.js';
import { History } from './pages/History.js';
import { api, HealthResponse } from './services/api.js';

const NavigationHeader: React.FC = () => {
  const location = useLocation();
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    api.getHealth().then(setHealth).catch(() => {});
  }, []);

  const isLive = health?.mode === 'LIVE';

  const toggleMode = async () => {
    const nextMode = isLive ? 'MOCK' : 'LIVE';
    try {
      await api.setMode(nextMode);
      const updated = await api.getHealth();
      setHealth(updated);
    } catch (err: any) {
      alert(err.message || `Failed to switch to ${nextMode} mode.`);
    }
  };

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-50 shrink-0">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Logo & Product Badge */}
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="bg-blue-600 text-white w-8 h-8 rounded-lg flex items-center justify-center font-extrabold tracking-wider text-sm shadow-xs">
              TR
            </span>
            <div className="leading-tight">
              <span className="text-base font-extrabold tracking-tight text-slate-900 block">
                TRACE
              </span>
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">
                Autonomous Verification Engine
              </span>
            </div>
          </Link>

          {/* Interactive Mode Toggle Pill */}
          <button
            onClick={toggleMode}
            className={`hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ml-3 transition-all hover:opacity-90 cursor-pointer ${
              isLive
                ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                : 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
            }`}
            title="Click to toggle between LIVE and MOCK modes"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isLive ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
              }`}
            />
            <span>{isLive ? 'LIVE MODE ● REAL CALL-E' : 'DEMO MODE ● SIMULATED CALLS'}</span>
            <span className="text-[10px] text-slate-400 font-normal ml-1 underline">Switch</span>
          </button>
        </div>

        {/* Top Navigation */}
        <nav className="flex items-center gap-3 text-xs font-semibold">
          <Link
            to="/"
            className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
              location.pathname === '/'
                ? 'bg-blue-50 text-blue-700 font-bold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Workspace
          </Link>

          <Link
            to="/history"
            className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
              location.pathname === '/history'
                ? 'bg-blue-50 text-blue-700 font-bold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <HistoryIcon className="w-3.5 h-3.5" />
            Audit History
          </Link>
        </nav>
      </div>
    </header>
  );
};

export const App: React.FC = () => {
  return (
    <Router>
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
        <NavigationHeader />

        <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-5 flex flex-col">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/history" element={<History />} />
          </Routes>
        </main>

        <footer className="bg-white border-t border-slate-200 py-3.5 mt-auto text-xs text-slate-500 shrink-0">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left">
            <p className="flex items-center justify-center gap-1.5 font-medium text-slate-700">
              <ShieldCheck className="w-4 h-4 text-blue-600" />
              TRACE Autonomous Real-World Verification System • Powered by CALL-E
            </p>
            <p className="text-[11px] text-slate-400">
              Direct E.164 telephony execution • Pure deterministic discrepancy reconciliation
            </p>
          </div>
        </footer>
      </div>
    </Router>
  );
};

export default App;
