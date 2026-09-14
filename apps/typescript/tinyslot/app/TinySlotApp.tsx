"use client";

import { useEffect, useState } from "react";
import { campaignSummary, evaluateCenter, nextWave } from "@/lib/matching";
import { downloadConversationPdf } from "@/lib/conversation-pdf";
import {
  fixtureBrief,
  fixtureCandidates,
  fixtureResults,
  fixtureSummaries,
  fixtureTranscripts,
  fixtureTourResult,
  initialRecords,
} from "@/lib/fixtures";
import { WEEKDAYS, type CenterCallRecord, type CenterResult, type MatchTier, type SearchBrief, type TourRequest, type TranscriptTurn, type Weekday } from "@/lib/types";

type Screen = "brief" | "mission" | "matches" | "tour";
type Mode = "fixture" | "live";
type LiveAvailability = "checking" | "available" | "unavailable";
type RunState = "idle" | "calling" | "complete" | "error";
type TourResult = typeof fixtureTourResult;

type LiveResponse = {
  callId: string;
  campaignId: string;
  operationId: string;
  stage: "search" | "tour";
  status: string;
  taskCompleted?: boolean | null;
  confidence?: { score?: number } | number | null;
  recipients?: Array<{
    candidateId: string;
    status: string;
    structuredResult: CenterResult | TourResult | null;
    summary?: string | null;
    transcriptTurns?: TranscriptTurn[];
  }>;
  message?: string;
  error?: string;
};

const campaignId = "tinyslot-demo-search";
const routeOptions = [
  { value: "US|en-US", label: "United States / English" },
  { value: "GB|en-GB", label: "United Kingdom / English" },
  { value: "IN|en-IN", label: "India / English" },
  { value: "SG|en-SG", label: "Singapore / English" },
  { value: "CA|en-CA", label: "Canada / English" },
  { value: "AU|en-AU", label: "Australia / English" },
];
const navigation: Array<{ id: Screen; step: string; label: string }> = [
  { id: "brief", step: "01", label: "Need" },
  { id: "mission", step: "02", label: "Calls" },
  { id: "matches", step: "03", label: "Matches" },
  { id: "tour", step: "04", label: "Tour" },
];
const tierLabels: Record<MatchTier, string> = {
  qualified: "Qualified",
  partial: "Partial fit",
  waitlist: "Waitlist",
  unavailable: "Unavailable",
  review: "Review",
};

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function formatMoney(minor: number, currency: SearchBrief["currency"]) {
  if (minor < 0) return "Unknown";
  return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(minor / 100);
}

function maskPhone(value: string | undefined) {
  const phone = value?.trim() ?? "";
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return "Not entered";
  return `${phone.slice(0, 3)} **** ${phone.slice(-3)}`;
}

function operationStorageKey(stage: "search" | "tour") {
  return `tinyslot:operation:${stage}`;
}

function getOperationId(stage: "search" | "tour") {
  const key = operationStorageKey(stage);
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  window.sessionStorage.setItem(key, value);
  return value;
}

function clearOperationId(stage: "search" | "tour") {
  window.sessionStorage.removeItem(operationStorageKey(stage));
}

