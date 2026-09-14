"use client";

import { useEffect, useRef, useState } from "react";
import { ConnectorType, Station, StationCheckState } from "@/lib/types";
import { rankStations, headlineFor } from "@/lib/ranking";

type Phase = "form" | "checking" | "results";

const CONNECTORS: ConnectorType[] = ["CCS2", "CCS1", "CHAdeMO", "Type2", "GB/T"];
const POLL_TIMEOUT_MS = 120_000; // real calls usually resolve in 20-90s

export default function Home() {
  const [stations, setStations] = useState<Station[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stationSet, setStationSet] = useState<"demo" | "us">("demo");
  const [from, setFrom] = useState("Lahore");
  const [to, setTo] = useState("Islamabad");
  const [connector, setConnector] = useState<ConnectorType>("CCS2");
  const [demoMode, setDemoMode] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [checks, setChecks] = useState<Record<string, StationCheckState>>({});
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const checksListRef = useRef<StationCheckState[]>([]);

  useEffect(() => {
    fetch(`/api/stations?set=${stationSet}`)
      .then((r) => r.json())
      .then((d) => {
        setStations(d.stations);
        setSelected(new Set(d.stations.map((s: Station) => s.id)));
      });
  }, [stationSet]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handleCheck() {
    setError(null);
    setPhase("checking");
    const stationIds = Array.from(selected);
    const pollStartedAt = Date.now();

    let startRes: Response;
    try {
      startRes = await fetch("/api/check/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, connector, stationIds, demoMode, apiKey }),
      });
    } catch (err: any) {
      setError(`Could not reach the server: ${String(err?.message ?? err)}`);
      setPhase("form");
      return;
    }

    if (!startRes.ok) {
      const body = await startRes.json().catch(() => ({}));
      setError(body.error ?? "Failed to start checks.");
      setPhase("form");
      return;
    }

    const { checks: started }: { checks: StationCheckState[] } = await startRes.json();
    checksListRef.current = started;
    setChecks(Object.fromEntries(started.map((c) => [c.stationId, c])));

    // Failsafe: if every station already came back failed (e.g. a bad API
    // key rejected before any call was placed), there's nothing to poll —
    // go straight to results instead of sitting on the checking screen.
    if (started.every((c) => ["completed", "failed", "canceled"].includes(c.status))) {
      setPhase("results");
      return;
    }

    pollRef.current = setInterval(async () => {
      let statusRes: Response;
      try {
        statusRes = await fetch("/api/check/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checks: checksListRef.current, apiKey }),
        });
      } catch (err: any) {
        // Network failure mid-poll — don't spin forever, surface it and stop.
        setError(`Lost connection while checking status: ${String(err?.message ?? err)}`);
        if (pollRef.current) clearInterval(pollRef.current);
        setPhase("results");
        return;
      }

      if (!statusRes.ok) {
        const body = await statusRes.json().catch(() => ({}));
        setError(body.error ?? `Status check failed (HTTP ${statusRes.status}).`);
        if (pollRef.current) clearInterval(pollRef.current);
        setPhase("results");
        return;
      }
      const { checks: latest }: { checks: StationCheckState[] } = await statusRes.json();
      checksListRef.current = latest;
      setChecks(Object.fromEntries(latest.map((c) => [c.stationId, c])));

      const allTerminal = latest.every((c) =>
        ["completed", "failed", "canceled"].includes(c.status),
      );
      const elapsed = Date.now() - pollStartedAt;
      if (allTerminal) {
        if (pollRef.current) clearInterval(pollRef.current);
        setPhase("results");
      } else if (elapsed > POLL_TIMEOUT_MS) {
        // A real call sitting in queued/in_progress for over 2 minutes is
        // unusual (most resolve in 20-90s) but not impossible — rather than
        // polling forever with no feedback, stop and show what we have,
        // marking anything still in flight so it's visible instead of
        // silently stuck. This is the failsafe for a call that never
        // reaches a terminal status at all.
        if (pollRef.current) clearInterval(pollRef.current);
        checksListRef.current = latest.map((c) =>
          ["completed", "failed", "canceled"].includes(c.status)
            ? c
            : { ...c, status: "failed" as const, error: c.error ?? "Timed out waiting for a final result from CALL-E." },
        );
        setChecks(Object.fromEntries(checksListRef.current.map((c) => [c.stationId, c])));
        setPhase("results");
      }
    }, 1500);
  }

  function toggleStation(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedStations = stations.filter((s) => selected.has(s.id));
  const ranked =
    phase === "results" ? rankStations(selectedStations, checks) : [];

  return (
    <main className="wrap">
      <div className="brand">ChargeCheck</div>
      <h1>Don&apos;t trust the map. Call the station.</h1>
      <p className="tagline">
        Google can tell you where the charger is. ChargeCheck calls to find out whether you can
        actually use it.
      </p>

      {phase === "form" && (
        <>
          <div className="card">
            <div className="row">
              <div className="field">
                <label>Station set</label>
                <select
                  value={stationSet}
                  onChange={(e) => {
                    const next = e.target.value as "demo" | "us";
                    setStationSet(next);
                    if (next === "us") {
                      setFrom("Your route");
                      setTo("Los Angeles, CA area");
                    } else {
                      setFrom("Lahore");
                      setTo("Islamabad");
                    }
                  }}
                >
                  <option value="demo">Local demo (fictional numbers)</option>
                  <option value="us">US live test (real support lines)</option>
                </select>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="row">
              <div className="field">
                <label>From</label>
                <input value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="field">
                <label>To</label>
                <input value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
              <div className="field">
                <label>Connector</label>
                <select value={connector} onChange={(e) => setConnector(e.target.value as ConnectorType)}>
                  {CONNECTORS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="card">
            <label>Charging stations to check</label>
            <div className="station-list">
              {stations.map((s) => (
                <label key={s.id} className="station-row" style={{ cursor: "pointer" }}>
                  <div className="station-meta">
                    <span className="station-name">{s.name}</span>
                    <span className="station-sub">
                      {s.location} · {s.phone} · {s.connectors.join(", ")}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => toggleStation(s.id)}
                  />
                </label>
              ))}
            </div>
            <label className="toggle" style={{ marginTop: 8 }}>
              <input
                type="checkbox"
                checked={demoMode}
                onChange={(e) => setDemoMode(e.target.checked)}
              />
              Demo mode (simulate calls — no real CALL-E dial)
            </label>
            {!demoMode && (
              <div style={{ marginTop: 12 }}>
                <label>Your CALL-E API key (used for this request only, never stored)</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Get one free at dashboard.heycall-e.com"
                />
              </div>
            )}
          </div>

          {error && <div className="card" style={{ color: "var(--danger)" }}>{error}</div>}

          <button className="primary" disabled={selected.size === 0} onClick={handleCheck}>
            CHECK AVAILABILITY
          </button>
        </>
      )}

      {phase === "checking" && (
        <div className="card">
          <div className="small-muted" style={{ marginBottom: 12 }}>
            CHECKING {selectedStations.length} STATION{selectedStations.length > 1 ? "S" : ""}
            {"  "}
            <span className={`badge ${demoMode ? "badge-demo" : "badge-live"}`}>
              {demoMode ? "DEMO / SIMULATION" : "LIVE CALL-E"}
            </span>
          </div>
          <div className="station-list">
            {selectedStations.map((s) => {
              const c = checks[s.id];
              const status = c?.status ?? "queued";
              return (
                <div key={s.id} className="station-row">
                  <div className="station-meta">
                    <span className="station-name">{s.name}</span>
                    <span className="station-sub">{statusLabel(status)}</span>
                    {c?.error && (
                      <span className="station-sub" style={{ color: "var(--danger)" }}>
                        {c.error}
                      </span>
                    )}
                  </div>
                  <div className="status-line">
                    <span className={`dot ${status}`} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {phase === "results" && (
        <>
          <div className="small-muted" style={{ marginBottom: 12 }}>
            VERIFIED CHARGING OPTIONS{"  "}
            <span className={`badge ${demoMode ? "badge-demo" : "badge-live"}`}>
              {demoMode ? "DEMO / SIMULATION" : "LIVE CALL-E"}
            </span>
          </div>
          {ranked.map((r, i) => (
            <div key={r.station.id} className={`card result-card ${i === 0 ? "top" : ""}`}>
              <div>
                {i === 0 &&
                  r.verified &&
                  (r.headline === "Available now" || r.headline.startsWith("Available soon")) && (
                    <div className="recommended">Recommended</div>
                  )}
                <div className="headline">{r.station.name}</div>
                <div className="small-muted">{r.station.location}</div>
                <div style={{ marginTop: 8, fontWeight: 600 }}>{headlineFor(r.check)}</div>
                {r.check.structuredResult && (
                  <div style={{ marginTop: 6 }}>
                    {r.check.structuredResult.price_per_kwh && (
                      <span className="tag">{r.check.structuredResult.price_per_kwh}</span>
                    )}
                    {r.check.structuredResult.payment_requirements && (
                      <span className="tag">{r.check.structuredResult.payment_requirements}</span>
                    )}
                    {r.check.structuredResult.accessibility && (
                      <span className="tag">{r.check.structuredResult.accessibility}</span>
                    )}
                  </div>
                )}
                <div style={{ marginTop: 6 }}>
                  {r.verified ? (
                    <span className="tag verified-tag">
                      CALL VERIFIED{" "}
                      {r.check.verifiedAt ? `· ${new Date(r.check.verifiedAt).toLocaleTimeString()}` : ""}
                    </span>
                  ) : (
                    <span className="tag unverified-tag">COULD NOT VERIFY</span>
                  )}
                </div>
                {r.check.error && (
                  <div className="small-muted" style={{ color: "var(--danger)", marginTop: 6 }}>
                    {r.check.error}
                  </div>
                )}
              </div>
            </div>
          ))}
          <button
            className="primary"
            style={{ marginTop: 16 }}
            onClick={() => {
              setPhase("form");
              setChecks({});
              checksListRef.current = [];
            }}
          >
            RUN ANOTHER CHECK
          </button>
        </>
      )}
    </main>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case "queued":
      return "Calling…";
    case "in_progress":
      return "Connected — asking about availability…";
    case "completed":
      return "Verified";
    case "failed":
      return "No answer / unavailable";
    case "canceled":
      return "Canceled";
    default:
      return status;
  }
}
