"use client";

import { useEffect, useState } from "react";
import type { DailyBriefing } from "@/lib/briefings/model";

const SHARED_PROFILE_ID = "shared-australia";

async function api(body: object) {
  const response = await fetch("/api/briefings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Daily knowledge request failed");
  return result;
}

export function BriefingWorkspace() {
  const [briefings, setBriefings] = useState<DailyBriefing[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const result = await api({ action: "list" });
    setBriefings((result.briefings as DailyBriefing[]).filter((item) => item.profileId === SHARED_PROFILE_ID));
  };

  useEffect(() => {
    let active = true;
    void api({ action: "list" }).then((result) => {
      if (active) setBriefings((result.briefings as DailyBriefing[]).filter((item) => item.profileId === SHARED_PROFILE_ID));
    }).catch((error) => {
      if (active) setMessage(error instanceof Error ? error.message : "Daily knowledge is unavailable");
    });
    return () => { active = false; };
  }, []);

  const prepare = async () => {
    setBusy(true);
    setMessage("");
    try {
      await api({ action: "prepare-shared", refresh: true });
      await load();
      setMessage("Today’s shared Australian briefing is ready for calls.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Daily knowledge preparation failed");
    } finally {
      setBusy(false);
    }
  };

  const latest = briefings[0];
  return <div aria-label="Shared Australian daily knowledge" style={{ display: "grid", gap: 24, paddingBlock: 24 }}>
    <section className="notice">
      <h2>One briefing for every senior</h2>
      <p>No personal profile is required. The shared briefing covers current Australian news, consumer and scam alerts, community services, benefits and retirement information.</p>
      <p>On the Calls page, turn on <strong>Use today’s knowledge briefing</strong>. The app prepares or reuses this briefing before sending the call to CALL-E.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <button disabled={busy} onClick={() => void prepare()} type="button">{busy ? "Preparing sources…" : "Prepare fresh daily knowledge"}</button>
        <button disabled={busy} onClick={() => void load()} type="button">Refresh</button>
      </div>
    </section>
    {message ? <p role="status">{message}</p> : null}
    {latest ? <section>
      <h2>Australian daily knowledge — {latest.localDate}</h2>
      <p>{latest.status} · {latest.timezone} · Prepared {new Date(latest.preparedAt).toLocaleString()}</p>
      {latest.sections.map((section) => <article key={section.topic} style={{ paddingBlock: 12 }}>
        <h3>{section.topic} — {section.status}</h3>
        <p style={{ whiteSpace: "pre-wrap" }}>{section.answer}</p>
        <ul>{section.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul>
      </article>)}
      <p>This information is prepared before the call. CALL-E answers from these sources and says when a requested detail was not verified.</p>
    </section> : <p>No shared briefing has been prepared yet. It will be created automatically when you review a knowledge-enabled call.</p>}
  </div>;
}
