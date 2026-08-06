import { useCallback, useEffect, useRef, useState } from "react";
import { attentionCases, routines, seniors } from "./carecall/fixtures";
import type { AttentionCase, CareRoutine, NavigationId, TimelineItem } from "./carecall/types";
import { CallPreviewSheet } from "./components/CallPreviewSheet";
import { CareCallExecutionSheet } from "./components/CareCallExecutionSheet";
import { Icon, type IconName } from "./components/Icon";
import { CareRoutines } from "./screens-care/CareRoutines";
import { NeedsAttention } from "./screens-care/NeedsAttention";
import { Seniors } from "./screens-care/Seniors";
import { Settings } from "./screens-care/Settings";
import { Today } from "./screens-care/Today";
import type { CareCallResult } from "./workflows/carecall";

// Retained while the previous appointment-recovery screens remain available as
// a migration reference. They are no longer mounted by the CareCall shell.
export type Screen = "landing" | "configure" | "preview" | "authorize" | "live" | "result";

const navigation: { id: NavigationId; label: string; icon: IconName }[] = [
  { id: "today", label: "Today", icon: "home" },
  { id: "seniors", label: "Seniors", icon: "users" },
  { id: "routines", label: "Care Routines", icon: "routine" },
  { id: "attention", label: "Needs Attention", icon: "attention" },
  { id: "settings", label: "Settings", icon: "settings" },
];

function Brand() {
  return (
    <div className="brand" aria-label="CareCall SG">
      <span className="brand-mark" aria-hidden="true"><Icon name="heart" size={20} /><span><Icon name="phone" size={10} /></span></span>
      <span><strong>CareCall</strong><small>SG</small></span>
    </div>
  );
}

