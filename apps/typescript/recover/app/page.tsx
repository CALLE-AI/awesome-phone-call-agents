"use client";

import { useEffect, useState, useCallback } from "react";

// ─── SVG Icon Components ──────────────────────────────────
// All icons are inline SVGs — no emoji, no icon font dependency.

function IconBolt({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

function IconPhone({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
    </svg>
  );
}

function IconDollar({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
    </svg>
  );
}

function IconAlertTriangle({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconTrendingUp({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}

function IconActivity({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function IconUser({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}


function IconCalendar({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function IconShield({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function IconCheck({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconX({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}


function IconStop({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    </svg>
  );
}

function IconExternalLink({ size = 12, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function IconPlus({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}


function IconWaveform({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12h3l3-8 4 16 3-8h3l3 4h3" />
    </svg>
  );
}


const MAX_CALL_ATTEMPTS = 3;

const SUPPORTED_REGIONS: { code: string; label: string; locale: string; flag: string }[] = [
  { code: "US", label: "United States", locale: "en-US", flag: "🇺🇸" },
  { code: "CA", label: "Canada", locale: "en-CA", flag: "🇨🇦" },
  { code: "GB", label: "United Kingdom", locale: "en-GB", flag: "🇬🇧" },
  { code: "AU", label: "Australia", locale: "en-AU", flag: "🇦🇺" },
  { code: "SG", label: "Singapore", locale: "en-SG", flag: "🇸🇬" },
  { code: "MY", label: "Malaysia", locale: "en-MY", flag: "🇲🇾" },
  { code: "IN", label: "India", locale: "en-IN", flag: "🇮🇳" },
  { code: "AE", label: "United Arab Emirates", locale: "en-AE", flag: "🇦🇪" },
  { code: "VN", label: "Vietnam", locale: "vi-VN", flag: "🇻🇳" },
  { code: "DE", label: "Germany", locale: "en-DE", flag: "🇩🇪" },
  { code: "FR", label: "France", locale: "fr-FR", flag: "🇫🇷" },
  { code: "MX", label: "Mexico", locale: "es-MX", flag: "🇲🇽" },
  { code: "BR", label: "Brazil", locale: "pt-BR", flag: "🇧🇷" },
  { code: "ID", label: "Indonesia", locale: "en-ID", flag: "🇮🇩" },
  { code: "PH", label: "Philippines", locale: "en-PH", flag: "🇵🇭" },
  { code: "KE", label: "Kenya", locale: "en-KE", flag: "🇰🇪" },
];

interface Subscriber {
  id: string;
  name: string;
  phone: string;
  region: string;
  locale: string;
  email: string;
  plan_name: string;
  amount_cents: number;
  status: string;
  followups_paused: number;
}

interface CallPreview {
  task: string;
  recipient: { phone: string; region: string; locale: string };
}

interface TranscriptTurn {
  offset_seconds: number;
  speaker: "bot" | "user" | string;
  text: string;
}

interface CallIntelligence {
  summary: string | null;
  completionConfidence: { label: string; score: number } | null;
  evidenceList: string[];
  transcriptTurns: TranscriptTurn[];
}

interface CallLogRow {
  id: string;
  subscriber_id: string;
  subscriber_name: string;
  subscriber_phone: string;
  plan_name: string;
  calle_call_id: string | null;
  trigger_reason: string;
  status: string;
  decision: string | null;
  evidence: string | null;
  action_taken: string | null;
  action_link: string | null;
  recovered_cents: number;
  attempt_number: number;
  scheduled_for: string | null;
  created_at: string;
  completed_at: string | null;
  preview: CallPreview | null;
  intelligence: CallIntelligence | null;
}

interface DashboardMetrics {
  totalAtRiskCents: number;
  totalRecoveredCents: number;
  recoveryRatePercent: number;
  activeSubscribersCount: number;
  pastDueCount: number;
  activeCallsCount: number;
  scheduledFollowupsCount: number;
  totalInterventionsCount: number;
}

// ─── Status maps ──────────────────────────────────────────

const SUB_STATUS: Record<string, { color: string; bg: string; border: string; dot: string; label: string }> = {
  active:   { color: "var(--success)",  bg: "var(--success-soft)",  border: "var(--success-border)",  dot: "#22c55e", label: "Active" },
  past_due: { color: "var(--danger)",   bg: "var(--danger-soft)",   border: "var(--danger-border)",   dot: "#f87171", label: "Past Due" },
  paused:   { color: "var(--neutral)",  bg: "var(--neutral-soft)",  border: "var(--neutral-border)",  dot: "#94a3b8", label: "Paused" },
};

const CALL_STATUS: Record<string, { color: string; bg: string; border: string; label: string }> = {
  scheduled:           { color: "var(--neutral)",  bg: "var(--neutral-soft)",  border: "var(--neutral-border)",  label: "Follow-up Scheduled" },
  pending_confirmation:{ color: "var(--warning)",  bg: "var(--warning-soft)",  border: "var(--warning-border)",  label: "Awaiting Confirmation" },
  in_progress:         { color: "#fbbf24",          bg: "rgba(251,191,36,0.1)", border: "rgba(251,191,36,0.25)", label: "CALL-E Calling…" },
  completed:           { color: "var(--success)",  bg: "var(--success-soft)",  border: "var(--success-border)",  label: "Completed" },
  failed:              { color: "var(--danger)",   bg: "var(--danger-soft)",   border: "var(--danger-border)",   label: "Failed" },
  canceled:            { color: "var(--neutral)",  bg: "var(--neutral-soft)",  border: "var(--neutral-border)",  label: "Canceled" },
};

const DECISION_LABEL: Record<string, string> = {
  retry_now: "Authorized Retry",
  update_card: "Requested Card Update",
  pause_subscription: "Requested Pause",
  no_answer: "No Answer",
  unknown: "Unclear Outcome",
};

const DECISION_COLOR: Record<string, string> = {
  retry_now: "var(--success)",
  update_card: "var(--success)",
  pause_subscription: "var(--neutral)",
  no_answer: "var(--danger)",
  unknown: "var(--neutral)",
};


function formatTs(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatOffset(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function fmtMoney(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const EMPTY_FORM = { name: "", phone: "+12763229632", email: "", planName: "", amountDollars: "", region: "US", locale: "en-US" };

// Same-origin dashboard requests are auto-authorized via sec-fetch-site header in dev.
// Include the demo key explicitly so the dashboard works even in strict production-like mode.
const AUTH_HEADERS = { "x-recover-key": "recover_demo_key_sec_9942" };

// ─── Main Dashboard ───────────────────────────────────────

export default function Dashboard() {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [calls, setCalls] = useState<CallLogRow[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [callFilter, setCallFilter] = useState<"all" | "pending" | "completed" | "scheduled">("all");
  const [activeIntelligenceCall, setActiveIntelligenceCall] = useState<CallLogRow | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [subsRes, callsRes, metricsRes] = await Promise.all([
        fetch("/api/subscribers", { headers: AUTH_HEADERS }),
        fetch("/api/calls", { headers: AUTH_HEADERS }),
        fetch("/api/admin/metrics", { headers: AUTH_HEADERS }),
      ]);
      if (subsRes.ok) setSubscribers(await subsRes.json());
      if (callsRes.ok) setCalls(await callsRes.json());
      if (metricsRes.ok) setMetrics(await metricsRes.json());
    } catch {}
  }, []);

  useEffect(() => {
    let ignore = false;
    async function init() {
      try {
        const [subsRes, callsRes, metricsRes] = await Promise.all([
          fetch("/api/subscribers", { headers: AUTH_HEADERS }),
          fetch("/api/calls", { headers: AUTH_HEADERS }),
          fetch("/api/admin/metrics", { headers: AUTH_HEADERS }),
        ]);
        if (!ignore) {
          if (subsRes.ok) setSubscribers(await subsRes.json());
          if (callsRes.ok) setCalls(await callsRes.json());
          if (metricsRes.ok) setMetrics(await metricsRes.json());
        }
      } catch {}
    }
    init();
    const interval = setInterval(refresh, 3000);
    return () => { ignore = true; clearInterval(interval); };
  }, [refresh]);

  function updateForm<K extends keyof typeof EMPTY_FORM>(key: K, value: string) {
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === "region") {
        const match = SUPPORTED_REGIONS.find((r) => r.code === value);
        if (match) next.locale = match.locale;
      }
      return next;
    });
  }

  function notify(msg: string) {
    setNotification(msg);
    setTimeout(() => setNotification(null), 5000);
  }

  async function submitSubscriber(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amountCents = Math.round(parseFloat(form.amountDollars || "0") * 100);
    if (!form.name || !form.phone || !form.email || !form.planName || !amountCents) {
      setError("Please fill in every field with a valid amount.");
      return;
    }
    setFormSubmitting(true);
    try {
      const res = await fetch("/api/subscribers", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
        body: JSON.stringify({ name: form.name, phone: form.phone, email: form.email, planName: form.planName, amountCents, region: form.region, locale: form.locale }),
      });
      let data: { error?: string } = {};
      try { data = await res.json(); } catch {}
      if (!res.ok) { setError(data.error ?? `HTTP ${res.status}`); return; }
      setForm(EMPTY_FORM);
      setShowForm(false);
      notify("Subscriber added successfully.");
      refresh();
    } finally { setFormSubmitting(false); }
  }

  async function simulateFailure(subscriberId: string) {
    setBusyId(subscriberId); setError(null);
    try {
      const res = await fetch("/api/stripe/simulate-failure", {
        method: "POST", headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
        body: JSON.stringify({ subscriberId }),
      });
      let data: { error?: string } = {};
      try { data = await res.json(); } catch {}
      if (!res.ok) setError(data.error ?? `HTTP ${res.status}`);
      else notify("Payment decline simulated — call preview staged below.");
    } finally { setBusyId(null); refresh(); }
  }

  async function confirmCall(callLogId: string) {
    setBusyId(callLogId); setError(null);
    try {
      const res = await fetch("/api/calle/place-call", {
        method: "POST", headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
        body: JSON.stringify({ callLogId }),
      });
      let data: { error?: string } = {};
      try { data = await res.json(); } catch {}
      if (!res.ok) setError(data.error ?? `HTTP ${res.status}`);
      else notify("CALL-E outbound call placed — recipient is being dialed now.");
    } finally { setBusyId(null); refresh(); }
  }

  async function cancelCall(callLogId: string) {
    setBusyId(callLogId);
    try { await fetch("/api/calle/cancel-call", { method: "POST", headers: { "Content-Type": "application/json", ...AUTH_HEADERS }, body: JSON.stringify({ callLogId }) }); }
    finally { setBusyId(null); refresh(); }
  }

  async function pauseFollowups(subscriberId: string) {
    setBusyId(subscriberId);
    try {
      await fetch("/api/calle/pause-followups", { method: "POST", headers: { "Content-Type": "application/json", ...AUTH_HEADERS }, body: JSON.stringify({ subscriberId }) });
      notify("Automated follow-up chain stopped for this subscriber.");
    } finally { setBusyId(null); refresh(); }
  }

  async function loadDemoData() {
    setBusyId("demo-load"); setError(null);
    try {
      const res = await fetch("/api/admin/demo-data", { method: "POST", headers: AUTH_HEADERS });
      if (res.ok) notify("Judge demo dataset loaded — real transcripts, recoveries, and follow-up chains ready.");
    } finally { setBusyId(null); refresh(); }
  }

  async function resetDatabase() {
    if (!confirm("Reset all data to an empty database?")) return;
    setBusyId("demo-reset");
    try { await fetch("/api/admin/demo-data", { method: "DELETE", headers: AUTH_HEADERS }); notify("Database reset."); }
    finally { setBusyId(null); refresh(); }
  }

  const filteredCalls = calls.filter((c) => {
    if (callFilter === "pending") return c.status === "pending_confirmation";
    if (callFilter === "completed") return c.status === "completed";
    if (callFilter === "scheduled") return c.status === "scheduled";
    return true;
  });

  const pendingCount = calls.filter((c) => c.status === "pending_confirmation").length;
  const completedCount = calls.filter((c) => c.status === "completed").length;
  const scheduledCount = calls.filter((c) => c.status === "scheduled").length;

  return (
    <>
      {/* Fixed background gradient mesh */}
      <div className="bg-mesh" aria-hidden />

      {/* App Shell */}
      <div style={{ position: "relative", zIndex: 1, minHeight: "100vh", display: "flex", flexDirection: "column" }}>

        {/* ── Top Nav ───────────────────────────────────────── */}
        <nav style={{
          borderBottom: "1px solid var(--border)",
          background: "rgba(13,15,20,0.85)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          position: "sticky",
          top: 0,
          zIndex: 20,
        }}>
          <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 24px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            {/* Logo */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ boxShadow: "0 0 20px var(--accent-glow)", borderRadius: 8, lineHeight: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "#1a1d26" }}>
                <img src="/logo.png" alt="Recover Logo" width={32} height={32} style={{ display: "block", objectFit: "contain" }} />
              </div>
              <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-0.02em", color: "var(--ink)" }}>Recover</span>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                color: "var(--accent-2)", background: "rgba(99,102,241,0.12)",
                border: "1px solid rgba(99,102,241,0.2)",
                padding: "2px 7px", borderRadius: 4,
              }}>
                CALL-E Agent
              </span>
            </div>

            {/* Nav actions */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {pendingCount > 0 && (
                <span style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "4px 10px", borderRadius: 20,
                  background: "var(--warning-soft)", border: "1px solid var(--warning-border)",
                  color: "var(--warning)", fontSize: 12, fontWeight: 600,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warning)", display: "inline-block" }} />
                  {pendingCount} awaiting review
                </span>
              )}
              <button
                id="btn-load-demo"
                onClick={loadDemoData}
                disabled={busyId === "demo-load"}
                className="btn btn-primary btn-sm"
              >
                {busyId === "demo-load" ? "Loading…" : <><IconBolt size={13} /> Load Demo Data</>}
              </button>
              <button
                id="btn-reset-db"
                onClick={resetDatabase}
                disabled={busyId === "demo-reset"}
                className="btn btn-ghost btn-sm"
                style={{ color: "var(--danger)", borderColor: "var(--danger-border)" }}
              >
                Reset
              </button>
            </div>
          </div>
        </nav>

        {/* ── Page Content ──────────────────────────────────── */}
        <main style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px", width: "100%", flex: 1 }}>

          {/* Page Hero */}
          <div className="fade-in" style={{ marginBottom: 32 }}>
            <h1 style={{
              fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em",
              background: "linear-gradient(135deg, var(--ink) 0%, var(--ink-2) 100%)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              marginBottom: 6,
            }}>
              Payment Recovery Command Center
            </h1>
            <p style={{ color: "var(--ink-2)", fontSize: 14, maxWidth: 600, lineHeight: 1.6 }}>
              Catches failed subscription payments the instant they decline and calls customers live to get a decision —
              instead of sending an email that gets ignored.
            </p>
          </div>

          {/* ── Metric Cards ────────────────────────────────── */}
          {metrics && (
            <div className="fade-in" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 40 }}>
              <MetricCard
                label="ARR Recovered"
                value={fmtMoney(metrics.totalRecoveredCents)}
                sub={`${metrics.totalInterventionsCount} intervention${metrics.totalInterventionsCount !== 1 ? "s" : ""} completed`}
                color="var(--success)"
                glowColor="rgba(34,197,94,0.15)"
                icon={<IconDollar size={18} color="var(--success)" />}
              />
              <MetricCard
                label="At-Risk Revenue"
                value={fmtMoney(metrics.totalAtRiskCents)}
                sub={`${metrics.pastDueCount} past-due account${metrics.pastDueCount !== 1 ? "s" : ""}`}
                color="var(--danger)"
                glowColor="rgba(248,113,113,0.1)"
                icon={<IconAlertTriangle size={18} color="var(--danger)" />}
              />
              <MetricCard
                label="Recovery Rate"
                value={`${metrics.recoveryRatePercent}%`}
                sub="Calls resulting in action"
                color="var(--accent-2)"
                glowColor="var(--accent-glow)"
                icon={<IconTrendingUp size={18} color="var(--accent-2)" />}
              />
              <MetricCard
                label="Live Interventions"
                value={String(metrics.activeCallsCount + metrics.scheduledFollowupsCount)}
                sub={`${metrics.activeCallsCount} in review · ${metrics.scheduledFollowupsCount} queued`}
                color="var(--neutral)"
                glowColor="rgba(148,163,184,0.08)"
                icon={<IconActivity size={18} color="var(--neutral)" />}
              />
            </div>
          )}

          {/* ── Alerts ──────────────────────────────────────── */}
          {notification && (
            <div className="toast" style={{
              marginBottom: 20, padding: "12px 16px", borderRadius: 10,
              background: "var(--success-soft)", border: "1px solid var(--success-border)",
              color: "var(--success)", fontSize: 13, fontWeight: 500,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <IconCheck size={15} color="var(--success)" />
              {notification}
            </div>
          )}
          {error && (
            <div className="toast" style={{
              marginBottom: 20, padding: "12px 16px", borderRadius: 10,
              background: "var(--danger-soft)", border: "1px solid var(--danger-border)",
              color: "var(--danger)", fontSize: 13, fontWeight: 500,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <IconAlertTriangle size={15} color="var(--danger)" />
              {error}
            </div>
          )}

          {/* ── Two-Column Layout ────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 24, alignItems: "start" }}>

            {/* ── LEFT: Subscribers ───────────────────────── */}
            <section>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div>
                  <p className="section-title">Subscribers</p>
                  <p style={{ color: "var(--ink-3)", fontSize: 12, marginTop: 2 }}>Monitored accounts for automated dunning</p>
                </div>
                <button
                  id="btn-add-subscriber"
                  onClick={() => setShowForm((v) => !v)}
                  className="btn btn-ghost btn-sm"
                >
                  {showForm ? <><IconX size={12} /> Cancel</> : <><IconPlus size={12} /> Add</>}
                </button>
              </div>

              {/* Add Subscriber Form */}
              {showForm && (
                <form
                  onSubmit={submitSubscriber}
                  className="fade-in"
                  style={{
                    marginBottom: 16, padding: 16, borderRadius: 12,
                    background: "var(--surface)", border: "1px solid var(--border)",
                    display: "flex", flexDirection: "column", gap: 10,
                  }}
                >
                  <p className="section-title" style={{ fontSize: 13 }}>Add Monitored Subscriber</p>

                  <input id="form-name" placeholder="Customer Name" value={form.name}
                    onChange={(e) => updateForm("name", e.target.value)}
                    className="input" required />

                  <div>
                    <input id="form-phone" placeholder="Phone (E.164, e.g. +12763229632)"
                      value={form.phone} onChange={(e) => updateForm("phone", e.target.value)}
                      className="input input-mono" required />
                    <div style={{ marginTop: 5, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 4 }}>
                      <span style={{ fontSize: 11, color: "var(--accent-2)" }}>CALL-E verified test number: <strong>+12763229632</strong> (US)</span>
                      <button type="button" id="btn-fill-test-number"
                        onClick={() => { updateForm("phone", "+12763229632"); updateForm("region", "US"); updateForm("locale", "en-US"); }}
                        style={{ fontSize: 11, color: "var(--ink-2)", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}>
                        Reset to test number
                      </button>
                    </div>
                  </div>

                  <input id="form-email" placeholder="Customer Email" type="email" value={form.email}
                    onChange={(e) => updateForm("email", e.target.value)}
                    className="input" required />

                  <div style={{ display: "flex", gap: 8 }}>
                    <input id="form-plan" placeholder="Plan name" value={form.planName}
                      onChange={(e) => updateForm("planName", e.target.value)}
                      className="input" style={{ flex: 1 }} required />
                    <input id="form-amount" placeholder="Amount ($)" type="number" step="0.01" min="1"
                      value={form.amountDollars} onChange={(e) => updateForm("amountDollars", e.target.value)}
                      className="input" style={{ width: 110 }} required />
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <select id="form-region" value={form.region}
                      onChange={(e) => updateForm("region", e.target.value)}
                      className="input" style={{ flex: 1 }}>
                      {SUPPORTED_REGIONS.map((r) => (
                        <option key={r.code} value={r.code}>{r.flag} {r.label} ({r.code})</option>
                      ))}
                    </select>
                    <input id="form-locale" placeholder="Locale" value={form.locale}
                      onChange={(e) => updateForm("locale", e.target.value)}
                      className="input" style={{ width: 100 }} />
                  </div>

                  <button type="submit" id="btn-submit-subscriber"
                    disabled={formSubmitting} className="btn btn-success">
                    {formSubmitting ? "Adding…" : "Save Subscriber"}
                  </button>
                </form>
              )}

              {/* Empty state */}
              {subscribers.length === 0 && !showForm && (
                <div style={{
                  padding: 32, textAlign: "center", borderRadius: 12,
                  border: "1px dashed var(--border-strong)", background: "var(--surface)",
                }}>
                  <div style={{ display: "flex", justifyContent: "center", marginBottom: 10, opacity: 0.35 }}>
                    <IconUser size={36} color="var(--ink-2)" />
                  </div>
                  <p style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>No subscribers yet</p>
                  <p style={{ color: "var(--ink-3)", fontSize: 12, marginTop: 4 }}>
                    Click &ldquo;+ Add&rdquo; or &ldquo;Load Demo Data&rdquo; to get started.
                  </p>
                </div>
              )}

              {/* Subscriber list */}
              <ul style={{ display: "flex", flexDirection: "column", gap: 10, listStyle: "none", padding: 0, margin: 0 }}>
                {subscribers.map((sub) => {
                  const s = SUB_STATUS[sub.status] ?? SUB_STATUS.paused;
                  const isPastDue = sub.status === "past_due";
                  return (
                    <li key={sub.id} className="entity-card" style={isPastDue ? { borderColor: "var(--danger-border)" } : {}}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <p style={{ fontWeight: 700, fontSize: 14, color: "var(--ink)" }}>{sub.name}</p>
                            <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)", background: "var(--surface-2)", padding: "1px 6px", borderRadius: 4 }}>{sub.region}</span>
                          </div>
                          <p style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 2 }}>{sub.email}</p>
                          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", marginTop: 4 }}>
                            {sub.plan_name} &middot; <span style={{ color: "var(--accent-2)" }}>{fmtMoney(sub.amount_cents)}/mo</span>
                          </p>
                          <p style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--ink-3)", marginTop: 2 }}>{sub.phone}</p>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                          <span className="pill" style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}>
                            <span className="pill-dot" style={{ background: s.dot }} />{s.label}
                          </span>
                          {sub.followups_paused === 1 && (
                            <span style={{ fontSize: 10, fontWeight: 600, color: "var(--warning)", background: "var(--warning-soft)", border: "1px solid var(--warning-border)", padding: "2px 7px", borderRadius: 4 }}>
                              Follow-ups off
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <button
                          id={`btn-simulate-${sub.id}`}
                          onClick={() => simulateFailure(sub.id)}
                          disabled={busyId === sub.id || isPastDue}
                          className="btn btn-sm"
                          style={{
                            background: isPastDue ? "var(--surface-3)" : "var(--danger-soft)",
                            color: isPastDue ? "var(--ink-3)" : "var(--danger)",
                            border: `1px solid ${isPastDue ? "var(--border)" : "var(--danger-border)"}`,
                          }}
                        >
                          {busyId === sub.id
                            ? "Declining…"
                            : isPastDue
                            ? "Intervention staged"
                            : <><IconBolt size={12} /> Simulate Stripe failure</>}
                        </button>
                        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>Stripe test-mode</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* ── RIGHT: Call Activity ─────────────────────── */}
            <section>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
                <div>
                  <p className="section-title">Voice Dunning Activity</p>
                  <p style={{ color: "var(--ink-3)", fontSize: 12, marginTop: 2 }}>Live call timeline · safety gates · AI transcripts</p>
                </div>

                {/* Filter tabs */}
                <div className="tab-group" style={{ flexShrink: 0 }}>
                  {(["all", "pending", "completed", "scheduled"] as const).map((f) => {
                    const counts: Record<string, number> = { all: calls.length, pending: pendingCount, completed: completedCount, scheduled: scheduledCount };
                    const labels: Record<string, string> = { all: "All", pending: "Review", completed: "Done", scheduled: "Queued" };
                    return (
                      <button key={f} onClick={() => setCallFilter(f)}
                        className={`tab-btn ${callFilter === f ? "active" : ""}`}
                        id={`tab-calls-${f}`}>
                        {labels[f]} {counts[f] > 0 && <span style={{ fontSize: 10, background: callFilter === f ? "var(--surface-2)" : "var(--surface-3)", padding: "1px 5px", borderRadius: 3 }}>{counts[f]}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Empty state */}
              {filteredCalls.length === 0 && (
                <div style={{
                  padding: "40px 24px", textAlign: "center", borderRadius: 12,
                  border: "1px dashed var(--border-strong)", background: "var(--surface)",
                }}>
                  <div style={{ display: "flex", justifyContent: "center", marginBottom: 10, opacity: 0.35 }}>
                    <IconPhone size={36} color="var(--ink-2)" />
                  </div>
                  <p style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>No calls in this view</p>
                  <p style={{ color: "var(--ink-3)", fontSize: 12, marginTop: 4 }}>
                    Trigger a payment failure or click &ldquo;Load Demo Data&rdquo; to populate records.
                  </p>
                </div>
              )}

              <ul style={{ display: "flex", flexDirection: "column", gap: 12, listStyle: "none", padding: 0, margin: 0 }}>
                {filteredCalls.map((call) => {
                  const cs = CALL_STATUS[call.status] ?? CALL_STATUS.canceled;
                  const isCalling = call.status === "in_progress";
                  return (
                    <li key={call.id} className="entity-card fade-in">

                      {/* Call header */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <p style={{ fontWeight: 700, fontSize: 14 }}>{call.subscriber_name}</p>
                            {call.attempt_number > 1 && (
                              <span style={{ fontSize: 10, fontWeight: 600, color: "var(--warning)", background: "var(--warning-soft)", border: "1px solid var(--warning-border)", padding: "2px 7px", borderRadius: 4 }}>
                                Attempt {call.attempt_number} of {MAX_CALL_ATTEMPTS}
                              </span>
                            )}
                          </div>
                          <p style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 2 }}>
                            {call.plan_name} &middot; Trigger: <span style={{ color: "var(--ink)", fontWeight: 500 }}>{call.trigger_reason}</span>
                          </p>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                          {isCalling && (
                            <span style={{ position: "relative", display: "flex", width: 10, height: 10 }}>
                              <span className="animate-ping" style={{
                                position: "absolute", inset: 0, borderRadius: "50%",
                                background: "#fbbf24", opacity: 0.6,
                              }} />
                              <span style={{ position: "relative", width: 10, height: 10, borderRadius: "50%", background: "#fbbf24" }} />
                            </span>
                          )}
                          <span className="pill" style={{ color: cs.color, background: cs.bg, border: `1px solid ${cs.border}` }}>
                            {cs.label}
                          </span>
                        </div>
                      </div>

                      {/* Scheduled follow-up */}
                      {call.status === "scheduled" && call.scheduled_for && (
                        <div className="gate-panel-info" style={{ marginTop: 10 }}>
                          <p style={{ fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--accent-2)", marginBottom: 4, display: "flex", alignItems: "center", gap: 5 }}>
                            <IconCalendar size={12} color="var(--accent-2)" /> Automatic Retry Scheduled
                          </p>
                          <p style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.6 }}>
                            Previous attempt didn&apos;t reach the customer. Automated follow-up staged for{" "}
                            <strong style={{ color: "var(--ink)" }}>{formatTs(call.scheduled_for)}</strong>.
                            Operator confirmation required before calling.
                          </p>
                          <button
                            id={`btn-stop-followup-${call.id}`}
                            onClick={() => pauseFollowups(call.subscriber_id)}
                            disabled={busyId === call.subscriber_id}
                            className="btn btn-danger-ghost btn-xs"
                            style={{ marginTop: 8 }}
                          >
                            {busyId === call.subscriber_id ? "Canceling…" : <><IconStop size={11} /> Stop follow-up chain</>}
                          </button>
                        </div>
                      )}

                      {/* Safety gate — pending confirmation */}
                      {call.status === "pending_confirmation" && call.preview && (
                        <div className="gate-panel" style={{ marginTop: 10 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                            <span style={{ fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--warning)", display: "flex", alignItems: "center", gap: 5 }}>
                              <IconShield size={12} color="var(--warning)" /> Safety Gate — Call Preview
                            </span>
                            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)" }}>
                              → {call.preview.recipient.phone} ({call.preview.recipient.region})
                            </span>
                          </div>
                          <div className="task-box">
                            <span style={{ color: "var(--ink-3)", fontWeight: 600 }}>CALL-E instructions: </span>
                            <span style={{ fontStyle: "italic", color: "var(--ink-2)" }}>&ldquo;{call.preview.task}&rdquo;</span>
                          </div>
                          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                            <button
                              id={`btn-confirm-call-${call.id}`}
                              onClick={() => confirmCall(call.id)}
                              disabled={busyId === call.id}
                              className="btn btn-success btn-sm"
                            >
                              {busyId === call.id ? "Placing call…" : <><IconCheck size={13} /> Confirm &amp; place call</>}
                            </button>
                            <button
                              id={`btn-cancel-call-${call.id}`}
                              onClick={() => cancelCall(call.id)}
                              disabled={busyId === call.id}
                              className="btn btn-ghost btn-sm"
                            >
                              Discard
                            </button>
                            {call.attempt_number > 1 && (
                              <button
                                id={`btn-stop-chain-${call.id}`}
                                onClick={() => pauseFollowups(call.subscriber_id)}
                                disabled={busyId === call.subscriber_id}
                                className="btn btn-danger-ghost btn-xs"
                              >
                                <IconStop size={11} /> Stop chain
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Completed resolution */}
                      {call.decision && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                              <span style={{
                                fontSize: 12, fontWeight: 700, padding: "3px 9px", borderRadius: 6,
                                color: DECISION_COLOR[call.decision] ?? "var(--neutral)",
                                background: call.decision === "retry_now" || call.decision === "update_card" ? "var(--success-soft)" : "var(--neutral-soft)",
                                border: `1px solid ${call.decision === "retry_now" || call.decision === "update_card" ? "var(--success-border)" : "var(--neutral-border)"}`,
                              }}>
                                {DECISION_LABEL[call.decision] ?? call.decision}
                              </span>
                              {call.recovered_cents > 0 && (
                                <span style={{ fontSize: 12, fontWeight: 800, color: "var(--success)" }}>
                                  +{fmtMoney(call.recovered_cents)} recovered
                                </span>
                              )}
                            </div>
                            {call.intelligence && (
                              <button
                                id={`btn-view-transcript-${call.id}`}
                                onClick={() => setActiveIntelligenceCall(call)}
                                className="btn btn-ghost btn-xs"
                                style={{ display: "flex", alignItems: "center", gap: 5 }}
                              >
                                <IconWaveform size={12} />
                                <span>Conversation</span>
                                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, background: "var(--surface-3)", padding: "1px 5px", borderRadius: 3 }}>
                                  {call.intelligence.transcriptTurns.length} turns
                                </span>
                              </button>
                            )}
                          </div>

                          {call.evidence && (
                            <p style={{ marginTop: 6, fontSize: 12, fontStyle: "italic", color: "var(--ink-2)" }}>
                              &ldquo;{call.evidence}&rdquo;
                            </p>
                          )}

                          {call.action_taken && (
                            <div style={{
                              marginTop: 8, padding: "8px 12px", borderRadius: 8,
                              background: "var(--success-soft)", border: "1px solid var(--success-border)",
                              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                            }}>
                              <span style={{ fontSize: 12, color: "var(--success)", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}><IconCheck size={12} color="var(--success)" /> Action Executed:</span>
                              <span style={{ fontSize: 12, color: "var(--ink-2)", flex: 1 }}>{call.action_taken}</span>
                              {call.action_link && (
                                <a href={call.action_link} target="_blank" rel="noreferrer"
                                  style={{ fontSize: 11, color: "var(--accent-2)", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>
                                  Open ↗
                                </a>
                              )}
                            </div>
                          )}

                          {call.completed_at && (
                            <p style={{ marginTop: 5, fontSize: 11, color: "var(--ink-3)" }}>
                              Completed {formatTs(call.completed_at)}
                            </p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        </main>

        {/* ── Footer ──────────────────────────────────────── */}
        <footer style={{
          borderTop: "1px solid var(--border)",
          padding: "16px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 12,
          color: "var(--ink-3)",
        }}>
          <span>Recover · Built for the <strong style={{ color: "var(--ink-2)" }}>CALL-E: Your Code Is Calling</strong> hackathon</span>
          <span>Auto-refreshes every 3s · CALL-E Voice API</span>
        </footer>
      </div>

      {/* ── Intelligence Modal ───────────────────────────── */}
      {activeIntelligenceCall?.intelligence && (
        <div
          className="modal-backdrop"
          style={{
            position: "fixed", inset: 0, zIndex: 50,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setActiveIntelligenceCall(null); }}
        >
          <div
            className="modal-panel"
            style={{
              width: "100%", maxWidth: 680,
              maxHeight: "90vh",
              display: "flex", flexDirection: "column",
              background: "var(--surface)", border: "1px solid var(--border-strong)",
              borderRadius: 16, overflow: "hidden",
              boxShadow: "0 25px 80px rgba(0,0,0,0.6)",
            }}
          >
            {/* Modal header */}
            <div style={{
              padding: "18px 20px", borderBottom: "1px solid var(--border)",
              display: "flex", justifyContent: "space-between", alignItems: "flex-start",
            }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <h2 style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em" }}>Call Intelligence</h2>
                  {activeIntelligenceCall.intelligence.completionConfidence && (
                    <span className="pill" style={{
                      color: "var(--success)", background: "var(--success-soft)", border: "1px solid var(--success-border)",
                    }}>
                      <span className="pill-dot" style={{ background: "var(--success)" }} />
                      {activeIntelligenceCall.intelligence.completionConfidence.label} confidence
                      ({Math.round(activeIntelligenceCall.intelligence.completionConfidence.score * 100)}%)
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 4 }}>
                  <strong style={{ color: "var(--ink)" }}>{activeIntelligenceCall.subscriber_name}</strong>
                  {" "}({activeIntelligenceCall.subscriber_phone}) · {activeIntelligenceCall.plan_name}
                </p>
              </div>
              <button
                id="btn-close-modal"
                onClick={() => setActiveIntelligenceCall(null)}
                style={{
                  background: "var(--surface-2)", border: "1px solid var(--border)",
                  borderRadius: 8, width: 30, height: 30,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", color: "var(--ink-2)", fontSize: 14,
                  transition: "background 0.15s",
                }}
              >
                <IconX size={14} color="var(--ink-2)" />
              </button>
            </div>

            {/* Modal body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: 16 }}>

              {/* AI Summary */}
              {activeIntelligenceCall.intelligence.summary && (
                <div style={{
                  background: "var(--surface-2)", border: "1px solid var(--border)",
                  borderRadius: 10, padding: 14,
                }}>
                  <p className="label" style={{ marginBottom: 6 }}>AI Conversation Summary</p>
                  <p style={{ fontSize: 13, lineHeight: 1.7, color: "var(--ink)" }}>
                    {activeIntelligenceCall.intelligence.summary}
                  </p>
                </div>
              )}

              {/* Action executed */}
              {activeIntelligenceCall.action_taken && (
                <div style={{
                  background: "var(--success-soft)", border: "1px solid var(--success-border)",
                  borderRadius: 10, padding: 14,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <p className="label" style={{ color: "var(--success)", marginBottom: 4 }}>Automated Resolution Executed</p>
                    {activeIntelligenceCall.action_link && (
                      <a href={activeIntelligenceCall.action_link} target="_blank" rel="noreferrer"
                        style={{ fontSize: 12, color: "var(--accent-2)", fontWeight: 600, display: "flex", alignItems: "center", gap: 3 }}>
                        View Portal <IconExternalLink size={11} color="var(--accent-2)" />
                      </a>
                    )}
                  </div>
                  <p style={{ fontSize: 13, color: "var(--success)", fontWeight: 500 }}>{activeIntelligenceCall.action_taken}</p>
                </div>
              )}

              {/* Transcript */}
              <div>
                <p className="label" style={{ marginBottom: 12 }}>
                  Turn-by-Turn Replay &nbsp;
                  <span style={{ color: "var(--ink-2)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                    ({activeIntelligenceCall.intelligence.transcriptTurns.length} turns)
                  </span>
                </p>

                {activeIntelligenceCall.intelligence.transcriptTurns.length === 0 ? (
                  <p style={{ fontSize: 12, color: "var(--ink-3)", fontStyle: "italic" }}>No transcript turns recorded.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {activeIntelligenceCall.intelligence.transcriptTurns.map((turn, i) => {
                      const isBot = turn.speaker === "bot";
                      return (
                        <div key={i} style={{ display: "flex", gap: 10, justifyContent: isBot ? "flex-start" : "flex-end" }}>
                          {isBot && (
                            <div style={{
                              width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                              background: "#1a1d26", border: "1px solid var(--border)",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              boxShadow: "0 0 12px var(--accent-glow)", overflow: "hidden",
                            }}>
                              <img src="/logo.png" alt="AI" width={22} height={22} style={{ objectFit: "contain", display: "block" }} />
                            </div>
                          )}
                          <div
                            className={isBot ? "bubble-bot" : "bubble-user"}
                            style={{ maxWidth: "78%", padding: "10px 14px" }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
                              <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: isBot ? "var(--ink-3)" : "rgba(255,255,255,0.6)" }}>
                                {isBot ? "Recover Agent" : activeIntelligenceCall.subscriber_name}
                              </span>
                              <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: isBot ? "var(--ink-3)" : "rgba(255,255,255,0.5)" }}>
                                {formatOffset(turn.offset_seconds)}
                              </span>
                            </div>
                            <p style={{ fontSize: 13, lineHeight: 1.6 }}>{turn.text}</p>
                          </div>
                          {!isBot && (
                            <div style={{
                              width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                              background: "var(--surface-3)", border: "1px solid var(--border)",
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              <IconUser size={14} color="var(--ink-3)" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Modal footer */}
            <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
              <button id="btn-close-modal-footer" onClick={() => setActiveIntelligenceCall(null)} className="btn btn-ghost btn-sm">
                Close Replay
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── MetricCard component ─────────────────────────────────

function MetricCard({
  label, value, sub, color, glowColor, icon,
}: {
  label: string; value: string; sub: string; color: string; glowColor: string; icon: React.ReactNode;
}) {
  return (
    <div className="metric-card">
      <div style={{
        position: "absolute", inset: 0, borderRadius: "inherit", opacity: 0.6,
        background: `radial-gradient(ellipse 80% 50% at 0% 0%, ${glowColor}, transparent)`,
        pointerEvents: "none",
      }} />
      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <p className="label">{label}</p>
          <span style={{ opacity: 0.85 }}>{icon}</span>
        </div>
        <p style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", color, marginTop: 8, lineHeight: 1 }}>
          {value}
        </p>
        <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 6 }}>{sub}</p>
      </div>
    </div>
  );
}