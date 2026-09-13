"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { CalleFollowupView } from "@/lib/calle/followup-service";
import styles from "./followups.module.css";

interface Snapshot { enabled: boolean; calls: CalleFollowupView[]; available: { reference: string; label: string }[] }
const labels: Record<string, string> = { waiting: "Waiting for call completion", checking: "Reading call result", searching: "Preparing SMS / searching", no_permission: "No verified SMS permission or recap", search_failed: "Could not verify a complete answer — no SMS", unknown: "Sending or uncertain — do not retry", queued: "SMS accepted; awaiting receipt", sent: "SMS delivered", failed: "SMS failed", cancelled: "Cancelled", expired: "Two-hour window expired" };

export function FollowupConsole() {
  const [snapshot, setSnapshot] = useState<Snapshot>({ enabled: false, calls: [], available: [] });
  const [reference, setReference] = useState("");
  const [destination, setDestination] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async (body: object, signal?: AbortSignal) => {
    const response = await fetch("/api/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not load follow-ups");
    return result as Snapshot;
  }, []);
  const submit = useCallback(async (body: object) => {
    setBusy(true); setError("");
    try { setSnapshot(await load(body)); setLoaded(true); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load follow-ups"); return false; }
    finally { setBusy(false); }
  }, [load]);
  useEffect(() => {
    const controller = new AbortController();
    load({ action: "list" }, controller.signal).then((data) => {
      if (!controller.signal.aborted) { setSnapshot(data); setLoaded(true); }
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load follow-ups"); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [load]);
  async function register(event: FormEvent) {
    event.preventDefault();
    if (await submit({ action: "register", reference, destination, authorized })) { setReference(""); setDestination(""); setAuthorized(false); }
  }
  return <main className={styles.page}>
    <header><p className="eyebrow">CALL-E + Twilio · Australian pilot</p><h1>Every call, followed up</h1>
      <p>Each new eligible call automatically keeps its called number. After the conversation, send the recap the customer agreed to receive. If they requested a search, include verified results in the same SMS when they fit.</p>
      <p className={styles.notice}>{snapshot.enabled ? "Automatic follow-ups are enabled. The server checks connected calls while it is running." : "Preview: automatic follow-ups are disabled. Set up CALL-E, Twilio and the follow-up storage key to enable them."}</p>
    </header>
    <section className={styles.card}><h2>Connect an existing CALL-E call</h2>
      <p>New calls to enabled test recipients connect automatically when follow-ups are enabled. The agent offers an SMS recap on ordinary calls too. Older calls need matching structured permission evidence; a provider summary alone cannot authorize SMS.</p>
      <form onSubmit={register}>
        <label>Registered call<select required value={reference} onChange={(event) => setReference(event.target.value)} disabled={!snapshot.enabled}>
          <option value="">Select a call from the monitor</option>{snapshot.available.map((call) => <option key={call.reference} value={call.reference}>{call.label}</option>)}
        </select></label>
        <label>Customer’s Australian mobile<input required type="tel" value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="04… or +614…" autoComplete="off" /></label>
        <label className={styles.check}><input type="checkbox" required checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} />Enable one follow-up for this call. I have permission to process its request. Send only if the customer explicitly agreed during the call; use this same called number.</label>
        <button disabled={busy || !authorized || !snapshot.enabled}>Enable this call’s follow-up</button>
      </form>
    </section>
    <div className={styles.row}><h2>Requests and delivery</h2><div>
      <button disabled={busy} onClick={() => void submit({ action: "list" })}>Refresh</button>
      <button className={styles.cancel} disabled={busy || !snapshot.enabled} onClick={() => void submit({ action: "run" })}>Check next call now</button>
    </div></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {loaded && !snapshot.calls.length && <p>No follow-ups yet. Place a new call through the CALL-E monitor after enabling setup.</p>}
    <div aria-live="polite">{snapshot.calls.map((call) => <section className={styles.card} key={call.id}>
      <h3>{call.callReference}</h3><p>{call.destination} · {labels[call.status] ?? call.status}</p>
      {call.query && <p><strong>Customer’s request:</strong> {call.query}</p>}
      {call.message && <pre className={styles.message}>{call.message}</pre>}
      {["waiting", "checking", "searching"].includes(call.status) && <button disabled={busy} onClick={() => void submit({ action: "cancel", id: call.id })}>Cancel follow-up</button>}
    </section>)}</div>
    <p>One SMS per eligible completed call, with permission. Unanswered calls and calls without verified permission receive no SMS. If a search fails, an independently approved recap can still be sent. Closing this page does not cancel an enabled follow-up. Stopping the server pauses checks; accepted SMS cannot be recalled.</p>
  </main>;
}
