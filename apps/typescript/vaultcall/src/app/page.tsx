'use client';

import React, { useState, useEffect } from 'react';
import { VerificationRecord, VoiceVerificationCertificate } from '@/lib/types';
import { HeaderKillSwitch } from '@/components/HeaderKillSwitch';
import { VerificationCard } from '@/components/VerificationCard';
import { ForensicAuditModal } from '@/components/ForensicAuditModal';
import { CertificateModal } from '@/components/CertificateModal';
import { ShowcaseLanding } from '@/components/ShowcaseLanding';
import { InteractiveVerificationStudio } from '@/components/InteractiveVerificationStudio';
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Lock,
  PhoneForwarded,
  DollarSign,
  Search,
  Sparkles,
  Layers,
  ArrowUpRight,
  RefreshCw,
  Zap,
  Play,
} from 'lucide-react';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<'showcase' | 'studio' | 'console'>('showcase');
  const [verifications, setVerifications] = useState<VerificationRecord[]>([]);
  const [stats, setStats] = useState<any>({
    totalExposureUsd: 0,
    fraudInterceptedUsd: 0,
    confirmedValidCount: 0,
    fraudInterceptedCount: 0,
    heldForReviewCount: 0,
    inProgressCount: 0,
  });
  const [killSwitch, setKillSwitch] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [filter, setFilter] = useState<string>('ALL');
  const [selectedRecord, setSelectedRecord] = useState<VerificationRecord | null>(null);
  const [activeCertificate, setActiveCertificate] = useState<VoiceVerificationCertificate | null>(null);
  const [showJudgeTour, setShowJudgeTour] = useState<boolean>(true);

  const fetchState = async () => {
    try {
      const res = await fetch('/api/verifications');
      if (res.ok) {
        const data = await res.json();
        setVerifications(data.verifications);
        setStats(data.stats);
        setKillSwitch(data.killSwitch);
      }
    } catch (err) {
      console.error('Failed to load state:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchState();
  }, []);

  const handleToggleKillSwitch = async (engaged: boolean) => {
    try {
      const res = await fetch('/api/kill-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engaged }),
      });
      if (res.ok) {
        const data = await res.json();
        setKillSwitch(data.engaged);
        fetchState();
      }
    } catch (err) {
      console.error('Failed to toggle kill switch:', err);
    }
  };

  const handleResetSeed = async () => {
    try {
      const res = await fetch('/api/verifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset_seed' }),
      });
      if (res.ok) {
        await fetchState();
        setSelectedRecord(null);
      }
    } catch (err) {
      console.error('Failed to reset seed:', err);
    }
  };

  const handleDispatch = async (id: string, scenario?: string) => {
    try {
      const res = await fetch(`/api/verifications/${id}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulationScenario: scenario }),
      });
      if (res.ok) {
        const data = await res.json();
        await fetchState();
        if (selectedRecord && selectedRecord.id === id) {
          setSelectedRecord(data.record);
        }
      }
    } catch (err) {
      console.error('Dispatch failed:', err);
    }
  };

  const filteredVerifications = verifications.filter((v) => {
    if (filter === 'VALID') return v.status === 'CONFIRMED_VALID';
    if (filter === 'FRAUD') return v.status === 'FRAUD_INTERCEPTED';
    if (filter === 'HOLD') return v.status === 'GATEKEEPER_HOLD';
    return true;
  });

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Pinned Global Header & Emergency Kill Switch & View Switcher */}
      <HeaderKillSwitch
        isEngaged={killSwitch}
        onToggle={handleToggleKillSwitch}
        onResetSeed={handleResetSeed}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* Judge 60-Second Quick Tour Banner */}
      {showJudgeTour && (
        <div className="bg-gradient-to-r from-cyan-950/90 via-slate-900 to-indigo-950/90 border-b border-cyan-800/40 px-4 sm:px-8 py-2">
          <div className="max-w-[1720px] w-full mx-auto flex flex-col lg:flex-row items-center justify-between gap-3 text-xs sm:text-sm font-mono">
            <div className="flex items-center space-x-2.5 text-cyan-300">
              <Sparkles className="h-4 w-4 text-accent-cyan shrink-0 animate-pulse" />
              <span>
                <strong>CALL-E Hackathon Judge Fast-Path:</strong> Explore the 3 views above or test live presets below.
              </span>
            </div>
            <div className="flex items-center space-x-2.5 shrink-0">
              <button
                onClick={() => {
                  setActiveTab('studio');
                }}
                className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 transition-colors font-semibold"
              >
                📱 Test Phone Sim (Apex Fraud)
              </button>
              <button
                onClick={() => {
                  const valid = verifications.find((v) => v.certificate);
                  if (valid && valid.certificate) {
                    setActiveCertificate(valid.certificate);
                  } else {
                    setActiveTab('console');
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 transition-colors font-semibold"
              >
                🏛️ Inspect SOX 404 Certificate
              </button>
              <button
                onClick={() => setShowJudgeTour(false)}
                className="text-slate-400 hover:text-slate-200 px-2 py-1"
                title="Dismiss banner"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Executive Content Area */}
      <main className="flex-1 w-full max-w-[1720px] mx-auto px-4 sm:px-8 py-4 sm:py-5">
        {/* Tab 1: Product Showcase Landing */}
        {activeTab === 'showcase' && (
          <ShowcaseLanding
            onOpenWorkspace={() => setActiveTab('studio')}
            onSelectCase={(caseId) => {
              const rec = verifications.find((v) => v.id === caseId);
              if (rec) {
                setSelectedRecord(rec);
              } else {
                setActiveTab('studio');
              }
            }}
          />
        )}

        {/* Tab 2: Interactive Telephony Lab / Phone Simulator */}
        {activeTab === 'studio' && (
          <InteractiveVerificationStudio
            records={verifications}
            onDispatch={handleDispatch}
            onViewCertificate={(rec) => {
              if (rec.certificate) setActiveCertificate(rec.certificate);
            }}
          />
        )}

        {/* Tab 3: Treasury Operations Console */}
        {activeTab === 'console' && (
          <div className="space-y-6">
            {/* Streamlined Executive Command Banner */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-panel via-slate-900 to-slate-950 border border-panel-border shadow-xl">
              <div className="space-y-1.5">
                <div className="flex items-center space-x-2.5">
                  <span className="px-2.5 py-0.5 rounded-md bg-accent-cyan/15 border border-accent-cyan/40 text-accent-cyan font-mono text-xs font-bold">
                    CALL-E Hackathon Flagship
                  </span>
                  <span className="text-xs text-slate-400 font-mono">
                    SOX 404 & Anti-BEC Wire Release Standard
                  </span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                  Treasury Out-of-Band Voice Defense
                </h1>
                <p className="text-xs sm:text-sm text-slate-300 max-w-4xl leading-relaxed">
                  When vendor bank modifications arrive via email or invoice attachment, VaultCall halts ERP wire release, resolves the vendor’s hardened PBX line, and deploys CALL-E to conduct an air-gapped cryptographic challenge-response before releasing millions in capital.
                </p>
              </div>

              <div className="flex items-center space-x-3 shrink-0">
                <button
                  onClick={handleResetSeed}
                  className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-mono font-medium transition-colors"
                >
                  <RefreshCw className="h-4 w-4 text-accent-cyan" />
                  <span>Reset Seed State</span>
                </button>
              </div>
            </div>

            {/* Real-time Enterprise Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <div className="p-6 rounded-2xl bg-panel border border-panel-border space-y-1.5 hover:border-slate-700 transition-colors shadow-lg">
                <div className="flex items-center justify-between text-slate-400 text-xs sm:text-sm font-mono">
                  <span>Protected Capital</span>
                  <DollarSign className="h-5 w-5 text-accent-cyan" />
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold font-mono text-white">
                  ${stats.totalExposureUsd.toLocaleString()}
                </div>
                <p className="text-xs text-slate-400 font-mono">Across pending & verified modifications</p>
              </div>

              <div className="p-6 rounded-2xl bg-panel border border-rose-900/50 space-y-1.5 hover:border-rose-700/60 transition-colors shadow-lg shadow-rose-950/20">
                <div className="flex items-center justify-between text-rose-400 text-xs sm:text-sm font-mono">
                  <span>BEC Fraud Intercepted</span>
                  <ShieldAlert className="h-5 w-5 text-rose-400" />
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold font-mono text-rose-300">
                  ${stats.fraudInterceptedUsd.toLocaleString()}
                </div>
                <p className="text-xs text-rose-400/80 font-mono">
                  {stats.fraudInterceptedCount} malicious attacks frozen
                </p>
              </div>

              <div className="p-6 rounded-2xl bg-panel border border-emerald-900/50 space-y-1.5 hover:border-emerald-700/60 transition-colors shadow-lg shadow-emerald-950/20">
                <div className="flex items-center justify-between text-emerald-400 text-xs sm:text-sm font-mono">
                  <span>Verified Wire Authorizations</span>
                  <ShieldCheck className="h-5 w-5 text-emerald-400" />
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold font-mono text-emerald-300">
                  {stats.confirmedValidCount}
                </div>
                <p className="text-xs text-emerald-400/80 font-mono">Cryptographic certificates minted</p>
              </div>

              <div className="p-6 rounded-2xl bg-panel border border-amber-900/50 space-y-1.5 hover:border-amber-700/60 transition-colors shadow-lg shadow-amber-950/20">
                <div className="flex items-center justify-between text-amber-400 text-xs sm:text-sm font-mono">
                  <span>Gatekeeper Holds</span>
                  <AlertTriangle className="h-5 w-5 text-amber-400" />
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold font-mono text-amber-300">
                  {stats.heldForReviewCount}
                </div>
                <p className="text-xs text-amber-400/80 font-mono">Voicemail / receptionist fail-closed</p>
              </div>
            </div>

            {/* Filter Navigation Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
              <div className="flex items-center space-x-1.5 p-1 rounded-xl bg-panel border border-panel-border text-xs font-mono">
                <button
                  onClick={() => setFilter('ALL')}
                  className={`px-3.5 py-1.5 rounded-lg transition-colors ${
                    filter === 'ALL' ? 'bg-panel-hover text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  All Audits ({verifications.length})
                </button>
                <button
                  onClick={() => setFilter('VALID')}
                  className={`px-3.5 py-1.5 rounded-lg transition-colors ${
                    filter === 'VALID' ? 'bg-emerald-950/80 text-emerald-300 font-semibold' : 'text-slate-400 hover:text-emerald-300'
                  }`}
                >
                  Confirmed Valid ({stats.confirmedValidCount})
                </button>
                <button
                  onClick={() => setFilter('FRAUD')}
                  className={`px-3.5 py-1.5 rounded-lg transition-colors ${
                    filter === 'FRAUD' ? 'bg-rose-950/80 text-rose-300 font-semibold' : 'text-slate-400 hover:text-rose-300'
                  }`}
                >
                  Fraud Intercepted ({stats.fraudInterceptedCount})
                </button>
                <button
                  onClick={() => setFilter('HOLD')}
                  className={`px-3.5 py-1.5 rounded-lg transition-colors ${
                    filter === 'HOLD' ? 'bg-amber-950/80 text-amber-300 font-semibold' : 'text-slate-400 hover:text-amber-300'
                  }`}
                >
                  Gatekeeper Hold ({stats.heldForReviewCount})
                </button>
              </div>

              <div className="text-xs text-slate-400 font-mono">
                Fast Path: Click any card to inspect forensic transcript proofs or trigger live simulation.
              </div>
            </div>

            {/* Live Verifications Queue */}
            <div className="space-y-3">
              {loading ? (
                <div className="text-center py-20 text-slate-500 font-mono text-sm">
                  Loading verification records...
                </div>
              ) : filteredVerifications.length === 0 ? (
                <div className="text-center py-16 text-slate-500 font-mono text-sm bg-panel border border-panel-border rounded-2xl">
                  No audit records match the selected filter.
                </div>
              ) : (
                filteredVerifications.map((record) => (
                  <VerificationCard
                    key={record.id}
                    record={record}
                    onSelect={(rec) => setSelectedRecord(rec)}
                    onDispatch={handleDispatch}
                    onViewCertificate={(rec) => {
                      if (rec.certificate) setActiveCertificate(rec.certificate);
                    }}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </main>

      {/* Forensic Audit Modal */}
      {selectedRecord ? (
        <ForensicAuditModal
          record={selectedRecord}
          onClose={() => setSelectedRecord(null)}
          onDispatch={handleDispatch}
          onViewCertificate={(rec) => {
            if (rec.certificate) setActiveCertificate(rec.certificate);
          }}
        />
      ) : null}

      {/* Official Certificate Modal */}
      {activeCertificate ? (
        <CertificateModal
          certificate={activeCertificate}
          onClose={() => setActiveCertificate(null)}
        />
      ) : null}
    </div>
  );
}
