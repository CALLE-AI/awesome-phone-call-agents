"use client";

import { useEffect, useMemo, useState } from "react";

type RecoveryStep = {
  id: number;
  label: string;
  detail: string;
  status: "waiting" | "calling" | "failed" | "success";
  time?: string;
};

type RecoveryResult = {
  provider: string;
  arrival: string;
  additionalCost: number;
  confirmation: string;
  hotelPenalty: string;
};

type CallLog = {
  provider: string;
  durationMs: number;
  decision: string;
  callId: string;
  returnedJson: Record<string, unknown> | null;
};

const demoResult: RecoveryResult = {
  provider: "Northstar Airlines",
  arrival: "07:50",
  additionalCost: 286,
  confirmation: "PLAN-B-4821",
  hotelPenalty: "Waived",
};

const initialSteps: RecoveryStep[] = [
  { id: 1, label: "Provider A - Skyline Air", detail: "Queued after constraint extraction", status: "waiting" },
];

function stepsAt(stage: number): RecoveryStep[] {
  const providerA: RecoveryStep = stage < 3
    ? initialSteps[0]
    : stage === 3
      ? { id: 1, label: "Provider A - Skyline Air", detail: "Calling for an arrival before 09:00...", status: "calling" }
      : { id: 1, label: "Provider A - Skyline Air", detail: "Rejected - earliest arrival 10:30", status: "failed", time: "42s" };
  if (stage < 4) return [providerA];

  const providerB: RecoveryStep = stage === 4
    ? { id: 2, label: "Provider B - Northstar Airlines", detail: "Calling because Provider A missed the deadline...", status: "calling" }
    : { id: 2, label: "Provider B - Northstar Airlines", detail: "Selected - arrives 07:50 - $286", status: "success", time: "1m 18s" };
  if (stage < 5) return [providerA, providerB];

  const hotel: RecoveryStep = stage === 5
    ? { id: 3, label: "Aster Hotel", detail: "Requesting disruption waiver...", status: "calling" }
    : { id: 3, label: "Aster Hotel", detail: "Hotel penalty successfully waived", status: "success", time: "54s" };
  return [providerA, providerB, hotel];
}

