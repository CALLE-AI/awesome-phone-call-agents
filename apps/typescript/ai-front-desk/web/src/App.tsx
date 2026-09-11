import { useCallback, useEffect, useState, type ReactElement } from "react";
import { api, type AppStatus } from "./api";
import { AppointmentsPage } from "./pages/AppointmentsPage";
import { WaitlistPage } from "./pages/WaitlistPage";
import { LeadsPage } from "./pages/LeadsPage";
import { CallActivityPage } from "./pages/CallActivityPage";
import { CalendarIcon, ClockIcon, UsersIcon, PhoneIcon } from "./icons";

type Page = "appointments" | "waitlist" | "leads" | "calls";

const pages: { id: Page; label: string; icon: ReactElement }[] = [
  { id: "appointments", label: "Appointments", icon: <CalendarIcon /> },
  { id: "waitlist", label: "Waitlist", icon: <ClockIcon /> },
  { id: "leads", label: "Leads", icon: <UsersIcon /> },
  { id: "calls", label: "Call Activity", icon: <PhoneIcon /> },
];

export interface LiveCall {
  contactName: string;
  snippet: string;
}

export function App() {
  const [page, setPage] = useState<Page>("appointments");
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [liveCall, setLiveCall] = useState<LiveCall | null>(null);
  const [liveSeconds, setLiveSeconds] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
    api.status().then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (liveCall === null) {
      setLiveSeconds(0);
      return;
    }
    const timer = setInterval(() => setLiveSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [liveCall]);

  const liveDuration = `${Math.floor(liveSeconds / 60)}:${String(liveSeconds % 60).padStart(2, "0")}`;
  const usedPct = status === null ? 0 : Math.min(100, (status.liveCallsUsed / status.freeTierTotal) * 100);

  return (
    <div className="layout">
      <div className="bg-grid" />
      <aside className="sidebar">
        <div>
          <div className="sidebar-brand">
            AI <span>Front Desk</span>
          </div>
          <div className="sidebar-tagline">Your calendar, kept full — by phone.</div>
        </div>
        <div className="hr" style={{ margin: "20px 0 14px" }} />

        <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {pages.map((item) => (
            <button
              key={item.id}
              className={`nav-button ${page === item.id ? "active" : ""}`}
              onClick={() => setPage(item.id)}
            >
              <span className="icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div style={{ flex: 1 }} />

        <div className="call-budget">
          {status === null ? (
            <span className="text-muted" style={{ fontSize: 12 }}>
              Server unreachable
            </span>
          ) : (
            <>
              <div className="count">
                <strong>{status.liveCallsUsed}</strong>
                <span className="text-muted">/{status.freeTierTotal} real calls used</span>
              </div>
              <div className="bar">
                <div className="bar-fill" style={{ width: `${usedPct}%` }} />
              </div>
              <span className={`mode-badge ${status.dryRun ? "dry" : "live"}`}>
                {!status.dryRun && <span className="dot" />}
                {status.dryRun ? "DRY RUN" : "LIVE CALLS"}
              </span>
            </>
          )}
        </div>
      </aside>

      <main className="main">
        {liveCall !== null && (
          <div className="live-call-banner">
            <div className="icon-box">
              <PhoneIcon />
            </div>
            <div style={{ flex: 1 }}>
              <div className="title">Outbound call in progress — {liveCall.contactName}</div>
              <div className="snippet">"{liveCall.snippet}"</div>
            </div>
            <span className="wave">
              <span />
              <span />
              <span />
              <span />
              <span />
            </span>
            <div className="duration">{liveDuration}</div>
          </div>
        )}
        {page === "appointments" && (
          <AppointmentsPage refreshKey={refreshKey} onRefresh={refresh} setLiveCall={setLiveCall} />
        )}
        {page === "waitlist" && (
          <WaitlistPage refreshKey={refreshKey} onRefresh={refresh} setLiveCall={setLiveCall} />
        )}
        {page === "leads" && <LeadsPage refreshKey={refreshKey} onRefresh={refresh} setLiveCall={setLiveCall} />}
        {page === "calls" && <CallActivityPage refreshKey={refreshKey} />}
      </main>
    </div>
  );
}
