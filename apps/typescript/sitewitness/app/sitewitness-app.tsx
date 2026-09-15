"use client";
import { redactText } from "./lib/output-privacy";
/* eslint-disable jsx-a11y/label-has-associated-control, jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AdvancedReview from "./advanced-review";
type View =
  | "portfolio"
  | "operations"
  | "case"
  | "consent"
  | "preview"
  | "call"
  | "review"
  | "readiness";
type Review = "pending" | "accepted" | "edited" | "rejected" | "follow_up";
type CaseDisposition = {
  disposition: string;
  rationale: string;
  at: string;
} | null;
type FollowUpTask = {
  id: string;
  channel: "secure_form" | "human_interview";
  summary: string;
  status: string;
  created_at: string;
  assignee?: string;
  due_at?: string;
  response_token?: string;
  attempt_count?: number;
  cancel_reason?: string;
  sent_at?: string;
  viewed_at?: string;
  updated_at?: string;
};
type AuditEvent = { id: string; event_type: string; entity_id: string; detail: string; actor: string; created_at: string };
type CaseWorkflow = {
  status: string;
  assigned_role: string;
  next_action: string;
  updated_at?: string;
};
type CallReadiness = {
  provider_mode: "fake" | "calle_goal" | "calle_calls";
  provider_configured: boolean;
  live_calls_enabled: boolean;
  external_calls_created: number;
  live_call_limit: number;
  live_call_slots_remaining: number;
  safe_for_development: boolean;
  goal?: { id: string; title?: string; version?: number; contract_valid: boolean };
};
type LatestCall = { status: string; error_message?: string; updated_at?: string } | null;
type GoalPlan = { goalFamily: string; property: string; assessmentId: string; evidenceGap: string; knownRecords: string; respondentRole: string; expectedKnowledgePeriod: string; priorityBranches: string[]; completionConditions: string[]; prohibitedConclusions: string[]; escalationRoute: string };
type Statement = {
  id: string;
  fact: string;
  source: string;
  certainty: string;
  evidence: string;
  turn: number;
  status: Review;
  warning?: string;
  blocking?: boolean;
  limitations?: string[];
  revision?: number;
  origin?: "secure_form" | "human_interview" | "fake" | "calle_goal" | "calle_calls";
};
const properties = [
  {
    id: "PROP-047",
    address: "47 Baker Street",
    type: "Former garment cleaner",
    status: "Ready for interview",
    priority: "high",
  },
  {
    id: "PROP-812",
    address: "812 Fulton Avenue",
    type: "Former auto repair",
    status: "Consent pending",
    priority: "medium",
  },
  {
    id: "PROP-204",
    address: "204 Harbor Road",
    type: "Warehouse containers",
    status: "Needs respondent",
    priority: "medium",
  },
  {
    id: "PROP-019",
    address: "19 Commerce Way",
    type: "Vehicle maintenance",
    status: "Conflicting accounts",
    priority: "high",
  },
];
const transcript = [
  [
    "SiteWitness",
    "Hello, this is SiteWitness, an automated interview assistant calling for Meridian Environmental about 47 Baker Street. This call will be transcribed and reviewed by an Environmental Professional. I do not determine liability, property condition, or whether investigation is required. Is this a private and acceptable time to continue?",
  ],
  ["Morgan Lee", "Yes, that’s fine."],
  [
    "SiteWitness",
    "What was your role at the property, and during which years did you personally know it?",
  ],
  ["Morgan Lee", "I managed the building from 1991 through 1996."],
  [
    "SiteWitness",
    "What did you personally observe about Sparkle Cleaners’ operations?",
  ],
  [
    "Morgan Lee",
    "Customers dropped clothes off and picked them up. I never saw cleaning happen or saw a dry-cleaning machine in the areas I used.",
  ],
  [
    "SiteWitness",
    "Did you routinely have access to every area, including the rear storage room?",
  ],
  [
    "Morgan Lee",
    "No. I rarely went into the rear storage room, so I can’t say what was kept there.",
  ],
  [
    "SiteWitness",
    "You said it operated that way the whole time. Since your personal knowledge starts in 1991, do you have first-hand knowledge from 1987 through 1990?",
  ],
  [
    "Morgan Lee",
    "No, that was before my time. The previous manager or an archived tenant file might help.",
  ],
  [
    "SiteWitness",
    "To confirm: you personally observed drop-off and pickup from 1991 through 1994, did not observe cleaning equipment in routinely accessed areas, did not routinely access the rear storage room, and have no first-hand knowledge before 1991. Is that accurate?",
  ],
  ["Morgan Lee", "Yes, that’s accurate."],
];
const initialStatements: Statement[] = [
  {
    id: "STMT-001",
    fact: "The respondent personally knew the property from 1991 through 1996.",
    source: "Direct observation",
    certainty: "Confirmed",
    evidence: transcript[3][1],
    turn: 4,
    status: "pending",
  },
  {
    id: "STMT-002",
    fact: "From 1991 through 1994, the respondent personally observed customers dropping off and collecting garments.",
    source: "Direct observation",
    certainty: "Confirmed",
    evidence: transcript[5][1],
    turn: 6,
    status: "pending",
  },
  {
    id: "STMT-003",
    fact: "The respondent did not observe garment cleaning or dry-cleaning machines in routinely accessed areas.",
    source: "Direct observation",
    certainty: "Confirmed",
    evidence: transcript[5][1],
    turn: 6,
    status: "pending",
  },
  {
    id: "STMT-004",
    fact: "The respondent rarely accessed the rear storage room and could not describe its contents.",
    source: "Knowledge limitation",
    certainty: "Confirmed",
    evidence: transcript[7][1],
    turn: 8,
    status: "pending",
  },
  {
    id: "STMT-005",
    fact: "The respondent has no first-hand knowledge of property operations from 1987 through 1990.",
    source: "Direct observation",
    certainty: "Confirmed",
    evidence: transcript[9][1],
    turn: 10,
    status: "pending",
  },
  {
    id: "STMT-006",
    fact: "The property presents no environmental concern.",
    source: "Assumption",
    certainty: "Unsupported",
    evidence: transcript[5][1],
    turn: 6,
    status: "pending",
    warning:
      "Professional environmental conclusion is prohibited and not supported by the cited turn.",
    blocking: true,
  },
];
export default function SiteWitnessApp() {
  const [view, setView] = useState<View>("portfolio"),
    [consent, setConsent] = useState(false),
    [transcription, setTranscription] = useState(false),
    [channel, setChannel] = useState("automated_callback"),
    [confirmed, setConfirmed] = useState(false),
    [launched, setLaunched] = useState(false),
    [phase, setPhase] = useState(0),
    [statements, setStatements] = useState(initialStatements),
    [selected, setSelected] = useState("STMT-001"),
    [notice, setNotice] = useState(""),
    [role, setRole] = useState("reviewer"),
    [caseDisposition, setCaseDisposition] = useState<CaseDisposition>(null),
    [followUpTasks, setFollowUpTasks] = useState<FollowUpTask[]>([]);
  const [goalPlan, setGoalPlan] = useState<GoalPlan | null>(null);
  const [callRunId, setCallRunId] = useState<string | null>(null);
  // undefined permits initial restoration; null means a new submission owns the UI.
  const activeCall = useRef<string | null | undefined>(undefined);
  const callGeneration = useRef(0);
  const [authorizationVersion, setAuthorizationVersion] = useState(1);
  const [livePhone, setLivePhone] = useState("");
  const [liveConfirmation, setLiveConfirmation] = useState("");
  const [liveStatus, setLiveStatus] = useState("READY");
  const [lastStatusCheck, setLastStatusCheck] = useState<string | null>(null);
  const [statusCheckError, setStatusCheckError] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState("");
  const [latestCall, setLatestCall] = useState<LatestCall>(null);
  const [latestTranscript, setLatestTranscript] = useState<string[][]>([]);
  const [workflow, setWorkflow] = useState<CaseWorkflow>({
    status: "NEEDS_OUTREACH",
    assigned_role: "coordinator",
    next_action: "Select an interview channel and prepare outreach.",
  });
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [callReadiness, setCallReadiness] = useState<CallReadiness>({
    provider_mode: "fake",
    provider_configured: true,
    live_calls_enabled: false,
    external_calls_created: 0,
    live_call_limit: 20,
    live_call_slots_remaining: 20,
    safe_for_development: true,
  });
  useEffect(() => {
    if (callReadiness.provider_mode !== "fake" || !launched || phase >= 3) return;
    const t = setTimeout(() => setPhase((p) => p + 1), 900);
    return () => clearTimeout(t);
  }, [launched, phase, callReadiness.provider_mode]);
  const refreshWorkflow = useCallback(async () => {
    const generation = callGeneration.current;
    try {
      const response = await fetch("/api/workflow", { cache: "no-store" });
      const data = (await response.json()) as {
          dispositions?: Array<{
            disposition: string;
            rationale: string;
            created_at: string;
          }>;
          tasks?: FollowUpTask[];
          workflow?: CaseWorkflow;
          ingested_statements?: Array<{
            id: string; origin: "secure_form" | "human_interview" | "fake" | "calle_goal" | "calle_calls"; fact: string; source: string; certainty: string;
            evidence: string; limitations: string;
          }>;
          audit?: AuditEvent[];
          latest_call?: { id: number; status: string; terminal: boolean; goal_error?: string; updated_at?: string } | null;
          latest_transcript?: Array<{ speaker: string; text: string }>;
      };
      if (generation !== callGeneration.current || activeCall.current === null) return;
      if (activeCall.current !== undefined && String(data.latest_call?.id) !== activeCall.current) return;
      const latest = data.dispositions?.[0];
      setCaseDisposition(latest ? { disposition: latest.disposition, rationale: latest.rationale, at: new Date(latest.created_at).toLocaleString() } : null);
      setFollowUpTasks(data.tasks || []);
      if (data.workflow) setWorkflow(data.workflow);
      setAudit(data.audit || []);
      if (data.latest_call) {
        let errorMessage = "";
        try {
          const parsed = JSON.parse(data.latest_call.goal_error || "{}") as { message?: string };
          errorMessage = parsed.message || "";
        } catch { errorMessage = ""; }
        setLatestCall({ status: data.latest_call.status, error_message: errorMessage, updated_at: data.latest_call.updated_at });
        if (callReadiness.provider_mode !== "fake") {
          activeCall.current = String(data.latest_call.id);
          setCallRunId(String(data.latest_call.id));
          setLaunched(true);
          setLiveStatus(data.latest_call.status);
          setPhase(data.latest_call.terminal ? 3 : 0);
          setLastStatusCheck(data.latest_call.updated_at || null);
        }
      }
      setLatestTranscript((data.latest_transcript || []).map((turn) => [turn.speaker, turn.text]));
      const ingested = (data.ingested_statements || []).map((item) => ({ ...item, turn: 0, status: "pending" as Review, limitations: item.limitations ? [item.limitations] : [] }));
      setStatements((current) => {
        if (callReadiness.provider_mode !== "fake")
          return ingested.filter((statement) => statement.origin === "calle_goal" || statement.origin === "calle_calls");
        return ingested.length
          ? [...current.filter((statement) => statement.blocking), ...ingested.filter((statement) => statement.origin !== "calle_goal" && statement.origin !== "calle_calls")]
          : current.filter((statement) => !statement.origin);
      });
    } catch { /* Keep the current visible state if refresh is temporarily unavailable. */ }
  }, [callReadiness.provider_mode]);
  useEffect(() => {
    if (callReadiness.provider_mode !== "fake" || phase !== 2 || !callRunId) return;
    fetch("/api/calle", { method: "POST", headers: { "content-type": "application/json", "x-demo-role": "coordinator" }, body: JSON.stringify({ action: "poll", run_id: callRunId }) })
      .then((response) => response.json())
      .then(() => refreshWorkflow())
      .catch(() => setNotice("The simulated run completed, but its result could not be ingested."));
  }, [phase, callRunId, refreshWorkflow, callReadiness.provider_mode]);
  useEffect(() => {
    if (callReadiness.provider_mode === "fake" || !launched || !callRunId || phase === 3) return;
    let stopped = false;
    const generation = callGeneration.current;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch("/api/calle", { method: "POST", signal: AbortSignal.timeout(20_000), headers: { "content-type": "application/json", "x-demo-role": "coordinator" }, body: JSON.stringify({ action: "poll", run_id: callRunId }) });
        const data = await response.json() as { status?: string; terminal?: boolean; error?: { message?: string } };
        if (stopped || generation !== callGeneration.current || activeCall.current !== callRunId) return;
        if (!response.ok) { setStatusCheckError(true); timer = window.setTimeout(poll, 5_000); return; }
        setStatusCheckError(false);
        setLastStatusCheck(new Date().toISOString());
        setLiveStatus(data.status || "IN PROGRESS");
        if (data.terminal) { setPhase(3); await refreshWorkflow(); return; }
        timer = window.setTimeout(poll, 5_000);
      } catch { if (!stopped && generation === callGeneration.current && activeCall.current === callRunId) { setStatusCheckError(true); timer = window.setTimeout(poll, 5_000); } }
    };
    void poll();
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [callReadiness.provider_mode, launched, callRunId, phase, refreshWorkflow]);
  useEffect(() => {
    const timer = window.setTimeout(() => void refreshWorkflow(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshWorkflow]);
  useEffect(() => {
    fetch("/api/calle", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: CallReadiness) => setCallReadiness(data))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    const refreshOnReturn = () => void refreshWorkflow();
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void refreshWorkflow(); };
    window.addEventListener("pageshow", refreshOnReturn);
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => { window.removeEventListener("pageshow", refreshOnReturn); window.removeEventListener("focus", refreshOnReturn); document.removeEventListener("visibilitychange", refreshWhenVisible); };
  }, [refreshWorkflow]);
  useEffect(() => {
    if (callReadiness.provider_mode !== "fake" || phase !== 3 || workflow.status === "AWAITING_EP_REVIEW") return;
    fetch("/api/workflow", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-role": "coordinator" },
      body: JSON.stringify({ action: "complete_fake_interview" }),
    })
      .then((response) => response.json())
      .then((data: CaseWorkflow) => setWorkflow(data))
      .catch(() => setNotice("Interview completed, but the workflow handoff could not be saved."));
  }, [phase, workflow.status, callReadiness.provider_mode]);
  const reviewStatements = useMemo(
    () => callReadiness.provider_mode !== "fake"
      ? statements.filter((statement) => statement.origin === "calle_goal" || statement.origin === "calle_calls")
      : statements.filter((statement) => statement.origin !== "calle_goal" && statement.origin !== "calle_calls"),
    [callReadiness.provider_mode, statements],
  );
  const reviewTranscript = useMemo(
    () => callReadiness.provider_mode !== "fake"
      ? latestTranscript.length > 0 ? latestTranscript : reviewStatements
          .filter((statement) => statement.evidence.trim().length > 0)
          .map((statement) => ["CALL-E supporting quote", statement.evidence])
      : transcript,
    [callReadiness.provider_mode, latestTranscript, reviewStatements],
  );
  const counts = useMemo(
    () => ({
      accepted: reviewStatements.filter(
        (s) => s.status === "accepted" || s.status === "edited",
      ).length,
      pending: reviewStatements.filter((s) => s.status === "pending").length,
    }),
    [reviewStatements],
  );
  const go = (v: View) => {
    setView(v);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const switchRole = async (nextRole: string) => {
    await refreshWorkflow();
    setRole(nextRole);
    setNotice(
      nextRole === "coordinator"
        ? "Coordinator workspace active. You can manage outreach and follow-up; evidence decisions remain read-only."
        : "EP Reviewer workspace active. You can review evidence and save dispositions; outreach administration is read-only.",
    );
    go(nextRole === "coordinator" ? "operations" : "portfolio");
  };
  const operateTask = async (id: string, action: string, extra: Record<string, unknown> = {}) => {
    const response = await fetch("/api/workflow", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-role": role },
      body: JSON.stringify({ action, task_id: id, ...extra }),
    });
    const data = (await response.json()) as { error?: { message: string }; task?: FollowUpTask };
    if (!response.ok) {
      setNotice(data.error?.message || "The follow-up task could not be updated.");
      return;
    }
    if (data.task) setFollowUpTasks((items) => items.map((task) => task.id === id ? { ...task, ...data.task } : task));
    setNotice("Coordinator action saved and added to the case timeline.");
    fetch("/api/workflow").then((result) => result.json()).then((fresh: { audit?: AuditEvent[]; workflow?: CaseWorkflow }) => { setAudit(fresh.audit || []); if (fresh.workflow) setWorkflow(fresh.workflow); }).catch(() => undefined);
  };
  const launch = async () => {
    if (launching) return;
    if (
      !consent ||
      !transcription ||
      channel !== "automated_callback" ||
      !confirmed
    ) {
      setNotice(
        "Launch blocked: active automated-call consent, transcription permission, and a confirmed preview are required.",
      );
      return;
    }
    const live = callReadiness.provider_mode !== "fake";
    if (live && (!callReadiness.live_calls_enabled || callReadiness.live_call_slots_remaining < 1)) { setNotice("Live calling is disabled or the 20-call allowance has been used."); return; }
    if (live && (!/^\+[1-9]\d{7,14}$/.test(livePhone) || liveConfirmation !== "PLACE LIVE CALL")) { setNotice("Enter the authorized E.164 number and type PLACE LIVE CALL exactly."); return; }
    if (!goalPlan) { setNotice("Prepare and review the site-specific Goal plan first."); return; }
    setNotice("");
    setLaunchError("");
    setLaunching(true);
    callGeneration.current += 1;
    activeCall.current = null;
    setLaunched(false);
    setCallRunId(null);
    setLatestCall(null);
    setLatestTranscript([]);
    setLastStatusCheck(null);
    setStatusCheckError(false);
    setLiveStatus("SUBMITTING");
    setPhase(0);
    go("call");
    try {
    const callPayload = {
      interview_id: "INT-047-BAKER",
      authorization_version: authorizationVersion,
      phone: live ? livePhone : "+15550123456",
      site_key: "dry_cleaner",
      selected_channel: channel,
      automated_call_allowed: consent,
      transcription_allowed: transcription,
      preview_confirmed: confirmed,
      live_confirmation: live ? liveConfirmation : undefined,
    };
    const launchResponse = await fetch("/api/calle", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-role": role },
      body: JSON.stringify({ action: "launch", ...callPayload }),
    });
    if (!launchResponse.ok) {
      const data = await launchResponse.json() as { error?: { message?: string } };
      setLaunching(false);
      setLaunchError(data.error?.message || "The call launch was blocked.");
      setLiveStatus("SUBMISSION UNCONFIRMED");
      setNotice(data.error?.message || "The call launch was blocked.");
      fetch("/api/calle", { cache: "no-store" }).then((result) => result.json()).then((fresh: CallReadiness) => setCallReadiness(fresh)).catch(() => undefined);
      return;
    }
    const launchedGoal = await launchResponse.json() as { run_id?: string | number; status?: string };
    if (!launchedGoal.run_id) throw new Error("Call submission returned no tracking identifier.");
    activeCall.current = String(launchedGoal.run_id);
    setCallRunId(String(launchedGoal.run_id || ""));
    setLaunched(true);
    setLiveStatus(launchedGoal.status || "QUEUED");
    const response = await fetch("/api/workflow", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-role": role },
      body: JSON.stringify({ action: live ? "start_interview" : "start_fake_interview" }),
    });
    if (!response.ok) {
      setLaunching(false);
      setNotice("Coordinator permission is required to start interview operations.");
      return;
    }
    setWorkflow((current) => ({ ...current, status: "INTERVIEW_IN_PROGRESS", assigned_role: "coordinator", next_action: "Monitor the interview through completion." }));
    setLaunched(true);
    setLaunching(false);
    if (!live) setLiveStatus("READY");
    go("call");
    } catch {
      setLiveStatus("SUBMISSION UNCONFIRMED");
      setNotice("The server response was interrupted. Call submission is unconfirmed; check the existing attempt before starting another call.");
    } finally {
      setLaunching(false);
    }
  };
  const prepareGoalPreview = async () => {
    setConfirmed(false); setNotice("");
    const response = await fetch("/api/calle", { method: "POST", headers: { "content-type": "application/json", "x-demo-role": role }, body: JSON.stringify({ action: "prepare", interview_id: "INT-047-BAKER", authorization_version: authorizationVersion, site_key: "dry_cleaner", selected_channel: channel, automated_call_allowed: consent, transcription_allowed: transcription }) });
    const data = await response.json() as { plan?: GoalPlan; authorization_version?: number; error?: { message?: string } };
    if (!response.ok || !data.plan) { setNotice(data.error?.message || "The site-specific Goal plan could not be prepared."); return; }
    if (data.authorization_version) setAuthorizationVersion(data.authorization_version);
    setGoalPlan(data.plan); go("preview");
  };
  const reset = async () => {
    await fetch("/api/workflow", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-demo-role": "demo_admin",
      },
      body: JSON.stringify({ action: "reset" }),
    }).catch(() => undefined);
    setConsent(false);
    setTranscription(false);
    setConfirmed(false);
    setLaunched(false);
    setGoalPlan(null);
    setCallRunId(null);
    setAuthorizationVersion(1);
    setPhase(0);
    setStatements(initialStatements);
    setCaseDisposition(null);
    setFollowUpTasks([]);
    setWorkflow({ status: "NEEDS_OUTREACH", assigned_role: "coordinator", next_action: "Select an interview channel and prepare outreach." });
    setNotice("Demo data reset. No external calls were placed.");
    go("portfolio");
  };
  return (
    <div className="appShell">
      <header className="appTop">
        <button className="brand buttonReset" onClick={() => go("portfolio")}>
          <span className="brandMark">SW</span>
          <span>SiteWitness</span>
        </button>
        <nav aria-label="Primary">
          {role === "coordinator" && (
            <button onClick={() => go("operations")} className={view === "operations" ? "active" : ""}>
              Work queue <b>{workflow.assigned_role === "coordinator" ? 1 : 0}</b>
            </button>
          )}
          <button onClick={() => go("portfolio")} className={view === "portfolio" ? "active" : ""}>
            {role === "coordinator" ? "Cases" : "Portfolio"}
          </button>
          <button onClick={() => go("case")}>Evidence gaps</button>
          <button onClick={() => go("review")} disabled={role === "reviewer" && workflow.assigned_role !== "reviewer"}>
            Review <b>{workflow.assigned_role === "reviewer" ? 1 : 0}</b>
          </button>
        </nav>
        <div className="headerTools">
          <span className="safeBadge">Synthetic data</span>
          <select
            aria-label="Demo role"
            value={role}
            onChange={(e) => void switchRole(e.target.value)}
          >
            <option value="reviewer">EP Reviewer</option>
            <option value="coordinator">Coordinator</option>
          </select>
          <button
            className="avatar buttonReset"
            onClick={() => go("readiness")}
          >
            EP
          </button>
        </div>
      </header>
      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice("")}>Dismiss</button>
        </div>
      )}
      <div className={`roleBanner ${role}`}>
        <strong>{role === "coordinator" ? "Coordinator" : "EP Reviewer"}</strong>
        <span>
          {role === "coordinator"
            ? "Manage channels, assignments, deadlines, and completion. Evidence decisions are read-only."
            : "Review evidence and make human dispositions. Outreach setup and task administration are read-only."}
        </span>
      </div>
      {view === "operations" && (
        <OperationsQueue tasks={followUpTasks} workflow={workflow} go={go} onOperateTask={operateTask} />
      )}{" "}
      {view === "portfolio" && (
        <Portfolio go={go} caseDisposition={caseDisposition} role={role} workflow={workflow} />
      )}{" "}
      {view === "case" && (
        <Case
          go={go}
          caseDisposition={caseDisposition}
          followUpTasks={followUpTasks}
          role={role}
          workflow={workflow}
          audit={audit}
        />
      )}{" "}
      {view === "consent" && (
        <Consent
          channel={channel}
          setChannel={setChannel}
          consent={consent}
          setConsent={setConsent}
          transcription={transcription}
          setTranscription={setTranscription}
          go={go}
          onTaskCreated={(task) =>
            setFollowUpTasks((items) => [task, ...items])
          }
          role={role}
          onWorkflowChanged={setWorkflow}
          preparePreview={prepareGoalPreview}
        />
      )}{" "}
      {view === "preview" && (
        <Preview
          confirmed={confirmed}
          setConfirmed={setConfirmed}
          launch={launch}
          go={go}
          plan={goalPlan}
          providerMode={callReadiness.provider_mode}
          readiness={callReadiness}
          livePhone={livePhone}
          setLivePhone={setLivePhone}
          liveConfirmation={liveConfirmation}
          setLiveConfirmation={setLiveConfirmation}
          launching={launching}
          launchError={launchError}
        />
      )}{" "}
      {view === "call" && <Call phase={phase} go={go} providerMode={callReadiness.provider_mode} liveStatus={liveStatus} lastStatusCheck={lastStatusCheck} statusCheckError={statusCheckError} />}{" "}
      {view === "review" && (
        <AdvancedReview
          statements={reviewStatements}
          setStatements={setStatements}
          transcript={reviewTranscript}
          transcriptLabel={callReadiness.provider_mode !== "fake" ? `${reviewTranscript.length} transcript turn${reviewTranscript.length === 1 ? "" : "s"} · CALL-E Calls API` : "12 turns · Fake fixture"}
          transcriptEmptyMessage={callReadiness.provider_mode !== "fake"
            ? `CALL-E completed the phone session, but ${latestCall?.error_message || "the call did not return usable structured evidence or transcript turns"}. Synthetic fixture content is intentionally hidden.`
            : "No transcript turns are available."}
          providerMode={callReadiness.provider_mode}
          selected={selected}
          setSelected={setSelected}
          role={role}
          counts={counts}
          onDispositionSaved={setCaseDisposition}
          onWorkflowChanged={setWorkflow}
          workflow={workflow}
        />
      )}{" "}
      {view === "readiness" && (
        <Readiness
          consent={consent}
          confirmed={confirmed}
          callReadiness={callReadiness}
          reset={reset}
        />
      )}
    </div>
  );
}
function dispositionLabel(value?: string) {
  return (
    {
      PARTIALLY_RESOLVED: "Partially resolved",
      REMAINS_UNRESOLVED: "Remains unresolved",
      HUMAN_INTERVIEW_REQUIRED: "Human interview required",
      ADDITIONAL_RECORD_REQUIRED: "Additional record required",
      RESOLVED_BY_REVIEWER: "Resolved by reviewer",
    } as Record<string, string>
  )[value || ""];
}
function OperationsQueue({
  tasks,
  workflow,
  go,
  onOperateTask,
}: {
  tasks: FollowUpTask[];
  workflow: CaseWorkflow;
  go: (v: View) => void;
  onOperateTask: (id: string, action: string, extra?: Record<string, unknown>) => void;
}) {
  const openTasks = tasks.filter((task) => !["SUBMITTED", "CANCELLED", "DECLINED", "EXPIRED"].includes(task.status));
  const assignedHere = workflow.assigned_role === "coordinator";
  return (
    <main className="page operationsPage">
      <div className="sectionHead">
        <div>
          <p className="eyebrow">COORDINATOR WORKSPACE</p>
          <h1 className="pageTitle">Outreach & follow-up queue</h1>
          <p className="intro">Operational work is separated from professional evidence judgment.</p>
        </div>
        <button className="primary inline" onClick={() => go("consent")}>Create follow-up <span>→</span></button>
      </div>
      <section className={`currentAssignment ${assignedHere ? "actionable" : "waiting"}`}>
        <div><span>Current case state</span><strong>{workflow.status.replaceAll("_", " ")}</strong></div>
        <p>{workflow.next_action}</p>
        <b>{assignedHere ? "Action required from Coordinator" : "Handed off to EP Reviewer"}</b>
      </section>
      <section className="workflowStrip" aria-label="Case lifecycle">
        {[
          ["1", "Evidence gap", "COMPLETE"],
          ["2", "Response received", "COMPLETE"],
          ["3", "EP review", "COMPLETE"],
          ["4", "Follow-up", openTasks.length ? "ACTIVE" : "NEEDS SETUP"],
          ["5", "Resolved", "PENDING"],
        ].map(([number, label, state]) => (
          <div className={state === "ACTIVE" ? "active" : ""} key={label}>
            <span>{number}</span><strong>{label}</strong><small>{state}</small>
          </div>
        ))}
      </section>
      <section className="queuePanel">
        <div className="queuePanelHead">
          <div><p className="panelLabel">47 BAKER STREET</p><h2>Remaining operational work</h2></div>
          <button className="secondary" onClick={() => go("case")}>View case</button>
        </div>
        {!assignedHere ? (
          <div className="emptyQueue"><strong>No Coordinator action is due</strong><p>This case has moved to the EP review queue. It will return here only if the reviewer requests further follow-up.</p></div>
        ) : tasks.length === 0 ? (
          <div className="emptyQueue"><strong>No follow-up assigned</strong><p>Create a secure written request or human interview task to advance this partially resolved case.</p></div>
        ) : (
          <div className="taskTable">
            {tasks.map((task) => (
              <article className={task.due_at && new Date(task.due_at) < new Date() && !["SUBMITTED", "CANCELLED", "DECLINED"].includes(task.status) ? "overdueTask" : ""} key={task.id}>
                <div className="taskChannel"><span>{task.channel === "secure_form" ? "FORM" : "HUMAN"}</span><strong>{task.channel === "secure_form" ? "Secure written response" : "Human interview"}</strong></div>
                <p>{task.summary}</p>
                <div><span>Owner</span><strong>{task.assignee || "Case coordinator"}</strong></div>
                <div><span>Due</span><strong>{task.due_at ? new Date(task.due_at).toLocaleString() : "Not set"}</strong></div>
                <div className="taskState"><span>{["SENT", "VIEWED"].includes(task.status) ? "Awaiting respondent" : "Coordinator state"}</span><strong>{task.status.replace("_", " ")}</strong>{task.cancel_reason && <small>{task.cancel_reason}</small>}</div>
                <div className="taskControls">
                  {task.channel === "secure_form" && task.status === "READY" && <button onClick={() => onOperateTask(task.id, "send_request")}>Simulate send</button>}
                  {task.response_token && ["SENT", "VIEWED", "IN_PROGRESS"].includes(task.status) && <button onClick={() => { window.location.href = `/respond/${task.response_token}`; }}>Open form</button>}
                  {task.channel === "human_interview" && ["SCHEDULED", "IN_PROGRESS"].includes(task.status) && <button onClick={() => { window.location.href = `/human-interview/${task.id}`; }}>Open workspace</button>}
                  {! ["SUBMITTED", "CANCELLED", "DECLINED", "EXPIRED"].includes(task.status) && <button onClick={() => onOperateTask(task.id, "record_attempt")}>Record attempt ({task.attempt_count || 0})</button>}
                  {! ["SUBMITTED", "CANCELLED", "DECLINED", "EXPIRED"].includes(task.status) && <button onClick={() => { const due_at = window.prompt("New due date and time (YYYY-MM-DDTHH:mm)", task.due_at?.slice(0, 16)); if (due_at) onOperateTask(task.id, "extend_due", { due_at }); }}>Extend</button>}
                  {! ["SUBMITTED", "CANCELLED", "DECLINED", "EXPIRED"].includes(task.status) && <button onClick={() => { const assignee_name = window.prompt("Assign to", task.assignee); if (assignee_name) onOperateTask(task.id, "reassign_request", { assignee_name }); }}>Reassign</button>}
                  {! ["SUBMITTED", "CANCELLED", "DECLINED", "EXPIRED"].includes(task.status) && <button onClick={() => { const reason = window.prompt("Cancellation reason"); if (reason) onOperateTask(task.id, "cancel_request", { reason }); }}>Cancel</button>}
                  {["CANCELLED", "DECLINED", "EXPIRED"].includes(task.status) && <button onClick={() => onOperateTask(task.id, "reopen_request")}>Reopen</button>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <aside className="decisionBoundary"><strong>Requires EP Reviewer</strong><span>Completing operational follow-up does not resolve the evidence gap. The new response must return to EP review for a final disposition.</span><button onClick={() => go("review")}>View evidence read-only</button></aside>
    </main>
  );
}
function Portfolio({
  go,
  caseDisposition,
  role,
  workflow,
}: {
  go: (v: View) => void;
  caseDisposition: CaseDisposition;
  role: string;
  workflow: CaseWorkflow;
}) {
  const [filter, setFilter] = useState<"open" | "resolved">("open");
  const fullyResolved = caseDisposition?.disposition === "RESOLVED_BY_REVIEWER";
  const visibleProperties = properties.filter((_, index) =>
    role === "reviewer"
      ? index === 0 && workflow.assigned_role === "reviewer" && filter === "open"
      : filter === "resolved"
      ? index === 0 && fullyResolved
      : index !== 0 || !fullyResolved,
  );
  const openCount = properties.length - (fullyResolved ? 1 : 0);
  return (
    <main>
      <section className="hero">
        <div>
          <p className="eyebrow">DEMO INDUSTRIAL PORTFOLIO</p>
          <h1>
            Close the evidence gap.
            <br />
            <em>Keep the judgment human.</em>
          </h1>
          <p className="lede">
            Consent-first factual interviews that turn ambiguous records into
            reviewable, transcript-linked evidence.
          </p>
        </div>
        <div className="metrics">
          <div>
            <strong>4</strong>
            <span>Properties</span>
          </div>
          <div>
            <strong>{openCount}</strong>
            <span>Open gaps</span>
          </div>
          <div>
            <strong>1</strong>
            <span>Ready to call</span>
          </div>
        </div>
      </section>
      <section className="content">
        <div className="sectionHead">
          <div>
            <p className="eyebrow">{role === "reviewer" ? "EP REVIEW WORK" : filter === "open" ? "ACTIVE CASES" : "REVIEWED CASES"}</p>
            <h2>
              {role === "reviewer"
                ? "Evidence awaiting your review"
                : filter === "open"
                ? "Evidence gap queue"
                : "Resolved evidence gaps"}
            </h2>
          </div>
          <div className="queueTools">
            {role === "coordinator" && <div className="queueFilters">
              <button
                className={filter === "open" ? "selected" : ""}
                onClick={() => setFilter("open")}
              >
                Open <b>{openCount}</b>
              </button>
              <button
                className={filter === "resolved" ? "selected" : ""}
                onClick={() => setFilter("resolved")}
              >
                Resolved <b>{fullyResolved ? 1 : 0}</b>
              </button>
            </div>}
            <button className="secondary" onClick={() => go("readiness")}>
              Demo readiness
            </button>
          </div>
        </div>
        <div className="caseGrid">
          {visibleProperties.map((p) => {
            const index = properties.findIndex((item) => item.id === p.id);
            const currentStatus =
              index === 0 && caseDisposition
                ? dispositionLabel(caseDisposition.disposition)
                : p.status;
            return (
              <article
                className={`caseCard ${index === 0 ? "featured" : ""} ${fullyResolved && index === 0 ? "resolvedCard" : ""}`}
                key={p.id}
              >
                <div className="caseTop">
                  <span className="caseNo">0{index + 1}</span>
                  <span className="priority">{p.priority}</span>
                </div>
                <h3>{p.address}</h3>
                <p>{p.type}</p>
                <div className="rule" />
                <span className="status">{currentStatus}</span>
                {index === 0 && caseDisposition && (
                  <small className="remainingWork">
                    {caseDisposition.disposition === "PARTIALLY_RESOLVED"
                      ? "Remaining: 1987–1990 and rear storage room"
                      : caseDisposition.rationale}
                  </small>
                )}
                <button
                  className={index === 0 ? "primary" : "textButton"}
                  onClick={() => go(index === 0 ? "case" : "portfolio")}
                >
                  {index === 0 ? "Review evidence gap" : "View case"}
                  <span>→</span>
                </button>
              </article>
            );
          })}
          {visibleProperties.length === 0 && (
            <div className="emptyQueue">
              <strong>{role === "reviewer" ? "No evidence is awaiting EP review" : "No resolved evidence gaps yet"}</strong>
              <p>{role === "reviewer" ? "47 Baker Street is currently with the Coordinator. Cases appear here automatically when interview or follow-up evidence is ready for professional review." : "Cases marked “Resolved by reviewer” will appear here."}</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
function Case({
  go,
  caseDisposition,
  followUpTasks,
  role,
  workflow,
  audit,
}: {
  go: (v: View) => void;
  caseDisposition: CaseDisposition;
  followUpTasks: FollowUpTask[];
  role: string;
  workflow: CaseWorkflow;
  audit: AuditEvent[];
}) {
  return (
    <main className="page">
      <div className="crumb">
        <button onClick={() => go("portfolio")}>Portfolio</button>
        <span>/</span>
        <span>47 Baker Street</span>
      </div>
      <section className="caseHero">
        <div>
          <p className="eyebrow">PROP-047 · OPEN EVIDENCE GAP</p>
          <h1>
            Was garment cleaning performed on site, or were garments only
            collected?
          </h1>
          <p>
            Existing evidence does not establish the basis, period, or limits of
            the owner’s answer.
          </p>
        </div>
        <div className="gapBadge">
          High priority
          <br />
          <small>Workflow priority only</small>
        </div>
      </section>
      <section className="caseStateBar">
        <div><span>Workflow state</span><strong>{workflow.status.replaceAll("_", " ")}</strong></div>
        <div><span>Assigned to</span><strong>{workflow.assigned_role === "reviewer" ? "EP Reviewer" : workflow.assigned_role === "coordinator" ? "Coordinator" : "Complete"}</strong></div>
        <p>{workflow.next_action}</p>
      </section>
      {caseDisposition && (
        <section className="caseDispositionBanner">
          <span>Current human disposition</span>
          <strong>{dispositionLabel(caseDisposition.disposition)}</strong>
          <p>{caseDisposition.rationale}</p>
          <small>
            Saved {caseDisposition.at}. This is a factual workflow status, not
            an environmental conclusion.
          </small>
        </section>
      )}
      {caseDisposition &&
        caseDisposition.disposition !== "RESOLVED_BY_REVIEWER" && (
          <section className="followUpPanel">
            <div className="followUpIntro">
              <p className="panelLabel">REMAINING FOLLOW-UP</p>
              <h2>What still needs to be resolved</h2>
              <p>
                The interview narrowed the evidence gap, but it did not answer
                every factual question.
              </p>
            </div>
            <div className="followUpItems">
              <article>
                <span>01</span>
                <div>
                  <strong>Operations before 1991</strong>
                  <p>
                    Morgan’s first-hand knowledge begins in 1991. Seek the
                    previous manager or archived tenant file.
                  </p>
                </div>
              </article>
              <article>
                <span>02</span>
                <div>
                  <strong>Rear storage room</strong>
                  <p>
                    Morgan rarely entered this area. Obtain records or interview
                    someone with direct access.
                  </p>
                </div>
              </article>
            </div>
            <div className="followUpActions">
              <button disabled={role !== "coordinator"} onClick={() => go("consent")}>
                Request secure written response
              </button>
              <button disabled={role !== "coordinator"} onClick={() => go("consent")}>
                Create human interview task
              </button>
            </div>
            {role !== "coordinator" && (
              <p className="permissionNote">Switch to Coordinator to administer follow-up channels and assignments.</p>
            )}
            {followUpTasks.length > 0 && (
              <div className="activeTasks">
                <strong>Active follow-up</strong>
                {followUpTasks.map((task) => (
                  <div key={task.id}>
                    <span>
                      {task.channel === "secure_form"
                        ? "Written response"
                        : "Human interview"}
                    </span>
                    <p>{task.summary}</p>
                    <b>{task.status}</b>
                    {task.assignee && <small>Owner: {task.assignee}</small>}
                    {task.due_at && <small>Due: {new Date(task.due_at).toLocaleString()}</small>}
                    {task.response_token && ["SENT", "VIEWED", "IN_PROGRESS"].includes(task.status) && (
                      <button className="openResponseButton" onClick={() => { window.location.href = `/respond/${task.response_token}`; }}>
                        Open synthetic respondent form <span>→</span>
                      </button>
                    )}
                    {task.channel === "human_interview" && ["SCHEDULED", "IN_PROGRESS"].includes(task.status) && (
                      <button className="openResponseButton" onClick={() => { window.location.href = `/human-interview/${task.id}`; }}>
                        Open interview workspace <span>→</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      <div className="twoCol">
        <section className="panel">
          <p className="panelLabel">HISTORICAL RECORD</p>
          <div className="timeline">
            <span>1987</span>
            <div />
            <span>1994</span>
          </div>
          <h3>Sparkle Cleaners</h3>
          <p>
            Synthetic city directories list a garment cleaner at this address
            from 1987 through 1994.
          </p>
          <blockquote>
            “I believe it was only a drop shop.”<cite>Owner questionnaire</cite>
          </blockquote>
          <div className="unknownGrid">
            <span>
              Basis of answer<strong>Unknown</strong>
            </span>
            <span>
              On-site equipment<strong>Unknown</strong>
            </span>
            <span>
              Rear room access<strong>Unknown</strong>
            </span>
          </div>
        </section>
        <aside className="panel respondent">
          <p className="panelLabel">SUGGESTED RESPONDENT</p>
          <div className="personIcon">ML</div>
          <h2>Morgan Lee</h2>
          <p>Former property manager</p>
          <dl>
            <div>
              <dt>Knowledge period</dt>
              <dd>1991–1996</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>+1 ••• ••• 1010</dd>
            </div>
            <div>
              <dt>Current channel</dt>
              <dd>Not selected</dd>
            </div>
          </dl>
          <button className="primary" disabled={role !== "coordinator"} onClick={() => go("consent")}>
            {caseDisposition
              ? "Add follow-up channel"
              : "Set interview channel"}{" "}
            <span>→</span>
          </button>
          <small className="boundary">
            SiteWitness selects respondents for relevant knowledge—not job title
            alone.
          </small>
        </aside>
      </div>
      <section className="caseTimeline">
        <div className="sectionHead"><div><p className="panelLabel">AUDIT HISTORY</p><h2>Case activity timeline</h2></div><button className="secondary" onClick={() => {
          const blob = new Blob([redactText(JSON.stringify({ schema_version: "sitewitness.case.v1", exported_at: new Date().toISOString(), property: { id: "PROP-047", address: "47 Baker Street", evidence_gap_id: "GAP-DRY-001" }, workflow, tasks: followUpTasks, audit }, null, 2))], { type: "application/json" });
          const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "sitewitness-47-baker-integration.json"; anchor.click(); URL.revokeObjectURL(url);
        }}>Export integration JSON</button></div>
        {audit.length === 0 ? <p>No recorded activity yet.</p> : audit.map((event) => (
          <article key={event.id}><span>{new Date(event.created_at).toLocaleString()}</span><div><strong>{event.event_type.replaceAll("_", " ")}</strong><p>{event.actor}</p></div></article>
        ))}
      </section>
    </main>
  );
}
function Consent(p: {
  channel: string;
  setChannel: (x: string) => void;
  consent: boolean;
  setConsent: (x: boolean) => void;
  transcription: boolean;
  setTranscription: (x: boolean) => void;
  go: (v: View) => void;
  onTaskCreated: (task: FollowUpTask) => void;
  role: string;
  onWorkflowChanged: (workflow: CaseWorkflow) => void;
  preparePreview: () => void;
}) {
  const [writtenQuestion, setWrittenQuestion] = useState(
    "Please clarify whether you have any records or first-hand knowledge concerning operations before 1991 or use of the rear storage room.",
  );
  const [writtenDue, setWrittenDue] = useState("2026-08-25");
  const [interviewer, setInterviewer] = useState(
    "Jordan Patel, Environmental Professional",
  );
  const [schedule, setSchedule] = useState("2026-08-26T10:00");
  const [taskMessage, setTaskMessage] = useState("");
  const [responseToken, setResponseToken] = useState("");
  const [humanTaskId, setHumanTaskId] = useState("");
  const createTask = async () => {
    const summary =
      p.channel === "secure_form"
        ? `${writtenQuestion} Due ${writtenDue}.`
        : `Interview with ${interviewer} scheduled for ${new Date(schedule).toLocaleString()}.`;
    const response = await fetch("/api/workflow", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-demo-role": p.role,
      },
      body: JSON.stringify({
        action: "follow_up",
        channel: p.channel,
        summary,
        assignee: p.channel === "secure_form" ? "Case coordinator" : interviewer,
        due_at: p.channel === "secure_form" ? `${writtenDue}T17:00:00` : schedule,
      }),
    });
    const data = (await response.json()) as {
      task?: FollowUpTask;
      error?: { message: string };
    };
    if (!response.ok || !data.task) {
      setTaskMessage(
        data.error?.message || "The follow-up task could not be created.",
      );
      return;
    }
    p.onTaskCreated(data.task);
    setResponseToken(data.task.response_token || "");
    setHumanTaskId(data.task.channel === "human_interview" ? data.task.id : "");
    p.onWorkflowChanged({ status: "AWAITING_RESPONSE", assigned_role: "coordinator", next_action: "Monitor the request and record the response when received." });
    setTaskMessage(
      p.channel === "secure_form"
        ? "Secure written-response request created."
        : "Human interview task scheduled.",
    );
  };
  return (
    <main className="page narrow">
      <p className="eyebrow">INTERVIEW CHANNEL</p>
      <h1 className="pageTitle">How would Morgan like to respond?</h1>
      <p className="intro">
        An automated callback is optional. Written and human alternatives remain
        available.
      </p>
      {p.role !== "coordinator" && (
        <div className="permissionCallout">
          <strong>Read-only for EP Reviewers</strong>
          <span>A Coordinator must create invitations, schedule interviews, or prepare the fake callback.</span>
        </div>
      )}
      <div className="channelGrid">
        {[
          ["secure_form", "Secure form", "Respond in writing"],
          [
            "automated_callback",
            "Automated callback",
            "A disclosed, transcribed SiteWitness call",
          ],
          [
            "human_interview",
            "Human interview",
            "Speak with a project team member",
          ],
        ].map((x) => (
          <button
            key={x[0]}
            className={`channel ${p.channel === x[0] ? "selected" : ""}`}
            onClick={() => p.setChannel(x[0])}
            disabled={p.role !== "coordinator"}
          >
            <span className="radio">{p.channel === x[0] ? "●" : "○"}</span>
            <strong>{x[1]}</strong>
            <small>{x[2]}</small>
          </button>
        ))}
      </div>
      {p.channel === "automated_callback" && (
        <section className="consentBox">
          <h2>Record active consent</h2>
          <p>
            For this synthetic demo, confirm what the participant knowingly
            selected.
          </p>
          <label>
            <input
              type="checkbox"
              checked={p.consent}
              onChange={(e) => p.setConsent(e.target.checked)}
            />
            <span>
              <strong>I agree to receive an automated callback</strong>
              <small>The call will identify itself as automated.</small>
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={p.transcription}
              onChange={(e) => p.setTranscription(e.target.checked)}
            />
            <span>
              <strong>I agree that the call may be transcribed</strong>
              <small>
                An Environmental Professional will review the result.
              </small>
            </span>
          </label>
        </section>
      )}
      {p.channel === "secure_form" && (
        <section className="channelWorkspace">
          <p className="panelLabel">SECURE WRITTEN RESPONSE</p>
          <h2>Prepare the follow-up request</h2>
          <p>
            The respondent receives the unresolved factual questions in writing.
            No automated call is created.
          </p>
          <label>
            Questions for Morgan
            <textarea
              value={writtenQuestion}
              onChange={(e) => setWrittenQuestion(e.target.value)}
            />
          </label>
          <label>
            Requested response date
            <input
              type="date"
              value={writtenDue}
              onChange={(e) => setWrittenDue(e.target.value)}
            />
          </label>
          <div className="channelSummary">
            <strong>Included automatically</strong>
            <span>
              47 Baker Street · Synthetic records summary · Secure response
              instructions
            </span>
          </div>
        </section>
      )}
      {p.channel === "human_interview" && (
        <section className="channelWorkspace">
          <p className="panelLabel">HUMAN INTERVIEW</p>
          <h2>Create a project-team follow-up</h2>
          <p>
            Assign the remaining questions to a person. SiteWitness will not
            contact the respondent.
          </p>
          <label>
            Assigned interviewer
            <input
              value={interviewer}
              onChange={(e) => setInterviewer(e.target.value)}
            />
          </label>
          <label>
            Proposed date and time
            <input
              type="datetime-local"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
            />
          </label>
          <div className="channelSummary">
            <strong>Interview scope</strong>
            <span>
              Operations before 1991 · Rear storage room access · Archived
              tenant records
            </span>
          </div>
        </section>
      )}
      {taskMessage && (
        <div className="taskMessage" role="status">
          ✓ {taskMessage}
          {responseToken ? (
            <button onClick={() => p.go("operations")}>Open Work Queue to simulate send</button>
          ) : humanTaskId ? (
            <button onClick={() => { window.location.href = `/human-interview/${humanTaskId}`; }}>Open interview workspace</button>
          ) : (
            <button onClick={() => p.go("case")}>View case follow-up</button>
          )}
        </div>
      )}
      <div className="actions">
        <button className="secondary" onClick={() => p.go("case")}>
          Back
        </button>
        {p.channel === "automated_callback" ? (
          <button
            className="primary inline"
            disabled={p.role !== "coordinator" || !p.consent || !p.transcription}
            onClick={p.preparePreview}
          >
            Prepare call preview <span>→</span>
          </button>
        ) : (
          <button
            className="primary inline"
            disabled={
              p.role !== "coordinator" || (p.channel === "secure_form"
                ? writtenQuestion.trim().length < 20 || !writtenDue
                : !interviewer.trim() || !schedule)
            }
            onClick={createTask}
          >
            {p.channel === "secure_form"
              ? "Create written request"
              : "Schedule human interview"}
            <span>→</span>
          </button>
        )}
      </div>
    </main>
  );
}
function Preview(p: {
  confirmed: boolean;
  setConfirmed: (x: boolean) => void;
  launch: () => void;
  go: (v: View) => void;
  plan: GoalPlan | null;
  providerMode: "fake" | "calle_goal" | "calle_calls";
  readiness: CallReadiness;
  livePhone: string;
  setLivePhone: (value: string) => void;
  liveConfirmation: string;
  setLiveConfirmation: (value: string) => void;
  launching: boolean;
  launchError: string;
}) {
  const plan = p.plan;
  const phoneValid = /^\+[1-9]\d{7,14}$/.test(p.livePhone);
  const confirmationValid = p.liveConfirmation === "PLACE LIVE CALL";
  const liveReady = phoneValid && confirmationValid && p.readiness.live_calls_enabled && p.readiness.live_call_slots_remaining > 0;
  return (
    <main className="page">
      <div className="modeBanner">
        <strong>{p.providerMode === "fake" ? "Fake Goal Run mode" : p.providerMode === "calle_calls" ? "CALL-E Calls API mode" : "CALL-E Goal Run mode"}</strong>
        <span>
          {p.providerMode === "fake" ? "This deterministic demonstration will not place a phone call." : "A live call remains subject to the server-side call budget and explicit confirmation gate."}
        </span>
      </div>
      <p className="eyebrow">CALL PREVIEW · AUTHORIZATION VERSION 1</p>
      <h1 className="pageTitle">
        Review exactly what SiteWitness may disclose and ask
      </h1>
      <div className="previewGrid">
        <section className="panel">
          <p className="panelLabel">OPENING DISCLOSURE</p>
          <p className="script">
            “This is SiteWitness, an automated interview assistant for SiteWitness
            Environmental Consulting, calling about 47 Baker Street. This call will be
            transcribed and reviewed by an Environmental Professional. I do not
            determine liability, property condition, or whether further
            investigation is required.”
          </p>
          <p className="panelLabel spaced">SITE-SPECIFIC GOAL PLAN</p>
          <div className="channelSummary"><strong>{plan?.goalFamily || "Goal unavailable"}</strong><span>{plan?.property} · {plan?.assessmentId}</span></div>
          <p><strong>Material gap:</strong> {plan?.evidenceGap}</p>
          <p><strong>Known records:</strong> {plan?.knownRecords}</p>
          <p className="panelLabel spaced">BOUNDED QUESTIONS</p>
          <ol className="questionList">
            {(plan?.priorityBranches || []).map((q, i) => (
              <li key={q}>
                <span>{i + 1}</span>
                {q}
              </li>
            ))}
          </ol>
          <p className="panelLabel spaced">COMPLETION CONDITIONS</p>
          <ul>{plan?.completionConditions.map((condition) => <li key={condition}>{condition}</li>)}</ul>
        </section>
        <aside>
          {p.providerMode === "fake" ? (
            <section className="panel mini">
              <p className="panelLabel">RECIPIENT</p>
              <strong>Morgan Lee</strong>
              <span>+1 ••• ••• 1010</span>
              <div className="check ok">✓ Automated-call consent active</div>
              <div className="check ok">✓ Transcription consent active</div>
            </section>
          ) : (
            <section className="panel liveCallSetup" aria-labelledby="live-call-setup-title">
              <div className="liveCallHeader">
                <div>
                  <p className="panelLabel">LIVE CALL SETUP</p>
                  <h3 id="live-call-setup-title">Who should CALL-E call?</h3>
                </div>
                <span className="callAllowance">{p.readiness.live_call_slots_remaining} calls left</span>
              </div>
              <div className={`liveStep ${phoneValid ? "complete" : ""}`}>
                <span className="stepNumber">1</span>
                <label htmlFor="live-phone">
                  <strong>Recipient phone number</strong>
                  <small id="live-phone-help">Include the country code, such as +1 202 555 0123.</small>
                  <div className="inputStatus">
                    <input id="live-phone" type="tel" inputMode="tel" value={p.livePhone} placeholder="+1 202 555 0123" autoComplete="tel" aria-describedby="live-phone-help" aria-invalid={p.livePhone.length > 0 && !phoneValid} onChange={(event) => p.setLivePhone(event.target.value.replace(/[\s()-]/g, ""))} />
                    {phoneValid && <span aria-label="Valid phone number">✓</span>}
                  </div>
                  {p.livePhone.length > 0 && !phoneValid && <em>Enter a valid number beginning with + and a country code.</em>}
                </label>
              </div>
              <div className={`liveStep ${confirmationValid ? "complete" : ""}`}>
                <span className="stepNumber">2</span>
                <label htmlFor="live-confirmation">
                  <strong>Confirm this is intentional</strong>
                  <small>Type the phrase exactly as shown:</small>
                  <code>PLACE LIVE CALL</code>
                  <div className="inputStatus">
                    <input id="live-confirmation" value={p.liveConfirmation} placeholder="PLACE LIVE CALL" autoComplete="off" spellCheck={false} onChange={(event) => p.setLiveConfirmation(event.target.value.toUpperCase())} />
                    {confirmationValid && <span aria-label="Confirmation matches">✓</span>}
                  </div>
                </label>
              </div>
              <div className="liveSafetySummary">
                <span>✓ Consent active</span>
                <span>✓ Transcription allowed</span>
                <span>{liveReady ? "✓ Ready to place call" : "Complete both steps to enable the button"}</span>
              </div>
            </section>
          )}
          <section className="panel prohibited">
            <p className="panelLabel">OUT OF BOUNDS</p>
            <ul>{plan?.prohibitedConclusions.map((item) => <li key={item}>{item}</li>)}</ul>
            <p><strong>Human escalation:</strong> {plan?.escalationRoute}</p>
          </section>
        </aside>
      </div>
      <label className="confirm">
        <input
          type="checkbox"
          checked={p.confirmed}
          onChange={(e) => p.setConfirmed(e.target.checked)}
        />
        <span>
          <strong>I reviewed this exact plan</strong>
          <small>
            Any change invalidates this confirmation and requires a new preview.
          </small>
        </span>
      </label>
      <div className="actions">
        <button className="secondary" onClick={() => p.go("consent")}>
          Back
        </button>
        <button
          className="primary inline"
          disabled={p.launching || !p.confirmed || (p.providerMode !== "fake" && !liveReady)}
          onClick={p.launch}
        >
          {p.launching ? "Sending to CALL-E…" : p.providerMode === "fake" ? "Run fake interview" : "Place one live call"} <span>{p.launching ? "" : "→"}</span>
        </button>
      </div>
      {p.launchError && <div className="launchError" role="alert"><strong>Call was not started</strong><span>{p.launchError}</span></div>}
    </main>
  );
}
function Call({ phase, go, providerMode, liveStatus, lastStatusCheck, statusCheckError }: { phase: number; go: (v: View) => void; providerMode: "fake" | "calle_goal" | "calle_calls"; liveStatus: string; lastStatusCheck: string | null; statusCheckError: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [liveStatus]);
  const states = [
    "DIALING",
    "IN PROGRESS",
    "VALIDATING EVIDENCE",
    "COMPLETED · PENDING REVIEW",
  ];
  return (
    <main className="page callPage">
      <p className="eyebrow">INTERVIEW INT-001</p>
      <h1 className="pageTitle">Interview activity</h1>
      <div className="callCard">
        <div className={`pulse ${phase === 3 ? "done" : ""}`}>
          {phase === 3 ? "✓" : "SW"}
        </div>
        <span className="modePill">{providerMode === "fake" ? "FAKE GOAL RUN · NO CALL PLACED" : "LIVE CALL-E GOAL RUN · 20-CALL LIMIT"}</span>
        <h2 aria-live="polite">{providerMode === "fake" ? states[phase] : liveStatus === "SUBMITTING" ? "Submitting your call…" : liveStatus === "QUEUED" ? "Waiting for call progress" : liveStatus === "IN_PROGRESS" ? "Call in progress" : liveStatus === "PROCESSING_EVIDENCE" ? "Call ended · Preparing evidence" : liveStatus}</h2>
        <p>
          {phase < 3
            ? providerMode === "fake" ? "The deterministic provider is progressing through the interview fixture." : liveStatus === "SUBMITTING" ? "Your request is being sent. CALL-E can take several seconds to acknowledge it." : liveStatus === "QUEUED" ? "Your request was accepted. CALL-E has not yet supplied a newer call status; the conversation may already have started. Checking automatically." : liveStatus === "PROCESSING_EVIDENCE" ? "The phone session has ended. Waiting for CALL-E to finish the transcript and evidence extraction." : "SiteWitness is checking the existing call for updates."
            : "The call has ended. Open evidence review to see the returned evidence and any processing issues."}
        </p>
        {providerMode !== "fake" && phase < 3 && <p>{Math.floor(elapsed / 60)}m {elapsed % 60}s in this status{liveStatus === "QUEUED" && elapsed >= 120 ? " — CALL-E is taking longer than expected. Keep this page open; starting another request could create a duplicate call." : ""}</p>}
        {providerMode !== "fake" && <p role="status">{statusCheckError ? "The latest status check failed. Retrying automatically. " : ""}{lastStatusCheck ? `Last successful status check: ${new Date(lastStatusCheck).toLocaleTimeString()}.` : "Waiting for the first status update."} {liveStatus === "QUEUED" ? "CALL-E’s status may lag behind the phone conversation." : ""}</p>}
        {providerMode === "fake" && <><div className="progress">
          <i style={{ width: `${(phase + 1) * 25}%` }} />
        </div>
        <div className="activity">
          {states.slice(0, phase + 1).map((s, i) => (
            <div key={s}>
              <span>{i < phase || phase === 3 ? "✓" : "●"}</span>
              <strong>{s}</strong>
              <small>
                {
                  [
                    "Synthetic interview instructions prepared.",
                    "Disclosure and permission confirmed.",
                    "Returned statements aligned to supporting transcript quotations.",
                    "Human review is required before use.",
                  ][i]
                }
              </small>
            </div>
          ))}
        </div></>}
        {phase === 3 && (
          <button className="primary inline" onClick={() => go("review")}>
            Review evidence <span>→</span>
          </button>
        )}
      </div>
    </main>
  );
}
export function ReviewView(p: {
  statements: Statement[];
  selected: string;
  setSelected: (x: string) => void;
  review: (id: string, s: Review) => void;
  role: string;
  counts: { accepted: number; pending: number };
}) {
  const current = p.statements.find((s) => s.id === p.selected)!;
  return (
    <main className="reviewPage">
      <div className="reviewHead">
        <div>
          <p className="eyebrow">47 BAKER STREET · INTERVIEW INT-001</p>
          <h1>Evidence review</h1>
          <p>
            Generated statements remain pending until an Environmental
            Professional acts.
          </p>
        </div>
        <div className="reviewMetrics">
          <span>
            <strong>{p.counts.accepted}</strong>Reviewed
          </span>
          <span>
            <strong>{p.counts.pending}</strong>Pending
          </span>
        </div>
      </div>
      <div className="reviewGrid">
        <section className="transcript">
          <div className="stickyTitle">
            <strong>Transcript</strong>
            <span>12 turns · Fake fixture</span>
          </div>
          {transcript.map((t, i) => (
            <article
              className={`${t[0] === "Morgan Lee" ? "respondentTurn" : "agentTurn"} ${current?.turn === i + 1 ? "highlight" : ""}`}
              key={i}
            >
              <div>
                <strong>{t[0]}</strong>
                <small>Turn {i + 1}</small>
              </div>
              <p>{t[1]}</p>
            </article>
          ))}
        </section>
        <section className="statements">
          <div className="stickyTitle">
            <strong>Structured statements</strong>
            <span>Evidence-linked · Human review required</span>
          </div>
          {p.statements.map((s) => (
            <article
              className={`statement ${p.selected === s.id ? "selectedStatement" : ""}`}
              key={s.id}
              onClick={() => p.setSelected(s.id)}
            >
              <div className="statementTop">
                <span>{s.id}</span>
                <b className={`reviewStatus ${s.status}`}>
                  {s.status.replace("_", " ")}
                </b>
              </div>
              <p>{s.fact}</p>
              <div className="tags">
                <span>{s.source}</span>
                <span>{s.certainty}</span>
              </div>
              <button
                className="evidenceLink"
                onClick={() => p.setSelected(s.id)}
              >
                ↗ Transcript turn {s.turn}
              </button>
              {s.warning && (
                <div className={`warning ${s.blocking ? "block" : ""}`}>
                  <strong>
                    {s.blocking ? "Blocking warning" : "Review warning"}
                  </strong>
                  {s.warning}
                </div>
              )}
              <div className="reviewActions">
                <button
                  disabled={p.role !== "reviewer" || s.blocking}
                  onClick={() => p.review(s.id, "accepted")}
                >
                  Accept
                </button>
                <button
                  disabled={p.role !== "reviewer" || s.blocking}
                  onClick={() => p.review(s.id, "edited")}
                >
                  Edit
                </button>
                <button
                  disabled={p.role !== "reviewer"}
                  onClick={() => p.review(s.id, "rejected")}
                >
                  Reject
                </button>
                <button
                  disabled={p.role !== "reviewer"}
                  onClick={() => p.review(s.id, "follow_up")}
                >
                  Follow up
                </button>
              </div>
            </article>
          ))}
          <section className="packet">
            <p className="panelLabel">EVIDENCE GAP DISPOSITION</p>
            <select disabled={p.role !== "reviewer"}>
              <option>Partially resolved</option>
              <option>Remains unresolved</option>
              <option>Human interview required</option>
            </select>
            <textarea
              aria-label="Reviewer rationale"
              defaultValue=""
            />
            <button className="primary inline" disabled={p.role !== "reviewer"}>
              Save human disposition
            </button>
            <small>
              This is a workflow disposition, not an environmental conclusion.
            </small>
          </section>
        </section>
      </div>
    </main>
  );
}
function Readiness({
  consent,
  confirmed,
  callReadiness,
  reset,
}: {
  consent: boolean;
  confirmed: boolean;
  callReadiness: CallReadiness;
  reset: () => void;
}) {
  const rows: [
    [string, boolean],
    [string, boolean],
    [string, boolean],
    [string, boolean],
    [string, boolean],
    [string, boolean],
  ] = [
    ["Synthetic fixture portfolio", true],
    ["Development-safe provider", callReadiness.safe_for_development],
    ["Automated-call consent", consent],
    ["Current preview confirmation", confirmed],
    ["Published Goal contract", Boolean(callReadiness.goal?.contract_valid)],
    ["Live calls enabled", callReadiness.live_calls_enabled],
  ];
  return (
    <main className="page narrow">
      <p className="eyebrow">DEMO OPERATIONS</p>
      <h1 className="pageTitle">Readiness & safety</h1>
      <p className="intro">
        {callReadiness.provider_mode === "fake" ? "Fake mode is ready." : "CALL-E live mode is selected."} Live calling remains guarded by credentials,
        participant consent, a current preview, and explicit server configuration.
      </p>
      <section className="panel readiness">
        {rows.map(([label, ok]) => (
          <div key={label}>
            <span className={ok ? "readyDot" : "offDot"}>{ok ? "✓" : "—"}</span>
            <strong>{label}</strong>
            <small>{ok ? "Ready" : "Not configured"}</small>
          </div>
        ))}
      </section>
      <div className="ops">
        <div>
          <span>Provider mode</span>
          <strong>{callReadiness.provider_mode}</strong>
        </div>
        <div>
          <span>External calls created</span>
          <strong>{callReadiness.external_calls_created}</strong>
        </div>
        <div>
          <span>Live-call allowance remaining</span>
          <strong>{callReadiness.live_call_slots_remaining} of {callReadiness.live_call_limit}</strong>
        </div>
        <div>
          <span>Data classification</span>
          <strong>Synthetic only</strong>
        </div>
        <div>
          <span>Published Goal</span>
          <strong>{callReadiness.goal?.title || callReadiness.goal?.id || "Not configured"}</strong>
        </div>
        <div>
          <span>RunSpec version</span>
          <strong>{callReadiness.goal?.version || "—"}</strong>
        </div>
      </div>
      <section className="panel governancePanel">
        <p className="panelLabel">IDENTITY, RETENTION & INTEGRATION BOUNDARIES</p>
        <div><strong>Identity source</strong><span>Hosted workspace identity headers; synthetic role switcher in local demo</span></div>
        <div><strong>Authorization</strong><span>Coordinator and EP actions enforced independently by server routes</span></div>
        <div><strong>Evidence preservation</strong><span>Original respondent and interviewer answers remain immutable beside reviewer revisions</span></div>
        <div><strong>Retention policy</strong><span>90-day pilot default proposed; destructive purge remains disabled until organizational policy approval</span></div>
        <div><strong>Integration boundary</strong><span>CALL-E credentials and phone numbers remain server-side; ordinary development and automated tests use deterministic providers</span></div>
      </section>
      <FixtureLab />
      <button className="secondary danger" onClick={reset}>
        Reset synthetic demo
      </button>
    </main>
  );
}

function FixtureLab() {
  const goalBranches = [
    [
      "Bounded recollection",
      "NO DIRECT MACHINE OBSERVATION",
      "The witness recalls drop-off and pickup only. The Goal records that rear-room access, equipment, solvents, and waste handling are unknown, then stops the machinery branch.",
    ],
    [
      "Direct observation",
      "MACHINE OBSERVED IN REAR ROOM",
      "The Goal asks only the relevant follow-ups: observation years, machine location, solvent knowledge, and any personally observed waste handling. Uncertainty or a safety concern routes to human follow-up.",
    ],
  ];
  const fixtures = [
    [
      "Completed",
      "COMPLETED_PENDING_REVIEW",
      "Transcript and six pending statements created.",
    ],
    [
      "Declined",
      "DECLINED",
      "Interview stopped; no factual statements created.",
    ],
    [
      "Wrong person",
      "NEEDS_HUMAN_FOLLOW_UP",
      "Substantive questions stopped immediately.",
    ],
    ["No answer", "NO_ANSWER", "No negative inference and no automatic retry."],
    [
      "Requested human",
      "NEEDS_HUMAN_FOLLOW_UP",
      "Automated questioning stopped.",
    ],
    [
      "Invalid schema",
      "INVALID_RESULT",
      "Raw redacted result retained for review.",
    ],
    ["Missing transcript", "INVALID_RESULT", "Evidence acceptance blocked."],
    [
      "Low confidence",
      "NEEDS_HUMAN_FOLLOW_UP",
      "Blocking completion-confidence warning.",
    ],
    [
      "Active hazard",
      "NEEDS_HUMAN_FOLLOW_UP",
      "Historical interview stopped; no response guidance provided.",
    ],
  ];
  const [selectedBranch, setSelectedBranch] = useState(goalBranches[0]);
  const [selectedFixture, setSelectedFixture] = useState(fixtures[0]);
  return (
    <>
      <section className="panel fixtureLab">
        <p className="panelLabel">GOAL BRANCH PROOF · PRECOMPUTED</p>
        <p>Compare two deterministic interview paths without creating an external call.</p>
        <div className="fixtureButtons">
          {goalBranches.map((branch) => (
            <button
              key={branch[0]}
              className={selectedBranch[0] === branch[0] ? "chosen" : ""}
              onClick={() => setSelectedBranch(branch)}
            >
              {branch[0]}
            </button>
          ))}
        </div>
        <div className="fixtureResult">
          <span>Selected evidence branch</span>
          <strong>{selectedBranch[1]}</strong>
          <p>{selectedBranch[2]}</p>
        </div>
      </section>
      <section className="panel fixtureLab">
        <p className="panelLabel">FAKE PROVIDER FIXTURE LAB</p>
        <p>
          Exercise terminal and safety outcomes without creating an external call.
        </p>
        <div className="fixtureButtons">
          {fixtures.map((fixture) => (
            <button
              key={fixture[0]}
              className={selectedFixture[0] === fixture[0] ? "chosen" : ""}
              onClick={() => setSelectedFixture(fixture)}
            >
              {fixture[0]}
            </button>
          ))}
        </div>
        <div className="fixtureResult">
          <span>Normalized outcome</span>
          <strong>{selectedFixture[1]}</strong>
          <p>{selectedFixture[2]}</p>
        </div>
      </section>
    </>
  );
}
