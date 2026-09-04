import { useEffect, useRef, useState } from "react";
import { configureLiveWorkspace, createJob, createJobInput, getState, jobAction, previewJob, resetState } from "./lib/api";
import type { AppState, FakeOutcome, Preview, WorkflowTemplate, WorkflowType } from "./lib/types";

const fallbackWorkflows: WorkflowTemplate[] = [
  { id: "appointment_management", label: "Appointment desk", business: "Service businesses", description: "Confirm or reschedule a customer appointment without changing the calendar automatically.", recipientLabel: "Customer", recordLabel: "Appointment", applyLabel: "appointment", demoEmployeeId: "emp-ana", demoShiftId: "shift-ana-1", demoOutcome: "reschedule_requested" },
  { id: "lead_follow_up", label: "Lead follow-up", business: "Sales teams", description: "Turn a phone conversation into a qualified follow-up time for a prospective customer.", recipientLabel: "Prospect", recordLabel: "Follow-up", applyLabel: "follow-up", demoEmployeeId: "emp-diego", demoShiftId: "shift-diego-1", demoOutcome: "confirmed" },
  { id: "shift_coordination", label: "Shift coordination", business: "Operations teams", description: "Check a team member's availability and safely confirm or renegotiate a work shift.", recipientLabel: "Team member", recordLabel: "Shift", applyLabel: "shift", demoEmployeeId: "emp-lucia", demoShiftId: "shift-lucia-1", demoOutcome: "declined" },
];

const outcomeLabels: Record<FakeOutcome, string> = {
  confirmed: "Confirmed", reschedule_requested: "Requests another time", declined: "Declined", unknown: "Unknown / unclear", failed: "Provider failure",
};

const statusLabels: Record<string, string> = {
  awaiting_approval: "Awaiting approval", queued: "Queued", in_progress: "Call in progress", needs_review: "Result needs review", failed: "Call failed", canceled: "Canceled", applied: "Change applied", rejected: "Change rejected",
};

const traceLabels: Record<string, string> = {
  approval_required: "Preview and approval request", call_authorized: "Manager authorization recorded", call_created: "CALL-E call created", call_completed: "Structured result received", change_applied: "Human-approved change applied", change_rejected: "Manager rejected the proposed change", call_failed: "Provider failure contained safely", call_retrying: "Retrying with the same idempotency key", call_canceled: "Call canceled before commitment",
};

const demoCases: Array<{ name: string; detail: string; workflowType: WorkflowType; employeeId: string; shiftId: string; fakeOutcome: FakeOutcome }> = [
  { name: "Appointment reschedule", detail: "Luna Studio · alternate time", workflowType: "appointment_management", employeeId: "emp-ana", shiftId: "shift-ana-1", fakeOutcome: "reschedule_requested" },
  { name: "Lead follow-up", detail: "Norte Services · qualified next step", workflowType: "lead_follow_up", employeeId: "emp-diego", shiftId: "shift-diego-1", fakeOutcome: "confirmed" },
  { name: "Shift coordination", detail: "Calle Ops · team availability", workflowType: "shift_coordination", employeeId: "emp-lucia", shiftId: "shift-lucia-1", fakeOutcome: "confirmed" },
];

const formatSlot = (date: string, startTime: string, endTime: string) => `${date} · ${startTime}–${endTime}`;
type View = "dashboard" | "flow";
type Stage = "configure" | "run" | "review";

