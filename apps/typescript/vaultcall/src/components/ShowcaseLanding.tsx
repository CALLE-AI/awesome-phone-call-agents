'use client';

import React from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  PhoneCall,
  Sparkles,
  ArrowRight,
  Lock,
  FileCheck2,
  AlertTriangle,
  Radio,
  FileText,
  DollarSign,
  Cpu,
  Layers,
  Fingerprint,
} from 'lucide-react';

interface ShowcaseLandingProps {
  onOpenWorkspace: () => void;
  onSelectCase: (caseId: string) => void;
}

export const ShowcaseLanding: React.FC<ShowcaseLandingProps> = ({
  onOpenWorkspace,
  onSelectCase,
}) => {
  return (
    <div className="space-y-24 py-4 w-full">
      {/* Hero Section */}
      <section className="relative mx-auto grid max-w-[1680px] w-full gap-12 lg:gap-20 lg:grid-cols-[1.15fr_0.85fr] items-center">
        {/* Glow ambient background orbs */}
        <div className="absolute -left-20 top-10 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -right-20 bottom-10 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

        {/* Hero Left Content */}
        <div className="relative space-y-7">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-950/50 px-4 py-1.5 text-xs font-bold text-accent-cyan font-mono shadow-sm">
            <Sparkles className="h-4 w-4 animate-pulse" />
            <span>Built for the CALL-E Hackathon · $10,000 Prize Pool</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-extrabold tracking-tight text-white leading-[1.06]">
            Every vendor bank change demands an{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent-cyan via-accent-indigo to-accent-emerald">
              airgap phone call.
            </span>
          </h1>

          <p className="text-base sm:text-lg lg:text-xl text-slate-300 leading-relaxed max-w-2xl">
            Business Email Compromise (BEC) steals $55 Billion by tricking AP clerks with fake invoice wire changes. VaultCall uses <strong>CALL-E</strong> to autonomously dial pre-verified corporate treasury officers, execute voice challenge-responses, and mint cryptographic release certificates before a single dollar moves.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 pt-2">
            <button
              onClick={onOpenWorkspace}
              className="inline-flex items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-emerald-500 via-cyan-500 to-indigo-500 hover:opacity-95 px-8 py-4 text-base font-extrabold text-slate-950 shadow-xl shadow-cyan-950/50 transition-all hover:scale-[1.02]"
            >
              <span>Launch Interactive Telephony Lab</span>
              <ArrowRight className="h-5 w-5" />
            </button>

            <a
              href="#workflow"
              className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900/90 hover:bg-slate-800 px-8 py-4 text-base font-bold text-slate-200 hover:text-white transition-colors"
            >
              See How It Works
            </a>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm font-mono text-slate-400 pt-2">
            <span className="flex items-center space-x-1.5 text-emerald-400">
              <span>✓</span>
              <span>Deterministic Fixture Replay</span>
            </span>
            <span>·</span>
            <span className="flex items-center space-x-1.5 text-cyan-400">
              <span>✓</span>
              <span>Zero API Key Required</span>
            </span>
            <span>·</span>
            <span className="flex items-center space-x-1.5 text-indigo-400">
              <span>✓</span>
              <span>SOX 404 Compliant</span>
            </span>
          </div>
        </div>

        {/* Hero Right: Interactive Synthetic Case Preview */}
        <div className="relative mx-auto w-full max-w-xl">
          <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-950/95 p-6 shadow-2xl backdrop-blur-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-accent-cyan font-mono">
                  Live Synthetic Defense Audit
                </p>
                <h3 className="text-lg font-bold text-white mt-0.5">Apex Global Logistics LLC</h3>
              </div>
              <span className="rounded-full bg-rose-950/80 border border-rose-600/60 px-3 py-1 text-[11px] font-mono font-bold text-rose-400 animate-pulse">
                BEC FRAUD BLOCKED
              </span>
            </div>

            {/* Timeline Steps */}
            <div className="mt-5 space-y-3">
              {/* Step 1 */}
              <div className="flex items-center gap-3.5 rounded-2xl bg-slate-900/70 border border-slate-800/80 p-3.5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <FileText className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-xs font-semibold text-slate-200">
                    Phishing Invoice Intercepted ($785,000)
                  </strong>
                  <small className="block truncate text-[11px] font-mono text-rose-400">
                    Claimed burner phone +1 (305) 555-0144 STRIPPED
                  </small>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex items-center gap-3.5 rounded-2xl bg-slate-900/70 border border-slate-800/80 p-3.5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cyan-500/10 text-accent-cyan border border-cyan-500/20">
                  <PhoneCall className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-xs font-semibold text-slate-200">
                    CALL-E Dialed Corporate PBX
                  </strong>
                  <small className="block truncate text-[11px] font-mono text-slate-400">
                    Dialed +1 (312) 555-0188 · Security Ref: Bravo-Zulu-918
                  </small>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex items-center gap-3.5 rounded-2xl bg-slate-900/70 border border-slate-800/80 p-3.5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  <ShieldAlert className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-xs font-semibold text-slate-200">
                    Controller Shouted Fraud on Record
                  </strong>
                  <small className="block truncate text-[11px] font-mono text-slate-400 italic">
                    "DO NOT send that money! Email was breached!"
                  </small>
                </div>
              </div>
            </div>

            {/* Quick Metrics Footer */}
            <div className="mt-4 grid grid-cols-2 gap-3 pt-2">
              <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-3">
                <span className="text-[11px] font-mono text-slate-400 block">Capital Saved</span>
                <strong className="text-sm font-mono text-rose-400 font-bold">$785,000 USD</strong>
              </div>
              <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-3">
                <span className="text-[11px] font-mono text-slate-400 block">Security Action</span>
                <strong className="text-sm font-mono text-emerald-400 font-bold">Account Frozen</strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4-Step Continuous Enterprise Security Workflow */}
      <section id="workflow" className="max-w-[1680px] w-full mx-auto space-y-12 border-t border-slate-800/80 pt-20">
        <div className="max-w-3xl space-y-3.5">
          <p className="text-xs font-mono font-bold uppercase tracking-wider text-accent-cyan">
            From Suspicious Email to Cryptographic Release
          </p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight">
            The 4-Step Out-of-Band Defense Architecture
          </h2>
          <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
            The phone call is never an isolated chatbot conversation. It is an immutable cryptographic verification gate integrated directly into enterprise ERP accounting before any wire moves.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Card 1 */}
          <article className="relative rounded-2xl border border-slate-800 bg-slate-900/50 p-7 space-y-4 hover:border-slate-700 transition-colors shadow-lg">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-cyan-500/10 text-accent-cyan border border-cyan-500/20">
              <FileText className="h-6 w-6" />
            </span>
            <span className="absolute right-7 top-7 text-xs font-mono font-bold text-slate-500">
              01
            </span>
            <h3 className="text-lg font-bold text-white">ERP Interception</h3>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-400 font-sans">
              Invoice attachment or bank change request arrives via email or vendor portal. Automated webhook captures exposure.
            </p>
          </article>

          {/* Card 2 */}
          <article className="relative rounded-2xl border border-slate-800 bg-slate-900/50 p-7 space-y-4 hover:border-slate-700 transition-colors shadow-lg">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-indigo-500/10 text-accent-indigo border border-indigo-500/20">
              <Lock className="h-6 w-6" />
            </span>
            <span className="absolute right-7 top-7 text-xs font-mono font-bold text-slate-500">
              02
            </span>
            <h3 className="text-lg font-bold text-white">Airgap Policy Gate</h3>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-400 font-sans">
              Strictly strips any phone number in the email. Resolves pre-verified corporate PBX from hardened registry and mints NATO token.
            </p>
          </article>

          {/* Card 3 */}
          <article className="relative rounded-2xl border border-slate-800 bg-slate-900/50 p-7 space-y-4 hover:border-slate-700 transition-colors shadow-lg">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-emerald-500/10 text-accent-emerald border border-emerald-500/20">
              <PhoneCall className="h-6 w-6" />
            </span>
            <span className="absolute right-7 top-7 text-xs font-mono font-bold text-slate-500">
              03
            </span>
            <h3 className="text-lg font-bold text-white">CALL-E Spoken Challenge</h3>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-400 font-sans">
              CALL-E dials the CFO, requests Tax ID digits, states invoice details, and records verbal assent or fraud denial.
            </p>
          </article>

          {/* Card 4 */}
          <article className="relative rounded-2xl border border-slate-800 bg-slate-900/50 p-7 space-y-4 hover:border-slate-700 transition-colors shadow-lg">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <FileCheck2 className="h-6 w-6" />
            </span>
            <span className="absolute right-7 top-7 text-xs font-mono font-bold text-slate-500">
              04
            </span>
            <h3 className="text-lg font-bold text-white">Cryptographic Verdict</h3>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-400 font-sans">
              Evidence reconciler links transcript turns. Valid verifications mint a SHA-256 certificate; fraud attempts lock accounts.
            </p>
          </article>
        </div>
      </section>

      {/* Core Security Standard Features */}
      <section className="max-w-[1680px] w-full mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 border-t border-slate-800/80 pt-20">
        <article className="rounded-2xl border border-slate-800 bg-slate-900/50 p-7 space-y-3.5 shadow-lg">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <h4 className="text-lg font-bold text-white">Evidence-Linked Grounding</h4>
          <p className="text-xs sm:text-sm leading-relaxed text-slate-400">
            No silent hallucinations. Extracted claims are matched against literal callee turns. Any ungrounded claim strikes through and fails closed.
          </p>
        </article>

        <article className="rounded-2xl border border-slate-800 bg-slate-900/50 p-7 space-y-3.5 shadow-lg">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <AlertTriangle className="h-6 w-6" />
          </span>
          <h4 className="text-lg font-bold text-white">Fail-Closed Gatekeeper Hold</h4>
          <p className="text-xs sm:text-sm leading-relaxed text-slate-400">
            Voicemail, IVRs, and receptionists are NOT verification reaches. Transactions remain securely locked until an authorized officer speaks.
          </p>
        </article>

        <article className="rounded-2xl border border-slate-800 bg-slate-900/50 p-7 space-y-3.5 shadow-lg">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-cyan-500/10 text-accent-cyan border border-cyan-500/20">
            <Fingerprint className="h-6 w-6" />
          </span>
          <h4 className="text-lg font-bold text-white">SHA-256 Irrevocable Audit</h4>
          <p className="text-xs sm:text-sm leading-relaxed text-slate-400">
            Every verification mints a cryptographically stamped audit receipt with timestamps and release tokens for SOX 404 compliance.
          </p>
        </article>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 pt-8 pb-12 text-xs font-mono text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center space-x-2 text-slate-400">
          <span className="font-bold text-white">VaultCall</span>
          <span>·</span>
          <span>CALL-E Voice Verification Protocol</span>
        </div>
        <p className="text-slate-500">
          Hackathon Environment · All vendor profiles and phone numbers are synthetic
        </p>
      </footer>
    </div>
  );
};
