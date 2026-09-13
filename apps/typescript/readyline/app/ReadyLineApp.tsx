"use client";

import { useEffect, useMemo, useState } from "react";
import {
  conflictedVendorIds,
  detectConflicts,
  parseTime,
  readinessSummary,
  type Readiness,
  type VendorPlan,
} from "@/lib/constraint-engine";
import {
  fixtureVenue,
  initialVendorPlans,
  resolutionCallGoal,
  resolvedVendorPlans,
} from "@/lib/fixture";

type Screen = "plan" | "calls" | "conflicts" | "resolution";
type Mode = "fixture" | "live";
type RunState = "idle" | "calling" | "complete" | "error";
type CallStage = "readiness" | "resolution";
type LiveAvailability = "checking" | "available" | "unavailable";
type ActiveCall = {
  callId: string;
  eventId: string;
  stage: CallStage;
  operationId: string;
  vendorIds: string[];
};

type LiveResult = {
  callId: string;
  eventId?: string;
  stage?: CallStage;
  operationId?: string;
  status: string;
  taskCompleted?: boolean | null;
  recipients?: Array<{
    vendorId: string;
    status: string;
    summary: string | null;
    structuredResult: Record<string, unknown> | null;
  }>;
  message?: string;
  error?: string;
};

const screens: Array<{ id: Screen; number: string; label: string }> = [
  { id: "plan", number: "01", label: "Plan" },
  { id: "calls", number: "02", label: "Calls" },
  { id: "conflicts", number: "03", label: "Conflicts" },
  { id: "resolution", number: "04", label: "Resolution" },
];

const supportedRoutes = [
  { value: "GB|en-GB", label: "United Kingdom · English" },
  { value: "US|en-US", label: "United States · English" },
  { value: "DE|de-DE", label: "Germany · German" },
  { value: "FR|fr-FR", label: "France · French" },
];

const typeLabels: Record<string, string> = {
  ACCESS_BEFORE_OPEN: "Access",
  DOCK_COLLISION: "Dock collision",
  POWER_CAPACITY_EXCEEDED: "Power",
  SETUP_DEADLINE_MISSED: "Deadline",
  READINESS_NOT_CONFIRMED: "Readiness",
  UNKNOWN_INPUT: "Unknown",
};

const eventId = "north-hall-product-summit";
const activeCallStorageKey = "readyline:v2:active-call";

function pendingOperationStorageKey(stage: CallStage) {
  return `readyline:v1:pending-operation:${stage}`;
}

function readActiveCall(): ActiveCall | null {
  try {
    const value = window.sessionStorage.getItem(activeCallStorageKey);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<ActiveCall>;
    if (
      typeof parsed.callId !== "string" ||
      parsed.callId.length === 0 ||
      typeof parsed.eventId !== "string" ||
      !/^[a-z0-9-]{3,80}$/.test(parsed.eventId) ||
      typeof parsed.operationId !== "string" ||
      !/^[A-Za-z0-9_-]{8,120}$/.test(parsed.operationId) ||
      !Array.isArray(parsed.vendorIds) ||
      parsed.vendorIds.length < 1 ||
      parsed.vendorIds.length > 10 ||
      parsed.vendorIds.some((vendorId) =>
        typeof vendorId !== "string" || !/^[a-z0-9-]{3,80}$/.test(vendorId)
      ) ||
      new Set(parsed.vendorIds).size !== parsed.vendorIds.length ||
      (parsed.stage !== "readiness" && parsed.stage !== "resolution")
    ) {
      return null;
    }
    return {
      callId: parsed.callId,
      eventId: parsed.eventId,
      stage: parsed.stage,
      operationId: parsed.operationId,
      vendorIds: parsed.vendorIds,
    };
  } catch {
    return null;
  }
}

function storeActiveCall(activeCall: ActiveCall) {
  try {
    window.sessionStorage.setItem(activeCallStorageKey, JSON.stringify(activeCall));
  } catch {
    // A live run still works when session storage is unavailable; it just cannot be resumed after refresh.
  }
}

function clearActiveCall() {
  try {
    window.sessionStorage.removeItem(activeCallStorageKey);
  } catch {
    // Ignore unavailable session storage.
  }
}

function getOrCreateOperationId(stage: CallStage) {
  const storageKey = pendingOperationStorageKey(stage);
  try {
    const existing = window.sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const operationId = crypto.randomUUID();
    window.sessionStorage.setItem(storageKey, operationId);
    return operationId;
  } catch {
    return crypto.randomUUID();
  }
}

