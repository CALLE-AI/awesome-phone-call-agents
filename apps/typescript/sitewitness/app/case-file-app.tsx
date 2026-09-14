"use client";
import Link from "next/link";
import { redactText } from "./lib/output-privacy";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
} from "react";
import {
  SOURCE_RECORDS,
  INITIAL_CONTACTS,
  publicContact,
  type PublicContact,
  type SourceTask,
} from "./lib/case-file";
import { INTERVIEW_BRANCHES } from "./lib/call-instructions";
import {
  type EvidenceRecord,
  type Citation,
  type TranscriptTurn,
  type applyReviews,
} from "./lib/evidence";
import type { GoalPlan } from "./lib/goal-context";
import {
  RESEARCH_YEARS,
  describeYears,
  yearsInText,
  emptyCoverage,
  coverageQuoteCitation,
  type CaseCoverage,
} from "./lib/case-coverage";
import "./case-file.css";
import type { DemoSession } from "./lib/demo-session";

type Stage = "records" | "people" | "brief" | "evidence" | "followup";
type Role = "coordinator" | "reviewer";
type ContactData = {
  session?: DemoSession;
  contacts: PublicContact[];
  selectedContactId: string | null;
  tasks: SourceTask[];
};
type Statement = ReturnType<typeof applyReviews>[number] & {
  runId: number | null;
  citation: Citation | null;
};
type Run = {
  id: number;
  sequence: number;
  contactId: string | null;
  contactName: string;
  provider: string;
  status: string;
  error: { message?: string } | null;
  validationError: string;
  evidence: EvidenceRecord | null;
  turns: TranscriptTurn[];
  branches: Array<{
    id: string;
    title: string;
    status: string;
    quote: string;
    citation: Citation;
  }>;
  plan: GoalPlan | null;
  recordedAt: string;
  knowledgeCitation: Citation;
  suggestedCoverage: { quote: string; sourceTurnId: string };
  noteCitations: Citation[];
  leadCitations: Citation[];
  terminal: boolean;
};
type EvidenceData = {
  session?: DemoSession;
  runs: Run[];
  statements: Statement[];
  coverage: CaseCoverage;
  suggestion: {
    contactId: string;
    name: string;
    years: number[];
    focus: string;
  } | null;
};
type WorkflowData = {
  session?: DemoSession;
  workflow: { status: string; assigned_role: string; next_action: string };
  dispositions: Array<{
    id: number;
    disposition: string;
    rationale: string;
    created_at: string;
  }>;
  audit: Array<{
    id: number;
    event_type: string;
    actor: string;
    created_at: string;
  }>;
};
type Readiness = {
  session?: DemoSession;
  provider_mode: string;
  provider_configured: boolean;
  live_calls_enabled: boolean;
  live_call_slots_remaining: number;
  integration_label: string;
  pending_attempt:
    | (Preview & { run_id: number; has_provider_id: boolean; status: string })
    | null;
};
type Preview = {
  branches?: Array<{ id: string; title: string; rule: string }>;
  authorization_version: number;
  plan: GoalPlan;
  task: string;
  variables_fingerprint: string;
  contact_id: string;
  contact_version: number;
  provider_mode: string;
};
const stages: Array<[Stage, string]> = [
  ["records", "Source records"],
  ["people", "People & calls"],
  ["brief", "Interview brief"],
  ["evidence", "Evidence & review"],
  ["followup", "Next action"],
];
const human = (value: string) => value.replaceAll("_", " ").toLowerCase();
const date = (value: string) => new Date(value).toLocaleString();