const App = () => {
  const [state, setState] = useState<AppState | null>(null);
  const [workflowType, setWorkflowType] = useState<WorkflowType>("appointment_management");
  const [employeeId, setEmployeeId] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [fakeOutcome, setFakeOutcome] = useState<FakeOutcome>("reschedule_requested");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [demoCaseIndex, setDemoCaseIndex] = useState(0);
  const [busy, setBusy] = useState<string | null>("loading");
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [view, setView] = useState<View>("dashboard");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [evidenceTab, setEvidenceTab] = useState<"transcript" | "events">("transcript");
  const [liveWorkspace, setLiveWorkspace] = useState({ workflowType: "appointment_management" as WorkflowType, name: "", phone: "", business: "", recordLabel: "", date: "", startTime: "", endTime: "", region: "", locale: "" });
  const initialized = useRef(false);

  const workflows = state?.runtime.workflows?.length ? state.runtime.workflows : fallbackWorkflows;
  const isLiveMode = state?.runtime.provider === "live";
  const liveWorkspaceRequired = Boolean(isLiveMode && state && !state.runtime.workspaceConfigured);
  const workflow = workflows.find((item) => item.id === workflowType) || workflows[0] || fallbackWorkflows[0];
  const employee = state?.employees.find((item) => item.id === employeeId) || state?.employees[0];
  const shifts = state?.shifts.filter((item) => item.employeeId === employee?.id) || [];
  const shift = shifts.find((item) => item.id === shiftId) || shifts[0];
  const selectedJob = state?.jobs.find((item) => item.id === selectedJobId) || null;
  const selectedJobWorkflow = workflows.find((item) => item.id === selectedJob?.workflowType) || workflow;
  const activeJob = selectedJob && ["queued", "in_progress"].includes(selectedJob.status) ? selectedJob : null;
  const selectedJobEvents = selectedJob ? state?.events.filter((event) => event.jobId === selectedJob.id).slice(0, 8).reverse() || [] : [];
  const recentEvents = selectedJob ? state?.events.filter((event) => event.jobId === selectedJob.id) || [] : [];
  const activeStage: Stage = selectedJob?.result ? "review" : preview || selectedJob ? "run" : "configure";
  const stageIndex = activeStage === "configure" ? 0 : activeStage === "run" ? 1 : 2;
  const currentScenario = isLiveMode
    ? { name: "Live workspace", detail: "User-provided contact and scheduled context" }
    : demoCases[demoCaseIndex] || demoCases[0];

  const load = async () => {
    try { setState(await getState()); setError(null); } catch (err) { setError(err instanceof Error ? err.message : "Could not load state"); } finally { setBusy(null); }
  };

  useEffect(() => { void load(); }, []);

  const applyDemoCase = (nextIndex: number) => {
    if (!state) return;
    const item = demoCases[nextIndex % demoCases.length];
    const nextShift = state.shifts.find((entry) => entry.id === item.shiftId);
    setDemoCaseIndex(nextIndex % demoCases.length);
    setWorkflowType(item.workflowType); setEmployeeId(item.employeeId); setShiftId(item.shiftId);
    setDate(nextShift?.date || ""); setTime(nextShift?.startTime || ""); setFakeOutcome(item.fakeOutcome);
    setPreview(null); setSelectedJobId(null); setEvidenceTab("transcript"); setError(null);
  };

  useEffect(() => {
    if (!state || initialized.current) return;
    initialized.current = true;
    if (state.runtime.provider === "live") {
      const nextEmployee = state.employees[0];
      const nextShift = state.shifts[0];
      const nextWorkflow = state.runtime.workflows[0]?.id || "appointment_management";
      setWorkflowType(nextWorkflow);
      setEmployeeId(nextEmployee?.id || ""); setShiftId(nextShift?.id || "");
      setDate(nextShift?.date || ""); setTime(nextShift?.startTime || "");
      setLiveWorkspace((current) => ({ ...current, workflowType: nextWorkflow, region: state.runtime.region, locale: state.runtime.language }));
    } else {
      applyDemoCase(0);
      if (state.jobs[0]) setSelectedJobId(state.jobs[0].id);
    }
  }, [state]);

  useEffect(() => {
    if (!activeJob) return undefined;
    const timer = window.setInterval(async () => { try { setState(await jobAction(activeJob.id, "refresh")); } catch { /* manual refresh remains available */ } }, 3000);
    return () => window.clearInterval(timer);
  }, [activeJob?.id]);

  const startScenario = (index: number) => { applyDemoCase(index); setView("flow"); setHistoryOpen(false); };

  const openSavedRun = (jobId: string) => {
    if (!state) return;
    const job = state.jobs.find((item) => item.id === jobId);
    if (!job) return;
    const nextWorkflow = workflows.find((item) => item.id === job.workflowType) || workflows[0];
    const nextEmployee = state.employees.find((item) => item.id === job.employeeId);
    const nextShift = state.shifts.find((item) => item.id === job.shiftId);
    setWorkflowType(nextWorkflow.id); setEmployeeId(nextEmployee?.id || ""); setShiftId(nextShift?.id || "");
    setDate(nextShift?.date || ""); setTime(nextShift?.startTime || ""); setFakeOutcome(job.outcome || nextWorkflow.demoOutcome);
    setPreview(null); setSelectedJobId(job.id); setView("flow"); setHistoryOpen(false); setEvidenceTab("transcript");
  };

  const doAction = async (label: string, action: string) => {
    if (!selectedJob) return;
    setBusy(label); setError(null);
    try { setState(await jobAction(selectedJob.id, action)); } catch (err) { setError(err instanceof Error ? err.message : "Action failed"); } finally { setBusy(null); }
  };

  const handleWorkflowChange = (nextType: WorkflowType) => {
    const nextWorkflow = workflows.find((item) => item.id === nextType) || workflow;
    if (isLiveMode) {
      setWorkflowType(nextType); setLiveWorkspace((current) => ({ ...current, workflowType: nextType })); setFakeOutcome(nextWorkflow.demoOutcome); setPreview(null); setSelectedJobId(null); setError(null);
      return;
    }
    const nextEmployee = state?.employees.find((item) => item.id === nextWorkflow.demoEmployeeId);
    const nextShift = state?.shifts.find((item) => item.id === nextWorkflow.demoShiftId);
    setWorkflowType(nextType); setEmployeeId(nextEmployee?.id || ""); setShiftId(nextShift?.id || "");
    setDate(nextShift?.date || ""); setTime(nextShift?.startTime || ""); setFakeOutcome(nextWorkflow.demoOutcome); setPreview(null); setSelectedJobId(null);
  };

  const handleEmployeeChange = (nextEmployeeId: string) => {
    const nextShift = state?.shifts.find((item) => item.employeeId === nextEmployeeId);
    setEmployeeId(nextEmployeeId); setShiftId(nextShift?.id || ""); setDate(nextShift?.date || ""); setTime(nextShift?.startTime || ""); setPreview(null);
  };

  const handleShiftChange = (nextShiftId: string) => {
    const nextShift = shifts.find((item) => item.id === nextShiftId);
    setShiftId(nextShiftId); setDate(nextShift?.date || ""); setTime(nextShift?.startTime || ""); setPreview(null);
  };

  const handlePreview = async () => {
    if (!employee || !shift) return;
    setBusy("preview"); setError(null);
    try { setPreview(await previewJob(createJobInput(employee.id, shift.id, date || shift.date, time || shift.startTime, fakeOutcome, workflowType))); setView("flow"); } catch (err) { setError(err instanceof Error ? err.message : "Preview failed"); } finally { setBusy(null); }
  };

  const handleCreate = async () => {
    if (!employee || !shift) return;
    setBusy("create"); setError(null);
    try { const next = await createJob(createJobInput(employee.id, shift.id, date || shift.date, time || shift.startTime, fakeOutcome, workflowType)); setState(next); setSelectedJobId(next.jobs[0]?.id || null); setPreview(null); } catch (err) { setError(err instanceof Error ? err.message : "Could not create job"); } finally { setBusy(null); }
  };

  const handleConfigureLiveWorkspace = async () => {
    setBusy("workspace"); setError(null);
    try {
      const next = await configureLiveWorkspace(liveWorkspace);
      const nextWorkflow = workflows.find((item) => item.id === liveWorkspace.workflowType) || workflows[0];
      setState(next); setWorkflowType(nextWorkflow.id); setEmployeeId(next.employees[0]?.id || ""); setShiftId(next.shifts[0]?.id || "");
      setDate(next.shifts[0]?.date || ""); setTime(next.shifts[0]?.startTime || ""); setFakeOutcome(nextWorkflow.demoOutcome);
      setPreview(null); setSelectedJobId(null); setView("flow");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load live workspace"); } finally { setBusy(null); }
  };

  const handleReset = async () => {
    setBusy("reset"); setError(null);
    try {
      const next = await resetState(); setState(next); setPreview(null); setSelectedJobId(null); setView("dashboard"); setHistoryOpen(false); setDemoCaseIndex(0); setWorkflowType("appointment_management"); setEmployeeId(""); setShiftId(""); setDate(""); setTime(""); setFakeOutcome("reschedule_requested"); setLiveWorkspace((current) => ({ ...current, workflowType: "appointment_management", name: "", phone: "", business: "", recordLabel: "", date: "", startTime: "", endTime: "", region: next.runtime.region, locale: next.runtime.language }));
    } catch (err) { setError(err instanceof Error ? err.message : "Could not reset"); } finally { setBusy(null); }
  };

  const employeeName = (id: string) => state?.employees.find((item) => item.id === id)?.name || "Unknown contact";
  const shiftLabel = (id: string) => { const item = state?.shifts.find((entry) => entry.id === id); return item ? formatSlot(item.date, item.startTime, item.endTime) : "Unknown scheduled item"; };

  if (!state) return <main className="loading"><div className="spinner" />Loading E-mploye…</main>;

  return (
    <div className="app-shell guided-app">
      <header className="topbar">
        <div className="brand"><div className="brand-mark">E</div><div><div className="brand-name">E-mploye</div><div className="brand-sub">One virtual employee · many business workflows</div></div></div>
        <div className="top-actions"><span className="persona-chip">1 virtual employee</span><span className={`mode-pill ${state.runtime.provider}`}>{state.runtime.provider === "fake" ? "CALL-E SANDBOX" : "LIVE CALL-E"}</span><button className="ghost-button history-trigger" onClick={() => setHistoryOpen((open) => !open)} disabled={Boolean(busy)}>Runs · {state.jobs.length}</button><button className="ghost-button settings-button" onClick={() => setSettingsOpen(true)} disabled={Boolean(busy)}>Live mode setup</button><button className="ghost-button" onClick={handleReset} disabled={Boolean(busy)}>Reset demo</button></div>
      </header>

      {settingsOpen && <div className="settings-backdrop" role="presentation" onClick={() => setSettingsOpen(false)}><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}><div className="settings-heading"><div><p className="eyebrow">RUNTIME CONFIGURATION</p><h2 id="settings-title">CALL-E connection</h2></div><button className="ghost-button settings-close" onClick={() => setSettingsOpen(false)}>Close</button></div><p className="settings-intro">Choose the execution posture on the server. The browser never receives or stores the CALL-E API key.</p><div className="settings-mode-grid"><div className={`settings-mode-card ${state.runtime.provider === "fake" ? "active" : ""}`}><div><span className="settings-mode-label">SAFE DEFAULT</span><strong>CALL-E sandbox</strong></div><span className="settings-state">{state.runtime.provider === "fake" ? "Active" : "Available"}</span><p>Deterministic calls, no phone charges, and every outcome available for the demo.</p></div><div className={`settings-mode-card live ${state.runtime.provider === "live" ? "active" : ""}`}><div><span className="settings-mode-label">CONTROLLED OPT-IN</span><strong>Live CALL-E</strong></div><span className="settings-state">{state.runtime.liveReady ? "Ready" : state.runtime.liveRequested ? "Waiting for config" : "Disabled"}</span><p>Uses the server-side key and one authorized E.164 test phone after manager approval.</p></div></div><div className="settings-status-grid"><div className="settings-status-card"><span>API key</span><strong>{state.runtime.apiKeyConfigured ? "Configured · server only" : "Not configured"}</strong><small>Secret value is never returned to the UI.</small></div><div className="settings-status-card"><span>Test phone</span><strong>{state.runtime.testPhoneConfigured ? `${state.runtime.testPhoneMasked} · configured` : "Required for live mode"}</strong><small>Use only a number you own or explicitly authorized.</small></div><div className="settings-status-card"><span>Workspace data</span><strong>{state.runtime.workspaceConfigured ? "Loaded · user provided" : "Empty · required in live mode"}</strong><small>Live mode never starts from the sandbox contacts.</small></div><div className="settings-status-card"><span>Language · region</span><strong>{state.runtime.language} · {state.runtime.region}</strong><small>Authorized destination: {state.runtime.testPhoneMasked || "not configured"}</small></div></div><div className="settings-env"><p className="eyebrow">SERVER-ONLY SETUP</p><code>CALLE_API_KEY=your_server_side_key</code><code>CALLE_LIVE_ENABLED=true</code><code>CALLE_TEST_PHONE=+15551234567</code><code>CALLE_TEST_REGION=US</code><code>CALLE_TEST_LOCALE=en-US</code></div><p className="settings-note">Live mode becomes active only when the flag, API key, authorized phone, region, and locale are all present. The public Vercel demo deliberately remains sandbox-only.</p></section></div>}

      {historyOpen && <aside className="history-drawer" aria-label="Saved runs"><div className="drawer-heading"><div><p className="eyebrow">ACTIVITY</p><h2>Saved runs</h2></div><button className="ghost-button" onClick={() => setHistoryOpen(false)}>Close</button></div>{state.jobs.length ? <div className="history-list">{state.jobs.map((job) => <button className={`history-row ${selectedJob?.id === job.id ? "selected" : ""}`} key={job.id} onClick={() => openSavedRun(job.id)}><span className={`history-dot ${job.status}`} /><span><strong>{workflows.find((item) => item.id === job.workflowType)?.label || "E-mploye task"}</strong><small>{employeeName(job.employeeId)} · {shiftLabel(job.shiftId)}</small></span><span className={`status-text ${job.status}`}>{statusLabels[job.status]}</span><span className="chevron">›</span></button>)}</div> : <p className="muted-note">No runs saved yet.</p>}</aside>}

      <main className={`guided-content ${view === "flow" ? "is-flow" : "is-dashboard"}`}>
        {error && <div className="alert error"><strong>Action blocked</strong><span>{error}</span><button onClick={() => setError(null)}>Dismiss</button></div>}

        {view === "dashboard" ? <section className="dashboard-view">
          <section className="hero guided-hero"><div><p className="eyebrow">ONE VIRTUAL EMPLOYEE · MANY WORKFLOWS</p><h1>E-mploye handles the routine. You keep the decision.</h1><p className="hero-copy">One phone-based AI employee for appointments, sales follow-up, and operations. Every call is previewed, approved, logged, and kept under human control.</p></div><div className="hero-note"><div><span className="dot" /> Human approval stays in the loop</div><div className="hero-note-small">No business change happens without approval.</div><div className="hero-note-small">{workflows.length} reusable workflows</div></div></section>
          <section className="panel workflow-gallery guided-gallery"><div className="panel-heading"><div><p className="eyebrow">THE E-MPLOYEE ROLE</p><h2>What should E-mploye handle?</h2><p className="section-copy">One virtual employee, adapted to the business context and task.</p></div><span className="count-badge">{workflows.length} workflows</span></div><div className="workflow-cards">{workflows.map((item) => <button key={item.id} className={`workflow-card ${workflow.id === item.id ? "selected" : ""}`} onClick={() => handleWorkflowChange(item.id)} aria-pressed={workflow.id === item.id}><span className="workflow-kind">{item.business}</span><strong>{item.label}</strong><span>{item.description}</span><small>{item.recipientLabel} → {item.recordLabel}</small></button>)}</div></section>
          {isLiveMode && liveWorkspaceRequired && <section className="live-setup panel"><div className="panel-heading"><div><p className="eyebrow">LIVE WORKSPACE</p><h2>Load the data for this call</h2><p className="section-copy">Live mode starts empty. Add one authorized contact and one scheduled context before previewing anything.</p></div><span className="count-badge">Required</span></div><div className="live-safety-banner"><strong>Controlled destination: {state.runtime.testPhoneMasked || "server-configured E.164"}</strong><span>The phone must match the server-side authorized test number. No sandbox records are copied into live mode.</span></div><div className="live-form-grid"><label>Workflow<select value={liveWorkspace.workflowType} onChange={(event) => { const nextType = event.target.value as WorkflowType; const nextWorkflow = workflows.find((item) => item.id === nextType) || workflow; setLiveWorkspace((current) => ({ ...current, workflowType: nextType, recordLabel: current.recordLabel || nextWorkflow.recordLabel })); setWorkflowType(nextType); }} >{workflows.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.business}</option>)}</select></label><label>Contact name<input value={liveWorkspace.name} onChange={(event) => setLiveWorkspace((current) => ({ ...current, name: event.target.value }))} placeholder="Person you authorized" /></label><label>Authorized E.164 phone<input value={liveWorkspace.phone} onChange={(event) => setLiveWorkspace((current) => ({ ...current, phone: event.target.value }))} placeholder="+15551234567" inputMode="tel" /></label><label>Business context<input value={liveWorkspace.business} onChange={(event) => setLiveWorkspace((current) => ({ ...current, business: event.target.value }))} placeholder="Your business or team" /></label><label>Scheduled context<input value={liveWorkspace.recordLabel} onChange={(event) => setLiveWorkspace((current) => ({ ...current, recordLabel: event.target.value }))} placeholder="Appointment, follow-up, or shift" /></label><label>Scheduled date<input type="date" value={liveWorkspace.date} onChange={(event) => setLiveWorkspace((current) => ({ ...current, date: event.target.value }))} /></label><label>Start time<input type="time" value={liveWorkspace.startTime} onChange={(event) => setLiveWorkspace((current) => ({ ...current, startTime: event.target.value }))} /></label><label>End time<input type="time" value={liveWorkspace.endTime} onChange={(event) => setLiveWorkspace((current) => ({ ...current, endTime: event.target.value }))} /></label><label>Destination region<input value={liveWorkspace.region} onChange={(event) => setLiveWorkspace((current) => ({ ...current, region: event.target.value.toUpperCase() }))} placeholder={state.runtime.region || "US"} /></label><label>Destination locale<input value={liveWorkspace.locale} onChange={(event) => setLiveWorkspace((current) => ({ ...current, locale: event.target.value }))} placeholder={state.runtime.language || "en-US"} /></label></div><div className="live-setup-actions"><button className="primary-button" onClick={() => void handleConfigureLiveWorkspace()} disabled={Boolean(busy) || !state.runtime.liveReady}>Load live workspace →</button><span>{state.runtime.liveReady ? "Server readiness passed. The next step is preview and manager approval." : "Complete server-only CALL-E readiness before loading live data."}</span></div></section>}
          {isLiveMode && !liveWorkspaceRequired && <section className="live-ready-summary panel"><div><p className="eyebrow">LIVE WORKSPACE READY</p><h2>{state.employees[0]?.name || "Authorized contact"}</h2><p>{state.employees[0]?.business || "User-provided business"} · {state.shifts[0] ? formatSlot(state.shifts[0].date, state.shifts[0].startTime, state.shifts[0].endTime) : "Scheduled context loaded"}</p></div><div className="live-ready-actions"><button className="primary-button" onClick={() => setView("flow")}>Open live workspace →</button><button className="secondary-button danger-outline" onClick={() => void handleReset()} disabled={Boolean(busy)}>Clear live data</button></div></section>}
          {!isLiveMode && <section className="guided-demo panel"><div><p className="eyebrow">GUIDED DEMO</p><h2>Three ready-to-run scenarios</h2><p>Choose a prepared scenario to see the complete CALL-E approval flow in a deterministic sandbox.</p></div><div className="scenario-grid">{demoCases.map((item, index) => <button className={`scenario-card ${demoCaseIndex === index ? "selected" : ""}`} key={item.name} onClick={() => startScenario(index)}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{item.name}</strong><small>{item.detail}</small></div><b>Start scenario →</b></button>)}</div></section>}
          <section className="dashboard-proof"><div><span className="proof-dot" /> {isLiveMode ? "LIVE CALL-E" : "CALL-E SANDBOX"}</div><span>{isLiveMode ? "Server-configured, user-loaded workspace" : "Deterministic outcomes · no call credits used"}</span><span>{state.jobs.length} saved runs</span></section>
        </section> : <section className="flow-view">
          <div className="flow-topbar"><button className="back-button" onClick={() => { setView("dashboard"); setPreview(null); setSelectedJobId(null); }}>← Dashboard</button><div className="flow-stepper" aria-label="Workflow progress">{["Configure", "Approve & run", "Review & apply"].map((label, index) => <div className={`flow-step ${index === stageIndex ? "active" : ""} ${index < stageIndex ? "done" : ""}`} key={label}><span>{index < stageIndex ? "✓" : index + 1}</span>{label}</div>)}</div><div className="flow-context-pill">{selectedJobWorkflow.label}</div></div>
           <div className="flow-grid"><aside className="flow-context panel"><p className="eyebrow">CURRENT SCENARIO</p><h2>{currentScenario.name}</h2><p>{currentScenario.detail}</p><div className="context-divider" /><dl><div><dt>Workflow</dt><dd>{workflow.label}</dd></div><div><dt>Contact</dt><dd>{employee?.name || "—"}</dd></div><div><dt>Provider</dt><dd>{state.runtime.provider === "fake" ? "CALL-E sandbox" : "Live CALL-E"}</dd></div></dl><button className="secondary-button context-action" onClick={() => { setView("dashboard"); setPreview(null); setSelectedJobId(null); }}>Change scenario</button></aside>
            <section className="flow-main panel">
              {activeStage === "configure" && <><div className="stage-heading"><div><p className="eyebrow">1 · CONFIGURE</p><h1>{workflow.label}</h1><p>{workflow.description}</p></div><span className="stage-badge">Not started</span></div><div className="form-grid"><label className="wide">Task template<select value={workflow.id} onChange={(event) => handleWorkflowChange(event.target.value as WorkflowType)}>{workflows.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.business}</option>)}</select></label><label>{workflow.recipientLabel}<select value={employee?.id || ""} onChange={(event) => handleEmployeeChange(event.target.value)}>{state.employees.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.business || item.role}</option>)}</select></label><label>{workflow.recordLabel}<select value={shift?.id || ""} onChange={(event) => handleShiftChange(event.target.value)}>{shifts.map((item) => <option key={item.id} value={item.id}>{formatSlot(item.date, item.startTime, item.endTime)} · {item.role}</option>)}</select></label><label>Proposed date<input type="date" value={date || shift?.date || ""} onChange={(event) => setDate(event.target.value)} /></label><label>Proposed time<input type="time" value={time || shift?.startTime || ""} onChange={(event) => setTime(event.target.value)} /></label><label className="wide">{isLiveMode ? "Provider outcome" : "Simulated call outcome"}<select value={fakeOutcome} onChange={(event) => setFakeOutcome(event.target.value as FakeOutcome)} disabled={state.runtime.provider === "live"}><option value="confirmed">Confirmed</option><option value="reschedule_requested">Requests another time</option><option value="declined">Declined</option><option value="unknown">Unknown / unclear</option><option value="failed">Provider failure</option></select><small className="field-help">{isLiveMode ? "The live result comes from CALL-E after the authorized conversation." : "Simulate every outcome without using call credits."}</small></label></div><div className="stage-actions"><button className="primary-button" onClick={handlePreview} disabled={Boolean(busy)}>Preview task →</button></div></>}

              {activeStage === "run" && preview && !selectedJob && <div className="preview-stage-view"><div className="stage-heading"><div><p className="eyebrow">2 · APPROVE & RUN</p><h1>Review before approval</h1><p>Confirm the exact instruction before creating the approval request.</p></div><span className="stage-badge safe">Preview ready</span></div><div className="exact-task"><div className="preview-top"><div><p className="eyebrow">EXACT TASK TO BE SENT</p><h2>{preview.workflow.label} · {preview.employee.name}</h2></div><span className="safe-chip">✓ Safety checks passed</span></div><p className="task-copy">{preview.task}</p><div className="preview-meta"><span>☎ {preview.employee.phone}</span><span>{preview.workflow.business}</span><span>{state.runtime.language} · {state.runtime.region}</span><span>{state.runtime.provider === "fake" ? "CALL-E sandbox" : "Live CALL-E"}</span></div><p className="preview-warning">This step only records manager intent. The call is created only after the explicit authorization control.</p></div><div className="stage-actions"><button className="secondary-button" onClick={() => setPreview(null)}>← Edit configuration</button><button className="primary-button" onClick={handleCreate} disabled={Boolean(busy)}>Request approval →</button></div></div>}

              {selectedJob && <div className="execution-view"><div className="stage-heading"><div><p className="eyebrow">{activeStage === "review" ? "3 · REVIEW & APPLY" : "2 · APPROVE & RUN"}</p><h1>{activeStage === "review" ? "Review the result" : "CALL-E execution"}</h1><p>{employeeName(selectedJob.employeeId)} · {selectedJobWorkflow.label} · {shiftLabel(selectedJob.shiftId)}</p></div><span className={`status-pill ${selectedJob.status}`}>{statusLabels[selectedJob.status]}</span></div><div className="execution-layout"><div className="execution-trace"><div className="trace-head"><div><p className="eyebrow">CALL-E EXECUTION</p><strong>{selectedJob.provider === "fake" ? "Sandbox trace" : "Live CALL-E trace"}</strong></div><span className={`trace-provider ${selectedJob.provider}`}>{selectedJob.provider === "fake" ? "SANDBOX" : "LIVE"}</span></div><div className="trace-list">{selectedJobEvents.map((event) => <div className="trace-event" key={event.id}><span className="trace-dot" /><div><strong>{traceLabels[event.type] || event.type.replaceAll("_", " ")}</strong><span>{event.message}</span></div><small>{new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></div>)}</div></div><div className="execution-action">{selectedJob.status === "awaiting_approval" && <div className="approval-box"><strong>Manager approval required</strong><p>Review the task and authorize one {selectedJob.provider === "fake" ? "simulated " : ""}call. Nothing changes automatically.</p><div className="stage-actions"><button className="primary-button" onClick={() => void doAction("approve", "approve")} disabled={Boolean(busy)}>Authorize call →</button><button className="secondary-button danger-outline" onClick={() => void doAction("cancel", "cancel")} disabled={Boolean(busy)}>Cancel</button></div></div>}{["queued", "in_progress"].includes(selectedJob.status) && <div className="progress-box"><strong>{selectedJob.status === "queued" ? "Call queued" : "Conversation in progress"}</strong><p>Refreshing status automatically.</p><div className="stage-actions"><button className="secondary-button" onClick={() => void doAction("refresh", "refresh")} disabled={Boolean(busy)}>Refresh</button>{selectedJob.provider === "fake" && <button className="secondary-button danger-outline" onClick={() => void doAction("cancel", "cancel")} disabled={Boolean(busy)}>Cancel call</button>}</div></div>}{selectedJob.status === "failed" && <div className="approval-box failure-box"><strong>Call failed safely</strong><p>{selectedJob.failureMessage || "No provider result was returned."} The scheduled item is unchanged.</p><div className="stage-actions"><button className="primary-button" onClick={() => void doAction("retry", "retry")} disabled={Boolean(busy)}>Prepare new attempt</button><button className="secondary-button" onClick={() => { setView("dashboard"); setSelectedJobId(null); setPreview(null); }}>Back to dashboard</button></div></div>}</div></div>{selectedJob.result && <div className="review-layout"><div className="result-main"><div className="result-heading"><div><p className="eyebrow">STRUCTURED RESULT</p><h2>{outcomeLabels[selectedJob.outcome || "unknown"]}</h2></div><span className={`outcome-badge ${selectedJob.outcome}`}>{Math.round(selectedJob.result.confidence * 100)}% confidence</span></div><div className="result-fields"><div><span>Outcome</span><strong>{selectedJob.result.outcome}</strong></div><div><span>Confidence</span><strong>{Math.round(selectedJob.result.confidence * 100)}%</strong></div><div><span>Alternate date</span><strong>{selectedJob.result.requested_date || "—"}</strong></div><div><span>Alternate time</span><strong>{selectedJob.result.requested_time || "—"}</strong></div></div><p className="evidence-quote">“{selectedJob.result.contact_message}”</p>{selectedJob.status === "needs_review" && <div className="stage-actions"><button className="primary-button" onClick={() => void doAction("apply", "apply")} disabled={Boolean(busy) || !["confirmed", "reschedule_requested"].includes(selectedJob.outcome || "")}>Approve & apply {selectedJobWorkflow.applyLabel}</button><button className="secondary-button danger-outline" onClick={() => void doAction("reject", "reject")} disabled={Boolean(busy)}>Reject · keep unchanged</button></div>}{selectedJob.status === "applied" && <div className="success-note">✓ Change applied with human approval.</div>}{selectedJob.status === "rejected" && <div className="muted-note">Result rejected. The scheduled item remains unchanged.</div>}</div><div className="evidence-panel"><div className="evidence-tabs"><button className={evidenceTab === "transcript" ? "active" : ""} onClick={() => setEvidenceTab("transcript")}>Transcript</button><button className={evidenceTab === "events" ? "active" : ""} onClick={() => setEvidenceTab("events")}>Audit events</button></div>{evidenceTab === "transcript" ? (selectedJob.transcript.length ? selectedJob.transcript.map((turn, index) => <div className={`transcript-turn ${turn.speaker}`} key={`${turn.speaker}-${index}`}><span>{turn.speaker}</span><p>{turn.text}</p></div>) : <p className="muted-note">No transcript until the call reaches a terminal state.</p>) : (recentEvents.length ? recentEvents.map((event) => <div className="event-row" key={event.id}><span className="event-line" /><div><strong>{traceLabels[event.type] || event.message}</strong><small>{new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></div></div>) : <p className="muted-note">No audit events yet.</p>)}</div></div>}{selectedJob.status === "applied" && <div className="completion-actions"><button className="primary-button" onClick={() => isLiveMode ? setView("dashboard") : startScenario((demoCaseIndex + 1) % demoCases.length)}>{isLiveMode ? "Back to live workspace" : "Run next demo scenario →"}</button><button className="secondary-button" onClick={() => { setView("dashboard"); setSelectedJobId(null); }}>Back to dashboard</button></div>}{["rejected", "canceled"].includes(selectedJob.status) && <div className="completion-actions"><button className="primary-button" onClick={() => { setView("dashboard"); setSelectedJobId(null); setPreview(null); }}>{isLiveMode ? "Back to live workspace" : "Back to dashboard"}</button></div>}</div>}
            </section></div>
        </section>}
      </main>
      <footer className="footer guided-footer">Sandbox by default · Real CALL-E calls are available with a server-side API key and an authorized E.164 number.</footer>
    </div>
  );
};

export default App;
