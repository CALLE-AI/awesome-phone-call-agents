'use client';

import React, { useState } from 'react';
import { ShieldAlert, ShieldCheck, Power, RefreshCw } from 'lucide-react';

interface HeaderKillSwitchProps {
  isEngaged: boolean;
  onToggle: (newState: boolean) => Promise<void>;
  onResetSeed: () => Promise<void>;
  activeTab?: 'showcase' | 'studio' | 'console';
  onTabChange?: (tab: 'showcase' | 'studio' | 'console') => void;
}

export const HeaderKillSwitch: React.FC<HeaderKillSwitchProps> = ({
  isEngaged,
  onToggle,
  onResetSeed,
  activeTab = 'showcase',
  onTabChange,
}) => {
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleToggle = async () => {
    setLoading(true);
    try {
      await onToggle(!isEngaged);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      await onResetSeed();
    } finally {
      setResetting(false);
    }
  };

  return (
    <header className="sticky top-0 z-50 border-b border-panel-border bg-background/95 backdrop-blur-md px-4 sm:px-8 py-3.5 shadow-lg shadow-black/20">
      <div className="max-w-[1720px] w-full mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Logo & Platform Badge */}
        <div className="flex items-center space-x-3.5 w-full md:w-auto justify-between md:justify-start">
          <div className="flex items-center space-x-3 cursor-pointer group" onClick={() => onTabChange?.('showcase')}>
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-accent-cyan via-accent-indigo to-accent-emerald flex items-center justify-center font-extrabold text-white shadow-lg shadow-cyan-500/25 text-xl group-hover:scale-105 transition-transform">
              V
            </div>
            <div>
              <div className="flex items-center space-x-2.5">
                <span className="font-extrabold tracking-tight text-white text-xl">VaultCall</span>
                <span className="text-[11px] uppercase font-mono px-2 py-0.5 rounded-md bg-cyan-950/80 border border-cyan-500/40 text-accent-cyan font-bold tracking-wide">
                  CALL-E Hackathon
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono">Autonomous BEC Wire Defense Protocol</p>
            </div>
          </div>
        </div>

        {/* Center View Navigation Tabs */}
        {onTabChange && (
          <nav className="flex items-center p-1.5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-inner">
            <button
              onClick={() => onTabChange('showcase')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-mono transition-all ${
                activeTab === 'showcase'
                  ? 'bg-gradient-to-r from-cyan-600 to-indigo-600 text-white shadow-md shadow-cyan-950/40 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>🌟</span>
              <span>Showcase</span>
            </button>

            <button
              onClick={() => onTabChange('studio')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-mono transition-all ${
                activeTab === 'studio'
                  ? 'bg-gradient-to-r from-emerald-600 to-cyan-600 text-white shadow-md shadow-emerald-950/40 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>📱</span>
              <span>Live Phone Lab</span>
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            </button>

            <button
              onClick={() => onTabChange('console')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-mono transition-all ${
                activeTab === 'console'
                  ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-950/40 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>🏛️</span>
              <span>Treasury Console</span>
            </button>
          </nav>
        )}

        {/* Global Controls & Kill Switch */}
        <div className="flex items-center space-x-3 w-full md:w-auto justify-end">
          <button
            onClick={handleReset}
            disabled={resetting}
            title="Reset to Judge Benchmark Fixtures"
            className="flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-mono font-medium text-slate-300 bg-panel hover:bg-panel-hover border border-panel-border transition-colors shadow-sm"
          >
            <RefreshCw className={`h-4 w-4 ${resetting ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Reset Seed</span>
          </button>

          <div
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-full border text-xs font-mono transition-colors ${
              isEngaged
                ? 'bg-rose-950/60 border-rose-600/50 text-rose-400'
                : 'bg-emerald-950/60 border-emerald-600/50 text-emerald-400'
            }`}
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                isEngaged ? 'bg-rose-500 animate-ping' : 'bg-emerald-400'
              }`}
            />
            <span className="font-bold tracking-wide">{isEngaged ? 'DIALING LOCKED' : 'AIRGAP ACTIVE'}</span>
          </div>

          <button
            onClick={handleToggle}
            disabled={loading}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl font-mono text-xs font-bold transition-all shadow-md ${
              isEngaged
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
                : 'bg-panel-hover hover:bg-rose-950/80 text-rose-300 hover:text-rose-200 border border-rose-900/50'
            }`}
          >
            <Power className="h-4 w-4" />
            <span className="hidden sm:inline">{isEngaged ? 'RESUME DIALING' : 'KILL SWITCH'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