async function requestApi<T>(
  path: string,
  role: Role,
  body?: unknown,
  caseId?: string,
): Promise<T> {
  const response = await fetch(
    path,
    body
      ? {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-demo-role": role,
            ...(caseId ? { "x-demo-case": caseId } : {}),
          },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const unreadableResponse = () =>
    new Error(
      `The server returned an empty or unreadable response (HTTP ${response.status}). Refresh to reload saved work.${body ? " If you were placing a call, check its saved status before starting another." : ""}`,
    );
  const data = await response.json().catch(() => {
    throw unreadableResponse();
  });
  if (!data || typeof data !== "object") throw unreadableResponse();
  if (!response.ok || data.ok === false)
    throw new Error(
      data.error?.message || "The request could not be completed. Try again.",
    );
  return data as T;
}

export default function CaseFileApp() {
  const sessionRef = useRef<DemoSession | null>(null);
  const refreshSequence = useRef(0);
  const [session, setSession] = useState<DemoSession | null>(null);
  const [canRestart, setCanRestart] = useState(false);
  const resetDialog = useRef<HTMLDialogElement>(null);
  const api = useCallback(
    <T,>(path: string, requestRole: Role, body?: unknown) =>
      requestApi<T>(path, requestRole, body, sessionRef.current?.caseId),
    [],
  );

  const [stage, setStage] = useState<Stage>("records");
  const [role, setRole] = useState<Role>("coordinator");
  const [recordId, setRecordId] = useState<string>("directory");
  const [contacts, setContacts] = useState<ContactData>({
    contacts: INITIAL_CONTACTS.map(publicContact),
    selectedContactId: "morgan",
    tasks: [],
  });
  const [evidence, setEvidence] = useState<EvidenceData>({
    runs: [],
    statements: [],
    coverage: emptyCoverage(),
    suggestion: null,
  });
  const [workflow, setWorkflow] = useState<WorkflowData | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [newContact, setNewContact] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [scenario, setScenario] = useState("bounded");
  const [followUpFocus, setFollowUpFocus] = useState("");
  const [yearDetail, setYearDetail] = useState<number | null>(null);
  const [coverageDraft, setCoverageDraft] = useState<{
    runId: number;
    quote: string;
    sourceTurnId: string;
    interpretationNote: string;
    years: number[];
    confirmed: boolean;
  } | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [pollingRunId, setPollingRunId] = useState<number | null>(null);
  const [callStatus, setCallStatus] = useState("");
  const [lastCheck, setLastCheck] = useState("");
  const [highlight, setHighlight] = useState<string[]>([]);
  const [taskContact, setTaskContact] = useState<string>("");
  const [taskSummary, setTaskSummary] = useState("");
  const [taskAssignee, setTaskAssignee] = useState("Case coordinator");
  const [disposition, setDisposition] = useState("PARTIALLY_RESOLVED");
  const [rationale, setRationale] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editFact, setEditFact] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editEvidence, setEditEvidence] = useState("");
  const [pulses, setPulses] = useState<
    Array<{ id: number; x: number; y: number }>
  >([]);
  const pulseId = useRef(0);
  const stageNav = useRef<HTMLElement>(null);
  const documentHeading = useRef<HTMLHeadingElement>(null);
  const sceneDialog = useRef<HTMLDialogElement>(null);
  const [sceneFocus, setSceneFocus] = useState("front");
  const reactToClick = (event: PointerEvent<HTMLDivElement>) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const target = event.target as HTMLElement;
    if (
      !target.closest("button:not(:disabled), a, summary, input[type=checkbox]")
    )
      return;
    const id = ++pulseId.current;
    setPulses((current) => [
      ...current.slice(-5),
      { id, x: event.clientX, y: event.clientY },
    ]);
  };
  const showSourceRecord = (id: string) => {
    setRecordId(id);
    documentHeading.current?.focus({ preventScroll: true });
    documentHeading.current?.scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  };

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    for (let attempt = 0; attempt < 3; attempt++) {
      const wf = await api<WorkflowData>("/api/workflow", role);
      const [c, e, r, demo] = await Promise.all([
        api<ContactData>("/api/case-file", role),
        api<EvidenceData>("/api/case-evidence", role),
        api<Readiness>("/api/calle", role),
        api<{ session: DemoSession; canRestart: boolean }>(
          "/api/demo-session",
          role,
        ),
      ]);
      if (sequence !== refreshSequence.current) return;
      if (
        !wf.session ||
        [c, e, r, demo].some(
          (item) => item.session?.caseId !== wf.session?.caseId,
        )
      )
        continue;
      if (
        sessionRef.current &&
        sessionRef.current.caseId !== wf.session.caseId
      ) {
        // A complete reload also clears every draft, preview and pending timer.
        window.location.replace("/?demo=started");
        return;
      }
      sessionRef.current = wf.session;
      setSession(wf.session);
      setCanRestart(demo.canRestart);
      setWorkflow(wf);
      setContacts(c);
      setEvidence(e);
      setReadiness(r);
      setLoaded(true);
      if (
        new URLSearchParams(window.location.search).get("demo") === "started"
      ) {
        setMessage(
          "Fresh demo ready. Start with the source records; earlier tests are saved in Demo history.",
        );
        window.history.replaceState(null, "", window.location.pathname);
      }
      return;
    }
    throw new Error(
      "The demo changed while loading. Refresh to open the new investigation.",
    );
  }, [role, api]);
  useEffect(() => {
    void Promise.resolve()
      .then(refresh)
      .catch((problem) => setError(problem.message));
  }, [refresh]);
  useEffect(() => {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? "instant"
      : "smooth";
    const nav = stageNav.current;
    const activeStep = nav?.querySelector<HTMLElement>("[aria-current]");
    if (nav && activeStep && nav.scrollWidth > nav.clientWidth) {
      nav.scrollTo({
        left:
          activeStep.getBoundingClientRect().left -
          nav.getBoundingClientRect().left +
          nav.scrollLeft -
          (nav.clientWidth - activeStep.clientWidth) / 2,
        behavior,
      });
    }
    window.scrollTo({
      top: 0,
      behavior,
    });
  }, [stage]);
  useEffect(() => {
    if (!pollingRunId || role !== "coordinator") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<{
          status: string;
          terminal: boolean;
          error?: { message?: string };
        }>("/api/calle", role, {
          action: "poll",
          run_id: String(pollingRunId),
        });
        if (!active) return;
        setCallStatus(result.status);
        setLastCheck(new Date().toISOString());
        if (result.error)
          setError(
            result.error.message || "The call did not return usable evidence.",
          );
        await refresh();
        if (!active) return;
        if (result.terminal) {
          setPollingRunId(null);
          setStage("evidence");
          setSelectedRunId(pollingRunId);
        } else timer = setTimeout(poll, 2500);
      } catch (problem) {
        if (active) {
          setError(
            problem instanceof Error
              ? problem.message
              : "Status check failed. Resume when ready.",
          );
          setPollingRunId(null);
        }
      }
    };
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pollingRunId, role, refresh, api]);

  const runAction = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "The action failed.",
      );
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  const contact =
    contacts.contacts.find((item) => item.id === contacts.selectedContactId) ||
    null;
  const source =
    SOURCE_RECORDS.find((item) => item.id === recordId) || SOURCE_RECORDS[0];
  const selectedRun =
    evidence.runs.find((item) => item.id === selectedRunId) ||
    evidence.runs[0] ||
    null;
  const statements = evidence.statements.filter(
    (item) => item.runId === null || item.runId === selectedRun?.id,
  );
  const savedRunCoverage = evidence.coverage.records.find(
    (record) => record.runId === selectedRun?.id,
  );
  const suggestedQuote = selectedRun?.suggestedCoverage || { quote: "", sourceTurnId: "" };
  const coverageForm = {
    runId: selectedRun?.id || 0,
    quote: savedRunCoverage?.quote || suggestedQuote.quote,
    sourceTurnId: savedRunCoverage?.sourceTurnId || suggestedQuote.sourceTurnId,
    interpretationNote: savedRunCoverage?.interpretationNote || "",
    years: savedRunCoverage?.years || ([] as number[]),
    confirmed: false,
    ...(coverageDraft?.runId === selectedRun?.id ? coverageDraft : {}),
  };
  const updateCoverage = (value: Partial<NonNullable<typeof coverageDraft>>) =>
    setCoverageDraft({ ...coverageForm, ...value });
  const planNextCall = async (contactId: string, focus: string) => {
    setContacts(
      await api<ContactData>("/api/case-file", "coordinator", {
        action: "select_contact",
        contactId,
      }),
    );
    const existing = contacts.tasks.find(
      (task) =>
        task.contactId === contactId &&
        task.summary === focus &&
        task.status === "open",
    );
    if (!existing)
      await api("/api/case-file", "coordinator", {
        action: "create_task",
        contactId,
        title: "Conduct the next interview",
        summary: focus,
        assignee: "Case coordinator",
      });
    setFollowUpFocus(focus);
    setPreview(null);
    setReviewed(false);
    setConfirmation("");
    setNewContact(false);
    setStage("people");
    setMessage(
      "Next interview planned from the remaining years. Enter this participant's number and permission, then prepare the call.",
    );
    await refresh();
  };
  const canReview =
    role === "reviewer" && workflow?.workflow.assigned_role === "reviewer";
  const historicalUseResolved = workflow?.workflow.status === "RESOLVED";
  const live = readiness?.provider_mode !== "fake";
  const activeAttempt = readiness?.pending_attempt;
  const otherPending = evidence.statements.filter(
    (item) =>
      item.status === "pending" &&
      item.runId !== null &&
      item.runId !== selectedRun?.id,
  );
  const suggestedYears = yearsInText(coverageForm.quote);
  const manuallyInterpretedYears = coverageForm.years.filter(
    (year) => !suggestedYears.includes(year),
  );
  const coverageCitation = coverageQuoteCitation(
    coverageForm.quote,
    selectedRun?.turns || [],
    coverageForm.sourceTurnId,
  );
  const interpretationLength = coverageForm.interpretationNote.trim().length;
  const projectedYears = RESEARCH_YEARS.filter(
    (year) =>
      coverageForm.years.includes(year) ||
      evidence.coverage.records.some(
        (record) =>
          record.runId !== selectedRun?.id && record.years.includes(year),
      ),
  );
  const allYearsSelected = projectedYears.length === RESEARCH_YEARS.length;
  const coverageSaveIssue = !canReview
    ? "Choose EP Reviewer and reopen human review if needed to save these years."
    : coverageCitation.status !== "matched"
      ? "Choose an original respondent answer below. Keep its exact wording."
      : !coverageForm.years.length
        ? "Select the years supported by this quotation."
        : (manuallyInterpretedYears.length > 0 || interpretationLength > 0) &&
            (interpretationLength < 10 || interpretationLength > 1000)
          ? "Explain how the original answer supports your year correction (10–1,000 characters)."
          : !coverageForm.confirmed
            ? "Confirm the date quotation and selected years below."
            : "";
  const contactReady = contact?.readiness === "Ready for authorized call";
  const previewCurrent = Boolean(
    preview &&
    contact &&
    preview.contact_id === contact.id &&
    preview.contact_version === contact.version &&
    preview.provider_mode === readiness?.provider_mode,
  );
  const openRecord = (id: string) => {
    setRecordId(id);
    setStage("records");
  };
  const openTask = (id: string | null, summary: string) => {
    setTaskContact(id || "");
    setTaskSummary(summary);
    setStage("followup");
  };
  const prepare = () =>
    runAction(async () => {
      if (!contact) throw new Error("Choose a respondent first.");
      const result = await api<Preview>("/api/calle", role, {
        action: "prepare",
        interview_id: sessionRef.current?.interviewId,
        authorization_version: 1,
        site_key: "dry_cleaner",
        contact_id: contact.id,
        contact_version: contact.version,
        selected_channel: "automated_callback",
        automated_call_allowed: contact.automatedAllowed,
        transcription_allowed: contact.transcriptionAllowed,
        scenario,
        follow_up_focus: followUpFocus,
      });
      setPreview(result);
      setReviewed(false);
      setConfirmation("");
      setStage("brief");
      setMessage(
        "The brief is ready for your review. No call has been placed.",
      );
    });
  const launch = () =>
    runAction(async () => {
      if (!preview || !contact) return;
      const result = await api<{ run_id: number; status: string }>(
        "/api/calle",
        role,
        {
          action: "launch",
          interview_id: sessionRef.current?.interviewId,
          authorization_version: preview.authorization_version,
          site_key: "dry_cleaner",
          contact_id: contact.id,
          contact_version: contact.version,
          preview_fingerprint: preview.variables_fingerprint,
          selected_channel: "automated_callback",
          automated_call_allowed: contact.automatedAllowed,
          transcription_allowed: contact.transcriptionAllowed,
          preview_confirmed: reviewed,
          live_confirmation: confirmation,
        },
      );
      setCallStatus(result.status);
      setPollingRunId(result.run_id);
      setPreview(null);
      setReviewed(false);
      setConfirmation("");
      await refresh();
    });
  const reviewStatement = (statement: Statement, status: string) =>
    runAction(async () => {
      await api("/api/workflow", role, {
        action: "review",
        statement_id: statement.id,
        status,
        expected_revision: statement.revision,
      });
      await refresh();
      setMessage(
        status === "accepted"
          ? "Claim accepted. The original quotation stays attached."
          : status === "rejected"
            ? "Claim rejected. Its original evidence remains in the history."
            : "Claim marked for follow-up. The question stays open.",
      );
    });
  const showQuote = (citation: Citation | null) => {
    setHighlight(citation?.turnIds || []);
    if (citation?.turnIds[0])
      document.getElementById(citation.turnIds[0])?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "center",
      });
  };
  const exportEvidence = () => {
    const blob = new Blob(
      [
        redactText(JSON.stringify(
          {
            caseId: session?.caseId,
            original_sources: SOURCE_RECORDS,
            interview: selectedRun
              ? {
                  id: selectedRun.id,
                  provider: selectedRun.provider,
                  recordedAt: selectedRun.recordedAt,
                  proposed_evidence: selectedRun.evidence,
                  transcript: selectedRun.turns,
                }
              : null,
            accepted_evidence: statements.filter(
              (item) => item.status === "accepted",
            ),
            human_disposition_history: workflow?.dispositions || [],
          },
          null,
          2,
        )),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "baker-street-evidence.json";
    a.click();
    URL.revokeObjectURL(url);
    setMessage("Accepted evidence download started.");
  };

  return (
    <div className="caseFile" onPointerDownCapture={reactToClick}>
      <div className="cfClickReactions" aria-hidden="true">
        {pulses.map((pulse) => (
          <span
            key={pulse.id}
            className="cfClickPulse"
            style={{ left: pulse.x, top: pulse.y }}
            onAnimationEnd={() =>
              setPulses((current) =>
                current.filter((item) => item.id !== pulse.id),
              )
            }
          />
        ))}
      </div>
      {busy && (
        <div className="cfSaving" role="status">
          <span className="cfSpinner" aria-hidden="true" />
          Working on your request…
        </div>
      )}
      <dialog
        className="cfSceneDialog"
        ref={sceneDialog}
        aria-labelledby="scene-title"
      >
        <div className="cfSceneHeading">
          <div>
            <p className="cfEyebrow">ILLUSTRATIVE LOCATION</p>
            <h2 id="scene-title">Every room raises a different question</h2>
          </div>
          <form method="dialog">
            <button aria-label="Close location illustration">×</button>
          </form>
        </div>
        <div className="cfSceneBody">
          <div className="cfSceneImage">
            <img
              src="/illustrations/dry-cleaner.png"
              width="1672"
              height="941"
              decoding="async"
              alt="Conceptual cutaway of a dry cleaner: an interviewer at the front counter, clothing racks, and a closed rear-room door."
            />
            <button
              className="cfHotspot cfFrontSpot"
              aria-label="Explore the front counter"
              aria-pressed={sceneFocus === "front"}
              onClick={() => setSceneFocus("front")}
            >
              1
            </button>
            <button
              className="cfHotspot cfRearSpot"
              aria-label="Explore the rear area"
              aria-pressed={sceneFocus === "rear"}
              onClick={() => setSceneFocus("rear")}
            >
              2
            </button>
          </div>
          <div className="cfSceneControls">
            <div className="cfSceneTabs" aria-label="Location questions">
              <button
                aria-pressed={sceneFocus === "front"}
                onClick={() => setSceneFocus("front")}
              >
                1 · Front counter
              </button>
              <button
                aria-pressed={sceneFocus === "rear"}
                onClick={() => setSceneFocus("rear")}
              >
                2 · Rear area
              </button>
              <button
                aria-pressed={sceneFocus === "years"}
                onClick={() => setSceneFocus("years")}
              >
                3 · Earlier years
              </button>
            </div>
            <div className="cfSceneAnswer" key={sceneFocus} aria-live="polite">
              <strong>
                {sceneFocus === "front"
                  ? "Which operations did this person observe?"
                  : sceneFocus === "rear"
                    ? "Did this person enter the rear area?"
                    : "Who knows what happened before they arrived?"}
              </strong>
              <p>
                {sceneFocus === "front"
                  ? "Ask what the respondent personally saw, and during which years. Pickup and drop-off observations describe the areas they knew."
                  : sceneFocus === "rear"
                    ? "Establish access before asking about equipment or handling. Keep room access unknown until the respondent describes it."
                    : "Expected dates are a referral. Confirm their actual knowledge period, then ask for another person or record if earlier years remain open."}
              </p>
            </div>
            <p className="cfSceneDisclaimer">
              AI-generated conceptual illustration. This is not a photograph,
              floor plan or evidence about 47 Baker Street.
            </p>
          </div>
        </div>
      </dialog>
      <dialog
        className="cfResetDialog"
        ref={resetDialog}
        aria-labelledby="reset-title"
        aria-describedby="reset-description"
      >
        <p className="cfEyebrow">A FRESH REHEARSAL</p>
        <h2 id="reset-title">Start a new demo?</h2>
        <p id="reset-description">
          This test will be saved in Demo history. You’ll return to the original
          source records and contact list with no calls, collected evidence,
          reviewed years or follow-up tasks.
        </p>
        <p>
          Enter the participant’s number and permission again. Your CALL-E
          settings and call usage stay the same.
        </p>
        {role !== "coordinator" && (
          <p className="cfNotice">
            Switch the Demo role to Coordinator to start a new demo.
          </p>
        )}
        {!canRestart && (
          <p className="cfNotice" role="status">
            Finish the current call and retrieve its result first. If submission
            is unconfirmed, resume the saved attempt.
          </p>
        )}
        <div className="cfResetActions">
          <button
            className="cfSecondary"
            onClick={() => resetDialog.current?.close()}
          >
            Keep this demo
          </button>
          <button
            className="cfPrimary"
            disabled={busy || !loaded || !canRestart || role !== "coordinator"}
            onClick={() => {
              resetDialog.current?.close();
              void runAction(async () => {
                await api("/api/demo-session", role, {
                  action: "start_new_demo",
                  expectedCaseId: sessionRef.current?.caseId,
                });
                setPollingRunId(null);
                window.location.assign("/?demo=started");
              });
            }}
          >
            Start new demo
          </button>
        </div>
      </dialog>
      <header className="cfHeader">
        <button className="cfBrand" onClick={() => setStage("records")}>
          <span>SW</span>SiteWitness
          <small className="cfBrandTag">CASE STUDIO</small>
        </button>
        <div className="cfHeaderRight">
          <button
            className="cfRestartButton"
            disabled={busy || !loaded}
            onClick={() => resetDialog.current?.showModal()}
          >
            ↻ Start new demo
          </button>
          <Link href="/call-history" prefetch={false}>
            Demo history ↗
          </Link>
          <span className="cfSynthetic">Synthetic property case</span>
          <label>
            Demo role
            <select
              aria-label="Demo role"
              value={role}
              onChange={(event) => {
                setRole(event.target.value as Role);
                setError("");
                setMessage("");
              }}
            >
              <option value="coordinator">Coordinator</option>
              <option value="reviewer">EP Reviewer</option>
            </select>
          </label>
        </div>
      </header>
      <main className="cfMain">
        <div className="cfCaseHeading">
          <div>
            <p className="cfEyebrow">CURRENT INVESTIGATION · ESA-0047</p>
            <h1>47 Baker Street</h1>
            <p>
              {stage === "records"
                ? "Before this property is reused, an environmental consultant needs to know whether clothes were cleaned here or only collected for cleaning elsewhere."
                : "What happened onsite during 1987–1994? Each interview adds only what that person knows."}
            </p>
          </div>
          <div className="cfCaseSummary">
            <div className="cfQuickFacts" aria-label="Explore this case">
              <button onClick={() => setStage("records")}>
                <strong>{SOURCE_RECORDS.length}</strong> records <span>↗</span>
              </button>
              <button onClick={() => setStage("people")}>
                <strong>{contacts.contacts.length}</strong>{" "}
                {contacts.contacts.length === 1 ? "person" : "people"}{" "}
                <span>↗</span>
              </button>
              <button onClick={() => setStage("evidence")}>
                <strong>{evidence.runs.length}</strong>{" "}
                {evidence.runs.length === 1 ? "call" : "calls"} <span>↗</span>
              </button>
            </div>
            <div className="cfCaseState">
              <span>Case status</span>
              <strong>
                {workflow
                  ? human(workflow.workflow.status)
                  : "Loading saved case…"}
              </strong>
              <small>
                {readiness?.integration_label || "Checking provider…"}
              </small>
            </div>
          </div>
        </div>
        {stage !== "records" && (
          <section
            className="cfYearBoard"
            aria-label="Reviewed interview years"
          >
            <div>
              <strong>
                {evidence.coverage.years.length} of 8 years have reviewed
                testimony
              </strong>
              <span>
                {evidence.runs.length === 0
                  ? "No calls have been made in this investigation."
                  : "Call completion does not close the evidence gap."}
              </span>
            </div>
            <div className="cfYearGrid">
              {RESEARCH_YEARS.map((year) => (
                <button
                  key={year}
                  className={
                    evidence.coverage.years.includes(year) ? "covered" : ""
                  }
                  aria-pressed={yearDetail === year}
                  onClick={() =>
                    setYearDetail(yearDetail === year ? null : year)
                  }
                >
                  <strong>{year}</strong>
                  <span>
                    {evidence.coverage.years.includes(year)
                      ? "Reviewed"
                      : "Open"}
                  </span>
                </button>
              ))}
            </div>
            {yearDetail !== null && (
              <p role="status">
                {yearDetail}:{" "}
                {evidence.coverage.years.includes(yearDetail)
                  ? "A reviewer retained testimony addressing this year. This is not an environmental conclusion."
                  : "No reviewed interview has established testimony for this year yet."}
              </p>
            )}
          </section>
        )}
        <nav className="cfSteps" aria-label="Case workflow" ref={stageNav}>
          {stages.map(([id, title], i) => (
            <button
              key={id}
              aria-current={stage === id ? "step" : undefined}
              onClick={() => {
                setStage(id);
                setMessage("");
              }}
            >
              <span>{i + 1}</span>
              <b>{title}</b>
              <i aria-hidden="true">↗</i>
            </button>
          ))}
        </nav>
        {error && (
          <div className="cfNotice cfError" role="alert">
            {error}
            <button onClick={() => runAction(refresh)}>Refresh</button>
          </div>
        )}
        {activeAttempt && (
          <div className="cfNotice">
            <strong>
              {activeAttempt.has_provider_id
                ? "An existing call is still active or processing."
                : "The last submission is unconfirmed. Keep the same attempt."}
            </strong>
            <p>
              {activeAttempt.has_provider_id
                ? "Resume its status checks before preparing another interview."
                : "Retrying the saved brief uses the same request identifier. Do not prepare a new call."}
            </p>
            <button
              disabled={busy || role !== "coordinator"}
              onClick={() =>
                runAction(async () => {
                  if (activeAttempt.has_provider_id) {
                    setPollingRunId(activeAttempt.run_id);
                    setStage("brief");
                  } else {
                    setContacts(
                      await api<ContactData>("/api/case-file", role, {
                        action: "select_contact",
                        contactId: activeAttempt.contact_id,
                      }),
                    );
                    setPreview(activeAttempt);
                    setReviewed(false);
                    setConfirmation("");
                    setStage("brief");
                  }
                })
              }
            >
              {activeAttempt.has_provider_id
                ? "Resume existing call checks"
                : "Restore saved brief for retry"}
            </button>
          </div>
        )}
        {message && (
          <div className="cfToast" key={message} role="status">
            <span className="cfToastCheck" aria-hidden="true">
              ✓
            </span>
            <span>{message}</span>
            <button
              aria-label="Dismiss feedback"
              onClick={() => setMessage("")}
            >
              ×
            </button>
          </div>
        )}
        {readiness?.provider_mode === "fake" && (
          <div className="cfNotice cfRehearsal">
            Synthetic rehearsal mode. Conversations and evidence in this mode
            are fixed test scenarios. No phone calls are made.
          </div>
        )}

        {stage === "records" && (
          <section className="cfRecordsLayout">
            <div className="cfDocuments">
              <div className="cfSectionHeading">
                <div>
                  <p className="cfEyebrow">01 · SOURCE RECORDS</p>
                  <h2 ref={documentHeading} tabIndex={-1}>
                    Start with the source records
                  </h2>
                </div>
                <a href={source.file} target="_blank" rel="noreferrer">
                  Open full document ↗
                </a>
              </div>
              <div
                className="cfDocumentTabs"
                role="tablist"
                aria-label="Source documents"
              >
                {SOURCE_RECORDS.map((item, index) => (
                  <button
                    role="tab"
                    aria-selected={source.id === item.id}
                    key={item.id}
                    onClick={() => setRecordId(item.id)}
                  >
                    <span className="cfDocIndex" aria-hidden="true">
                      0{index + 1}
                    </span>
                    {item.title}
                  </button>
                ))}
              </div>
              <div className="cfDocumentMeta" key={source.id}>
                <strong>{source.title}</strong>
                <span>
                  {source.location} · {source.date}
                </span>
                <span>Supplied by: {source.suppliedBy}</span>
              </div>
              <iframe
                className="cfDocumentFrame"
                src={`${source.file}#${source.id === "directory" ? "entry-47" : source.id === "questionnaire" ? "question-4" : "referral"}`}
                title={source.title}
                sandbox=""
              />
              <p className="cfSmall">
                Prepared, synthetic source documents with manually linked
                excerpts. No automatic document extraction is claimed.
              </p>
            </div>
            <aside className="cfGap">
              <p className="cfEyebrow">WHY FOLLOW UP</p>
              <h2>The records leave one question open.</h2>
              <button
                className="cfSourceQuote"
                onClick={() => showSourceRecord("directory")}
              >
                <small>Historical directory · page 1</small>
                <q>Sparkle Cleaners, 1987–1994</q>
              </button>
              <button
                className="cfSourceQuote"
                onClick={() => showSourceRecord("questionnaire")}
              >
                <small>Owner questionnaire · question 4</small>
                <q>I believe it was only a drop shop.</q>
              </button>
              <p>
                A “drop shop” collects clothes for cleaning elsewhere. The
                directory names a cleaner, but the owner’s answer is only a
                belief. Neither record confirms what happened onsite.
              </p>
              <div className="cfQuestion">
                <span>Evidence gap</span>
                <strong>
                  Was cleaning performed onsite, and which years can a
                  respondent personally speak to?
                </strong>
              </div>
              <button
                className="cfSceneLauncher"
                onClick={() => sceneDialog.current?.showModal()}
              >
                <img
                  src="/illustrations/dry-cleaner.png"
                  width="1672"
                  height="941"
                  loading="lazy"
                  decoding="async"
                  alt="Illustrated cleaner's front counter and closed rear door"
                />
                <span>
                  <small>EXPLORE THE SETTING</small>
                  <strong>What could they actually see?</strong>
                  <i aria-hidden="true">↗</i>
                </span>
              </button>
              <h3>Next: find someone who knows</h3>
              <p>
                The referral note and supplied contact list identify former
                managers and an operator who may know. Their firsthand knowledge
                still needs to be established through interviews.
              </p>
              <button className="cfPrimary" onClick={() => setStage("people")}>
                Next: people to call →
              </button>
            </aside>
          </section>
        )}

        {stage === "people" && (
          <section>
            <div className="cfSectionHeading">
              <div>
                <p className="cfEyebrow">02 · PEOPLE & CALLS</p>
                <h2>
                  {evidence.runs.length
                    ? "Who can answer the remaining question?"
                    : "People we need to call"}
                </h2>
                <p>
                  Enter your number to play a witness in this fictional property
                  case. CALL-E will dial it, and your actual answers will become
                  the interview record.
                </p>
              </div>
              <button
                className="cfSecondary"
                disabled={role !== "coordinator"}
                onClick={() => setNewContact(!newContact)}
              >
                {newContact ? "Close new contact" : "Add a supplied contact"}
              </button>
            </div>
            <div className="cfPeopleLayout">
              <div className="cfPeopleList">
                {contacts.contacts.map((item) => (
                  <article
                    key={item.id}
                    className={
                      contact?.id === item.id ? "cfPerson selected" : "cfPerson"
                    }
                  >
                    <p className="cfEyebrow">
                      {item.sourceRun
                        ? "RESPONDENT-SUPPLIED LEAD"
                        : "SUPPLIED REFERRAL"}
                    </p>
                    <h3>{item.name}</h3>
                    <p>{item.role}</p>
                    <p>
                      <strong>Expected knowledge:</strong>{" "}
                      {item.expectedPeriod || "Not established"}
                    </p>
                    <span className="cfStatus">{item.readiness}</span>
                    <span className="cfCallBadge">
                      {evidence.runs.some((run) => run.contactId === item.id)
                        ? `${evidence.runs.filter((run) => run.contactId === item.id).length} call(s) in this case`
                        : "Not called"}
                    </span>
                    <details className="cfContactSource">
                      <summary>Referral source</summary>
                      <p className="cfSmall">Source: {item.source}</p>
                      {item.sourceQuote && (
                        <blockquote>{item.sourceQuote}</blockquote>
                      )}
                      {item.sourceRecord && (
                        <button
                          className="cfTextButton"
                          onClick={() => openRecord(item.sourceRecord!)}
                        >
                          Read referral note ↗
                        </button>
                      )}
                    </details>
                    <button
                      className="cfSecondary"
                      disabled={
                        busy ||
                        role !== "coordinator" ||
                        contact?.id === item.id
                      }
                      onClick={() =>
                        runAction(async () => {
                          setContacts(
                            await api<ContactData>("/api/case-file", role, {
                              action: "select_contact",
                              contactId: item.id,
                            }),
                          );
                          setPreview(null);
                        })
                      }
                    >
                      {contact?.id === item.id
                        ? "Selected respondent"
                        : "Select this respondent"}
                    </button>
                  </article>
                ))}
                <button
                  className="cfTextButton"
                  disabled={busy || role !== "coordinator"}
                  onClick={() =>
                    runAction(async () => {
                      setContacts(
                        await api<ContactData>("/api/case-file", role, {
                          action: "select_contact",
                          contactId: null,
                        }),
                      );
                      setPreview(null);
                    })
                  }
                >
                  None of these people is suitable
                </button>
              </div>
              <div>
                {newContact ? (
                  <ContactForm
                    key="new"
                    contact={null}
                    disabled={busy || role !== "coordinator"}
                    onSave={(values) =>
                      runAction(async () => {
                        const data = await api<ContactData>(
                          "/api/case-file",
                          role,
                          { action: "save_contact", ...values },
                        );
                        setContacts(data);
                        setNewContact(false);
                        setMessage(
                          "Contact saved with its source. Select it when appropriate.",
                        );
                      })
                    }
                  />
                ) : contact ? (
                  <ContactForm
                    key={`${contact.id}-${contact.version}`}
                    contact={contact}
                    disabled={busy || role !== "coordinator"}
                    onSave={(values) =>
                      runAction(async () => {
                        setContacts(
                          await api<ContactData>("/api/case-file", role, {
                            action: "save_contact",
                            ...values,
                          }),
                        );
                        setPreview(null);
                        setMessage(
                          "Contact and permission details saved. Any earlier brief must be reviewed again.",
                        );
                      })
                    }
                  />
                ) : (
                  <div className="cfEmpty">
                    <h3>No respondent identified</h3>
                    <p>
                      An incomplete record does not mean a call can happen.
                      Obtain a suitable person or another record first.
                    </p>
                  </div>
                )}
                <div className="cfNextBox">
                  <h3>
                    {contactReady
                      ? "Ready to prepare a brief"
                      : contact
                        ? contact.readiness
                        : "A source is needed first"}
                  </h3>
                  <p>
                    {contactReady
                      ? "Preparing a brief does not place a call."
                      : "Enter the consenting participant's number and save the permission above. Then you can prepare a real CALL-E interview."}
                  </p>
                  {contactReady ? (
                    <button
                      className="cfPrimary"
                      disabled={busy || !loaded || role !== "coordinator"}
                      onClick={prepare}
                    >
                      Prepare interview brief →
                    </button>
                  ) : (
                    <button
                      className="cfPrimary"
                      disabled={role !== "coordinator"}
                      onClick={() =>
                        openTask(
                          contact?.id || null,
                          contact
                            ? `Obtain authorized contact details and permission for ${contact.name} through the property team. Confirm their relevance to the missing historical period.`
                            : "Ask the property team to identify a person with firsthand historical knowledge or obtain another record relevant to the cleaner's operations.",
                        )
                      }
                    >
                      Create contact or record task →
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {stage === "brief" && (
          <section>
            <div className="cfSectionHeading">
              <div>
                <p className="cfEyebrow">03 · INTERVIEW BRIEF</p>
                <h2>One factual question, relevant follow-ups</h2>
                <p>
                  The reviewed instructions below are the instructions sent with
                  the call.
                </p>
              </div>
              <span className="cfStatus">
                {readiness?.integration_label || "Checking integration"}
              </span>
            </div>
            {readiness?.provider_mode === "calle_goal" && (
              <div className="cfNotice cfError">
                This revised brief uses the Calls API. Published Goal Runs have
                a separate contract and cannot execute this brief.
              </div>
            )}
            {readiness?.provider_mode === "fake" && (
              <label className="cfField">
                Synthetic rehearsal scenario
                <select
                  value={scenario}
                  onChange={(event) => {
                    setScenario(event.target.value);
                    setPreview(null);
                  }}
                >
                  <option value="bounded">
                    Drop-off knowledge and a new lead
                  </option>
                  <option value="direct">Firsthand onsite cleaning</option>
                  <option value="declined">Human requested</option>
                </select>
              </label>
            )}
            <label className="cfField">
              Remaining question for this call (optional)
              <textarea
                value={followUpFocus}
                maxLength={800}
                disabled={
                  busy ||
                  role !== "coordinator" ||
                  Boolean(readiness?.pending_attempt)
                }
                placeholder="For example: the first interview only addresses 1992–1993. Ask this earlier operator about firsthand work during 1987–1991."
                onChange={(event) => {
                  setFollowUpFocus(event.target.value);
                  setPreview(null);
                  setReviewed(false);
                  setConfirmation("");
                }}
              />
              <span className="cfSmall">
                Use the reviewed evidence to choose the missing years or facts.
                Preparing a new brief includes this question in the exact
                instructions you approve. Each additional call needs its own
                approval.
              </span>
            </label>
            {!previewCurrent ? (
              <div className="cfEmpty">
                <h3>
                  {contactReady
                    ? "Prepare a current brief"
                    : "Contact readiness comes first"}
                </h3>
                <p>
                  {contactReady
                    ? "A new brief includes the saved respondent details, source records and interview priorities."
                    : "A suitable respondent, a supplied phone number and both permissions are required."}
                </p>
                <button
                  className="cfPrimary"
                  disabled={
                    busy ||
                    !loaded ||
                    role !== "coordinator" ||
                    readiness?.provider_mode === "calle_goal"
                  }
                  onClick={contactReady ? prepare : () => setStage("people")}
                >
                  {contactReady
                    ? "Prepare interview brief"
                    : "Review contact readiness"}
                </button>
              </div>
            ) : (
              preview && (
                <div className="cfBriefLayout">
                  <div>
                    <div className="cfBriefSummary">
                      <p className="cfEyebrow">
                        {preview.plan.property} · {contact?.name}
                      </p>
                      <h3>{preview.plan.evidenceGap}</h3>
                      <p>
                        <strong>Expected knowledge, to confirm:</strong>{" "}
                        {preview.plan.expectedKnowledgePeriod}
                      </p>
                      <p>
                        <strong>Known records:</strong>{" "}
                        {preview.plan.knownRecords}
                      </p>
                    </div>
                    <ol className="cfBranchList">
                      {(preview.branches || INTERVIEW_BRANCHES).map(
                        (branch) => (
                          <li key={branch.id}>
                            <h3>{branch.title}</h3>
                            <p>{branch.rule}</p>
                          </li>
                        ),
                      )}
                    </ol>
                    <details className="cfDetails">
                      <summary>Complete instructions for this call</summary>
                      <pre>{preview.task}</pre>
                    </details>
                  </div>
                  <aside className="cfApproval">
                    <h3>Review before calling</h3>
                    <p>
                      Respondent: <strong>{contact?.name}</strong>
                      <br />
                      Supplied number: {contact?.maskedPhone}
                    </p>
                    <p>
                      The interview collects factual evidence. Every material
                      statement requires human review.
                    </p>
                    <label className="cfCheck">
                      <input
                        type="checkbox"
                        checked={reviewed}
                        onChange={(event) => setReviewed(event.target.checked)}
                        disabled={busy || role !== "coordinator"}
                      />
                      I reviewed this exact brief
                    </label>
                    {live && (
                      <>
                        <p className="cfSmall">
                          This will place one real phone call to the authorized
                          participant.
                        </p>
                        <label className="cfField">
                          Type PLACE LIVE CALL
                          <input
                            autoComplete="off"
                            value={confirmation}
                            onChange={(event) =>
                              setConfirmation(event.target.value)
                            }
                            disabled={busy || role !== "coordinator"}
                          />
                        </label>
                        <p className="cfSmall">
                          Local call allowance:{" "}
                          {readiness?.live_call_slots_remaining ?? "—"}{" "}
                          remaining.
                        </p>
                      </>
                    )}
                    <button
                      className="cfPrimary"
                      disabled={
                        busy ||
                        role !== "coordinator" ||
                        !reviewed ||
                        !previewCurrent ||
                        Boolean(pollingRunId) ||
                        Boolean(activeAttempt?.has_provider_id) ||
                        (live &&
                          (!readiness?.provider_configured ||
                            !readiness.live_calls_enabled ||
                            !readiness.live_call_slots_remaining ||
                            confirmation !== "PLACE LIVE CALL"))
                      }
                      onClick={launch}
                    >
                      {busy
                        ? "Submitting…"
                        : live
                          ? "Place one live call"
                          : "Run synthetic rehearsal"}
                    </button>
                    {live &&
                      (!readiness?.provider_configured ||
                        !readiness.live_calls_enabled) && (
                        <p className="cfSmall">
                          Live calling is not configured and enabled.
                        </p>
                      )}
                  </aside>
                </div>
              )
            )}
            {(callStatus || pollingRunId) && (
              <div className="cfCallProgress" role="status">
                <strong>Provider-reported status: {human(callStatus)}</strong>
                <p>
                  {pollingRunId
                    ? "Checking for returned evidence. Call completion and evidence processing are separate steps."
                    : "Status checks are paused or complete."}
                </p>
                {lastCheck && (
                  <small>Last successful check: {date(lastCheck)}</small>
                )}
              </div>
            )}
            {evidence.runs.some((run) => !run.terminal) && !pollingRunId && (
              <button
                className="cfSecondary"
                disabled={role !== "coordinator"}
                onClick={() => {
                  const active = evidence.runs.find((run) => !run.terminal);
                  if (active) setPollingRunId(active.id);
                }}
              >
                Resume checks for the existing call
              </button>
            )}
          </section>
        )}

        {stage === "evidence" && (
          <section>
            <div className="cfSectionHeading">
              <div>
                <p className="cfEyebrow">04 · EVIDENCE & HUMAN REVIEW</p>
                <h2>What did this interview establish?</h2>
                <p>
                  Compare the original answer with the returned evidence. A call
                  finishing does not resolve the case.
                </p>
              </div>
              <button
                className="cfSecondary"
                disabled={
                  !statements.some((item) => item.status === "accepted")
                }
                onClick={exportEvidence}
              >
                Export accepted evidence
              </button>
            </div>
            {evidence.runs.length > 0 && (
              <label className="cfField cfRunSelect">
                Calls in this investigation
                <select
                  value={selectedRun?.id || ""}
                  onChange={(event) => {
                    setSelectedRunId(Number(event.target.value));
                    setHighlight([]);
                  }}
                >
                  {evidence.runs.map((run) => (
                    <option key={run.id} value={run.id}>
                      Call {run.sequence} · {run.contactName} ·{" "}
                      {date(run.recordedAt)} ·{" "}
                      {run.provider === "fake"
                        ? "Synthetic rehearsal"
                        : "CALL-E"}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {selectedRun?.provider === "fake" && (
              <div className="cfNotice cfRehearsal">
                This is a fixed synthetic rehearsal, not a recording of CALL-E
                behavior.
              </div>
            )}
            {selectedRun && (
              <div className="cfEvidenceSummary">
                <div>
                  <span>Call execution</span>
                  <strong>{human(selectedRun.status)}</strong>
                </div>
                <div>
                  <span>Proposed interview outcome</span>
                  <strong>
                    {selectedRun.evidence?.profile === "evidence-v2"
                      ? human(selectedRun.evidence.outcome)
                      : "Not separately established"}
                  </strong>
                </div>
                <div>
                  <span>Reviewed year coverage</span>
                  <strong>
                    {evidence.coverage.years.length} of {RESEARCH_YEARS.length}{" "}
                    years
                  </strong>
                  <small>
                    {historicalUseResolved
                      ? "Historical-use question resolved by reviewer"
                      : evidence.coverage.missingYears.length
                        ? "Remaining years still need reviewed testimony"
                        : "Complete year coverage · reviewer decision pending"}
                  </small>
                </div>
              </div>
            )}
            {selectedRun?.terminal &&
              role === "coordinator" &&
              workflow?.workflow.assigned_role === "reviewer" && (
                <button
                  className="cfPrimary"
                  onClick={() => setRole("reviewer")}
                >
                  Review returned evidence
                </button>
              )}
            {(selectedRun?.error || selectedRun?.validationError) && (
              <div className="cfNotice cfError">
                {selectedRun.validationError || selectedRun.error?.message}{" "}
                Available original transcript is retained below. No substitute
                evidence has been generated.
              </div>
            )}
            <div className="cfComparison">
              <article>
                <p className="cfEyebrow">BEFORE · ORIGINAL OWNER ANSWER</p>
                <blockquote>“I believe it was only a drop shop.”</blockquote>
                <button
                  className="cfTextButton"
                  onClick={() => openRecord("questionnaire")}
                >
                  Open source questionnaire ↗
                </button>
                <p>
                  The directory lists a cleaner from 1987–1994. It does not
                  describe onsite operations.
                </p>
              </article>
              <article>
                <p className="cfEyebrow">AFTER · EVIDENCE ADDED</p>
                {statements.length ? (
                  <ul>
                    {statements.map((item) => (
                      <li key={item.id}>
                        {item.fact}
                        <span className="cfInlineStatus">
                          {human(item.status)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    {selectedRun
                      ? "No reviewable factual statements were returned for this interview."
                      : "No interview evidence yet. Contact readiness is the next step."}
                  </p>
                )}
              </article>
            </div>
            {selectedRun?.evidence && (
              <div className="cfFindings">
                <h3>Knowledge and remaining questions</h3>
                {selectedRun.evidence.profile === "compact-legacy" ? (
                  <p>
                    This earlier call returned one compact statement and
                    uncertainty notes. It did not separately extract a knowledge
                    period, outcome, branch coverage or new leads. Do not infer
                    those fields from the demonstration setup.
                  </p>
                ) : (
                  <p>
                    <strong>Extracted date summary:</strong>{" "}
                    {selectedRun.evidence.knowledge_period}{" "}
                    <CitationButton
                      citation={selectedRun.knowledgeCitation}
                      onClick={() => showQuote(selectedRun.knowledgeCitation)}
                    />
                  </p>
                )}
                {selectedRun.evidence.profile !== "evidence-v2" &&
                  selectedRun.evidence.limitations && (
                    <p>
                      <strong>Reported limitations / uncertainty:</strong>{" "}
                      {selectedRun.evidence.limitations}
                    </p>
                  )}
                {selectedRun.evidence.profile !== "evidence-v2" &&
                  selectedRun.evidence.unknowns && (
                    <p>
                      <strong>Reported unknowns:</strong>{" "}
                      {selectedRun.evidence.unknowns}
                    </p>
                  )}
                {[
                  ...selectedRun.evidence.limitation_items.map((item) => ({
                    ...item,
                    label: "Reported limitation",
                  })),
                  ...selectedRun.evidence.unknown_items.map((item) => ({
                    ...item,
                    label: "Reported unknown",
                  })),
                ].map((item, i) => (
                  <p key={i}>
                    <strong>{item.label}:</strong> {item.text}{" "}
                    <CitationButton
                      citation={selectedRun.noteCitations[i]}
                      onClick={() =>
                        showQuote(selectedRun.noteCitations[i])
                      }
                    />
                  </p>
                ))}
                {selectedRun.evidence.leads.map((lead, i) => (
                  <p key={i}>
                    <strong>Named lead:</strong> {lead.name} — {lead.reason}{" "}
                    <CitationButton
                      citation={selectedRun.leadCitations[i]}
                      onClick={() =>
                        showQuote(selectedRun.leadCitations[i])
                      }
                    />
                  </p>
                ))}
                {selectedRun.branches.length > 0 && (
                  <details className="cfDetails">
                    <summary>
                      Questions addressed in the returned conversation
                    </summary>
                    <p className="cfSmall">
                      These are post-call extraction results, not a live view of
                      CALL-E’s internal decisions. Check the transcript.
                    </p>
                    <ul>
                      {selectedRun.branches.map((branch) => (
                        <li key={branch.id}>
                          <strong>{branch.title}:</strong>{" "}
                          {human(branch.status)}{" "}
                          {branch.quote && (
                            <CitationButton
                              citation={branch.citation}
                              onClick={() => showQuote(branch.citation)}
                            />
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
            <div className="cfReviewLayout">
              <div className="cfTranscript">
                <h3>Conversation source</h3>
                {selectedRun?.turns.length ? (
                  selectedRun.turns.map((turn) => (
                    <article
                      id={turn.id}
                      key={turn.id}
                      className={
                        highlight.includes(turn.id)
                          ? "cfTurn highlighted"
                          : "cfTurn"
                      }
                    >
                      <div>
                        <strong>
                          {turn.speaker === "assistant"
                            ? selectedRun?.provider === "fake"
                              ? "Rehearsal assistant"
                              : "CALL-E"
                            : turn.speaker === "respondent"
                              ? "Respondent"
                              : "Unknown speaker"}
                        </strong>
                        <span>
                          Turn {turn.index}
                          {turn.offsetSeconds !== null
                            ? ` · ${Math.floor(turn.offsetSeconds / 60)}:${String(Math.floor(turn.offsetSeconds % 60)).padStart(2, "0")}`
                            : ""}
                        </span>
                      </div>
                      <p>{turn.text}</p>
                    </article>
                  ))
                ) : (
                  <p>No transcript is available for this interview.</p>
                )}
              </div>
              <div className="cfStatements">
                <div className="cfSectionHeading">
                  <h3>Review the claims</h3>
                  <span>
                    {
                      statements.filter((item) => item.status === "pending")
                        .length
                    }{" "}
                    pending
                  </span>
                </div>
                <p className="cfSmall">
                  A matched quotation proves that the words occurred. Check
                  whether it supports the full claim before accepting.
                </p>
                {!canReview && (
                  <div className="cfNotice">
                    {role !== "reviewer"
                      ? "Switch to EP Reviewer to make evidence decisions."
                      : "This case has a saved decision or is assigned elsewhere. Reopen review to add a new decision without deleting history."}
                    {role === "reviewer" && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          runAction(async () => {
                            await api("/api/case-file", role, {
                              action: "reopen_review",
                            });
                            await refresh();
                            setRationale("");
                          })
                        }
                      >
                        Reopen human review
                      </button>
                    )}
                  </div>
                )}
                {statements.map((item) => (
                  <article
                    className="cfStatement"
                    key={item.id}
                    data-review={item.status}
                  >
                    <div className="cfStatementMeta">
                      <span>
                        {human(item.origin)} · revision {item.revision}
                      </span>
                      <strong
                        className="cfDecisionBadge"
                        key={`${item.status}-${item.revision}`}
                      >
                        {human(item.status)}
                      </strong>
                    </div>
                    <p className="cfFact">{item.fact}</p>
                    <p className="cfSmall">
                      {human(item.source)} · {human(item.certainty)}
                    </p>
                    <blockquote>{item.evidence}</blockquote>
                    {item.runId ? (
                      <CitationButton
                        citation={item.citation}
                        onClick={() => showQuote(item.citation)}
                      />
                    ) : (
                      <p className="cfSmall">
                        Original {human(item.origin)} response. This is not a
                        call transcript.
                      </p>
                    )}
                    {item.limitations && <p>{item.limitations}</p>}
                    {item.edits.length > 0 && (
                      <details>
                        <summary>Original wording and reviewer notes</summary>
                        <p>{item.originalFact}</p>
                        {item.edits.map((edit, i) => (
                          <p key={i}>{edit.note}</p>
                        ))}
                      </details>
                    )}
                    {editing === item.id ? (
                      <div className="cfEdit">
                        <label className="cfField">
                          Supported wording
                          <textarea
                            value={editFact}
                            onChange={(event) =>
                              setEditFact(event.target.value)
                            }
                          />
                        </label>
                        <label className="cfField">
                          Exact supporting quotation
                          <textarea
                            value={editEvidence}
                            onChange={(event) =>
                              setEditEvidence(event.target.value)
                            }
                          />
                        </label>
                        <label className="cfField">
                          Reason for revision
                          <textarea
                            value={editNote}
                            onChange={(event) =>
                              setEditNote(event.target.value)
                            }
                          />
                        </label>
                        <button
                          className="cfPrimary"
                          disabled={
                            busy || !canReview || editNote.trim().length < 5
                          }
                          onClick={() =>
                            runAction(async () => {
                              await api("/api/workflow", role, {
                                action: "edit",
                                statement_id: item.id,
                                expected_revision: item.revision,
                                fact: editFact,
                                note: editNote,
                                evidence_quote: editEvidence,
                                source: item.source,
                                certainty: item.certainty,
                                limitations: item.limitations
                                  ? [item.limitations]
                                  : [],
                              });
                              setEditing(null);
                              await refresh();
                            })
                          }
                        >
                          Save revision
                        </button>
                        <button
                          className="cfTextButton"
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="cfActions">
                        <button
                          disabled={
                            busy ||
                            !canReview ||
                            (item.runId !== null &&
                              item.citation?.status !== "matched")
                          }
                          onClick={() => reviewStatement(item, "accepted")}
                        >
                          Accept
                        </button>
                        <button
                          disabled={busy || !canReview}
                          onClick={() => {
                            setEditing(item.id);
                            setEditFact(item.fact);
                            setEditNote("");
                            setEditEvidence(item.evidence);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          disabled={busy || !canReview}
                          onClick={() => reviewStatement(item, "rejected")}
                        >
                          Reject
                        </button>
                        <button
                          disabled={busy || !canReview}
                          onClick={() => reviewStatement(item, "follow_up")}
                        >
                          Follow up
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </div>
            {selectedRun?.terminal && selectedRun.turns.length > 0 && (
              <section className="cfCoverageReview">
                <p className="cfEyebrow">
                  HUMAN REVIEW · ACTUAL INTERVIEW YEARS
                </p>
                <h3>Which years does this answer really address?</h3>
                <p>
                  Select only years the respondent personally knew. Dates
                  mentioned as unknown or outside their knowledge must stay
                  open.
                </p>
                <p className="cfSmall">
                  Automatic dates are suggestions. You can select any supported
                  year and explain a correction. Other claims can be reviewed
                  later.
                </p>
                {selectedRun.knowledgeCitation.status !== "matched" && (
                  <p className="cfNotice">
                    The extracted date summary does not match one original
                    answer. Choose the respondent&apos;s actual words below to
                    review the years.
                  </p>
                )}
                <label className="cfField">
                  Original respondent answer
                  <select
                    value={coverageForm.sourceTurnId}
                    disabled={!canReview || busy}
                    onChange={(event) => {
                      const turn = selectedRun.turns.find(
                        (item) =>
                          item.id === event.target.value &&
                          item.speaker === "respondent",
                      );
                      updateCoverage({
                        sourceTurnId: turn?.id || "",
                        quote: turn?.text || "",
                        years: [],
                        interpretationNote: "",
                        confirmed: false,
                      });
                    }}
                  >
                    <option value="">Choose an answer from this call</option>
                    {selectedRun.turns
                      .filter((turn) => turn.speaker === "respondent")
                      .map((turn) => (
                        <option key={turn.id} value={turn.id}>
                          Turn {turn.index}: {turn.text}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="cfField">
                  Exact respondent quotation establishing the years
                  <textarea
                    value={coverageForm.quote}
                    disabled={!canReview || busy}
                    onChange={(event) =>
                      updateCoverage({
                        quote: event.target.value,
                        years: [],
                        interpretationNote: "",
                        confirmed: false,
                      })
                    }
                  />
                </label>
                <p className="cfSmall">
                  Suggested years: {describeYears(suggestedYears)}. Check the
                  answer and its limits before confirming.
                  {coverageCitation.status === "matched" && (
                    <>
                      {" "}
                      <CitationButton
                        citation={coverageCitation}
                        onClick={() => showQuote(coverageCitation)}
                      />
                    </>
                  )}
                </p>
                <div className="cfYearActions">
                  <button
                    className="cfSecondary"
                    disabled={!canReview || busy || !suggestedYears.length}
                    onClick={() =>
                      updateCoverage({
                        years: suggestedYears,
                        interpretationNote: "",
                        confirmed: false,
                      })
                    }
                  >
                    Use suggested years
                  </button>
                  <button
                    className="cfSecondary"
                    disabled={!canReview || busy}
                    onClick={() =>
                      updateCoverage({
                        years: [...RESEARCH_YEARS],
                        confirmed: false,
                      })
                    }
                  >
                    Select all 1987–1994
                  </button>
                </div>
                <div className="cfYearChoices">
                  {RESEARCH_YEARS.map((year) => (
                    <label key={year}>
                      <input
                        type="checkbox"
                        disabled={!canReview || busy}
                        checked={coverageForm.years.includes(year)}
                        onChange={(event) =>
                          updateCoverage({
                            years: event.target.checked
                              ? [...coverageForm.years, year]
                              : coverageForm.years.filter(
                                  (value) => value !== year,
                                ),
                            confirmed: false,
                          })
                        }
                      />
                      {year}
                    </label>
                  ))}
                </div>
                {(manuallyInterpretedYears.length > 0 ||
                  interpretationLength > 0) && (
                  <label className="cfField cfYearInterpretation">
                    Reason for year correction
                    <span className="cfSmall">
                      {manuallyInterpretedYears.length > 0
                        ? `${describeYears(manuallyInterpretedYears)} was not automatically recognized. `
                        : ""}
                      Explain how this original answer establishes the selected
                      years. Your explanation will be saved with the quotation.
                    </span>
                    <textarea
                      value={coverageForm.interpretationNote}
                      disabled={!canReview || busy}
                      maxLength={1000}
                      placeholder="Explain the date wording and why it covers the selected years."
                      onChange={(event) =>
                        updateCoverage({
                          interpretationNote: event.target.value,
                          confirmed: false,
                        })
                      }
                    />
                  </label>
                )}
                <p className="cfSmall" aria-live="polite">
                  After saving: {projectedYears.length} of{" "}
                  {RESEARCH_YEARS.length} years will have reviewed testimony.{" "}
                  {allYearsSelected
                    ? "All research years are covered. The final historical-use decision remains with the reviewer."
                    : `${describeYears(RESEARCH_YEARS.filter((year) => !projectedYears.includes(year)))} still need reviewed testimony.`}
                </p>
                {savedRunCoverage && (
                  <p className="cfSmall">
                    Saved for this interview:{" "}
                    {describeYears(savedRunCoverage.years)}.
                    {savedRunCoverage.interpretationNote && (
                      <>
                        {" "}
                        Reviewer explanation:{" "}
                        {savedRunCoverage.interpretationNote}
                      </>
                    )}
                  </p>
                )}
                <label className="cfCheck">
                  <input
                    type="checkbox"
                    checked={coverageForm.confirmed}
                    disabled={!canReview || busy}
                    onChange={(event) =>
                      updateCoverage({ confirmed: event.target.checked })
                    }
                  />
                  I reviewed this date quotation and confirm the selected years
                  are within the respondent&apos;s firsthand knowledge.
                </label>
                <button
                  className="cfPrimary"
                  disabled={busy || Boolean(coverageSaveIssue)}
                  onClick={() =>
                    runAction(async () => {
                      const saved = await api<{ coverage: CaseCoverage }>(
                        "/api/case-coverage",
                        role,
                        {
                          runId: selectedRun.id,
                          quote: coverageForm.quote,
                          sourceTurnId: coverageForm.sourceTurnId,
                          interpretationNote: coverageForm.interpretationNote,
                          years: coverageForm.years,
                          reviewed: true,
                        },
                      );
                      setCoverageDraft(null);
                      await refresh();
                      setRole("coordinator");
                      setStage("followup");
                      setMessage(
                        saved.coverage.missingYears.length
                          ? "Reviewed years saved. Plan the next call for the remaining years; other claims remain available for review."
                          : "All eight years have reviewed testimony. Review the remaining claims and tasks, then save the historical-use decision.",
                      );
                    })
                  }
                >
                  {allYearsSelected
                    ? "Save complete year coverage"
                    : "Save reviewed years & plan follow-up"}
                </button>
                {coverageSaveIssue && (
                  <p className="cfSmall" role="status">
                    {coverageSaveIssue}
                  </p>
                )}
                {!coverageForm.quote && (
                  <p className="cfSmall">
                    Copy the respondent&apos;s exact date statement from the
                    transcript. No dates are assumed when the provider does not
                    return a usable quotation.
                  </p>
                )}
              </section>
            )}
            <details className="cfDisposition">
              <summary>Other human dispositions and saved decisions</summary>
              {otherPending.length > 0 && (
                <div className="cfNotice">
                  {otherPending.length} pending claims remain in other
                  interviews.{" "}
                  {Array.from(
                    new Set(otherPending.map((item) => item.runId)),
                  ).map((id) => (
                    <button key={id} onClick={() => setSelectedRunId(id)}>
                      Review interview {id}
                    </button>
                  ))}
                </div>
              )}
              <h3>Human case disposition</h3>
              <p>
                Base this decision on the reviewed evidence. An earlier saved
                rationale is history, not a suggested answer for this interview.
              </p>
              <label className="cfField">
                Disposition
                <select
                  value={disposition}
                  disabled={!canReview || busy}
                  onChange={(event) => setDisposition(event.target.value)}
                >
                  <option value="PARTIALLY_RESOLVED">Partially resolved</option>
                  <option value="REMAINS_UNRESOLVED">Remains unresolved</option>
                  <option value="HUMAN_INTERVIEW_REQUIRED">
                    Human interview required
                  </option>
                  <option value="ADDITIONAL_RECORD_REQUIRED">
                    Additional record required
                  </option>
                  <option value="RESOLVED_BY_REVIEWER">
                    Resolved by reviewer
                  </option>
                </select>
              </label>
              <label className="cfField">
                Rationale based on the actual evidence
                <textarea
                  placeholder="Explain what the evidence establishes and what remains open."
                  value={rationale}
                  disabled={!canReview || busy}
                  onChange={(event) => setRationale(event.target.value)}
                />
              </label>
              <button
                className="cfPrimary"
                disabled={
                  busy ||
                  !canReview ||
                  rationale.trim().length < 20 ||
                  evidence.statements.some((item) => item.status === "pending")
                }
                onClick={() =>
                  runAction(async () => {
                    await api("/api/workflow", role, {
                      action: "disposition",
                      disposition,
                      rationale,
                    });
                    await refresh();
                    setRationale("");
                    setMessage(
                      "Human disposition saved. Earlier decisions remain in the history.",
                    );
                    setStage("followup");
                  })
                }
              >
                Save human disposition
              </button>
              {workflow && workflow.dispositions.length > 0 && (
                <details className="cfDetails">
                  <summary>Saved disposition history</summary>
                  {workflow.dispositions.map((item) => (
                    <article key={item.id}>
                      <strong>
                        {human(item.disposition)} · {date(item.created_at)}
                      </strong>
                      <p>{item.rationale}</p>
                    </article>
                  ))}
                </details>
              )}
            </details>
          </section>
        )}

        {stage === "followup" && (
          <section>
            <div className="cfSectionHeading">
              <div>
                <p className="cfEyebrow">05 · NEXT ACTION</p>
                <h2>
                  {historicalUseResolved
                    ? "Historical-use question resolved"
                    : !evidence.coverage.missingYears.length
                      ? "All years have reviewed testimony"
                      : evidence.coverage.years.length
                        ? "Incomplete evidence leads to the next call"
                        : "Make the remaining work specific"}
                </h2>
                <p>
                  A name without a number is a lead. A task to obtain a record
                  is progress, even when another call is not ready.
                </p>
              </div>
            </div>
            {evidence.coverage.records.length > 0 && (
              <div className="cfNextCall">
                <p className="cfEyebrow">
                  REMAINING YEARS WITHOUT REVIEWED TESTIMONY
                </p>
                <h3>{describeYears(evidence.coverage.missingYears)}</h3>
                <p>
                  {evidence.coverage.years.length} of 8 years have reviewed
                  testimony.{" "}
                  {historicalUseResolved
                    ? "The reviewer saved a decision resolving the historical-use question."
                    : !evidence.coverage.missingYears.length
                      ? "A human decision is still required."
                      : "The investigation remains open."}
                </p>
                {evidence.suggestion ? (
                  <>
                    <h4>Next suggested contact: {evidence.suggestion.name}</h4>
                    <p>{evidence.suggestion.focus}</p>
                    <button
                      className="cfPrimary"
                      disabled={busy || role !== "coordinator"}
                      onClick={() =>
                        runAction(() =>
                          planNextCall(
                            evidence.suggestion!.contactId,
                            evidence.suggestion!.focus,
                          ),
                        )
                      }
                    >
                      Prepare next call with {evidence.suggestion.name}
                    </button>
                  </>
                ) : (
                  <p>
                    {historicalUseResolved
                      ? "This decision addresses historical use. It does not establish contamination, safety, or redevelopment suitability."
                      : "Review the remaining facts and assign a person or record task below. Having testimony for every year does not settle every question about onsite operations."}
                  </p>
                )}
              </div>
            )}
            <div className="cfFollowupLayout">
              <div>
                {role === "reviewer" && (
                  <p className="cfNotice">
                    Switch to Coordinator to assign contact or record work.
                  </p>
                )}
                <h3>People who may help</h3>
                {contacts.contacts.map((item) => (
                  <article className="cfPerson" key={item.id}>
                    <h3>{item.name}</h3>
                    <p>{item.role}</p>
                    <span className="cfStatus">{item.readiness}</span>
                    <p className="cfSmall">Source: {item.source}</p>
                    {item.sourceQuote && (
                      <blockquote>{item.sourceQuote}</blockquote>
                    )}
                    <button
                      className="cfSecondary"
                      disabled={role !== "coordinator"}
                      onClick={() =>
                        openTask(
                          item.id,
                          `Ask the property team to obtain contact details and permission for ${item.name}. Confirm whether they can help with the remaining questions supported by the interview.`,
                        )
                      }
                    >
                      Assign contact follow-up
                    </button>
                    <button
                      className="cfTextButton"
                      disabled={busy || role !== "coordinator"}
                      onClick={() =>
                        runAction(async () => {
                          setContacts(
                            await api<ContactData>("/api/case-file", role, {
                              action: "select_contact",
                              contactId: item.id,
                            }),
                          );
                          setNewContact(false);
                          setStage("people");
                        })
                      }
                    >
                      Review supplied details
                    </button>
                  </article>
                ))}
                <h3>
                  {!evidence.coverage.missingYears.length &&
                  !historicalUseResolved
                    ? "Earlier saved human decision"
                    : "Saved human decision"}
                </h3>
                {!evidence.coverage.missingYears.length &&
                  !historicalUseResolved && (
                    <>
                      <p>
                        All years now have reviewed testimony. Save an updated
                        decision after checking any outstanding work.
                      </p>
                      <button
                        className="cfPrimary"
                        onClick={() => {
                          setRole("reviewer");
                          setStage("evidence");
                        }}
                      >
                        Review complete evidence →
                      </button>
                    </>
                  )}
                {workflow?.dispositions[0] ? (
                  <>
                    <p>{human(workflow.dispositions[0].disposition)}</p>
                    <blockquote>
                      {workflow.dispositions[0].rationale}
                    </blockquote>
                    <p className="cfSmall">
                      Saved {date(workflow.dispositions[0].created_at)}. Review
                      this historical decision against the current evidence
                      before relying on it.
                    </p>
                    <button
                      className="cfTextButton"
                      onClick={() => setStage("evidence")}
                    >
                      Review evidence and decisions →
                    </button>
                  </>
                ) : (
                  <p>No human disposition has been saved.</p>
                )}
              </div>
              <div>
                <form
                  className="cfTaskForm"
                  onSubmit={(event) => {
                    event.preventDefault();
                    runAction(async () => {
                      setContacts(
                        await api<ContactData>("/api/case-file", role, {
                          action: "create_task",
                          title: taskContact
                            ? "Obtain contact details or a referral"
                            : "Obtain a historical respondent or record",
                          contactId: taskContact || null,
                          summary: taskSummary,
                          assignee: taskAssignee,
                        }),
                      );
                      setTaskSummary("");
                      setMessage(
                        "Internal task saved. No message or call was sent.",
                      );
                    });
                  }}
                >
                  <h3>Contact or record task</h3>
                  <label className="cfField">
                    Related person
                    <select
                      value={taskContact}
                      onChange={(event) => setTaskContact(event.target.value)}
                      disabled={role !== "coordinator" || busy}
                    >
                      <option value="">
                        No suitable person yet / record request
                      </option>
                      {contacts.contacts.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="cfField">
                    What needs to be obtained?
                    <textarea
                      value={taskSummary}
                      onChange={(event) => setTaskSummary(event.target.value)}
                      disabled={role !== "coordinator" || busy}
                      placeholder="Describe the missing information, who to ask, and why it is relevant."
                    />
                  </label>
                  <label className="cfField">
                    Assigned to
                    <input
                      value={taskAssignee}
                      onChange={(event) => setTaskAssignee(event.target.value)}
                      disabled={role !== "coordinator" || busy}
                    />
                  </label>
                  <p className="cfSmall">
                    This creates an internal task. It does not send a request or
                    look up contact details automatically.
                  </p>
                  <button
                    className="cfPrimary"
                    disabled={
                      busy ||
                      role !== "coordinator" ||
                      taskSummary.trim().length < 20 ||
                      !taskAssignee.trim()
                    }
                  >
                    Save follow-up task
                  </button>
                </form>
                <h3>Assigned work</h3>
                {contacts.tasks.length ? (
                  contacts.tasks.map((task) => (
                    <article
                      className="cfTask"
                      key={task.id}
                      data-state={task.status}
                    >
                      <span className="cfStatus">{task.status}</span>
                      <h4>{task.title}</h4>
                      <p>{task.summary}</p>
                      <p className="cfSmall">
                        Assigned to {task.assignee} · {date(task.createdAt)}
                      </p>
                      {task.status === "open" && (
                        <button
                          className="cfSecondary"
                          disabled={busy || role !== "coordinator"}
                          onClick={() =>
                            runAction(async () => {
                              setContacts(
                                await api<ContactData>("/api/case-file", role, {
                                  action: "complete_task",
                                  id: task.id,
                                }),
                              );
                              setMessage(
                                "Task completed. Any newly obtained contact details still need to be saved on the person.",
                              );
                            })
                          }
                        >
                          Mark task completed
                        </button>
                      )}
                    </article>
                  ))
                ) : (
                  <p>No contact or record tasks have been assigned.</p>
                )}
              </div>
            </div>
            <details className="cfDetails">
              <summary>Other response channels and audit history</summary>
              <p>
                <a href="/workflows">
                  Open written and human-interview workflows ↗
                </a>
              </p>
              {workflow?.audit.map((item) => (
                <p key={item.id}>
                  {date(item.created_at)} · {human(item.event_type)} ·{" "}
                  {item.actor}
                </p>
              ))}
            </details>
          </section>
        )}
        <footer className="cfFooter">
          <span>SiteWitness · Factual evidence for human review</span>
          <span>
            Source records and property identities in this case are synthetic.
          </span>
        </footer>
      </main>
    </div>
  );
}

function CitationButton({
  citation,
  onClick,
}: {
  citation: Citation | null;
  onClick: () => void;
}) {
  return citation?.status === "matched" ? (
    <button className="cfCitation" onClick={onClick}>
      View exact respondent quote ↗
    </button>
  ) : (
    <span className="cfUnverified">
      {citation?.status === "ambiguous"
        ? "Quote appears in multiple turns; review required"
        : citation?.status === "missing_transcript"
          ? "No transcript available to verify quote"
          : "Quote not verified against a respondent turn"}
    </span>
  );
}

function ContactForm({
  contact,
  disabled,
  onSave,
}: {
  contact: PublicContact | null;
  disabled: boolean;
  onSave: (values: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(contact?.name || "");
  const [role, setRole] = useState(contact?.role || "");
  const [period, setPeriod] = useState(contact?.expectedPeriod || "");
  const [source, setSource] = useState(contact?.source || "");
  const [phone, setPhone] = useState("");
  const [phoneSource, setPhoneSource] = useState(contact?.phoneSource || "");
  const [permission, setPermission] = useState(contact?.permissionNote || "");
  const [automated, setAutomated] = useState(
    contact?.automatedAllowed || false,
  );
  const [transcription, setTranscription] = useState(
    contact?.transcriptionAllowed || false,
  );
  const [clearPhone, setClearPhone] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({
      id: contact?.id,
      version: contact?.version,
      name,
      role,
      expectedPeriod: period,
      source,
      phone,
      phoneSource,
      permissionNote: permission,
      automatedAllowed: automated,
      transcriptionAllowed: transcription,
      clearPhone,
      permissionReconfirmed: Boolean(phone && automated && transcription),
    });
  };
  return (
    <form className="cfContactForm" onSubmit={submit}>
      <h3>
        {contact
          ? "Contact details & permission"
          : "Add a contact supplied by a person or record"}
      </h3>
      <details className="cfContactSource" open={!contact}>
        <summary>Witness role and referral details</summary>
        <div className="cfFieldPair">
          <label className="cfField">
            Respondent name
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={disabled}
              maxLength={200}
            />
          </label>
          <label className="cfField">
            Relationship to the property
            <input
              required
              value={role}
              onChange={(event) => setRole(event.target.value)}
              disabled={disabled}
              maxLength={500}
            />
          </label>
        </div>
        <label className="cfField">
          Expected knowledge period — to confirm
          <input
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            disabled={disabled}
            maxLength={1000}
          />
        </label>
        <label className="cfField">
          Who or what identified this person?
          <input
            required
            value={source}
            onChange={(event) => setSource(event.target.value)}
            disabled={disabled || Boolean(contact)}
            maxLength={1000}
          />
        </label>
      </details>
      <div className="cfPhoneSection">
        <p>
          <strong>Supplied number:</strong>{" "}
          {contact?.maskedPhone || "Not supplied"}
        </p>
        <label className="cfField">
          {contact?.hasPhone
            ? "Replace number (leave blank to retain it)"
            : "Authorized participant’s phone number"}
          <input
            type="tel"
            autoComplete="off"
            placeholder="+ country code and number"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
              setAutomated(false);
              setTranscription(false);
            }}
            disabled={disabled || clearPhone}
            maxLength={16}
          />
        </label>
        <label className="cfCheck cfSelfConsent">
          <input
            type="checkbox"
            disabled={disabled || clearPhone || (!phone && !contact?.hasPhone)}
            checked={
              automated &&
              transcription &&
              phoneSource === "Test participant supplied their own number"
            }
            onChange={(event) => {
              setAutomated(event.target.checked);
              setTranscription(event.target.checked);
              if (event.target.checked) {
                setPhoneSource("Test participant supplied their own number");
                setPermission(
                  `The participant confirmed in the workspace on ${new Date().toISOString()} that this is their number and agreed to an automated CALL-E demo interview and transcription for human review.`,
                );
              } else {
                setPhoneSource("");
                setPermission("");
              }
            }}
          />
          This is my number. I agree to CALL-E calling me and transcribing this
          demo interview.
        </label>
        {contact?.hasPhone && (
          <label className="cfCheck">
            <input
              type="checkbox"
              checked={clearPhone}
              onChange={(event) => {
                setClearPhone(event.target.checked);
                setAutomated(false);
                setTranscription(false);
              }}
              disabled={disabled}
            />
            Remove this number and its permissions
          </label>
        )}
        <label className="cfField">
          Who supplied this number?
          <input
            value={phoneSource}
            placeholder="For example: demonstration participant, supplied directly"
            onChange={(event) => setPhoneSource(event.target.value)}
            disabled={disabled}
            maxLength={1000}
          />
        </label>
      </div>
      <label className="cfField">
        Permission record
        <textarea
          value={permission}
          placeholder="Who agreed, when, and how permission was obtained"
          onChange={(event) => setPermission(event.target.value)}
          disabled={disabled}
          maxLength={1000}
        />
      </label>
      <label className="cfCheck">
        <input
          type="checkbox"
          checked={automated}
          onChange={(event) => setAutomated(event.target.checked)}
          disabled={disabled || clearPhone}
        />
        The participant permits an automated demonstration call
      </label>
      <label className="cfCheck">
        <input
          type="checkbox"
          checked={transcription}
          onChange={(event) => setTranscription(event.target.checked)}
          disabled={disabled || clearPhone}
        />
        The participant permits transcription for human review
      </label>
      <p className="cfSmall">
        A referral does not supply permission. Saving these details does not
        place a call.
      </p>
      <button className="cfPrimary" disabled={disabled}>
        Save contact & permission
      </button>
    </form>
  );
}
