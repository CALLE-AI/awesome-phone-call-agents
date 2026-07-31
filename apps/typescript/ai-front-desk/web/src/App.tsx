import { useCallback, useEffect, useState } from "react";
import { api, type AppStatus } from "./api";
import { AppointmentsPage } from "./pages/AppointmentsPage";
import { WaitlistPage } from "./pages/WaitlistPage";
import { LeadsPage } from "./pages/LeadsPage";
import { CallActivityPage } from "./pages/CallActivityPage";

type Page = "appointments" | "waitlist" | "leads" | "calls";

const pages: { id: Page; label: string }[] = [
  { id: "appointments", label: "📅 Appointments" },
  { id: "waitlist", label: "📋 Waitlist" },
  { id: "leads", label: "📥 Leads" },
  { id: "calls", label: "☎️ Call Activity" },
];

export function App() {
  const [page, setPage] = useState<Page>("appointments");
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [calling, setCalling] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
    api.status().then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>
          AI <span>Front Desk</span>
        </h1>
        <p className="tagline">Your calendar, kept full — by phone.</p>
        {pages.map((item) => (
          <button
            key={item.id}
            className={`nav-button ${page === item.id ? "active" : ""}`}
            onClick={() => setPage(item.id)}
          >
            {item.label}
          </button>
        ))}
        <div className="call-budget">
          {status === null ? (
            <span>Server unreachable</span>
          ) : (
            <>
              <strong>
                {status.liveCallsUsed}/{status.freeTierTotal}
              </strong>{" "}
              real calls used
              <br />
              <span className={`mode ${status.dryRun ? "dry" : "live"}`}>
                {status.dryRun ? "DRY RUN" : "LIVE CALLS"}
              </span>
            </>
          )}
        </div>
      </aside>
      <main className="main">
        {calling !== null && (
          <div className="calling-banner">
            <span className="pulse" /> {calling}
          </div>
        )}
        {page === "appointments" && (
          <AppointmentsPage refreshKey={refreshKey} onRefresh={refresh} setCalling={setCalling} />
        )}
        {page === "waitlist" && (
          <WaitlistPage refreshKey={refreshKey} onRefresh={refresh} setCalling={setCalling} />
        )}
        {page === "leads" && <LeadsPage refreshKey={refreshKey} onRefresh={refresh} setCalling={setCalling} />}
        {page === "calls" && <CallActivityPage refreshKey={refreshKey} />}
      </main>
    </div>
  );
}
