import { useEffect, useMemo, useState } from "react";
import { useRoutineDirectory } from "../carecall/routine-directory-context";
import { useSeniorDirectory } from "../carecall/senior-directory-context";
import type { CareRoutine } from "../carecall/types";
import {
  callStateLabel,
  callStateTone,
  elapsedCallSeconds,
  formatCallDuration,
  formatCallTime,
  type CareCallListItem,
  type CareCallListPayload,
  type CareCallListView,
} from "../carecall/call-operations";
import { Icon } from "../components/Icon";
import { RoutineIcon, SeniorAvatar } from "../components/CarePrimitives";

const views: Array<{ id: CareCallListView; label: string }> = [
  { id: "all", label: "All calls" },
  { id: "queue", label: "Queue" },
  { id: "active", label: "Active" },
  { id: "history", label: "History" },
  { id: "needs_review", label: "Needs review" },
];

const emptyStats = { total: 0, queued: 0, active: 0, needs_review: 0, completed_today: 0 };

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "CC";
}

export function Calls({ sessionToken, onAuthenticated, onNotice, onPreview }: { sessionToken: string; onAuthenticated: (token: string) => void; onNotice: (message: string) => void; onPreview: (routine: CareRoutine) => void }) {
  const { seniors } = useSeniorDirectory();
  const { findRoutine } = useRoutineDirectory();
  const [operatorId, setOperatorId] = useState("mei-chen");
  const [accessCode, setAccessCode] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [view, setView] = useState<CareCallListView>("all");
  const [source, setSource] = useState<"all" | "manual" | "schedule">("all");
  const [seniorId, setSeniorId] = useState("all");
  const [limit, setLimit] = useState(25);
  const [jobs, setJobs] = useState<CareCallListItem[]>([]);
  const [stats, setStats] = useState(emptyStats);
  const [totalMatching, setTotalMatching] = useState(0);
  const [scanTruncated, setScanTruncated] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    async function loadCalls(initial = false) {
      if (initial) setLoading(true);
      const query = new URLSearchParams({ view, limit: String(limit) });
      if (source !== "all") query.set("source", source);
      if (seniorId !== "all") query.set("senior_id", seniorId);
      try {
        const response = await fetch(`/api/carecall/jobs?${query}`, { headers: { authorization: `Bearer ${sessionToken}` } });
        const body = await response.json() as CareCallListPayload;
        if (cancelled) return;
        if (!response.ok) {
          if (response.status === 401) onAuthenticated("");
          setError(response.status === 401 ? "Your operator session expired. Sign in again to view calls." : (body.error ?? "Call operations could not be loaded."));
          return;
        }
        setJobs(body.jobs);
        setStats(body.stats);
        setTotalMatching(body.total_matching);
        setScanTruncated(body.scan_truncated);
        setGeneratedAt(body.generated_at);
        setError(null);
      } catch {
        if (!cancelled) setError("The call operations service could not be reached. No queue state was assumed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadCalls(true);
    const timer = window.setInterval(() => void loadCalls(false), 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [limit, onAuthenticated, refreshVersion, seniorId, sessionToken, source, view]);

  useEffect(() => {
    if (!jobs.some((job) => job.status === "starting" || job.status === "ongoing")) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [jobs]);

  const seniorOptions = useMemo(() => {
    const options = new Map(seniors.map((senior) => [senior.id, senior.preferredName]));
    for (const job of jobs) options.set(job.senior.id, job.senior.preferred_name);
    return [...options.entries()].sort((left, right) => left[1].localeCompare(right[1]));
  }, [jobs, seniors]);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setSigningIn(true);
    setError(null);
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operator_id: operatorId.trim(), access_code: accessCode }),
      });
      const body = await response.json() as { token?: string; message?: string };
      if (!response.ok || !body.token) {
        setError(body.message ?? "Operator sign-in was not accepted.");
        return;
      }
      setAccessCode("");
      onAuthenticated(body.token);
      onNotice("Operator session started. Call operations are now scoped to your authorized seniors.");
    } catch {
      setError("Operator sign-in could not reach the service.");
    } finally {
      setSigningIn(false);
    }
  }

  async function cancelJob(job: CareCallListItem) {
    if (!window.confirm(`Cancel the queued ${job.routine.title.toLowerCase()} for ${job.senior.preferred_name}? It will not be called.`)) return;
    const response = await fetch(`/api/carecall/jobs/${encodeURIComponent(job.job_id)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (response.ok) {
      onNotice(`Queued call for ${job.senior.preferred_name} cancelled before dialing.`);
      setRefreshVersion((current) => current + 1);
    } else {
      onNotice("The call could not be cancelled. It may already have started; refresh and inspect its status.");
    }
  }

  function changeView(next: CareCallListView) {
    setView(next);
    setLimit(25);
  }

  if (!sessionToken) {
    return (
      <div className="page page--calls">
        <header className="page-intro page-intro--compact">
          <div><p className="eyebrow">Operational call console</p><h1>Calls</h1><p className="page-summary">View the durable queue, active calls, review cases, and call history.</p></div>
        </header>
        <section className="surface calls-signin" aria-labelledby="calls-signin-title">
          <div className="calls-signin__icon"><Icon name="shield" size={24} /></div>
          <div><p className="eyebrow">Protected operations</p><h2 id="calls-signin-title">Sign in to view call records</h2><p>Only calls for seniors within your configured scope will be returned. Phone numbers and transcripts are not included.</p></div>
          <form onSubmit={(event) => void signIn(event)}>
            <label><span>Operator ID</span><input autoComplete="username" onChange={(event) => setOperatorId(event.target.value)} required value={operatorId} /></label>
            <label><span>Operator sign-in code</span><input autoComplete="current-password" onChange={(event) => setAccessCode(event.target.value)} required type="password" value={accessCode} /></label>
            {error && <p className="field-error" role="alert">{error}</p>}
            <button className="primary-button" disabled={signingIn} type="submit">{signingIn ? "Signing in…" : "View call operations"}</button>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="page page--calls">
      <header className="page-intro page-intro--compact">
        <div><p className="eyebrow">Operational call console</p><h1>Calls</h1><p className="page-summary">One shared queue, live provider status, and durable history for authorized seniors.</p></div>
        <div className="calls-live-state" role="status"><span aria-hidden="true" /> Auto-refreshing every 5 seconds</div>
      </header>

      <section className="calls-metrics" aria-label="Call operations summary">
        <article><span>Waiting</span><strong>{stats.queued}</strong><small>Queued or scheduled</small></article>
        <article data-tone="accent"><span>Active</span><strong>{stats.active}</strong><small>Starting or ongoing</small></article>
        <article data-tone="success"><span>Completed today</span><strong>{stats.completed_today}</strong><small>Singapore date</small></article>
        <article data-tone="attention"><span>Needs review</span><strong>{stats.needs_review}</strong><small>Human decision required</small></article>
      </section>

      <section className="surface calls-console" aria-labelledby="calls-list-title">
        <header className="calls-toolbar">
          <div className="calls-tabs" aria-label="Filter calls">
            {views.map((option) => <button aria-pressed={view === option.id} key={option.id} onClick={() => changeView(option.id)} type="button">{option.label}</button>)}
          </div>
          <div className="calls-filters">
            <label><span className="sr-only">Call source</span><select onChange={(event) => { setSource(event.target.value as typeof source); setLimit(25); }} value={source}><option value="all">All sources</option><option value="manual">Manual</option><option value="schedule">Scheduled</option></select></label>
            <label><span className="sr-only">Senior</span><select onChange={(event) => { setSeniorId(event.target.value); setLimit(25); }} value={seniorId}><option value="all">All seniors</option>{seniorOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
            <button className="quiet-button" type="button" onClick={() => { onAuthenticated(""); setJobs([]); }}>Sign out</button>
          </div>
        </header>

        <div className="calls-list-heading"><div><h2 id="calls-list-title">{views.find((option) => option.id === view)?.label}</h2><p>{totalMatching} matching {totalMatching === 1 ? "record" : "records"}{generatedAt ? ` · updated ${new Date(generatedAt).toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : ""}</p></div>{loading && <span className="calls-loading">Refreshing…</span>}</div>
        {error && <div className="execution-error" role="alert"><strong>Call operations unavailable</strong><p>{error}</p></div>}
        {scanTruncated && <div className="boundary-note"><Icon name="info" size={18} /><p>The operational scan reached 500 records. Narrow the filters or use the durable audit store for older records.</p></div>}

        {!loading && jobs.length === 0 && !error ? (
          <div className="calls-empty"><Icon name="phone" size={26} /><h3>No matching calls</h3><p>New manual and scheduled calls will appear here as soon as they enter the durable queue.</p></div>
        ) : (
          <div className="calls-list" aria-live="polite">
            {jobs.map((job) => {
              const knownSenior = seniors.find((senior) => senior.id === job.senior.id);
              const duration = elapsedCallSeconds(job, now);
              // The record shows the routine title as it was at call time, but
              // links to the routine as it stands now. A job whose routine or
              // senior is no longer in the directory stays plain text rather
              // than opening a sheet that cannot be built.
              const linkedRoutine = findRoutine(job.routine.id);
              const openable = linkedRoutine && knownSenior;
              return (
                <article className="call-record" data-state={job.status} key={job.job_id}>
                  <div className="call-record__summary">
                    <SeniorAvatar initials={knownSenior?.initials ?? initials(job.senior.preferred_name)} tone={knownSenior?.avatar ?? "blue"} />
                    <div className="call-record__identity">
                      <strong>{job.senior.preferred_name}</strong>
                      {openable
                        ? (
                          <button
                            className="routine-link"
                            onClick={() => onPreview(linkedRoutine)}
                            title={`Open the ${job.routine.title.toLowerCase()} care routine`}
                            type="button"
                          >
                            <span>{job.routine.title}</span>
                            <Icon name="chevron" size={14} />
                          </button>
                        )
                        : <span title={linkedRoutine ? undefined : "This routine is no longer in the care directory."}>{job.routine.title}</span>}
                    </div>
                    <RoutineIcon kind={job.routine.kind} />
                    <div className="call-record__state"><span className="call-state-pill" data-tone={callStateTone(job)}><span aria-hidden="true" />{callStateLabel(job, now)}</span><small>{job.source === "manual" ? "Manual authorization" : "Recurring schedule"}</small></div>
                    <div className="call-record__timing"><strong>{formatCallDuration(duration)}</strong><span>{job.status === "queued" ? formatCallTime(job.scheduled_for) : formatCallTime(job.completed_at ?? job.started_at ?? job.updated_at)}</span></div>
                    {job.status === "queued" ? <button className="secondary-button" type="button" onClick={() => void cancelJob(job)}>Cancel</button> : <span />}
                  </div>
                  <details className="call-record__details">
                    <summary>View operational details</summary>
                    <dl>
                      <div><dt>Queue job</dt><dd>{job.job_id}</dd></div>
                      <div><dt>Provider run</dt><dd>{job.run_id ?? "Not started"}</dd></div>
                      <div><dt>Queued</dt><dd>{formatCallTime(job.created_at)}</dd></div>
                      <div><dt>Started</dt><dd>{formatCallTime(job.started_at)}</dd></div>
                      <div><dt>Completed</dt><dd>{formatCallTime(job.completed_at)}</dd></div>
                      <div><dt>Duration source</dt><dd>{job.duration_source === "provider" ? "CALL-E provider" : job.duration_source === "observed" ? "CareCall observed" : "Not available"}</dd></div>
                      <div><dt>Provider status</dt><dd>{job.provider_status?.replaceAll("_", " ") ?? "Not available"}</dd></div>
                      <div><dt>Failure reason</dt><dd>{job.failure_reason?.replaceAll("_", " ") ?? "None"}</dd></div>
                    </dl>
                    {job.result && <div className="call-record__outcome"><strong>{job.result.outcome_label}</strong><p>{job.result.evidence ?? "No reliable conversational evidence was returned."}</p><span>Next: {job.result.next_action}</span></div>}
                    <p className="call-record__privacy"><Icon name="shield" size={16} /> Full phone numbers and transcripts are intentionally excluded from this console.</p>
                  </details>
                </article>
              );
            })}
          </div>
        )}
        {jobs.length < totalMatching && (
          <footer className="calls-pagination">
            {limit < 100 && <button className="secondary-button" type="button" onClick={() => setLimit((current) => Math.min(100, current + 25))}>Load more</button>}
            <span>{limit < 100 ? `Showing ${jobs.length} of ${totalMatching}` : `Showing the newest ${jobs.length} of ${totalMatching}. Narrow the filters to inspect older records.`}</span>
          </footer>
        )}
      </section>
    </div>
  );
}