export function App() {
  const [view, setView] = useState<NavigationId>("today");
  const [selectedSeniorId, setSelectedSeniorId] = useState(seniors[0].id);
  const [previewRoutine, setPreviewRoutine] = useState<CareRoutine | null>(null);
  const [executionRoutine, setExecutionRoutine] = useState<CareRoutine | null>(null);
  const [resolvedAttentionIds, setResolvedAttentionIds] = useState<Set<string>>(new Set());
  const [runtimeAttentionCases, setRuntimeAttentionCases] = useState<AttentionCase[]>([]);
  const [durableAttentionCases, setDurableAttentionCases] = useState<AttentionCase[]>([]);
  const [operatorSessionToken, setOperatorSessionToken] = useState("");
  const [notice, setNotice] = useState("");
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const navigate = useCallback((destination: NavigationId) => {
    setView(destination);
    window.requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }));
  }, []);

  function previewFromTimeline(item: TimelineItem) {
    const routine = routines.find((candidate) => candidate.id === item.routineId);
    if (routine) setPreviewRoutine(routine);
  }

  const recordCareCallResult = useCallback((result: CareCallResult) => {
    if (!result.follow_up_required || !executionRoutine) return;
    const routine = executionRoutine;
    const priority: AttentionCase["priority"] = result.urgency === "contact-now"
      ? "contact-now"
      : result.urgency === "follow-up-today" ? "today" : "review";
    const priorityLabel = priority === "contact-now" ? "Contact now" : priority === "today" ? "Follow up today" : "Review when available";
    const flags = result.safety_flags.length > 0
      ? ` Safety flags: ${result.safety_flags.map((flag) => flag.replaceAll("_", " ")).join(", ")}.`
      : "";
    setRuntimeAttentionCases((current) => current.some((item) => item.id === `live-${result.call_id}`) ? current : [
      ...current,
      {
        id: `live-${result.call_id}`,
        seniorId: routine.seniorId,
        routineId: routine.id,
        priority,
        priorityLabel,
        title: result.outcome_label,
        createdAt: new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", dateStyle: "medium", timeStyle: "short" }).format(new Date()),
        context: `Live CareCall result: ${result.evidence ?? "no reliable conversational evidence"}.${flags}`,
        nextAction: result.next_action,
      },
    ]);
  }, [executionRoutine]);

  useEffect(() => {
    if (!operatorSessionToken) return;
    let cancelled = false;
    async function loadCases() {
      try {
        const response = await fetch("/api/carecall/cases", { headers: { authorization: `Bearer ${operatorSessionToken}` } });
        const body = await response.json() as { cases?: AttentionCase[] };
        if (!cancelled && response.ok && body.cases) setDurableAttentionCases(body.cases);
      } catch { /* Session-only cases remain visible when durable refresh fails. */ }
    }
    void loadCases();
    return () => { cancelled = true; };
  }, [operatorSessionToken, runtimeAttentionCases]);

  const resolveAttentionCase = useCallback((caseId: string) => {
    setResolvedAttentionIds((current) => new Set(current).add(caseId));
    if (!operatorSessionToken || !caseId.startsWith("live-")) return;
    void fetch("/api/carecall/cases", {
      method: "PATCH",
      headers: { authorization: `Bearer ${operatorSessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ case_id: caseId, acknowledged: true }),
    });
  }, [operatorSessionToken]);

  const previewSenior = previewRoutine
    ? seniors.find((senior) => senior.id === previewRoutine.seniorId) ?? null
    : null;
  const liveCases = durableAttentionCases.length > 0 ? durableAttentionCases : runtimeAttentionCases;
  const allAttentionCases = [...attentionCases, ...liveCases.filter((item) => !attentionCases.some((fixture) => fixture.id === item.id))];
  const openAttentionCount = allAttentionCases.filter((item) => !resolvedAttentionIds.has(item.id)).length;

  return (
    <div className="care-app">
      <a className="skip-link" href="#main-content">Skip to main content</a>

      <aside className="sidebar">
        <Brand />
        <button className="team-switcher" type="button" onClick={() => setNotice("Queenstown Care Team is the active workspace.")}>
          <span className="team-mark">QC</span>
          <span><strong>Queenstown</strong><small>Care Team</small></span>
          <Icon name="chevron" size={16} />
        </button>

        <nav className="primary-nav" aria-label="Primary navigation">
          {navigation.map((item) => (
            <button
              aria-current={view === item.id ? "page" : undefined}
              data-active={view === item.id}
              key={item.id}
              onClick={() => navigate(item.id)}
              type="button"
            >
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
              {item.id === "attention" && openAttentionCount > 0 && <span className="nav-badge" aria-label={`${openAttentionCount} open cases`}>{openAttentionCount}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />
        <section className="sidebar-care-note">
          <span><Icon name="shield" size={17} /></span>
          <div><strong>Human care, supported.</strong><p>CareCall reminds and escalates. People make care decisions.</p></div>
        </section>
        <button className="operator-card" type="button" onClick={() => setNotice("Signed in as Mei Chen, care coordinator.")}>
          <span className="operator-avatar">MC</span>
          <span><strong>Mei Chen</strong><small>Care coordinator</small></span>
          <Icon name="more" size={18} />
        </button>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="mobile-brand"><Brand /></div>
          <div className="topbar-context">
            <span className="context-dot" aria-hidden="true" />
            Queenstown Care Team
          </div>
          <div className="topbar-actions">
            <span className="demo-state"><Icon name="info" size={15} /> Demo data</span>
            <button className="topbar-button search-button" type="button" onClick={() => setNotice("Search will cover seniors, routines, and call history.")}><Icon name="search" size={18} /><span>Search</span><kbd>⌘ K</kbd></button>
            <button aria-label={`Notifications, ${openAttentionCount} open care cases`} className="topbar-button topbar-button--icon" type="button" onClick={() => navigate("attention")}><Icon name="attention" size={19} />{openAttentionCount > 0 && <span className="notification-dot" />}</button>
            <span className="topbar-avatar" aria-label="Signed in as Mei Chen">MC</span>
          </div>
        </header>

        <main className="workspace-main" id="main-content" ref={mainRef} tabIndex={-1}>
          {view === "today" && <Today attentionCount={openAttentionCount} attentionCases={allAttentionCases} resolvedIds={resolvedAttentionIds} onNavigate={navigate} onPreview={previewFromTimeline} />}
          {view === "seniors" && <Seniors selectedId={selectedSeniorId} onSelect={setSelectedSeniorId} onPreview={setPreviewRoutine} />}
          {view === "routines" && <CareRoutines onPreview={setPreviewRoutine} onNotice={setNotice} />}
          {view === "attention" && (
            <NeedsAttention
              cases={allAttentionCases}
              onPreview={setPreviewRoutine}
              onNotice={setNotice}
              resolvedIds={resolvedAttentionIds}
              onResolve={resolveAttentionCase}
            />
          )}
          {view === "settings" && <Settings onNotice={setNotice} />}
        </main>

        <nav className="mobile-nav" aria-label="Mobile navigation">
          {navigation.map((item) => (
            <button aria-current={view === item.id ? "page" : undefined} data-active={view === item.id} key={item.id} onClick={() => navigate(item.id)} type="button">
              <span><Icon name={item.icon} size={20} />{item.id === "attention" && openAttentionCount > 0 && <i aria-hidden="true">{openAttentionCount}</i>}</span>
              {item.label === "Care Routines" ? "Routines" : item.label.replace("Needs ", "")}
            </button>
          ))}
        </nav>
      </div>

      <div aria-atomic="true" aria-live="polite" className="toast-region">
        {notice && <div className="toast"><Icon name="check" size={18} /><span>{notice}</span><button aria-label="Dismiss message" type="button" onClick={() => setNotice("")}><Icon name="close" size={16} /></button></div>}
      </div>

      {previewRoutine && previewSenior && (
        <CallPreviewSheet
          routine={previewRoutine}
          senior={previewSenior}
          onClose={() => setPreviewRoutine(null)}
          onAuthorize={() => {
            setExecutionRoutine(previewRoutine);
            setPreviewRoutine(null);
          }}
        />
      )}
      {executionRoutine && (
        <CareCallExecutionSheet
          routine={executionRoutine}
          senior={seniors.find((senior) => senior.id === executionRoutine.seniorId)!}
          onCompleted={recordCareCallResult}
          onAuthenticated={setOperatorSessionToken}
          onClose={() => setExecutionRoutine(null)}
        />
      )}
    </div>
  );
}