export function TinySlotApp({ publicDemo = false }: { publicDemo?: boolean }) {
  const [screen, setScreen] = useState<Screen>("brief");
  const [mode, setMode] = useState<Mode>("fixture");
  const [brief, setBrief] = useState<SearchBrief>(fixtureBrief);
  const [records, setRecords] = useState<CenterCallRecord[]>(initialRecords);
  const [runState, setRunState] = useState<RunState>("idle");
  const [liveAvailability, setLiveAvailability] = useState<LiveAvailability>(publicDemo ? "unavailable" : "checking");
  const [livePhones, setLivePhones] = useState<Record<string, string>>({});
  const [route, setRoute] = useState("US|en-US");
  const [operatorKey, setOperatorKey] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [notice, setNotice] = useState("");
  const [activeCallId, setActiveCallId] = useState("");
  const [selectedCenterId, setSelectedCenterId] = useState("willow-room");
  const [tourApproval, setTourApproval] = useState("");
  const [tourRequest, setTourRequest] = useState<TourRequest>({
    candidateId: "willow-room",
    parentFirstName: "Alex",
    callbackPhone: "+12025550190",
    preferredWindow: "Thursday at 10:00",
    alternateWindow: "Friday at 15:30",
  });
  const [tourState, setTourState] = useState<RunState>("idle");
  const [tourResult, setTourResult] = useState<TourResult | null>(null);

  const summary = campaignSummary(fixtureCandidates, records, brief);
  const evaluationsById = new Map(summary.evaluations.map((item) => [item.candidateId, item]));
  const selectedCenter = fixtureCandidates.find((candidate) => candidate.id === selectedCenterId) ?? fixtureCandidates[0];
  const selectedRecord = records.find((record) => record.candidateId === selectedCenter.id);

  useEffect(() => {
    if (publicDemo) return;
    const controller = new AbortController();
    fetch("/api/calls/readiness", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const value = await response.json() as { liveAvailable?: boolean };
        setLiveAvailability(value.liveAvailable ? "available" : "unavailable");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setLiveAvailability("unavailable");
      });
    return () => controller.abort();
  }, [publicDemo]);

  function updateBrief<K extends keyof SearchBrief>(key: K, value: SearchBrief[K]) {
    setBrief((current) => ({ ...current, [key]: value }));
  }

  function toggleDay(day: Weekday) {
    setBrief((current) => ({
      ...current,
      requiredWeekdays: current.requiredWeekdays.includes(day)
        ? current.requiredWeekdays.filter((item) => item !== day)
        : [...current.requiredWeekdays, day],
    }));
  }

  async function pollLiveCall(callId: string, operationId: string, stage: "search" | "tour") {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await wait(attempt === 0 ? 1200 : 4000);
      const params = new URLSearchParams({ callId, campaignId, operationId, stage });
      const response = await fetch(`/api/calls?${params.toString()}`, {
        cache: "no-store",
        headers: { "X-TinySlot-Operator-Key": operatorKey },
      });
      const value = await response.json() as LiveResponse;
      if (!response.ok) throw new Error(value.message ?? "Unable to read CALL-E status.");
      if (value.callId !== callId || value.campaignId !== campaignId || value.operationId !== operationId || value.stage !== stage) {
        throw new Error("CALL-E returned a result for a different operation.");
      }
      if (!['completed', 'failed', 'canceled'].includes(value.status)) continue;
      if (value.status !== "completed" || value.taskCompleted !== true) throw new Error(`CALL-E ended with ${value.status}.`);
      return value;
    }
    throw new Error("The call is still running. Keep the call ID and check again before starting another call.");
  }

  async function runFixtureWave(candidateIds: string[]) {
    setRecords((current) => current.map((record) => candidateIds.includes(record.candidateId) ? { ...record, status: "calling" } : record));
    setScreen("mission");
    setNotice("Replaying three synthetic center conversations. No phone is being dialed.");
    await wait(1200);
    setRecords((current) => current.map((record) => candidateIds.includes(record.candidateId) ? {
      ...record,
      status: "completed",
      result: fixtureResults[record.candidateId] ?? null,
      source: "fixture",
      verifiedAt: "2026-09-14T10:24:00Z",
      confidence: 0.94,
      summary: fixtureSummaries[record.candidateId] ?? "No fixture summary was available.",
      transcriptTurns: fixtureTranscripts[record.candidateId] ?? [],
    } : record));
    setRunState("complete");
    setNotice("The simulated wave is complete. TinySlot kept every unknown separate from a verified opening.");
  }

  async function runLiveWave(candidateIds: string[]) {
    if (liveAvailability !== "available") throw new Error("Live calling is not configured on this deployment.");
    if (operatorKey.length < 20) throw new Error("Enter the deployment operator key.");
    if (!authorized) throw new Error("Confirm that every destination is authorized for this test call.");
    const recipients = candidateIds.map((candidateId) => {
      const candidate = fixtureCandidates.find((item) => item.id === candidateId)!;
      return { ...candidate, phone: livePhones[candidateId]?.trim() ?? "" };
    });
    if (recipients.some((recipient) => !/^\+[1-9]\d{7,14}$/.test(recipient.phone))) throw new Error("Enter an E.164 test number for every center in this wave.");
    if (new Set(recipients.map((recipient) => recipient.phone)).size !== recipients.length) throw new Error("Each simulated center needs a different authorized test number.");

    const operationId = getOperationId("search");
    const [region, locale] = route.split("|");
    setRecords((current) => current.map((record) => candidateIds.includes(record.candidateId) ? { ...record, status: "calling" } : record));
    setScreen("mission");
    setNotice("CALL-E is starting the authorized search wave.");
    const response = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-TinySlot-Operator-Key": operatorKey },
      body: JSON.stringify({
        campaignId,
        operationId,
        stage: "search",
        brief,
        authorized,
        recipients: recipients.map((recipient) => ({ candidateId: recipient.id, name: recipient.name, phone: recipient.phone, region, locale })),
      }),
    });
    const accepted = await response.json() as LiveResponse;
    if (!response.ok) throw new Error(accepted.message ?? accepted.error ?? "CALL-E could not start the search wave.");
    setActiveCallId(accepted.callId);
    clearOperationId("search");
    const completed = await pollLiveCall(accepted.callId, operationId, "search");
    const confidence = typeof completed.confidence === "number" ? completed.confidence : completed.confidence?.score ?? null;
    const byCandidate = new Map((completed.recipients ?? []).map((recipient) => [recipient.candidateId, recipient]));
    setRecords((current) => current.map((record) => {
      if (!candidateIds.includes(record.candidateId)) return record;
      const recipient = byCandidate.get(record.candidateId);
      return {
        ...record,
        status: recipient?.status === "completed" ? "completed" : "failed",
        result: recipient?.structuredResult as CenterResult | null ?? null,
        source: "calle",
        callId: completed.callId,
        verifiedAt: new Date().toISOString(),
        confidence,
        summary: recipient?.summary ?? undefined,
        transcriptTurns: recipient?.transcriptTurns ?? [],
      };
    }));
    setNotice("Live CALL-E results are bound to this search and ready for deterministic comparison.");
  }

  async function startNextWave() {
    const ids = nextWave(records, 3, summary.targetMet);
    if (ids.length === 0) {
      setNotice(summary.targetMet ? "The target is met, so TinySlot will not call the held centers." : "There are no remaining centers to call.");
      return;
    }
    setRunState("calling");
    try {
      if (mode === "fixture") await runFixtureWave(ids);
      else await runLiveWave(ids);
      setRunState("complete");
    } catch (error) {
      setRunState("error");
      setRecords((current) => current.map((record) => ids.includes(record.candidateId) && record.status === "calling" ? { ...record, status: "failed" } : record));
      setNotice(error instanceof Error ? error.message : "The call wave failed.");
    }
  }

  function openTour(candidateId: string) {
    const candidate = fixtureCandidates.find((item) => item.id === candidateId);
    const record = records.find((item) => item.candidateId === candidateId);
    const firstWindow = record?.result?.tourWindows[0] ?? "";
    const secondWindow = record?.result?.tourWindows[1] ?? "";
    setSelectedCenterId(candidateId);
    setTourRequest((current) => ({ ...current, candidateId, preferredWindow: firstWindow, alternateWindow: secondWindow }));
    setTourApproval("");
    setTourResult(null);
    setTourState("idle");
    setScreen("tour");
    if (candidate) setNotice(`Review exactly what TinySlot may share with ${candidate.name}.`);
  }

  async function runTour() {
    if (tourApproval !== "REQUEST TOUR") {
      setNotice("Type REQUEST TOUR exactly before this separately approved call can start.");
      return;
    }
    setTourState("calling");
    setNotice(mode === "fixture" ? "Replaying a synthetic tour request. No call is being placed." : "CALL-E is placing one approved tour request call.");
    try {
      if (mode === "fixture") {
        await wait(1200);
        setTourResult(fixtureTourResult);
      } else {
        if (liveAvailability !== "available" || operatorKey.length < 20 || !authorized) throw new Error("Live mode, operator access, and recipient authorization are required.");
        const phone = livePhones[selectedCenter.id]?.trim() ?? "";
        if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error("Enter the selected center's authorized E.164 test number.");
        const operationId = getOperationId("tour");
        const [region, locale] = route.split("|");
        const response = await fetch("/api/calls", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-TinySlot-Operator-Key": operatorKey },
          body: JSON.stringify({
            campaignId,
            operationId,
            stage: "tour",
            brief,
            authorized,
            recipients: [{ candidateId: selectedCenter.id, name: selectedCenter.name, phone, region, locale }],
            tour: tourRequest,
          }),
        });
        const accepted = await response.json() as LiveResponse;
        if (!response.ok) throw new Error(accepted.message ?? "CALL-E could not start the tour call.");
        setActiveCallId(accepted.callId);
        clearOperationId("tour");
        const completed = await pollLiveCall(accepted.callId, operationId, "tour");
        const value = completed.recipients?.[0]?.structuredResult as TourResult | null;
        if (!value) throw new Error("The tour call ended without a schema-valid result.");
        setTourResult(value);
      }
      setTourState("complete");
      setNotice("The tour outcome is recorded separately from childcare availability.");
    } catch (error) {
      setTourState("error");
      setNotice(error instanceof Error ? error.message : "The tour request failed.");
    }
  }

  function resetDemo() {
    setBrief(fixtureBrief);
    setRecords(initialRecords);
    setRunState("idle");
    setTourState("idle");
    setTourResult(null);
    setActiveCallId("");
    setNotice("The fictional search has been reset. No call was placed.");
    setScreen("brief");
  }

  function downloadReport() {
    const report = {
      product: "TinySlot",
      generatedAt: new Date().toISOString(),
      mode,
      brief,
      summary: { qualified: summary.qualified, completed: summary.completed, callsAvoided: summary.callsAvoided },
      centers: records.map((record) => ({
        candidate: fixtureCandidates.find((item) => item.id === record.candidateId),
        record,
        evaluation: evaluationsById.get(record.candidateId) ?? null,
      })),
      tour: tourResult,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "tinyslot-evidence-report.json";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("The masked evidence report has been exported.");
  }

  async function downloadPdf() {
    try {
      await downloadConversationPdf(brief, fixtureCandidates, records);
      setNotice("The privacy-masked conversation PDF has been downloaded.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The conversation PDF could not be generated.");
    }
  }

  return (
    <main className="shell">
      <aside className="side-rail" aria-label="TinySlot navigation">
        <button className="logo" type="button" onClick={() => setScreen("brief")} aria-label="TinySlot home"><span>t</span></button>
        <nav>
          {navigation.map((item) => (
            <button key={item.id} type="button" className={screen === item.id ? "active" : ""} onClick={() => setScreen(item.id)}>
              <small>{item.step}</small><span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="privacy-mark" title="Privacy-minimized search">P</div>
      </aside>

      <section className="workbench">
        <header className="topbar">
          <div>
            <p className="kicker">Verified childcare openings, by phone</p>
            <h1>TinySlot<span>.</span></h1>
          </div>
          <div className="top-actions">
            <div className="mode-toggle" aria-label="Call mode">
              <button type="button" className={mode === "fixture" ? "selected" : ""} onClick={() => setMode("fixture")}>Demo</button>
              <button type="button" className={mode === "live" ? "selected" : ""} onClick={() => setMode("live")}>Live</button>
            </div>
            <button className="button ghost" type="button" onClick={resetDemo}>Reset</button>
          </div>
        </header>

        {notice && <div className={`notice ${runState === "error" || tourState === "error" ? "error" : ""}`} role="status">{notice}</div>}

        {screen === "brief" && (
          <BriefScreen
            brief={brief}
            mode={mode}
            liveAvailability={liveAvailability}
            livePhones={livePhones}
            route={route}
            operatorKey={operatorKey}
            authorized={authorized}
            onBrief={updateBrief}
            onDay={toggleDay}
            onPhone={(id, phone) => setLivePhones((current) => ({ ...current, [id]: phone }))}
            onRoute={setRoute}
            onOperatorKey={setOperatorKey}
            onAuthorized={setAuthorized}
            onStart={startNextWave}
            busy={runState === "calling"}
          />
        )}
        {screen === "mission" && (
          <MissionScreen
            brief={brief}
            records={records}
            mode={mode}
            livePhones={livePhones}
            summary={summary}
            runState={runState}
            callId={activeCallId}
            onNext={startNextWave}
            onMatches={() => setScreen("matches")}
          />
        )}
        {screen === "matches" && (
          <MatchesScreen
            brief={brief}
            records={records}
            summary={summary}
            onTour={openTour}
            onDownload={downloadReport}
            onDownloadPdf={downloadPdf}
          />
        )}
        {screen === "tour" && (
          <TourScreen
            brief={brief}
            center={selectedCenter}
            record={selectedRecord}
            mode={mode}
            request={tourRequest}
            approval={tourApproval}
            state={tourState}
            result={tourResult}
            onRequest={setTourRequest}
            onApproval={setTourApproval}
            onRun={runTour}
            onBack={() => setScreen("matches")}
          />
        )}
      </section>
    </main>
  );
}

function BriefScreen({ brief, mode, liveAvailability, livePhones, route, operatorKey, authorized, onBrief, onDay, onPhone, onRoute, onOperatorKey, onAuthorized, onStart, busy }: {
  brief: SearchBrief;
  mode: Mode;
  liveAvailability: LiveAvailability;
  livePhones: Record<string, string>;
  route: string;
  operatorKey: string;
  authorized: boolean;
  onBrief: <K extends keyof SearchBrief>(key: K, value: SearchBrief[K]) => void;
  onDay: (day: Weekday) => void;
  onPhone: (id: string, phone: string) => void;
  onRoute: (value: string) => void;
  onOperatorKey: (value: string) => void;
  onAuthorized: (value: boolean) => void;
  onStart: () => void;
  busy: boolean;
}) {
  return (
    <div className="stack">
      <section className="hero-grid">
        <div className="hero-copy">
          <p className="section-number">01 / Search brief</p>
          <h2>Stop refreshing waitlists.<br /><i>Ask what is open now.</i></h2>
          <p>TinySlot turns one privacy-minimized care need into a bounded CALL-E search. Facts come from center staff; the fit decision comes from deterministic rules.</p>
        </div>
        <div className="promise-card">
          <span className="orbit" aria-hidden="true" />
          <p>Search target</p>
          <strong>{brief.targetMatches}</strong>
          <span>verified matches</span>
          <small>Calls stop as soon as this target is met.</small>
        </div>
      </section>

      <section className="brief-card">
        <div className="card-heading"><div><p className="kicker">Non-identifying profile</p><h3>What care must fit?</h3></div><span className="safe-pill">No child name</span></div>
        <div className="form-grid">
          <label><span>Age band</span><select value={brief.ageBand} onChange={(event) => onBrief("ageBand", event.target.value as SearchBrief["ageBand"])}><option value="infant">Infant</option><option value="toddler">Toddler</option><option value="preschool">Preschool</option><option value="school-age">School age</option></select></label>
          <label><span>Needed by</span><input type="date" value={brief.desiredStartDate} onChange={(event) => onBrief("desiredStartDate", event.target.value)} /></label>
          <label><span>Drop-off</span><input type="time" value={brief.dropoffTime} onChange={(event) => onBrief("dropoffTime", event.target.value)} /></label>
          <label><span>Pickup</span><input type="time" value={brief.pickupTime} onChange={(event) => onBrief("pickupTime", event.target.value)} /></label>
          <label><span>Monthly budget</span><div className="money-input"><b>$</b><input type="number" min="1" value={brief.budgetMonthlyMinor / 100} onChange={(event) => onBrief("budgetMonthlyMinor", Math.max(100, Number(event.target.value) * 100))} /></div></label>
          <label><span>Matches needed</span><select value={brief.targetMatches} onChange={(event) => onBrief("targetMatches", Number(event.target.value))}><option value="1">1 match</option><option value="2">2 matches</option><option value="3">3 matches</option></select></label>
        </div>
        <fieldset className="day-picker"><legend>Required weekdays</legend><div>{WEEKDAYS.map((day) => <button key={day} type="button" className={brief.requiredWeekdays.includes(day) ? "selected" : ""} onClick={() => onDay(day)}>{day.slice(0, 3)}</button>)}</div></fieldset>
      </section>

      <section className="candidate-card">
        <div className="card-heading"><div><p className="kicker">Ranked candidate list</p><h3>First wave: 3 of 6 centers</h3></div><span className="quiet-pill">Max 3 calls / wave</span></div>
        <div className="candidate-list">
          {fixtureCandidates.map((candidate, index) => (
            <div className={`candidate-row ${index >= 3 ? "held" : ""}`} key={candidate.id}>
              <span className="candidate-index">{String(index + 1).padStart(2, "0")}</span>
              <div><strong>{candidate.name}</strong><small>{candidate.neighborhood} / {candidate.distanceMiles.toFixed(1)} mi</small></div>
              {mode === "live" ? <input aria-label={`${candidate.name} test phone`} value={livePhones[candidate.id] ?? ""} onChange={(event) => onPhone(candidate.id, event.target.value)} placeholder="Authorized E.164" /> : <code>{candidate.demoPhone}</code>}
              <span className={index < 3 ? "wave-pill" : "hold-pill"}>{index < 3 ? "Wave 1" : "Held back"}</span>
            </div>
          ))}
        </div>
      </section>

      {mode === "live" && (
        <section className="live-panel">
          <div className={`live-status ${liveAvailability}`}><i /><div><strong>{liveAvailability === "available" ? "Live backend ready" : liveAvailability === "checking" ? "Checking live backend" : "Live backend unavailable"}</strong><small>The public demo remains safe when live credentials are absent.</small></div></div>
          <label><span>Calling route</span><select value={route} onChange={(event) => onRoute(event.target.value)}>{routeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label><span>Operator key</span><input type="password" value={operatorKey} onChange={(event) => onOperatorKey(event.target.value)} placeholder="Deployment access key" autoComplete="off" /></label>
          <label className="authorization"><input type="checkbox" checked={authorized} onChange={(event) => onAuthorized(event.target.checked)} /><span>I attest that these test destinations authorized this disclosed AI call.</span></label>
        </section>
      )}

      <div className="action-dock"><div><strong>{mode === "fixture" ? "Safe judge replay" : "Real-world side effect"}</strong><span>{mode === "fixture" ? "Synthetic results. No network, calls, or credits." : "This starts up to three real calls to allowlisted numbers."}</span></div><button className="button primary" type="button" onClick={onStart} disabled={busy || brief.requiredWeekdays.length === 0 || (mode === "live" && liveAvailability !== "available")}>{busy ? "Starting wave..." : mode === "fixture" ? "Run simulated search" : "Start CALL-E wave"}</button></div>
    </div>
  );
}

function MissionScreen({ brief, records, mode, livePhones, summary, runState, callId, onNext, onMatches }: {
  brief: SearchBrief;
  records: CenterCallRecord[];
  mode: Mode;
  livePhones: Record<string, string>;
  summary: ReturnType<typeof campaignSummary>;
  runState: RunState;
  callId: string;
  onNext: () => void;
  onMatches: () => void;
}) {
  return (
    <div className="stack">
      <div className="section-intro"><div><p className="section-number">02 / Adaptive search</p><h2>{runState === "calling" ? "Calls in motion." : summary.targetMet ? "Enough signal. Stop calling." : "Another wave may be needed."}</h2></div><p>Each disposition stays separate. A voicemail, refusal, or waitlist can never become an opening.</p></div>
      {callId && <div className="run-id"><span>CALL-E run</span><code>{callId}</code></div>}
      <section className="mission-grid">
        {records.map((record) => {
          const candidate = fixtureCandidates.find((item) => item.id === record.candidateId)!;
          return (
            <article key={record.candidateId} className={`mission-card ${record.status}`}>
              <div className="mission-top"><span>{String(candidate.priority).padStart(2, "0")}</span><em>{record.status}</em></div>
              <h3>{candidate.name}</h3>
              <p>{candidate.neighborhood} / {mode === "fixture" ? candidate.demoPhone : maskPhone(livePhones[candidate.id])}</p>
              {record.status === "calling" ? <div className="voice-bars" aria-label="Call in progress"><i /><i /><i /><i /><i /></div> : record.result ? <blockquote>&ldquo;{record.result.availabilityEvidence || "No vacancy evidence was captured."}&rdquo;</blockquote> : <div className="held-message">Not called yet</div>}
              <div className="mini-facts"><span><small>Vacancy</small><b>{record.result?.vacancyStatus.replaceAll("_", " ") ?? "-"}</b></span><span><small>Start</small><b>{record.result?.earliestStartDate || "-"}</b></span></div>
            </article>
          );
        })}
      </section>
      <section className={`stop-banner ${summary.targetMet ? "met" : ""}`}>
        <div><p className="kicker">Adaptive stop rule</p><strong>{summary.qualified}/{brief.targetMatches} verified matches</strong><span>{summary.targetMet ? `${summary.callsAvoided} centers remain undisturbed.` : "The match target has not been met."}</span></div>
        <div className="button-row">{!summary.targetMet && runState !== "calling" && <button className="button ghost" type="button" onClick={onNext}>Run next wave</button>}<button className="button primary" type="button" onClick={onMatches} disabled={runState === "calling" || summary.completed === 0}>Compare evidence</button></div>
      </section>
    </div>
  );
}

function MatchesScreen({ brief, records, summary, onTour, onDownload, onDownloadPdf }: {
  brief: SearchBrief;
  records: CenterCallRecord[];
  summary: ReturnType<typeof campaignSummary>;
  onTour: (candidateId: string) => void;
  onDownload: () => void;
  onDownloadPdf: () => void;
}) {
  const completed = records.filter((record) => record.status === "completed");
  return (
    <div className="stack">
      <div className="section-intro"><div><p className="section-number">03 / Evidence matrix</p><h2>Compare facts, not optimism.</h2></div><p>TinySlot applies the same hard constraints to every center. Unknown answers stay visible and availability is never treated as guaranteed.</p></div>
      <div className="metric-strip"><div><strong>{summary.qualified}</strong><span>qualified</span></div><div><strong>{summary.completed}</strong><span>called</span></div><div><strong>{summary.callsAvoided}</strong><span>calls avoided</span></div><div><strong>{brief.requiredWeekdays.length}</strong><span>required days</span></div></div>
      <section className="match-list">
        {completed.map((record) => {
          const candidate = fixtureCandidates.find((item) => item.id === record.candidateId)!;
          const evaluation = evaluateCenter(candidate, record.result, brief);
          return (
            <article className={`match-card ${evaluation.tier}`} key={candidate.id}>
              <div className="match-summary">
                <div className="match-rank"><span>{evaluation.score}</span><small>fit score</small></div>
                <div><p className="kicker">{candidate.neighborhood} / verified {record.verifiedAt ? new Date(record.verifiedAt).toLocaleDateString() : "today"}</p><h3>{candidate.name}</h3><span className={`tier ${evaluation.tier}`}>{tierLabels[evaluation.tier]}</span><p>{evaluation.headline}</p></div>
                <div className="price"><strong>{formatMoney(record.result?.monthlyTuitionMinor ?? -1, brief.currency)}</strong><small>monthly</small>{evaluation.tier === "qualified" && record.result?.tourStatus === "offered" && <button className="text-button" type="button" onClick={() => onTour(candidate.id)}>Review tour request</button>}</div>
              </div>
              <div className="checks">{evaluation.checks.map((item) => <div key={item.key}><span className={item.status}>{item.status === "pass" ? "OK" : item.status === "fail" ? "X" : "?"}</span><p><strong>{item.label}</strong><small>{item.detail}</small></p></div>)}</div>
              <details className="call-summary"><summary>Call summary</summary><p>{record.summary || "No call summary was available."}</p><small>{record.transcriptTurns?.length ?? 0} transcript turns available for the PDF report.</small></details>
              {record.result && <div className="evidence"><span>Staff-reported evidence</span><blockquote>&ldquo;{record.result.availabilityEvidence || "No availability quote."}&rdquo;<br />&ldquo;{record.result.scheduleEvidence || "No schedule quote."}&rdquo;</blockquote></div>}
            </article>
          );
        })}
      </section>
      <div className="report-bar"><div><strong>Portable conversation report</strong><span>Exports summaries, conversations, outcomes, checks, and evidence without live phone numbers.</span></div><div className="report-actions"><button className="button ghost" type="button" onClick={onDownload}>Export JSON</button><button className="button primary" type="button" onClick={onDownloadPdf}>Download conversation PDF</button></div></div>
    </div>
  );
}

function TourScreen({ brief, center, record, mode, request, approval, state, result, onRequest, onApproval, onRun, onBack }: {
  brief: SearchBrief;
  center: (typeof fixtureCandidates)[number];
  record?: CenterCallRecord;
  mode: Mode;
  request: TourRequest;
  approval: string;
  state: RunState;
  result: TourResult | null;
  onRequest: (request: TourRequest) => void;
  onApproval: (value: string) => void;
  onRun: () => void;
  onBack: () => void;
}) {
  if (result) return (
    <div className="tour-success">
      <span className="success-ring">✓</span><p className="section-number">04 / Tour outcome</p><h2>{result.confirmedWindow}</h2><p>{result.nextStep}</p><blockquote>&ldquo;{result.evidence}&rdquo;</blockquote><div><span>Reference</span><strong>{result.reference}</strong></div><small>Availability and tour confirmation remain separate evidence records.</small><button className="button primary" type="button" onClick={onBack}>Return to matches</button>
    </div>
  );
  return (
    <div className="stack">
      <div className="section-intro"><div><p className="section-number">04 / Human approval</p><h2>One bounded follow-up.</h2></div><p>A qualified result does not authorize a second call. Review the disclosure envelope and approve this tour request separately.</p></div>
      <section className="tour-layout">
        <div className="tour-form card">
          <p className="kicker">Requested center</p><h3>{center.name}</h3><p className="muted-copy">{record?.result?.availabilityEvidence}</p>
          <label><span>Parent first name</span><input value={request.parentFirstName} onChange={(event) => onRequest({ ...request, parentFirstName: event.target.value })} /></label>
          <label><span>Callback number</span><input value={request.callbackPhone} onChange={(event) => onRequest({ ...request, callbackPhone: event.target.value })} /></label>
          <label><span>Preferred window</span><input value={request.preferredWindow} onChange={(event) => onRequest({ ...request, preferredWindow: event.target.value })} /></label>
          <label><span>Alternative</span><input value={request.alternateWindow} onChange={(event) => onRequest({ ...request, alternateWindow: event.target.value })} /></label>
        </div>
        <div className="disclosure-card">
          <div><p className="kicker">Disclosure envelope</p><h3>What CALL-E may say</h3></div>
          <ul className="may-list"><li>Parent first name and callback number</li><li>{brief.ageBand} care needed by {brief.desiredStartDate}</li><li>Two parent-approved tour windows</li></ul>
          <div className="must-not"><span>Must not</span><p>Share a child name, discuss health, enroll, accept policies, pay fees, or agree to another commitment.</p></div>
          <label className="approval-field"><span>Type <b>REQUEST TOUR</b> to authorize one call</span><input value={approval} onChange={(event) => onApproval(event.target.value)} placeholder="REQUEST TOUR" /></label>
        </div>
      </section>
      <div className="action-dock"><div><strong>{mode === "fixture" ? "Synthetic tour outcome" : "One real outbound call"}</strong><span>{mode === "fixture" ? "The same authorization gate is exercised without dialing." : "An in-flight CALL-E call cannot be recalled by closing this page."}</span></div><div className="button-row"><button className="button ghost" type="button" onClick={onBack}>Cancel</button><button className="button primary" type="button" onClick={onRun} disabled={state === "calling" || approval !== "REQUEST TOUR"}>{state === "calling" ? "Calling..." : "Approve and request"}</button></div></div>
    </div>
  );
}
