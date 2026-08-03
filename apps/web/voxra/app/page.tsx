"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// ─── Icons (inline SVG) ───────────────────────────────────────────────────────

function PhoneIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
    </svg>
  );
}

function BoltIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
    </svg>
  );
}

function ShieldIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  );
}

function ClockIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function SparklesIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  );
}

function CheckIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

// ─── Feature cards ────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: <BoltIcon className="w-6 h-6" />,
    color: "from-blue-500 to-cyan-400",
    title: "Quick to start",
    description:
      "Sign in, enter a phone number and a goal, and the AI agent makes the call. No setup or configuration needed.",
  },
  {
    icon: <SparklesIcon className="w-6 h-6" />,
    color: "from-violet-500 to-purple-400",
    title: "AI-powered conversation",
    description:
      "The agent follows your goal and adapts to what the other person says, handling simple back-and-forth naturally.",
  },
  {
    icon: <ClockIcon className="w-6 h-6" />,
    color: "from-emerald-500 to-teal-400",
    title: "Call transcripts",
    description:
      "Every call produces a transcript and outcome so you can see exactly what was said and what happened.",
  },
  {
    icon: <ShieldIcon className="w-6 h-6" />,
    color: "from-amber-500 to-orange-400",
    title: "Auth-gated access",
    description:
      "Login is required. Sessions are server-side and credentials are never exposed to the browser.",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Sign in",
    description: "Log in with your CALL-E account to access the dashboard.",
  },
  {
    step: "02",
    title: "Enter a number and goal",
    description: "Type in the phone number to call and describe what you want the agent to accomplish.",
  },
  {
    step: "03",
    title: "Review the result",
    description: "The agent makes the call and returns a transcript and outcome for you to review.",
  },
];

