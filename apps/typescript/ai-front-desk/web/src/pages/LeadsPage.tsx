import { useEffect, useState, type FormEvent } from "react";
import { api, type Lead } from "../api";
import { StatusBadge, formatDate, maskPhone } from "../components";

interface Props {
  refreshKey: number;
  onRefresh: () => void;
  setCalling: (message: string | null) => void;
}

export function LeadsPage({ refreshKey, onRefresh, setCalling }: Props) {
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
    setCalling(`New inquiry from ${name} — calling to qualify and book…`);
    try {
      await api.simulateNewLead({ name, phone, inquiry });
      setName("");
      setPhone("+1555");
      setInquiry("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCalling(null);
      setBusy(false);
      onRefresh();
    }
  }

  return (
    <>
      <h2>Leads</h2>
      <p className="subtitle">
        New inquiries get a qualification call: what they need, how soon — then they're booked into the next open slot
        or waitlisted.
      </p>
      {error !== null && <div className="error-banner">{error}</div>}
      <div className="card">
        <form className="form-row" onSubmit={submit}>
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input
            placeholder="+15551234567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            pattern="^\+[1-9]\d{6,14}$"
            title="E.164 format, e.g. +15551234567"
            required
          />
          <input
            placeholder="What did they ask? e.g. 'Do you take new patients?'"
            value={inquiry}
            onChange={(e) => setInquiry(e.target.value)}
            required
            style={{ flexBasis: "40%" }}
          />
          <button className="button primary" disabled={busy} type="submit">
            ☎ New lead → qualify
          </button>
        </form>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Contact</th>
              <th>Phone</th>
              <th>Inquiry</th>
              <th>Reason</th>
              <th>Timeframe</th>
              <th>Status</th>
              <th>Received</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id}>
                <td>{lead.contact?.name ?? "—"}</td>
                <td className="mono">{lead.contact ? maskPhone(lead.contact.phone) : "—"}</td>
                <td className="muted">“{lead.rawInquiry}”</td>
                <td>{lead.reasonForVisit ?? <span className="muted">—</span>}</td>
                <td>{lead.preferredTimeframe ?? <span className="muted">—</span>}</td>
                <td>
                  <StatusBadge status={lead.status} />
                </td>
                <td className="muted">{formatDate(lead.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