function clearPendingOperation(stage: CallStage) {
  try {
    window.sessionStorage.removeItem(pendingOperationStorageKey(stage));
  } catch {
    // Ignore unavailable session storage.
  }
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function maskLivePhone(phone: string | undefined) {
  const value = phone?.trim() ?? "";
  if (!/^\+[1-9]\d{7,14}$/.test(value)) return "Live recipient";
  return `${value.slice(0, 3)} •••• ${value.slice(-4)}`;
}

function field(result: Record<string, unknown>, key: string, fallback = "") {
  return typeof result[key] === "string" ? result[key] : fallback;
}

function mapLivePlan(plan: VendorPlan, result: Record<string, unknown> | null): VendorPlan {
  if (!result) {
    return {
      ...plan,
      readiness: "unknown",
      callStatus: "completed",
      evidence: "CALL-E could not produce a schema-valid result from the available evidence.",
    };
  }

  const readiness = field(result, "readiness", "unknown") as Readiness;
  return {
    ...plan,
    readiness: ["ready", "conditional", "blocked", "unknown"].includes(readiness)
      ? readiness
      : "unknown",
    arrivalTime: field(result, "arrival_time"),
    setupCompleteTime: field(result, "setup_complete_time"),
    needsLoadingDock: field(result, "needs_loading_dock", "unknown") as VendorPlan["needsLoadingDock"],
    dockStart: field(result, "dock_start"),
    dockEnd: field(result, "dock_end"),
    powerAmps: typeof result.power_amps === "number" ? result.power_amps : -1,
    blocker: field(result, "blocker"),
    evidence: field(result, "evidence", "No usable evidence returned."),
    callStatus: "completed",
  };
}

export function ReadyLineApp() {
  const [screen, setScreen] = useState<Screen>("conflicts");
  const [mode, setMode] = useState<Mode>("fixture");
  const [plans, setPlans] = useState<VendorPlan[]>(initialVendorPlans);
  const [runState, setRunState] = useState<RunState>("complete");
  const [resolutionState, setResolutionState] = useState<RunState>("idle");
  const [livePhones, setLivePhones] = useState<Record<string, string>>({});
  const [route, setRoute] = useState("GB|en-GB");
  const [authorized, setAuthorized] = useState(false);
  const [operatorKey, setOperatorKey] = useState("");
  const [callId, setCallId] = useState("");
  const [recoveredCall, setRecoveredCall] = useState<ActiveCall | null>(null);
  const [notice, setNotice] = useState("");
  const [showTour, setShowTour] = useState(true);
  const [liveAvailability, setLiveAvailability] = useState<LiveAvailability>("checking");

  const conflicts = useMemo(() => detectConflicts(fixtureVenue, plans), [plans]);
  const summary = useMemo(() => readinessSummary(plans, conflicts), [plans, conflicts]);
  const resolved = summary.status === "ready";

  useEffect(() => {
    const activeCall = readActiveCall();
    if (!activeCall) return;
    const timeoutId = window.setTimeout(() => {
      setRecoveredCall(activeCall);
      setCallId(activeCall.callId);
      setMode("live");
      setScreen("plan");
      setNotice("An unfinished CALL-E run was found. Enter the operator key to resume status polling.");
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function checkLiveAvailability() {
      try {
        const response = await fetch("/api/calls/readiness", {
          cache: "no-store",
          signal: controller.signal,
        });
        const result = (await response.json()) as { liveAvailable?: boolean };
        if (!response.ok) throw new Error("Readiness check failed.");
        setLiveAvailability(result.liveAvailable ? "available" : "unavailable");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLiveAvailability("unavailable");
      }
    }

    void checkLiveAvailability();
    return () => controller.abort();
  }, []);

  const navigate = (next: Screen) => {
    setScreen(next);
    setNotice("");
  };

  async function replayFixtureBatch() {
    setRunState("calling");
    setResolutionState("idle");
    setPlans(initialVendorPlans.map((plan) => ({ ...plan, callStatus: "calling" })));
    setScreen("calls");
    setNotice("Simulated vendor calls are in progress. No number is being dialed.");
    await wait(1100);
    setPlans(initialVendorPlans);
    setRunState("complete");
    setNotice("Three simulated vendor results are ready for conflict analysis.");
  }

  async function pollLiveCall(activeCall: ActiveCall) {
    for (let attempt = 0; attempt < 48; attempt += 1) {
      await wait(attempt === 0 ? 900 : 2500);
      const searchParams = new URLSearchParams({
        callId: activeCall.callId,
        eventId: activeCall.eventId,
        stage: activeCall.stage,
        operationId: activeCall.operationId,
      });
      const response = await fetch(`/api/calls?${searchParams.toString()}`, {
        cache: "no-store",
        headers: { "X-ReadyLine-Operator-Key": operatorKey },
      });
      const result = (await response.json()) as LiveResult;
      if (!response.ok) throw new Error(result.message ?? "Unable to read CALL-E status.");
      if (
        result.callId !== activeCall.callId ||
        result.eventId !== activeCall.eventId ||
        result.stage !== activeCall.stage ||
        result.operationId !== activeCall.operationId
      ) {
        throw new Error("CALL-E returned a result for a different operation.");
      }
      if (!["completed", "failed", "canceled"].includes(result.status)) continue;
      clearActiveCall();
      setRecoveredCall(null);
      if (result.status !== "completed") throw new Error(`CALL-E ended with status ${result.status}.`);
      if (result.taskCompleted !== true) throw new Error("CALL-E did not complete the expected task.");

      const recipients = result.recipients ?? [];
      const expectedVendorIds = new Set(activeCall.vendorIds);
      const recipientsByVendor = new Map(
        recipients.map((recipient) => [recipient.vendorId, recipient]),
      );
      if (
        recipients.length !== activeCall.vendorIds.length ||
        recipientsByVendor.size !== activeCall.vendorIds.length ||
        recipients.some(
          (recipient) =>
            !expectedVendorIds.has(recipient.vendorId) || recipient.status !== "completed",
        )
      ) {
        throw new Error("CALL-E returned incomplete or mismatched recipient results.");
      }

      setPlans((current) =>
        current.map((plan) => {
          if (!expectedVendorIds.has(plan.id)) return plan;
          return mapLivePlan(plan, recipientsByVendor.get(plan.id)?.structuredResult ?? null);
        }),
      );
      return;
    }
    throw new Error("CALL-E is still running. Keep the call ID and check again shortly.");
  }

  async function startLiveBatch() {
    if (liveAvailability !== "available") {
      setNotice("Live calling is not configured for this deployment. Use Demo mode or configure the server first.");
      return;
    }
    const phones = plans.map((plan) => livePhones[plan.id]?.trim() ?? "");
    if (operatorKey.length < 20) {
      setNotice("Enter the deployment's operator key before starting a live call.");
      return;
    }
    if (!authorized) {
      setNotice("Confirm that every recipient authorized this event-readiness call.");
      return;
    }
    if (phones.some((phone) => !/^\+[1-9]\d{7,14}$/.test(phone))) {
      setNotice("Enter every live number in E.164 format using a number you control.");
      return;
    }
    if (new Set(phones).size !== phones.length) {
      setNotice("Each vendor must have a different authorized phone number.");
      return;
    }

    const [region, locale] = route.split("|");
    const operationId = getOrCreateOperationId("readiness");
    setRunState("calling");
    setScreen("calls");
    setNotice("Creating the authorized CALL-E batch…");
    setPlans((current) => current.map((plan) => ({ ...plan, callStatus: "calling" })));

    try {
      const response = await fetch("/api/calls", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-ReadyLine-Operator-Key": operatorKey,
        },
        body: JSON.stringify({
          eventId,
          operationId,
          stage: "readiness",
          venue: fixtureVenue,
          recipients: phones.map((phone, index) => ({
            vendorId: plans[index].id,
            phone,
            region,
            locale,
          })),
        }),
      });
      const result = (await response.json()) as LiveResult;
      if (!response.ok) throw new Error(result.message ?? result.error ?? "CALL-E request failed.");
      if (
        result.eventId !== eventId ||
        result.stage !== "readiness" ||
        result.operationId !== operationId
      ) {
        throw new Error("CALL-E accepted a different operation than ReadyLine requested.");
      }
      setCallId(result.callId);
      const activeCall: ActiveCall = {
        callId: result.callId,
        eventId,
        stage: "readiness",
        operationId,
        vendorIds: plans.map((plan) => plan.id),
      };
      storeActiveCall(activeCall);
      clearPendingOperation("readiness");
      setRecoveredCall(activeCall);
      setNotice(`CALL-E accepted the batch. Tracking ${result.callId}.`);
      await pollLiveCall(activeCall);
      setRunState("complete");
      setNotice("Live structured results are ready for conflict analysis.");
    } catch (error) {
      setRunState("error");
      setPlans((current) => current.map((plan) => ({ ...plan, callStatus: "failed" })));
      setNotice(error instanceof Error ? error.message : "The live CALL-E batch failed.");
    }
  }

  async function runResolution() {
    const av = plans.find((plan) => plan.id === "northstar-av");
    if (!av) return;

    setResolutionState("calling");
    setNotice("Running the approved targeted follow-up…");

    if (mode === "fixture") {
      await wait(1200);
      setPlans(resolvedVendorPlans);
      setResolutionState("complete");
      setNotice("Northstar AV confirmed the revised plan. All load-in conflicts are resolved.");
      setScreen("conflicts");
      return;
    }

    if (liveAvailability !== "available") {
      setResolutionState("error");
      setNotice("Live calling is not configured for this deployment. Use Demo mode or configure the server first.");
      return;
    }

    const phone = livePhones[av.id]?.trim() ?? "";
    if (operatorKey.length < 20) {
      setResolutionState("error");
      setNotice("Enter the deployment's operator key on the Plan screen before the live follow-up.");
      return;
    }
    if (!authorized || !/^\+[1-9]\d{7,14}$/.test(phone)) {
      setResolutionState("error");
      setNotice("A verified, authorized Northstar AV number is required for the live follow-up.");
      return;
    }

    const [region, locale] = route.split("|");
    const operationId = getOrCreateOperationId("resolution");
    try {
      const response = await fetch("/api/calls", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-ReadyLine-Operator-Key": operatorKey,
        },
        body: JSON.stringify({
          eventId,
          operationId,
          stage: "resolution",
          recipients: [{ vendorId: av.id, phone, region, locale }],
          resolutionGoal: resolutionCallGoal,
        }),
      });
      const result = (await response.json()) as LiveResult;
      if (!response.ok) throw new Error(result.message ?? result.error ?? "CALL-E request failed.");
      if (
        result.eventId !== eventId ||
        result.stage !== "resolution" ||
        result.operationId !== operationId
      ) {
        throw new Error("CALL-E accepted a different operation than ReadyLine requested.");
      }
      setCallId(result.callId);
      const activeCall: ActiveCall = {
        callId: result.callId,
        eventId,
        stage: "resolution",
        operationId,
        vendorIds: [av.id],
      };
      storeActiveCall(activeCall);
      clearPendingOperation("resolution");
      setRecoveredCall(activeCall);
      await pollLiveCall(activeCall);
      setResolutionState("complete");
      setNotice("The live follow-up result has been reconciled against the event plan.");
      setScreen("conflicts");
    } catch (error) {
      setResolutionState("error");
      setNotice(error instanceof Error ? error.message : "The follow-up call failed.");
    }
  }

  async function resumeLiveCall() {
    if (!recoveredCall) return;
    if (operatorKey.length < 20) {
      setNotice("Enter the deployment's operator key before resuming this live run.");
      return;
    }

    const vendorIds = recoveredCall.vendorIds;
    setCallId(recoveredCall.callId);
    setRunState("calling");
    if (recoveredCall.stage === "resolution") setResolutionState("calling");
    setPlans((current) =>
      current.map((plan) => vendorIds.includes(plan.id) ? { ...plan, callStatus: "calling" } : plan),
    );
    setScreen("calls");
    setNotice(`Resuming CALL-E run ${recoveredCall.callId}.`);

    try {
      await pollLiveCall(recoveredCall);
      setRunState("complete");
      if (recoveredCall.stage === "resolution") {
        setResolutionState("complete");
        setScreen("conflicts");
        setNotice("The recovered follow-up result has been reconciled against the event plan.");
      } else {
        setNotice("The recovered structured results are ready for conflict analysis.");
      }
    } catch (error) {
      setRunState("error");
      if (recoveredCall.stage === "resolution") setResolutionState("error");
      setPlans((current) =>
        current.map((plan) => vendorIds.includes(plan.id) ? { ...plan, callStatus: "failed" } : plan),
      );
      setNotice(error instanceof Error ? error.message : "Unable to resume the CALL-E run.");
    }
  }

  function resetDemo() {
    setPlans(initialVendorPlans);
    setRunState("complete");
    setResolutionState("idle");
    setCallId("");
    setNotice("Demo restored to the original three-conflict scenario.");
    setScreen("conflicts");
  }

  function startGuidedTour() {
    setMode("fixture");
    setPlans(initialVendorPlans);
    setRunState("complete");
    setResolutionState("idle");
    setCallId("");
    setNotice("");
    setShowTour(false);
    setScreen("plan");
  }

  function downloadBrief() {
    const source = callId ? `CALL-E run ${callId}` : "Simulated demo";
    const vendorLines = plans.map((plan) =>
      [
        `- ${plan.name} (${plan.category})`,
        `  Arrival: ${plan.arrivalTime || "Unknown"}`,
        `  Setup complete: ${plan.setupCompleteTime || "Unknown"}`,
        `  Dock: ${plan.needsLoadingDock === "yes" ? `${plan.dockStart}–${plan.dockEnd}` : "Not required"}`,
        `  Power: ${plan.powerAmps < 0 ? "Unknown" : `${plan.powerAmps}A`}`,
        `  Evidence: ${plan.evidence}`,
      ].join("\n"),
    );
    const brief = [
      "READYLINE LOAD-IN BRIEF",
      "North Hall Product Summit · Saturday 17 October",
      "",
      `STATUS: ${resolved ? "READY" : "BLOCKED"}`,
      `SOURCE: ${source}`,
      "",
      "VENUE CONSTRAINTS",
      `- Access begins: ${fixtureVenue.accessStart}`,
      `- Loading dock capacity: ${fixtureVenue.dockCapacity} team`,
      `- Available power: ${fixtureVenue.availablePowerAmps}A`,
      `- Ready by: ${fixtureVenue.readyBy}`,
      "",
      "RECONCILED VENDOR PLAN",
      ...vendorLines,
      "",
      "DECISION RECORD",
      "01 · Vendor evidence captured as structured results.",
      "02 · Venue and cross-vendor constraints evaluated deterministically.",
      ...(resolved
        ? [
            "03 · Event manager approved the bounded Northstar AV follow-up.",
            "04 · Revised plan reconciled with no open conflicts.",
          ]
        : [`03 · ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"} awaiting human resolution.`]),
      "",
      "Generated by ReadyLine",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([brief], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "readyline-load-in-brief.txt";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("The reconciled load-in brief is ready to share with the event team.");
  }

  return (
    <main className="app-shell">
      <aside className="rail" aria-label="ReadyLine navigation">
        <button className="brand-mark" type="button" onClick={() => navigate("conflicts")} aria-label="ReadyLine home">R</button>
        <nav>
          {screens.map((item) => (
            <button
              className={`rail-link ${screen === item.id ? "active" : ""}`}
              key={item.id}
              type="button"
              onClick={() => navigate(item.id)}
              aria-current={screen === item.id ? "page" : undefined}
            >
              <span>{item.number}</span>
              <em>{item.label}</em>
            </button>
          ))}
        </nav>
        <div className="avatar" title="Event manager">MK</div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Load-in control / Saturday 17 October</p>
            <h1>North Hall Product Summit</h1>
          </div>
          <div className="header-actions">
            <div className="mode-switch" aria-label="Call mode">
              <button type="button" className={mode === "fixture" ? "selected" : ""} onClick={() => setMode("fixture")}>Demo</button>
              <button type="button" className={mode === "live" ? "selected" : ""} onClick={() => setMode("live")}>Live</button>
            </div>
            {resolved ? (
              <button className="secondary-button" type="button" onClick={resetDemo}>Reset scenario</button>
            ) : (
              <button className="primary-button" type="button" onClick={() => navigate("resolution")}>Review resolution</button>
            )}
          </div>
        </header>

        {showTour && mode === "fixture" && (
          <section className="tour-bar" aria-label="Guided ReadyLine demo">
            <div className="tour-copy">
              <p className="eyebrow">Judge walkthrough · 90 seconds</p>
              <strong>Follow one vendor plan from call evidence to an approved resolution.</strong>
            </div>
            <ol className="tour-steps" aria-label="Demo steps">
              <li><span>1</span>Run simulated calls</li>
              <li><span>2</span>Inspect conflicts</li>
              <li><span>3</span>Approve follow-up</li>
            </ol>
            <div className="tour-actions">
              <button className="secondary-button" type="button" onClick={() => setShowTour(false)}>Dismiss</button>
              <button className="primary-button" type="button" onClick={startGuidedTour}>Start guided demo</button>
            </div>
          </section>
        )}

        {notice && <div className={`notice ${runState === "error" || resolutionState === "error" ? "notice-error" : ""}`} role="status">{notice}</div>}

        {screen === "plan" && (
          <PlanScreen
            mode={mode}
            plans={plans}
            livePhones={livePhones}
            route={route}
            authorized={authorized}
            operatorKey={operatorKey}
            recoveredCall={recoveredCall}
            liveAvailability={liveAvailability}
            onPhoneChange={(id, phone) => setLivePhones((current) => ({ ...current, [id]: phone }))}
            onRouteChange={setRoute}
            onAuthorizedChange={setAuthorized}
            onOperatorKeyChange={setOperatorKey}
            onResume={resumeLiveCall}
            onStart={mode === "fixture" ? replayFixtureBatch : startLiveBatch}
            busy={runState === "calling"}
          />
        )}
        {screen === "calls" && <CallsScreen mode={mode} plans={plans} livePhones={livePhones} runState={runState} callId={callId} onInspect={() => navigate("conflicts")} />}
        {screen === "conflicts" && <ConflictsScreen plans={plans} conflicts={conflicts} summary={summary} source={callId ? "CALL-E" : "Demo"} onResolve={() => navigate("resolution")} onDownload={downloadBrief} />}
        {screen === "resolution" && (
          <ResolutionScreen
            conflicts={conflicts}
            mode={mode}
            state={resolutionState}
            resolved={resolved}
            liveAvailability={liveAvailability}
            onRun={runResolution}
            onBack={() => navigate("conflicts")}
          />
        )}
      </section>
    </main>
  );
}

function PlanScreen({
  mode,
  plans,
  livePhones,
  route,
  authorized,
  operatorKey,
  recoveredCall,
  liveAvailability,
  onPhoneChange,
  onRouteChange,
  onAuthorizedChange,
  onOperatorKeyChange,
  onResume,
  onStart,
  busy,
}: {
  mode: Mode;
  plans: VendorPlan[];
  livePhones: Record<string, string>;
  route: string;
  authorized: boolean;
  operatorKey: string;
  recoveredCall: ActiveCall | null;
  liveAvailability: LiveAvailability;
  onPhoneChange: (id: string, phone: string) => void;
  onRouteChange: (value: string) => void;
  onAuthorizedChange: (value: boolean) => void;
  onOperatorKeyChange: (value: string) => void;
  onResume: () => void;
  onStart: () => void;
  busy: boolean;
}) {
  return (
    <div className="screen-stack">
      <div className="section-intro">
        <div><p className="eyebrow">01 / Event plan</p><h2>Confirm the call contract</h2></div>
        <p>ReadyLine calls only the listed vendors, asks only load-in questions, and never makes operational commitments.</p>
      </div>

      <section className="venue-strip" aria-label="Venue constraints">
        <div><span>Access</span><strong>{fixtureVenue.accessStart}</strong></div>
        <div><span>Loading dock</span><strong>{fixtureVenue.dockCapacity} team</strong></div>
        <div><span>Available power</span><strong>{fixtureVenue.availablePowerAmps}A</strong></div>
        <div><span>Ready by</span><strong>{fixtureVenue.readyBy}</strong></div>
      </section>

      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">{mode === "fixture" ? "Fictional demo recipients" : "Authorized recipients"}</p><h3>{plans.length} vendors</h3></div><span className="quiet-chip">{mode === "fixture" ? "Simulation only" : "One batch"}</span></div>
        <div className="recipient-table">
          {plans.map((plan) => (
            <div className="recipient-row" key={plan.id}>
              <div className="vendor-initial">{plan.name.slice(0, 1)}</div>
              <div><strong>{plan.name}</strong><small>{plan.category}</small></div>
              {mode === "live" ? (
                <label className="phone-field"><span className="sr-only">{plan.name} phone</span><input value={livePhones[plan.id] ?? ""} onChange={(event) => onPhoneChange(plan.id, event.target.value)} placeholder="E.164 number you control" inputMode="tel" /></label>
              ) : <div className="demo-phone"><code>{plan.demoPhone}</code><small>Reserved · non-working</small></div>}
              <span className="consent-tag">{mode === "fixture" ? "Fictional" : "Authorized"}</span>
            </div>
          ))}
        </div>
      </section>

      {mode === "live" && (
        <section className="live-gate">
          <div className={`live-readiness ${liveAvailability}`} role="status" aria-live="polite">
            <span aria-hidden="true" />
            <div>
              <strong>
                {liveAvailability === "checking"
                  ? "Checking live backend…"
                  : liveAvailability === "available"
                    ? "Live backend ready"
                    : "Live backend unavailable"}
              </strong>
              <small>
                {liveAvailability === "available"
                  ? "Authorized CALL-E calls can be started from this deployment."
                  : liveAvailability === "checking"
                    ? "Confirming server-side configuration without exposing credentials."
                    : "Demo mode remains ready and uses no calls or credits."}
              </small>
            </div>
          </div>
          <label><span>Calling route</span><select value={route} onChange={(event) => onRouteChange(event.target.value)}>{supportedRoutes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="operator-field">
            <span>Operator key</span>
            <input
              type="password"
              value={operatorKey}
              onChange={(event) => onOperatorKeyChange(event.target.value)}
              placeholder="Deployment access key"
              autoComplete="off"
              spellCheck={false}
            />
            <small>Kept only in this tab&apos;s memory and never saved.</small>
          </label>
          <label className="check-line"><input type="checkbox" checked={authorized} onChange={(event) => onAuthorizedChange(event.target.checked)} /><span>I confirm these recipients authorized an AI event-readiness call.</span></label>
          {recoveredCall && (
            <div className="recovery-card">
              <div>
                <strong>Unfinished {recoveredCall.stage} run</strong>
                <code>{recoveredCall.callId}</code>
              </div>
              <button className="secondary-button" type="button" onClick={onResume}>Resume status check</button>
            </div>
          )}
        </section>
      )}

      <div className="action-bar"><div><strong>{mode === "fixture" ? "Safe simulation" : "Real-world side effect"}</strong><span>{mode === "fixture" ? "Fictional numbers only. No calls or credits used." : liveAvailability === "available" ? "CALL-E will place real calls after this click." : "Live calling must be configured on the server first."}</span></div><button className="primary-button" type="button" onClick={onStart} disabled={busy || (mode === "live" && liveAvailability !== "available")}>{busy ? (mode === "fixture" ? "Simulating…" : "Calling…") : mode === "fixture" ? "Run simulated batch" : liveAvailability === "checking" ? "Checking live backend…" : liveAvailability === "unavailable" ? "Live backend unavailable" : "Start CALL-E batch"}</button></div>
    </div>
  );
}

function CallsScreen({ mode, plans, livePhones, runState, callId, onInspect }: { mode: Mode; plans: VendorPlan[]; livePhones: Record<string, string>; runState: RunState; callId: string; onInspect: () => void }) {
  return (
    <div className="screen-stack">
      <div className="section-intro"><div><p className="eyebrow">02 / Call evidence</p><h2>{mode === "fixture" ? (runState === "calling" ? "Simulated calls in progress" : "Simulated results ready") : (runState === "calling" ? "Vendor calls in progress" : "Structured results received")}</h2></div><p>{mode === "fixture" ? "This browser-only replay uses fictional, non-working numbers and never contacts CALL-E." : "Every disposition stays separate. Silence, failure, and ambiguous answers are never counted as confirmation."}</p></div>
      {callId && <div className="call-id"><span>CALL-E run</span><code>{callId}</code></div>}
      <section className="call-grid">
        {plans.map((plan, index) => (
          <article className="call-card" key={plan.id}>
            <div className="call-card-top"><span className="call-number">0{index + 1}</span><span className={`call-status ${plan.callStatus}`}>{plan.callStatus}</span></div>
            <h3>{plan.name}</h3><p className="call-category">{plan.category} · {mode === "fixture" ? plan.demoPhone : maskLivePhone(livePhones[plan.id])}</p>
            {plan.callStatus === "calling" ? <div className="call-wave" aria-label={mode === "fixture" ? "Simulating call" : "Calling"}><i /><i /><i /><i /></div> : <blockquote>“{plan.evidence}”</blockquote>}
            <dl><div><dt>Arrival</dt><dd>{plan.arrivalTime || "Unknown"}</dd></div><div><dt>Setup complete</dt><dd>{plan.setupCompleteTime || "Unknown"}</dd></div><div><dt>Power</dt><dd>{plan.powerAmps < 0 ? "Unknown" : `${plan.powerAmps}A`}</dd></div></dl>
          </article>
        ))}
      </section>
      <div className="action-bar"><div><strong>Evidence captured</strong><span>Times and constraints are ready for deterministic comparison.</span></div><button className="primary-button" type="button" onClick={onInspect} disabled={runState === "calling"}>Inspect conflicts</button></div>
    </div>
  );
}

function Timeline({ plans, conflicts }: { plans: VendorPlan[]; conflicts: ReturnType<typeof detectConflicts> }) {
  const start = 540;
  const end = 660;
  const vendorsWithConflicts = conflictedVendorIds(conflicts);
  return (
    <div className="timeline-wrap">
      <div className="time-axis" aria-hidden="true"><span>09:00</span><span>09:30</span><span>10:00</span><span>10:30</span><span>11:00</span></div>
      {plans.map((plan) => {
        const planStart = parseTime(plan.needsLoadingDock === "yes" ? plan.dockStart : plan.arrivalTime) ?? start;
        const planEnd = parseTime(plan.needsLoadingDock === "yes" ? plan.dockEnd : plan.setupCompleteTime) ?? planStart;
        const left = Math.max(0, Math.min(100, ((planStart - start) / (end - start)) * 100));
        const width = Math.max(5, Math.min(100 - left, ((planEnd - planStart) / (end - start)) * 100));
        const isProblem = vendorsWithConflicts.has(plan.id);
        return (
          <div className="timeline-row" key={plan.id}>
            <div><strong>{plan.name}</strong><small>{plan.needsLoadingDock === "yes" ? `Dock + ${plan.powerAmps}A` : "No dock"}</small></div>
            <div className="track"><span className={`bar ${isProblem ? "bar-conflict" : "bar-ready"}`} style={{ left: `${left}%`, width: `${width}%` }}>{planStart < end ? `${plan.needsLoadingDock === "yes" ? plan.dockStart : plan.arrivalTime}–${plan.needsLoadingDock === "yes" ? plan.dockEnd : plan.setupCompleteTime}` : "After 11:00"}</span><i className="access-line" /></div>
          </div>
        );
      })}
      <div className="venue-note"><span /> Venue access begins at {fixtureVenue.accessStart}</div>
    </div>
  );
}

function ConflictsScreen({ plans, conflicts, summary, source, onResolve, onDownload }: { plans: VendorPlan[]; conflicts: ReturnType<typeof detectConflicts>; summary: ReturnType<typeof readinessSummary>; source: "CALL-E" | "Demo"; onResolve: () => void; onDownload: () => void }) {
  return (
    <div className="screen-stack">
      <div className="summary-grid">
        <article className={`readiness-card ${conflicts.length === 0 ? "is-ready" : ""}`}>
          <div className="card-heading"><div><p className="eyebrow">Current readiness</p><h2>{conflicts.length === 0 ? "Ready" : "Blocked"}</h2></div><span className="score">{summary.readyCount}/{summary.totalCount} ready</span></div>
          <p className="muted">{conflicts.length === 0 ? "Every vendor plan now fits the venue access, dock, power, and timing constraints." : "Vendor calls were successful, but their plans conflict when viewed together."}</p>
          <div className="vendor-list">{plans.map((vendor) => { const count = conflicts.filter((item) => item.vendorIds.includes(vendor.id)).length; return <div className="vendor-row" key={vendor.id}><span className={`status-dot ${count ? "danger" : "success"}`} /><strong>{vendor.name}</strong><span>{count ? `${count} conflict${count > 1 ? "s" : ""}` : "Ready"}</span></div>; })}</div>
        </article>
        <article className={`conflict-card ${conflicts.length === 0 ? "resolved-card" : ""}`}>
          <div className="card-heading"><div><p className="eyebrow">Cross-vendor analysis</p><h2>{conflicts.length === 0 ? "No open conflicts" : `${conflicts.length} conflicts`}</h2></div><span className={conflicts.length === 0 ? "resolved-chip" : "warning-chip"}>{conflicts.length === 0 ? "Plan reconciled" : "Action required"}</span></div>
          {conflicts.length === 0 ? <div className="resolved-message"><span>✓</span><p><strong>Northstar AV revised its plan.</strong>The new dock window starts as catering leaves, and power stays within 32A.</p></div> : <ol className="conflict-list">{conflicts.map((conflict) => <li key={conflict.id}><b>{typeLabels[conflict.type]}</b><span>{conflict.detail}</span></li>)}</ol>}
        </article>
      </div>
      <article className="timeline-card"><div className="timeline-header"><div><p className="eyebrow">Confirmed call evidence</p><h2>Load-in timeline</h2></div><div className="legend"><span><i className="legend-ready" /> Ready</span><span><i className="legend-conflict" /> Conflict</span></div></div><Timeline plans={plans} conflicts={conflicts} /></article>
      <section className="decision-record" aria-labelledby="decision-record-title">
        <div className="decision-heading">
          <div><p className="eyebrow">Operational audit trail</p><h3 id="decision-record-title">Decision record</h3></div>
          <span className={conflicts.length === 0 ? "resolved-chip" : "quiet-chip"}>{source} evidence</span>
        </div>
        <ol>
          <li><span>01</span><div><strong>Vendor evidence captured</strong><p>Three dispositions remain individually attributable to their calls.</p></div><em>Complete</em></li>
          <li><span>02</span><div><strong>Constraints evaluated</strong><p>Access, dock, power, and deadline rules ran deterministically.</p></div><em>Complete</em></li>
          {conflicts.length === 0 ? (
            <>
              <li><span>03</span><div><strong>Follow-up approved</strong><p>The event manager authorized one bounded Northstar AV call.</p></div><em>Recorded</em></li>
              <li><span>04</span><div><strong>Plan reconciled</strong><p>The revised commitments produce no open conflicts.</p></div><em>Ready</em></li>
            </>
          ) : (
            <li className="decision-pending"><span>03</span><div><strong>Human decision required</strong><p>{conflicts.length} conflict{conflicts.length === 1 ? "" : "s"} must be resolved before the plan is ready.</p></div><em>Pending</em></li>
          )}
        </ol>
        {conflicts.length === 0 && <div className="decision-export"><div><strong>Share the reconciled plan</strong><span>Includes venue limits, vendor commitments, evidence, and approvals.</span></div><button className="secondary-button" type="button" onClick={onDownload}>Download load-in brief</button></div>}
      </section>
      {conflicts.length > 0 && <div className="action-bar"><div><strong>One targeted call can resolve all three issues</strong><span>The event manager reviews the exact goal before CALL-E runs.</span></div><button className="primary-button" type="button" onClick={onResolve}>Review resolution</button></div>}
    </div>
  );
}

function ResolutionScreen({ conflicts, mode, state, resolved, liveAvailability, onRun, onBack }: { conflicts: ReturnType<typeof detectConflicts>; mode: Mode; state: RunState; resolved: boolean; liveAvailability: LiveAvailability; onRun: () => void; onBack: () => void }) {
  if (resolved) return <div className="empty-state"><span>✓</span><p className="eyebrow">Resolution complete</p><h2>The load-in plan is ready.</h2><p>All vendor commitments fit the venue constraints.</p><button className="secondary-button" type="button" onClick={onBack}>View reconciled timeline</button></div>;
  return (
    <div className="screen-stack">
      <div className="section-intro"><div><p className="eyebrow">04 / Human approval</p><h2>Review the targeted follow-up</h2></div><p>This call asks whether a revised plan is feasible. It cannot negotiate, spend money, or commit on the event manager’s behalf.</p></div>
      <div className="resolution-grid">
        <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Open conflicts</p><h3>What must change</h3></div><span className="warning-chip">{conflicts.length} blockers</span></div><div className="resolution-conflicts">{conflicts.map((conflict) => <div key={conflict.id}><span>{typeLabels[conflict.type]}</span><p>{conflict.detail}</p></div>)}</div></section>
        <section className="call-contract"><div className="contract-top"><div><p className="eyebrow">CALL-E plan preview</p><h3>Northstar AV follow-up</h3></div><code>{mode === "fixture" ? initialVendorPlans[0].demoPhone : "Live number"}</code></div><div className="contract-rule"><span>May ask</span><p>Revised arrival, dock window, approved power setup, and new completion time.</p></div><div className="contract-rule forbidden"><span>Must not</span><p>Accept charges, approve equipment, promise access, or make commitments.</p></div><blockquote>{resolutionCallGoal}</blockquote></section>
      </div>
      <div className="action-bar approval"><div><strong>{mode === "fixture" ? "Simulated follow-up" : "Real CALL-E follow-up"}</strong><span>{mode === "fixture" ? "Uses a saved fictional response without placing a call." : liveAvailability === "available" ? "This approval places one real outbound call." : "Live calling must be configured on the server first."}</span></div><div className="button-row"><button className="secondary-button" type="button" onClick={onBack}>Cancel</button><button className="primary-button" type="button" onClick={onRun} disabled={state === "calling" || (mode === "live" && liveAvailability !== "available")}>{state === "calling" ? (mode === "fixture" ? "Simulating follow-up…" : "Calling Northstar AV…") : mode === "live" && liveAvailability === "checking" ? "Checking live backend…" : mode === "live" && liveAvailability === "unavailable" ? "Live backend unavailable" : "Approve and run"}</button></div></div>
    </div>
  );
}