// FAQ removed per requirements

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const { user, status, signIn } = useAuth();
  const router = useRouter();
  const featuresRef = useRef<HTMLElement>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "authenticated") {
      router.push("/dashboard");
    }
  }, [status, router]);

  const handleGetStarted = async () => {
    if (user) {
      router.push("/dashboard");
      return;
    }
    setLoginError(null);
    setSigningIn(true);
    try {
      await signIn();
      // checkSession is called inside signIn; redirect handled by useEffect above
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Sign in failed");
      setSigningIn(false);
    }
  };

  const scrollToFeatures = () => {
    featuresRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }


  return (
    <div className="min-h-screen bg-surface text-slate-100 overflow-x-hidden">
      {/* ── Background decoration ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-brand-600/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 -left-60 w-[500px] h-[500px] bg-violet-600/8 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-1/4 w-[400px] h-[400px] bg-cyan-600/6 rounded-full blur-3xl" />
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          NAV
      ═══════════════════════════════════════════════════════════════ */}
      <nav className="relative z-20 border-b border-surface-border/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-brand-900/50">
                <PhoneIcon className="w-4 h-4 text-white" />
              </div>
              <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-surface animate-pulse-slow" />
            </div>
            <span className="text-lg font-bold tracking-tight">
              Vox<span className="text-brand-400">ra</span>
            </span>
          </div>

          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-400">
            <button onClick={scrollToFeatures} className="hover:text-slate-100 transition-colors">Features</button>
            <a href="#how-it-works" className="hover:text-slate-100 transition-colors">How it works</a>
            <a href="#use-cases" className="hover:text-slate-100 transition-colors">Use Cases</a>
          </div>

          <button
            onClick={handleGetStarted}
            disabled={signingIn}
            className="btn-primary text-sm py-2 px-5"
          >
            {signingIn ? "Connecting…" : "Sign in with CALL-E"}
          </button>
        </div>
      </nav>

      {/* ═══════════════════════════════════════════════════════════════
          HERO
      ═══════════════════════════════════════════════════════════════ */}
      <section className="relative z-10 pt-24 pb-20 px-6">
        <div className="max-w-5xl mx-auto text-center">
          {/* Pill badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-brand-800 bg-brand-950/50 text-brand-300 text-xs font-semibold mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Experimental &nbsp;·&nbsp; Powered by CALL-E
          </div>

          {/* Headline */}
          <h1 className="text-5xl md:text-7xl font-black tracking-tight leading-[1.05] mb-6">
            AI-powered outbound calls,
            <br />
            simply.
          </h1>

          <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            A simple dashboard to make AI phone calls using CALL-E.
            Enter a number, describe your goal, and let the agent handle the conversation.
          </p>

          {/* CTA group */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={handleGetStarted}
              disabled={signingIn}
              className="btn-primary text-base py-3.5 px-8 shadow-xl shadow-brand-900/40 glow-blue"
            >
              {signingIn ? "Signing in…" : "Open Dashboard"}
            </button>
            <button
              onClick={scrollToFeatures}
              className="btn-secondary text-base py-3.5 px-8"
            >
              Explore Capabilities ↓
            </button>
          </div>

          {loginError && (
            <p className="mt-4 text-sm text-red-400">{loginError}</p>
          )}

          {/* Trust strip */}
          <div className="mt-12 flex flex-wrap items-center justify-center gap-6 text-sm text-slate-500">
            {[
              "Login required — sessions are server-side",
              "Call transcripts saved per session",
              "MVP / experimental — not production-ready",
            ].map((t) => (
              <span key={t} className="flex items-center gap-1.5">
                <CheckIcon className="w-3.5 h-3.5 text-emerald-400" />
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* ── Hero visual — mock call card ── */}
        <div className="mt-20 max-w-lg mx-auto relative">
          <div className="absolute inset-0 bg-brand-600/20 blur-3xl rounded-3xl" />
          <div className="relative glass-card p-6 shadow-2xl">
            {/* Status bar */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
                <PhoneIcon className="w-4 h-4 text-brand-400" />
                Active Call
              </div>
              <span className="status-badge bg-emerald-900/50 text-emerald-300 border border-emerald-800/50">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                LIVE
              </span>
            </div>

            {/* Transcript preview */}
            <div className="space-y-3 text-sm">
              <div className="flex gap-3">
                <span className="shrink-0 px-2 py-0.5 rounded text-[10px] font-bold bg-brand-900 text-brand-300 self-start mt-0.5">AGENT</span>
                <p className="bubble-bot rounded-xl px-4 py-2.5 leading-relaxed">
                  Good morning! I&apos;m calling to confirm your appointment scheduled for tomorrow at 2 PM. Is this still a good time?
                </p>
              </div>
              <div className="flex gap-3 justify-end">
                <p className="bubble-user rounded-xl px-4 py-2.5 leading-relaxed">
                  Yes, that works perfectly.
                </p>
                <span className="shrink-0 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 self-start mt-0.5">THEM</span>
              </div>
              <div className="flex gap-3">
                <span className="shrink-0 px-2 py-0.5 rounded text-[10px] font-bold bg-brand-900 text-brand-300 self-start mt-0.5">AGENT</span>
                <p className="bubble-bot rounded-xl px-4 py-2.5 leading-relaxed">
                  Wonderful. Should I also note any special requirements or preferences for the visit?
                </p>
              </div>
              {/* Typing indicator */}
              <div className="flex gap-3 justify-end">
                <div className="bubble-user rounded-xl px-4 py-3 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
                <span className="shrink-0 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 self-start mt-0.5">THEM</span>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-5 pt-4 border-t border-surface-border flex items-center justify-between text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Appointment Confirmation</span>
              <span>0:42 elapsed</span>
              <span className="text-emerald-400 font-medium">High confidence</span>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          FEATURES
      ═══════════════════════════════════════════════════════════════ */}
      <section ref={featuresRef} id="features" className="relative z-10 py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">What it does</h2>
            <p className="text-slate-400 text-lg max-w-xl mx-auto">
              A thin UI over the CALL-E API. Useful for testing and simple automation tasks.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {FEATURES.map((f) => (
              <div key={f.title} className="glass-card p-6 hover:border-slate-600 transition-colors group">
                <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center text-white mb-5 shadow-lg group-hover:scale-110 transition-transform duration-200`}>
                  {f.icon}
                </div>
                <h3 className="font-semibold text-slate-100 mb-2">{f.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          HOW IT WORKS
      ═══════════════════════════════════════════════════════════════ */}
      <section id="how-it-works" className="relative z-10 py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">How it works</h2>
            <p className="text-slate-400 text-lg max-w-xl mx-auto">
              Three steps to make your first AI call.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {HOW_IT_WORKS.map((step, i) => (
              <div key={step.step} className="relative text-center">
                {i < HOW_IT_WORKS.length - 1 && (
                  <div className="hidden md:block absolute top-8 left-[calc(50%+2.5rem)] right-0 h-px bg-gradient-to-r from-surface-border to-transparent" />
                )}
                <div className="w-16 h-16 rounded-2xl bg-surface-card border border-surface-border flex items-center justify-center mx-auto mb-5 shadow-lg">
                  <span className="text-xl font-black text-gradient">{step.step}</span>
                </div>
                <h3 className="font-semibold text-lg mb-2">{step.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="mt-16 text-center">
            <button
              onClick={handleGetStarted}
              className="btn-primary text-base py-3.5 px-8 shadow-xl shadow-brand-900/40"
              disabled={signingIn}
            >
              {signingIn ? "Signing in…" : "Try it out"}
            </button>
          </div>
        </div>
      </section>



      {/* ═══════════════════════════════════════════════════════════════
          USE CASES
      ═══════════════════════════════════════════════════════════════ */}
      <section id="use-cases" className="relative z-10 py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Some things you could try</h2>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {[
              "Appointment reminders",
              "Confirming a booking",
              "Following up on a form submission",
              "Checking in with a contact",
              "Quick survey or feedback call",
              "Rescheduling a meeting",
              "Notifying someone of a change",
              "Simple order status update",
            ].map((uc) => (
              <span
                key={uc}
                className="px-4 py-2 rounded-xl border border-surface-border bg-surface-card text-slate-300 text-sm hover:border-brand-700 hover:text-brand-300 transition-colors cursor-default"
              >
                {uc}
              </span>
            ))}
          </div>
        </div>
      </section>



      {/* ═══════════════════════════════════════════════════════════════
          CTA BANNER
      ═══════════════════════════════════════════════════════════════ */}
      <section className="relative z-10 py-20 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="glass-card p-12 relative overflow-hidden">
            <div className="absolute inset-0 bg-hero-gradient pointer-events-none" />
            <div className="relative z-10">
              <h2 className="text-3xl md:text-4xl font-black mb-4">
                Give it a try.
              </h2>
              <p className="text-slate-400 mb-8 text-lg">
                It&apos;s experimental — expect rough edges. Sign in with your CALL-E account to get started.
              </p>
              <button
                onClick={handleGetStarted}
                disabled={signingIn}
                className="btn-primary text-base py-4 px-10 shadow-2xl shadow-brand-900/60 glow-blue"
              >
                {signingIn ? "Signing in…" : "Sign in with CALL-E"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          FOOTER
      ═══════════════════════════════════════════════════════════════ */}
      <footer className="relative z-10 border-t border-surface-border/50 py-10 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-slate-500">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-brand-500 to-cyan-400 flex items-center justify-center">
              <PhoneIcon className="w-3 h-3 text-white" />
            </div>
            <span className="font-semibold text-slate-300">Voxra</span>
            <span className="text-slate-600">— Powered by CALL-E</span>
          </div>
          <div className="flex gap-6">
            <a href="https://www.heycall-e.com" target="_blank" rel="noopener noreferrer" className="hover:text-slate-300 transition-colors">Official Site</a>
            <a href="https://github.com/CALLE-AI/call-e-integrations" target="_blank" rel="noopener noreferrer" className="hover:text-slate-300 transition-colors">GitHub</a>
            <a href="https://discord.gg/SDcGdhgRzj" target="_blank" rel="noopener noreferrer" className="hover:text-slate-300 transition-colors">Discord</a>
          </div>
          <span>© Voxra {new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  );
}