export default function Home() {
  const [steps, setSteps] = useState<RecoveryStep[]>(initialSteps);
  const [demoStage, setDemoStage] = useState(0);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [seconds, setSeconds] = useState(8 * 60 + 17);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showSetup, setShowSetup] = useState(false);
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [liveAvailable, setLiveAvailable] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [phoneOne, setPhoneOne] = useState("");
  const [phoneTwo, setPhoneTwo] = useState("");
  const [liveResult, setLiveResult] = useState<RecoveryResult | null>(null);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/recovery")
      .then((response) => response.json())
      .then((data) => setLiveAvailable(Boolean(data.liveAvailable)))
      .catch(() => setLiveAvailable(false));
  }, []);

  useEffect(() => {
    if (!running || finished) return;
    const timer = window.setInterval(() => {
      setSeconds((value) => Math.max(0, value - 1));
      setElapsedSeconds((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running, finished]);

  const clock = useMemo(() => {
    const hours = Math.floor(seconds / 3600).toString().padStart(2, "0");
    const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
    const secs = (seconds % 60).toString().padStart(2, "0");
    return `${hours}:${minutes}:${secs}`;
  }, [seconds]);

  const stopwatch = useMemo(() => {
    const minutes = Math.floor(elapsedSeconds / 60).toString().padStart(2, "0");
    const secs = (elapsedSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${secs}`;
  }, [elapsedSeconds]);

  const agentMessage = useMemo(() => {
    switch (demoStage) {
      case 1: return "Flight disruption detected - SK 214 CANCELLED";
      case 2: return "Constraints extracted: deadline 09:00, budget $400, interview first";
      case 3: return "Calling Provider A - Skyline Air...";
      case 4: return "No valid option - earliest arrival 10:30. Switching to Provider B...";
      case 5: return "Provider B offers a valid route. Validating it against every constraint...";
      case 6: return "Why this plan? CALL-E is explaining the decision before revealing it.";
      case 7: return "Mission accomplished. You'll arrive before your interview.";
      default: return "CALL-E is ready to recover the trip.";
    }
  }, [demoStage]);

  const providerAnalysis = useMemo(() => {
    switch (demoStage) {
      case 1: return { label: "ANALYZING PROVIDERS", title: "Reviewing recovery options...", detail: "CALL-E is preparing the provider sequence." };
      case 2: return { label: "EVALUATING CONSTRAINTS", title: "Checking arrival time and budget...", detail: "Deadline 09:00 - maximum extra cost $400." };
      case 3: return { label: "CALLING PROVIDER A", title: "Skyline Air is on the line...", detail: "Requesting the earliest valid arrival." };
      case 4: return { label: "PROVIDER A REJECTED", title: "Calling Provider B...", detail: "Arrival 10:30 failed the deadline constraint." };
      case 5: return { label: "EVALUATING PROVIDER B", title: "Validating arrival time and budget...", detail: "Checking the 07:50 arrival and $286 additional cost." };
      default: return { label: "ANALYZING PROVIDERS", title: "Ready to evaluate providers", detail: "CALL-E will reveal each provider only when it is contacted." };
    }
  }, [demoStage]);

  const constraintsExtracted = demoStage >= 2;
  const showWhy = demoStage >= 6;
  const revealFinal = demoStage >= 7 && finished;
  const displayedResult = mode === "live" ? liveResult : demoResult;

  function scheduleDemo() {
    const timeline = [
      { at: 0, stage: 1 },
      { at: 1000, stage: 2 },
      { at: 2200, stage: 3 },
      { at: 3600, stage: 4 },
      { at: 5100, stage: 5 },
      { at: 6500, stage: 6 },
      { at: 8300, stage: 7 },
    ];
    timeline.forEach(({ at, stage }) => {
      window.setTimeout(() => {
        setDemoStage(stage);
        setSteps(stepsAt(stage));
        if (stage === 7) {
          setFinished(true);
          setRunning(false);
        }
      }, at);
    });
  }

  async function startRecovery() {
    if (running) return;
    setError("");
    setFinished(false);
    setDemoStage(0);
    setSteps(initialSteps);
    setElapsedSeconds(0);
    setLiveResult(null);
    setCallLogs([]);
    setRunning(true);

    if (mode === "live") {
      if (!liveAvailable || !accessCode || !phoneOne || !phoneTwo) {
        setError("Live Mode requires the team access code and two E.164 test phone numbers.");
        setRunning(false);
        setShowSetup(true);
        return;
      }
      try {
        setDemoStage(1);
        await new Promise((resolve) => window.setTimeout(resolve, 700));
        setDemoStage(2);
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        setDemoStage(3);
        setSteps(stepsAt(3));
        const response = await fetch("/api/recovery", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "live",
            phones: [phoneOne, phoneTwo],
            accessCode,
            runId: crypto.randomUUID(),
          }),
        });
        const contentType = response.headers.get("content-type") || "";
        const result = contentType.includes("application/json")
          ? await response.json()
          : {
              error: response.status === 504
                ? "CALL-E exceeded the live demo time limit. No result was fabricated."
                : `Live recovery returned HTTP ${response.status}.`,
            };
        if (!response.ok) throw new Error(result.error || "Live recovery could not start.");
        setCallLogs(result.logs || []);
        if (result.steps) setSteps(result.steps);
        if (!result.result) throw new Error("CALL-E completed the available calls, but no viable route was confirmed.");
        setLiveResult(result.result);
        setDemoStage(6);
        await new Promise((resolve) => window.setTimeout(resolve, 1800));
        setDemoStage(7);
        setFinished(true);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Live recovery failed safely.");
      } finally {
        setRunning(false);
      }
      return;
    }

    scheduleDemo();
  }

  return (
    <main className="shell">
      <nav className="topbar">
        <a className="brand" href="#top" aria-label="PLAN B home"><span className="brand-mark">B</span><span>PLAN B</span></a>
        <div className="nav-center"><span className="pulse-dot" />CALL-E online <b className={elapsedSeconds < 180 ? "within-time" : "over-time"}>Stopwatch {stopwatch} / 03:00</b></div>
        <button className="ghost-button" onClick={() => setShowSetup(!showSetup)}>{showSetup ? "Close setup" : "Call setup"}</button>
      </nav>

      <section className="hero" id="top">
        <div className="eyebrow"><span>FLIGHT DISRUPTION DETECTED</span><b>SK 214 - CANCELLED</b></div>
        <div className="hero-grid">
          <div>
            <p className="flight-code">SK 214 - CANCELLED</p>
            <h1>The trip failed.<br /><em>The agent didn’t.</em></h1>
            <p className="hero-copy">Powered by CALL-E, PLAN B calls the real world - airlines, hotels, and providers - to rebuild a disrupted trip within your deadline and budget.</p>
          </div>
          <div className="deadline-card">
            <span>Priority</span><strong>Arrive before interview</strong><small>Scholarship interview - London</small>
            <div className="countdown"><span>Decision window</span><b>{clock}</b></div>
          </div>
        </div>
      </section>

      {showSetup && (
        <section className="setup-panel" aria-label="Call configuration">
          <div><span className="section-kicker">RUN MODE</span><div className="mode-switch">
            <button className={mode === "demo" ? "active" : ""} onClick={() => setMode("demo")}>Safe demo</button>
            {liveAvailable && <button className={mode === "live" ? "active" : ""} onClick={() => setMode("live")}>Live CALL-E</button>}
          </div></div>
          {mode === "live" && liveAvailable ? <>
            <label>Team access code<input type="password" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} autoComplete="off" /></label>
            <label>Provider A phone<input value={phoneOne} onChange={(event) => setPhoneOne(event.target.value)} placeholder="+1 415 555 0100" /></label>
            <label>Provider B phone<input value={phoneTwo} onChange={(event) => setPhoneTwo(event.target.value)} placeholder="+1 415 555 0101" /></label>
          </> : <p className="safe-mode-note">Safe Demo is client-side and never places a call. Live CALL-E stays hidden until enabled by the team.</p>}
        </section>
      )}

      <section className="workspace">
        <div className="mission-card">
          <div className="card-heading">
            <div><span className="section-kicker">RECOVERY MISSION</span><h2>Find one viable arrival plan</h2></div>
            <span className={`status-chip ${finished ? "resolved" : running ? "working" : ""}`}>{finished ? "CALL-E resolved it" : running ? `Step ${Math.max(1, demoStage)} of 7` : "CALL-E ready"}</span>
          </div>

          <div className={`agent-decision ${running ? "is-live" : ""} ${finished ? "is-done" : ""}`} role="status" aria-live="polite">
            <div className="agent-avatar">CE</div><div><span>CALL-E DECISION ENGINE</span><strong>{agentMessage}</strong></div><b>{finished ? "OK" : running ? "LIVE" : "IDLE"}</b>
          </div>

          <div className={`constraint-block ${constraintsExtracted ? "is-extracted" : ""}`}>
            <div className="constraint-heading"><span>CALL-E EXTRACTED CONSTRAINTS</span><b>{constraintsExtracted ? "EXTRACTED" : "WAITING"}</b></div>
            <div className="constraints">
              <div><span>DEADLINE</span><strong>09:00</strong></div>
              <div><span>MAXIMUM EXTRA BUDGET</span><strong>$400</strong></div>
              <div><span>PRIORITY</span><strong>Arrive before interview</strong></div>
            </div>
          </div>

          <div className="calls">
            {steps.map((step) => (
              <article className={`call-row ${step.status}`} key={step.id}>
                <div className="call-icon">{step.status === "success" ? "OK" : step.status === "failed" ? "X" : step.status === "calling" ? "..." : step.id}</div>
                <div className="call-body"><strong>{step.label}</strong><span>{step.detail}</span></div>
                <div className="call-meta">{step.time || (step.status === "calling" ? "LIVE" : "-")}</div>
              </article>
            ))}
          </div>

          {error && <p className="error-message">{error}</p>}
          <button className="rescue-button" onClick={startRecovery} disabled={running}>
            <span>{running ? "CALL-E IS RECOVERING THE TRIP" : finished ? "RUN THE SCENARIO AGAIN" : mode === "live" ? "START TWO LIVE CALLS" : "START SAFE DEMO"}</span><b>{running ? "..." : ">"}</b>
          </button>
        </div>

        <aside className={`outcome-card ${revealFinal ? "is-finished" : ""}`}>
          <span className="section-kicker">CALL-E DECISION</span>
          <div className="route-line"><b>SFO</b><span><i /><small>via OAK</small><i /></span><b>LHR</b></div>

          {!showWhy && <div className="decision-wait"><span>{providerAnalysis.label}</span><strong>{providerAnalysis.title}</strong><small>{providerAnalysis.detail}</small></div>}

          {showWhy && <div className="why-card active reveal-panel">
            <span>WHY THIS PLAN?</span>
            <ul>
              <li><i>&#10003;</i> Arrives before 09:00</li>
              <li><i>&#10003;</i> Within the $400 limit</li>
              <li><i>&#10003;</i> Lowest additional cost among valid options</li>
              <li><i>&#10003;</i> {mode === "demo" ? "Hotel penalty successfully waived" : "Structured result returned directly by CALL-E"}</li>
            </ul>
            {mode === "live" && <p className="honesty-note">Hotel negotiation was not attempted in Live Mode. No hotel outcome is claimed.</p>}
          </div>}

          {showWhy && !revealFinal && <div className="final-locked"><span>DECISION EXPLAINED</span><strong>Final plan unlocking...</strong><small>CALL-E reveals the structured result after explaining why.</small></div>}

          {revealFinal && displayedResult && <div className="final-recovery reveal-panel">
            <span className="final-title">FINAL RECOVERY PLAN</span>
            <div className="result-row"><span>Provider selected</span><strong>{displayedResult.provider}</strong></div>
            <div className="result-row"><span>Arrival</span><strong>{displayedResult.arrival} <i>&#10003;</i></strong></div>
            <div className="result-row"><span>Additional cost</span><strong>${displayedResult.additionalCost}</strong></div>
            <div className="result-row"><span>Confirmation</span><strong>{displayedResult.confirmation || "Not returned"}</strong></div>
            <div className="result-row"><span>Hotel penalty</span><strong>{displayedResult.hotelPenalty}</strong></div>
          </div>}

          {revealFinal && <div className="mission-complete"><span>&#10003;</span><div><b>Mission accomplished.</b><small>You’ll arrive before your interview.</small></div></div>}
          {mode === "live" && callLogs.length > 0 && <details className="call-log">
            <summary>Internal call log ({callLogs.length})</summary>
            {callLogs.map((log) => <div className="log-entry" key={log.callId}>
              <div><strong>{log.provider}</strong><span>{Math.round(log.durationMs / 1000)}s - {log.decision}</span></div>
              <pre>{JSON.stringify(log.returnedJson, null, 2)}</pre>
            </div>)}
          </details>}
        </aside>
      </section>

      <footer><p><b>Call-first recovery.</b> If one provider fails, CALL-E reroutes.</p><span>Powered by CALL-E</span></footer>
    </main>
  );
}
