import { useEffect, useState } from "react";
import { api, type WaitlistEntry } from "../api";
import { StatusBadge, maskPhone } from "../components";

interface Props {
  refreshKey: number;
  onRefresh: () => void;
  setCalling: (message: string | null) => void;
}

export function WaitlistPage({ refreshKey }: Props) {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.waitlist().then(setEntries).catch((e: Error) => setError(e.message));
  }, [refreshKey]);

  return (
    <>
      <h2>Waitlist</h2>
      <p className="subtitle">
        Priority-ordered. When a slot frees up, the backfill waterfall calls each WAITING contact in order until
        someone accepts. Trigger it from an appointment's "Cancel &amp; backfill" button.
      </p>
      {error !== null && <div className="error-banner">{error}</div>}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Priority</th>
              <th>Contact</th>
              <th>Phone</th>
              <th>Wants</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>#{entry.priority}</td>
                <td>{entry.contact.name}</td>
                <td className="mono">{maskPhone(entry.contact.phone)}</td>
                <td>{entry.desiredServiceType}</td>
                <td>
                  <StatusBadge status={entry.status} />
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Waitlist is empty.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
