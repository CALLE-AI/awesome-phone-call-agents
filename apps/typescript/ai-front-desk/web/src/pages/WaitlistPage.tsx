import { useEffect, useState } from "react";
import { api, type WaitlistEntry } from "../api";
import { StatusBadge, AvatarName, maskPhone } from "../components";
import type { LiveCall } from "../App";

interface Props {
  refreshKey: number;
  onRefresh: () => void;
  setLiveCall: (call: LiveCall | null) => void;
}

const COLUMNS = "70px 2fr 1.4fr 1.4fr 1fr";

const PRIORITY_COLOR: Record<number, string> = { 1: "var(--color-accent-2-700)" };

export function WaitlistPage({ refreshKey }: Props) {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.waitlist().then(setEntries).catch((e: Error) => setError(e.message));
  }, [refreshKey]);

  return (
    <div className="page">
      <h1>Waitlist</h1>
      <p className="page-subtitle">
        Priority-ordered. When a slot frees up, the backfill waterfall calls each WAITING contact in order until
        someone accepts. Trigger it from an appointment's "Cancel &amp; backfill" button.
      </p>
      {error !== null && <div className="error-banner">{error}</div>}

      <div className="data-grid-stacked">
        {entries.map((entry) => (
          <div className="grid-row" key={entry.id} style={{ gridTemplateColumns: COLUMNS, padding: "18px 20px" }}>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 20, color: PRIORITY_COLOR[entry.priority] ?? "var(--color-text)" }}>
              #{entry.priority}
            </div>
            <AvatarName name={entry.contact.name} />
            <div className="mono text-muted" style={{ fontSize: 13.5 }}>
              {maskPhone(entry.contact.phone)}
            </div>
            <div style={{ fontSize: 13.5 }}>{entry.desiredServiceType}</div>
            <div>
              <StatusBadge status={entry.status} />
            </div>
          </div>
        ))}
        {entries.length === 0 && (
          <div className="grid-row" style={{ gridTemplateColumns: "1fr" }}>
            <span className="text-muted">Waitlist is empty.</span>
          </div>
        )}
      </div>
    </div>
  );
}
