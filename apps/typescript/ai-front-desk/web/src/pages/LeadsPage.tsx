import { useEffect, useState, type FormEvent } from "react";
import { api, type Lead } from "../api";
import { StatusBadge, AvatarName, formatDate, maskPhone } from "../components";
import type { LiveCall } from "../App";

interface Props {
  refreshKey: number;
  onRefresh: () => void;
  setLiveCall: (call: LiveCall | null) => void;
}

export function LeadsPage({ refreshKey, onRefresh, setLiveCall }: Props) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("+1555");
  const [inquiry, setInquiry] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.leads().then(setLeads).catch((e: Error) => setError(e.message));
  }, [refreshKey]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setLiveCall({ contactName: name, snippet: "Asking what they need and when they'd like to come in…" });
    try {
      await api.simulateNewLead({ name, phone, inquiry });
      setName("");
      setPhone("+1555");
      setInquiry("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLiveCall(null);
      setBusy(false);
      onRefresh();
    }
  }

  return (
    <div className="page">
      <h1>Leads</h1>
      <p className="page-subtitle">
        New inquiries get a qualification call: what they need, how soon — then they're booked into the next open
        slot or waitlisted.
      </p>
      {error !== null && <div className="error-banner">{error}</div>}

      <div className="card elev-sm" style={{ marginBottom: 24 }}>
        <form onSubmit={submit} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ flex: "1 1 160px" }}>
            <label>Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field" style={{ flex: "1 1 160px" }}>
            <label>Phone (E.164)</label>
            <input
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              pattern="^\+[1-9]\d{6,14}$"
              title="E.164 format, e.g. +15551234567"
              required
            />
          </div>
          <div className="field" style={{ flex: "2 1 300px" }}>
            <label>Inquiry</label>
            <input
              className="input"
              placeholder="e.g. 'Do you take new patients?'"
              value={inquiry}
              onChange={(e) => setInquiry(e.target.value)}
              required
            />
          </div>
          <button className="btn btn-primary" disabled={busy} type="submit">
            New lead → qualify
          </button>
        </form>
      </div>

      <div className="lead-card-grid">
        {leads.map((lead) => (
          <div className="lead-card" key={lead.id}>
            <div className="lead-head">
              {lead.contact !== null ? (
                <AvatarName name={lead.contact.name} />
              ) : (
                <span className="text-muted">Unknown contact</span>
              )}
              <div style={{ flex: 1 }} />
              <StatusBadge status={lead.status} />
            </div>
            <div className="hr" style={{ margin: "10px 0" }} />
            <p className="lead-inquiry">“{lead.rawInquiry}”</p>
            <div className="lead-meta">
              <span className="k">Phone</span>
              <span className="v mono">{lead.contact !== null ? maskPhone(lead.contact.phone) : "—"}</span>
              <span className="k">Reason</span>
              <span className="v">{lead.reasonForVisit ?? "—"}</span>
              <span className="k">Timeframe</span>
              <span className="v">{lead.preferredTimeframe ?? "—"}</span>
              <span className="k">Received</span>
              <span className="v">{formatDate(lead.createdAt)}</span>
            </div>
          </div>
        ))}
        {leads.length === 0 && <span className="text-muted">No leads yet.</span>}
      </div>
    </div>
  );
}
