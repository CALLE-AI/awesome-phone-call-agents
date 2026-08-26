"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ChangeEvent } from "react";

import { CALL_COPY, DECISION_COPY, STATUS_COPY, canPlaceCall, formatCallClock, formatCallDuration, formatUploadedAt, isInFlightCall, isQueueBusy, queueActivity, rosterStatus, shortBatchId, shortCalleId, type QueueActivity } from "@/lib/status";
import { DEFAULT_SCORE_CONFIG, SCORE_CRITERIA_OPTIONS, scoreCriteriaLines, type ScoreConfig } from "@/lib/score-config";
import type { Batch, Candidate, RecruiterDecision } from "@/lib/types";
import { ApiError, clearOperatorToken, hirecallApi } from "@/services/hirecall-api";

export function BatchDesk() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const batchId = params.id;
  const [batch, setBatch] = useState<Batch | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openId, setOpenId] = useState("");
  const [openView, setOpenView] = useState<"data" | "screening">("data");
  const [dragOver, setDragOver] = useState(false);
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [copiedId, setCopiedId] = useState("");
  const [criteriaPrompted, setCriteriaPrompted] = useState(false);
  const [agentDismissed, setAgentDismissed] = useState("");
  const [liveCallsEnabled, setLiveCallsEnabled] = useState<boolean | null>(null);

  const sendHomeIfUnauthorized = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        clearOperatorToken();
        router.push("/");
        return true;
      }
      return false;
    },
    [router],
  );

  const load = useCallback(async () => {
    const data = await hirecallApi.getBatch(batchId);
    setBatch(data.batch);
    setCandidates(data.candidates);
    if (typeof data.liveCallsEnabled === "boolean") {
      setLiveCallsEnabled(data.liveCallsEnabled);
    }
  }, [batchId]);

  useEffect(() => {
    load()
      .catch((err: unknown) => {
        if (sendHomeIfUnauthorized(err)) return;
        setError(err instanceof Error ? err.message : "Could not load this Excel batch.");
      })
      .finally(() => setLoading(false));
  }, [load, sendHomeIfUnauthorized]);

  useEffect(() => {
    if (!batch || criteriaPrompted) return;
    if (!batch.scoreCriteriaSaved) setCriteriaOpen(true);
    setCriteriaPrompted(true);
  }, [batch, criteriaPrompted]);

  const queueBusy = isQueueBusy(candidates);
  const activity = queueActivity(candidates);
  const activityKey = activity ? `${activity.kind}:${activity.candidate.id}` : "";

  useEffect(() => {
    if (!queueBusy) return;
    const timer = window.setInterval(() => {
      void load().catch((err: unknown) => {
        if (sendHomeIfUnauthorized(err)) return;
      });
    }, 4000);
    return () => window.clearInterval(timer);
  }, [queueBusy, load, sendHomeIfUnauthorized]);

  function applyDetail(data: { batch?: Batch; candidates?: Candidate[] }) {
    if (data.batch) setBatch(data.batch);
    if (data.candidates) setCandidates(data.candidates);
  }

  async function prepareResume(candidateId?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await hirecallApi.prepareResumes(
        batchId,
        candidateId ? { candidateId } : { allWithLinks: true },
      );
      applyDetail(data);
      if (candidateId) {
        setNotice("Resume saved and call script written. Review it, then click Call.");
      } else {
        const promptNote = data.promptFailed
          ? ` ${data.promptFailed} call script(s) failed.`
          : "";
        setNotice(
          `Prepared ${data.prepared ?? 0} resume(s). ${data.failed ?? 0} failed. ${data.skipped ?? 0} skipped.${promptNote}`,
        );
      }
    } catch (err) {
      if (sendHomeIfUnauthorized(err)) return;
      if (err instanceof ApiError) {
        applyDetail(err.payload as { batch?: Batch; candidates?: Candidate[] });
        setError(err.message);
      } else {
        setError("Could not prepare the resume.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function queueCall(candidateId?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await hirecallApi.queueCalls(
        batchId,
        candidateId ? { candidateId } : { allReady: true },
      );
      applyDetail(data);
      if (candidateId) {
        const row = data.candidates?.find((person) => person.id === candidateId);
        const dryRun = Boolean(row?.calleCallId?.startsWith("dry-run:"));
        setNotice(
          dryRun
            ? "Dry-run finished. No live CALL-E call was placed. Set HIRECALL_LIVE_CALLS=true to dial for real."
            : "CALL-E is placing the call. Status will move to Calling, then Talking.",
        );
      } else {
        setNotice(
          `${data.queued ?? 0} ready candidate(s) queued.${data.started ? " The first call has started." : ""}${data.failed ? ` ${data.failed} failed.` : ""}`,
        );
      }
    } catch (err) {
      if (sendHomeIfUnauthorized(err)) return;
      if (err instanceof ApiError) {
        applyDetail(err.payload as { batch?: Batch; candidates?: Candidate[] });
        setError(err.message);
      } else {
        setError("Could not place the call.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function setDecision(candidateId: string, decision: Exclude<RecruiterDecision, "">) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await hirecallApi.setCallDecision(batchId, candidateId, decision);
      applyDetail(data);
      setNotice(
        decision === "call_again"
          ? "Call again saved. If they already spoke, the next script asks only what was unclear. If they asked to call later, the script stays the same."
          : `Decision saved: ${DECISION_COPY[decision].label}.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save that decision.");
    } finally {
      setBusy(false);
    }
  }

  async function setActive(active: boolean) {
    const message = active
      ? "Restore this Excel batch to the active roster?"
      : "Deactivate this Excel? It moves to Inactive and can be restored. HireCall will not start the next call. A call that is already ringing may keep ringing.";
    if (!confirm(message)) return;
    setBusy(true);
    setError("");
    try {
      const data = await hirecallApi.setBatchActive(batchId, active);
      if (active) {
        applyDetail(data);
        setNotice("This Excel is active again.");
      } else {
        router.push("/");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update this batch.");
    } finally {
      setBusy(false);
    }
  }

  async function updateWorkbook(file: File) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await hirecallApi.updateWorkbook(batchId, file);
      applyDetail(data);
      const extra = data.skipped ? ` ${data.skipped} row(s) skipped.` : "";
      setNotice(
        `Updated this Excel batch: ${data.updated} candidate(s) updated, ${data.inserted} added.${extra} Rows not in the file were left as they are. If a resume link changed, prepare that resume again.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update this Excel batch.");
    } finally {
      setBusy(false);
    }
  }

  async function saveScoreCriteria(config: ScoreConfig) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await hirecallApi.setBatchScoreCriteria(batchId, config);
      applyDetail(data);
      setCriteriaOpen(false);
      setNotice(
        `Scoring saved for this Excel. Pass mark is ${config.passScore}/10. Gemini scores only. You click Next round or Rejected after you read the screening.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save scoring criteria.");
    } finally {
      setBusy(false);
    }
  }

  async function saveJobRole(jobRole: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await hirecallApi.setBatchJobRole(batchId, jobRole);
      applyDetail(data);
      setNotice("Job role saved for this Excel. Gemini rewrote call scripts for people who already have a resume.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the job role.");
    } finally {
      setBusy(false);
    }
  }

  async function onWorkbookChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await updateWorkbook(file);
  }

  const pendingResumeCount = candidates.filter(
    (row) => row.resumeUrl && !row.resumeText,
  ).length;
  const pendingPromptCount = candidates.filter(
    (row) => row.resumeText && !row.callPrompt,
  ).length;
  const callableCount = candidates.filter(
    (row) => canPlaceCall(row) && row.callStatus !== "completed",
  ).length;
  const openCandidate = candidates.find((row) => row.id === openId);

  return (
    <div className="desk-grid min-h-screen">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-8 md:px-8 md:py-12">
        <p>
          <Link className="text-sm font-medium text-accent hover:underline" href="/">
            ← Back to roster
          </Link>
        </p>

        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1 text-xs font-medium tracking-[0.18em] text-muted uppercase">
              Excel batch {batch ? shortBatchId(batch.id) : ""}
              {batch && !batch.active ? " · Inactive" : ""}
            </p>
            <h1 className="font-display text-4xl leading-[1.05] font-medium tracking-tight text-ink md:text-5xl">
              {batch?.filename ?? "Loading…"}
            </h1>
            {batch ? (
              <p className="mt-3 text-sm text-muted">
                Uploaded {formatUploadedAt(batch.createdAt)}. {batch.candidateCount} candidate
                {batch.candidateCount === 1 ? "" : "s"} in this file
                {batch.jobRole ? ` for ${batch.jobRole}` : ""}. Prepare resume (Gemini
                writes the call script), then Call. Call dials that person with their
                saved script. Call ready queues this Excel one at a time.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink disabled:opacity-50"
              disabled={
                busy ||
                (pendingResumeCount === 0 && pendingPromptCount === 0) ||
                !batch?.active
              }
              onClick={() => void prepareResume()}
              type="button"
            >
              Prepare resumes ({pendingResumeCount + pendingPromptCount})
            </button>
            <button
              className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink disabled:opacity-50"
              disabled={busy || !batch?.active}
              onClick={() => setCriteriaOpen(true)}
              type="button"
            >
              Scoring criteria
            </button>
            <button
              className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
              disabled={busy || callableCount === 0 || !batch?.active}
              onClick={() => void queueCall()}
              type="button"
            >
              Call ready candidates ({callableCount})
            </button>
            <button
              className="rounded-full border border-line px-4 py-2 text-sm font-medium text-danger disabled:opacity-50"
              disabled={busy}
              onClick={() => void setActive(!(batch?.active ?? true))}
              type="button"
            >
              {batch?.active === false ? "Restore Excel" : "Deactivate"}
            </button>
          </div>
        </header>

        {error ? (
          <p className="rounded-xl bg-[rgba(154,59,47,0.1)] px-4 py-3 text-sm text-danger">{error}</p>
        ) : null}
        {notice ? (
          <p className="rounded-xl bg-[rgba(47,107,79,0.1)] px-4 py-3 text-sm text-forest">{notice}</p>
        ) : null}
        {liveCallsEnabled === false ? (
          <p className="rounded-xl border border-line bg-paper px-4 py-3 text-sm text-muted">
            Live calls are off. Call completes a local dry-run and does not dial.
            Set HIRECALL_LIVE_CALLS=true and CALLE_API_KEY, then restart the app, to
            place a real CALL-E call.
          </p>
        ) : null}

        {batch?.active ? (
          <JobRoleForm
            busy={busy}
            jobRole={batch.jobRole}
            scoreConfig={batch.scoreConfig}
            onOpenCriteria={() => setCriteriaOpen(true)}
            onSave={(value) => void saveJobRole(value)}
          />
        ) : null}

        {batch ? (
          <ScoreCriteriaCard config={batch.scoreConfig} onEdit={() => setCriteriaOpen(true)} />
        ) : null}

        {batch?.active ? (
          <section className="rounded-[28px] border border-line bg-paper p-5 shadow-[var(--shadow)] md:p-8">
            <h2 className="font-display text-2xl">Update this Excel</h2>
            <p className="mt-1 mb-5 text-sm text-muted">
              Drop a corrected file here to change names or resume links in this same
              batch. Phones keep the country code as uploaded. Matching uses the
              candidate name first, then the phone number. Changing a resume link
              clears the saved text so you can prepare it again. People missing from
              the new file stay in this batch.
            </p>
            <label
              className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
                dragOver
                  ? "border-accent bg-[rgba(196,92,38,0.08)]"
                  : "border-line bg-canvas/60 hover:border-accent/60"
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                const file = event.dataTransfer.files[0];
                if (file) void updateWorkbook(file);
              }}
            >
              <input
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                disabled={busy}
                onChange={onWorkbookChange}
                type="file"
              />
              <span className="font-display text-xl text-ink">Re-upload into this batch</span>
              <span className="mt-2 text-sm text-muted">
                {busy ? "Updating rows…" : "or click to choose .xlsx, .xls, or .csv. This does not add a roster row."}
              </span>
            </label>
          </section>
        ) : null}

        <section className="overflow-hidden rounded-[28px] border border-line bg-paper shadow-[var(--shadow)]">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-5 py-4 md:px-8">
            <div>
              <h2 className="font-display text-2xl">Candidates in this Excel</h2>
              <p className="mt-1 text-sm text-muted">
                {candidates.length} people · {candidates.filter((row) => row.callStatus === "completed").length}{" "}
                completed · {candidates.filter((row) => row.callResponse?.decision === "next_round").length} next round
              </p>
            </div>
          </div>

          {loading ? (
            <p className="px-5 py-12 text-center text-muted md:px-8">Loading candidates…</p>
          ) : candidates.length === 0 ? (
            <p className="px-5 py-12 text-center text-muted md:px-8">No candidates in this batch.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-canvas text-xs tracking-[0.14em] text-muted uppercase">
                  <tr>
                    <th className="px-5 py-3.5 font-medium md:px-8">Candidate</th>
                    <th className="px-3 py-3.5 font-medium">Resume</th>
                    <th className="px-3 py-3.5 font-medium">Status</th>
                    <th className="px-3 py-3.5 font-medium">Duration</th>
                    <th className="px-3 py-3.5 font-medium">CALL-E id</th>
                    <th className="px-3 py-3.5 font-medium">Score</th>
                    <th className="px-5 py-3.5 font-medium md:px-8">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((row) => {
                    const status = rosterStatus(row);
                    const copy = STATUS_COPY[status];
                    const placeable = canPlaceCall(row);
                    const inFlightRow = isInFlightCall(row.callStatus);
                    const calleId = row.calleCallId || row.callResponse?.calleCallId || "";
                    const clock = row.callResponse?.startedAt ? formatCallClock(row.callResponse.startedAt) : null;
                    const decision = row.callResponse?.decision || "pending";
                    const selected = openId === row.id;
                    return (
                      <tr
                        className={`border-t border-line align-middle transition-colors ${
                          selected ? "bg-[rgba(196,92,38,0.06)]" : "hover:bg-canvas/80"
                        }`}
                        key={row.id}
                      >
                        <td className="px-5 py-4 md:px-8">
                          <div className="font-medium text-ink">{row.name}</div>
                          <div className="mt-0.5 text-xs text-muted">{row.phone}</div>
                          <div className="mt-0.5 text-xs text-muted">
                            {row.jobRole || batch?.jobRole || "No job role"}
                            {row.consent ? "" : " · No consent"}
                          </div>
                        </td>
                        <td className="px-3 py-4">
                          {row.resumeUrl ? (
                            <div className="flex flex-col items-start gap-1">
                              <a
                                className="text-sm font-medium text-accent hover:underline"
                                href={row.resumeUrl}
                                rel="noreferrer"
                                target="_blank"
                              >
                                Open resume
                              </a>
                              <span
                                className={`text-xs ${
                                  row.callPrompt ? "text-forest" : row.resumeText ? "text-warn" : "text-muted"
                                }`}
                              >
                                {row.callPrompt
                                  ? "Script ready"
                                  : row.resumeText
                                    ? "Needs script"
                                    : row.resumeFetchError
                                      ? "Resume failed"
                                      : "Not prepared"}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted">No link</span>
                          )}
                        </td>
                        <td className="px-3 py-4">
                          <div className="flex flex-col items-start gap-1.5">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                                row.callStatus === "completed"
                                  ? "bg-[rgba(47,107,79,0.12)] text-forest"
                                  : row.callStatus === "failed"
                                    ? "bg-[rgba(154,59,47,0.12)] text-danger"
                                    : row.callStatus === "no_answer" ||
                                        row.callStatus === "calling" ||
                                        row.callStatus === "queued"
                                      ? "bg-[rgba(161,92,18,0.12)] text-warn"
                                      : row.callStatus === "talking"
                                        ? "bg-[rgba(47,107,79,0.12)] text-forest"
                                        : "border border-line bg-canvas text-muted"
                              }`}
                            >
                              {CALL_COPY[row.callStatus].label}
                            </span>
                            {status !== "ready" || row.callStatus === "not_called" ? (
                              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${copy.className}`}>
                                {copy.label}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap">
                          {clock ? (
                            <div>
                              <div className="font-display text-lg leading-none text-ink">
                                {formatCallDuration(row.callResponse?.durationSeconds ?? null)}
                              </div>
                              <div className="mt-1 text-xs text-muted">
                                {clock.date} · {clock.time}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted">Not called</span>
                          )}
                        </td>
                        <td className="px-3 py-4">
                          {calleId ? (
                            <button
                              className="inline-flex max-w-[160px] items-center gap-1.5 rounded-full border border-line bg-canvas px-2.5 py-1 font-mono text-[11px] text-ink hover:border-accent"
                              onClick={() => {
                                void navigator.clipboard.writeText(calleId);
                                setCopiedId(calleId);
                                window.setTimeout(() => setCopiedId(""), 1500);
                              }}
                              title={calleId}
                              type="button"
                            >
                              {copiedId === calleId ? "Copied" : shortCalleId(calleId)}
                            </button>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                        </td>
                        <td className="px-3 py-4">
                          {row.callResponse ? (
                            <div className="flex flex-col items-start gap-1.5">
                              <span
                                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                                  decision === "next_round"
                                    ? "bg-[rgba(47,107,79,0.12)] text-forest"
                                    : decision === "rejected"
                                      ? "bg-[rgba(154,59,47,0.12)] text-danger"
                                      : decision === "call_again"
                                        ? "bg-[rgba(161,92,18,0.12)] text-warn"
                                        : "border border-line bg-canvas text-muted"
                                }`}
                              >
                                {DECISION_COPY[decision].label}
                              </span>
                              <span className="text-xs text-muted">
                                {(row.calleCallId || "").startsWith("dry-run:")
                                  ? "No live call"
                                  : row.callResponse.score == null
                                    ? "Scoring…"
                                    : `${row.callResponse.score}/${row.callResponse.passScore}`}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                        </td>
                        <td className="px-5 py-4 md:px-8">
                          <div className="flex flex-wrap gap-1.5">
                            {row.resumeUrl && !row.resumeText ? (
                              <button
                                className="rounded-full border border-line px-3 py-1 text-xs font-medium text-ink disabled:opacity-40"
                                disabled={busy || !batch?.active}
                                onClick={() => void prepareResume(row.id)}
                                type="button"
                              >
                                Prepare
                              </button>
                            ) : null}
                            {row.resumeUrl && row.resumeText ? (
                              <button
                                className="rounded-full border border-line px-3 py-1 text-xs font-medium text-ink disabled:opacity-40"
                                disabled={busy || !batch?.active}
                                onClick={() => void prepareResume(row.id)}
                                type="button"
                              >
                                Prepare again
                              </button>
                            ) : null}
                            <button
                              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                                selected && openView === "data"
                                  ? "border-accent bg-accent text-paper"
                                  : "border-line text-ink"
                              }`}
                              onClick={() => {
                                if (openId === row.id && openView === "data") setOpenId("");
                                else {
                                  setOpenId(row.id);
                                  setOpenView("data");
                                }
                              }}
                              type="button"
                            >
                              Data
                            </button>
                            <button
                              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                                selected && openView === "screening"
                                  ? "border-accent bg-accent text-paper"
                                  : "border-line text-ink"
                              }`}
                              onClick={() => {
                                if (openId === row.id && openView === "screening") setOpenId("");
                                else {
                                  setOpenId(row.id);
                                  setOpenView("screening");
                                }
                              }}
                              type="button"
                            >
                              Screening
                            </button>
                            <button
                              className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-paper disabled:opacity-40"
                              disabled={busy || inFlightRow || !placeable || !batch?.active}
                              onClick={() => void queueCall(row.id)}
                              type="button"
                            >
                              {inFlightRow
                                ? CALL_COPY[row.callStatus].label
                                : placeable
                                  ? row.callStatus === "not_called"
                                    ? "Call"
                                    : "Call again"
                                  : "Can't call"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {openCandidate && openView === "data" ? (
          <section className="rounded-[28px] border border-line bg-paper p-5 shadow-[var(--shadow)] md:p-8">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl">Stored data · {openCandidate.name}</h2>
                <p className="mt-1 text-sm text-muted">
                  Edit the name, phone, job role, or resume link. Phone needs a country code.
                  Use Screening result to see call time, duration, CALL-E id, and the
                  answers table.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  className="text-sm font-medium text-accent hover:underline"
                  onClick={() => setOpenView("screening")}
                  type="button"
                >
                  Screening result
                </button>
                <button
                  className="text-sm font-medium text-accent hover:underline"
                  onClick={() => setOpenId("")}
                  type="button"
                >
                  Close
                </button>
              </div>
            </div>
            <CandidateEditor
              active={Boolean(batch?.active)}
              batchId={batchId}
              busy={busy}
              candidate={openCandidate}
              onBusy={setBusy}
              onError={setError}
              onNotice={setNotice}
              onSaved={applyDetail}
            />
            <div className="overflow-x-auto rounded-2xl border border-line">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-canvas text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th className="px-4 py-3 font-medium">Column</th>
                    <th className="px-4 py-3 font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["id", openCandidate.id],
                    ["batch_id", openCandidate.batchId],
                    ["name", openCandidate.name],
                    ["job_role", openCandidate.jobRole || "—"],
                    ["phone", openCandidate.phone],
                    ["consent", openCandidate.consent ? "yes" : "no"],
                    ["resume_url", openCandidate.resumeUrl || "—"],
                    ["resume_fetched_at", openCandidate.resumeFetchedAt ? formatUploadedAt(openCandidate.resumeFetchedAt) : "—"],
                    ["resume_fetch_error", openCandidate.resumeFetchError || "—"],
                    ["call_status", openCandidate.callStatus],
                    ["calle_call_id", openCandidate.calleCallId || "—"],
                    ["call_attempt", String(openCandidate.callAttempt)],
                    ["active", openCandidate.active ? "active" : "inactive"],
                    ["source_filename", openCandidate.sourceFilename || "—"],
                    ["created_at", formatUploadedAt(openCandidate.createdAt)],
                    ["resume_text length", String(openCandidate.resumeText.length)],
                    ["call_prompt length", String(openCandidate.callPrompt.length)],
                  ].map(([column, value]) => (
                    <tr className="border-t border-line" key={column}>
                      <td className="px-4 py-3 font-medium whitespace-nowrap text-ink">{column}</td>
                      <td className="px-4 py-3 break-all text-muted">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 className="font-display mt-6 text-xl">resume_text</h3>
            <pre className="mt-3 max-h-[480px] overflow-auto whitespace-pre-wrap rounded-2xl border border-line bg-canvas p-4 text-sm leading-relaxed text-ink">
              {openCandidate.resumeText || "—"}
            </pre>
            <h3 className="font-display mt-6 text-xl">call_prompt</h3>
            <p className="mt-1 text-sm text-muted">
              Written by Gemini when you prepare the resume. If you mark Call again
              needed after they already spoke, this script is rewritten for the
              unclear parts. If they asked to be called later, it stays the same.
            </p>
            <pre className="mt-3 max-h-[480px] overflow-auto whitespace-pre-wrap rounded-2xl border border-line bg-canvas p-4 text-sm leading-relaxed text-ink">
              {openCandidate.callPrompt || "—"}
            </pre>
          </section>
        ) : null}

        {openCandidate && openView === "screening" ? (
          <section className="rounded-[28px] border border-line bg-paper p-5 shadow-[var(--shadow)] md:p-8">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl">Screening result · {openCandidate.name}</h2>
                <p className="mt-1 text-sm text-muted">
                  Call time, duration, CALL-E id, Gemini score against the ticks
                  below, and the answers table. Gemini scores only. Mark Next
                  round, Rejected, or Call again after you read this.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  className="text-sm font-medium text-accent hover:underline"
                  onClick={() => setOpenView("data")}
                  type="button"
                >
                  View data
                </button>
                <button
                  className="text-sm font-medium text-accent hover:underline"
                  onClick={() => setOpenId("")}
                  type="button"
                >
                  Close
                </button>
              </div>
            </div>
            <ScreeningResultCard
              busy={busy}
              candidate={openCandidate}
              criteria={scoreCriteriaLines(batch?.scoreConfig ?? DEFAULT_SCORE_CONFIG)}
              onDecision={(decision) => void setDecision(openCandidate.id, decision)}
            />
          </section>
        ) : null}
      </div>
      {activity && agentDismissed !== activityKey ? (
        <QueueAgentPopup
          activity={activity}
          onDismiss={() => setAgentDismissed(activityKey)}
        />
      ) : null}
      {criteriaOpen && batch ? (
        <ScoreCriteriaDialog
          busy={busy}
          config={batch.scoreConfig}
          jobRole={batch.jobRole}
          onClose={() => setCriteriaOpen(false)}
          onSave={(config) => void saveScoreCriteria(config)}
        />
      ) : null}
    </div>
  );
}

function QueueAgentPopup({
  activity,
  onDismiss,
}: {
  activity: QueueActivity;
  onDismiss: () => void;
}) {
  const { candidate, kind, remaining } = activity;
  const title =
    kind === "talking"
      ? "Talking"
      : kind === "calling"
        ? "Calling"
        : kind === "scoring"
          ? "Writing summary"
          : "Queued";
  const detail =
    kind === "talking"
      ? `Talking with ${candidate.name} on ${candidate.phone}`
      : kind === "calling"
        ? `Calling ${candidate.name} at ${candidate.phone}`
        : kind === "scoring"
          ? `Gemini is writing the summary and score for ${candidate.name}`
          : `Next: ${candidate.name} · ${candidate.phone}. Waiting for the previous screen to finish.`;

  return (
    <div className="fixed right-5 bottom-5 z-40 w-[min(100%-2.5rem,380px)] rounded-[28px] border border-line bg-paper p-5 shadow-[var(--shadow)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-[0.18em] text-muted uppercase">HireCall agent</p>
          <h2 className="font-display mt-1 text-2xl">{title}</h2>
        </div>
        <button
          className="text-sm font-medium text-muted hover:text-ink"
          onClick={onDismiss}
          type="button"
        >
          Hide
        </button>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ink">{detail}</p>
      {kind === "scoring" ? (
        <p className="mt-2 text-xs text-muted">The next queued number is not dialed until this score is saved.</p>
      ) : null}
      {remaining > 0 ? (
        <p className="mt-2 text-xs text-muted">
          {remaining} still queued after this.
        </p>
      ) : null}
    </div>
  );
}

function CandidateEditor({
  active,
  batchId,
  busy,
  candidate,
  onBusy,
  onError,
  onNotice,
  onSaved,
}: {
  active: boolean;
  batchId: string;
  busy: boolean;
  candidate: Candidate;
  onBusy: (value: boolean) => void;
  onError: (value: string) => void;
  onNotice: (value: string) => void;
  onSaved: (data: { batch?: Batch; candidates?: Candidate[] }) => void;
}) {
  const [name, setName] = useState(candidate.name);
  const [jobRole, setJobRole] = useState(candidate.jobRole);
  const [phone, setPhone] = useState("");
  const [resumeUrl, setResumeUrl] = useState(candidate.resumeUrl);
  const [consent, setConsent] = useState(candidate.consent);

  useEffect(() => {
    setName(candidate.name);
    setJobRole(candidate.jobRole);
    setPhone("");
    setResumeUrl(candidate.resumeUrl);
    setConsent(candidate.consent);
  }, [candidate.id, candidate.name, candidate.jobRole, candidate.phone, candidate.resumeUrl, candidate.consent]);

  async function save() {
    onBusy(true);
    onError("");
    onNotice("");
    try {
      const data = await hirecallApi.updateCandidate(batchId, candidate.id, {
        name,
        phone: phone.trim() || candidate.phone,
        resumeUrl,
        consent,
        jobRole,
      });
      onSaved(data);
      const linkChanged = resumeUrl.trim() !== candidate.resumeUrl;
      const roleChanged = jobRole.trim() !== candidate.jobRole;
      onNotice(
        linkChanged
          ? "Candidate updated. Resume text was cleared — prepare the new link."
          : roleChanged
            ? "Candidate updated. Gemini rewrote the call script for this role."
            : "Candidate updated.",
      );
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not update this candidate.");
    } finally {
      onBusy(false);
    }
  }

  const fieldClass =
    "mt-1 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent";

  return (
    <form
      className="mb-6 grid gap-4 md:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label className="text-sm font-medium text-ink">
        Name
        <input
          className={fieldClass}
          disabled={busy || !active}
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
      </label>
      <label className="text-sm font-medium text-ink">
        Job role
        <input
          className={fieldClass}
          disabled={busy || !active}
          onChange={(event) => setJobRole(event.target.value)}
          placeholder="Software intern"
          value={jobRole}
        />
      </label>
      <label className="text-sm font-medium text-ink">
        Phone
        <input
          className={fieldClass}
          disabled={busy || !active}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="+14155550123"
          value={phone}
        />
        <span className="mt-1 block text-xs font-normal text-muted">
          Stored number is shown masked: {candidate.phone}. Leave blank to keep it, or enter a new
          country-code number to replace it.
        </span>
      </label>
      <label className="text-sm font-medium text-ink md:col-span-2">
        Resume link
        <input
          className={fieldClass}
          disabled={busy || !active}
          onChange={(event) => setResumeUrl(event.target.value)}
          placeholder="https://drive.google.com/..."
          value={resumeUrl}
        />
      </label>
      <label className="flex items-center gap-2 text-sm font-medium text-ink">
        <input
          checked={consent}
          disabled={busy || !active}
          onChange={(event) => setConsent(event.target.checked)}
          type="checkbox"
        />
        Consent on file
      </label>
      <div className="flex items-end justify-end">
        <button
          className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
          disabled={busy || !active}
          type="submit"
        >
          Save candidate
        </button>
      </div>
    </form>
  );
}

function JobRoleForm({
  busy,
  jobRole,
  scoreConfig,
  onOpenCriteria,
  onSave,
}: {
  busy: boolean;
  jobRole: string;
  scoreConfig: ScoreConfig;
  onOpenCriteria: () => void;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(jobRole);
  useEffect(() => {
    setValue(jobRole);
  }, [jobRole]);

  return (
    <section className="rounded-[28px] border border-line bg-paper p-5 shadow-[var(--shadow)] md:p-8">
      <h2 className="font-display text-2xl">Job role for this Excel</h2>
      <p className="mt-1 mb-4 text-sm text-muted">
        This opening is used in the CALL-E prompt Gemini writes. Put the same role
        in the Excel job_role column, or set it here for everyone in this file.
      </p>
      <form
        className="flex flex-col gap-3 md:flex-row md:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(value);
        }}
      >
        <label className="flex-1 text-sm font-medium text-ink">
          Job role
          <input
            className="mt-1 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            disabled={busy}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Software intern"
            value={value}
          />
        </label>
        <button
          className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
          disabled={busy}
          type="submit"
        >
          Save job role
        </button>
        <button
          className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink disabled:opacity-50"
          disabled={busy}
          onClick={onOpenCriteria}
          type="button"
        >
          Scoring criteria ({scoreConfig.passScore}/10)
        </button>
      </form>
    </section>
  );
}

function ScoreCriteriaCard({
  config,
  onEdit,
}: {
  config: ScoreConfig;
  onEdit: () => void;
}) {
  const ticks = SCORE_CRITERIA_OPTIONS.filter((row) => config.selected.includes(row.id));
  return (
    <section className="rounded-[28px] border border-line bg-paper p-5 shadow-[var(--shadow)] md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl">Scoring for this Excel</h2>
          <p className="mt-1 text-sm text-muted">
            Gemini reads the ticks below after each call. Pass mark is {config.passScore}/10.
            You mark Next round yourself after reading the screening.
          </p>
        </div>
        <button
          className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink"
          onClick={onEdit}
          type="button"
        >
          Edit criteria
        </button>
      </div>
      <ul className="mt-4 flex flex-col gap-2">
        {ticks.map((row) => (
          <li className="text-sm text-ink" key={row.id}>
            ✓ {row.label}
          </li>
        ))}
        {config.notes ? <li className="text-sm text-ink">✓ {config.notes}</li> : null}
      </ul>
    </section>
  );
}

function ScoreCriteriaDialog({
  busy,
  config,
  jobRole,
  onClose,
  onSave,
}: {
  busy: boolean;
  config: ScoreConfig;
  jobRole: string;
  onClose: () => void;
  onSave: (config: ScoreConfig) => void;
}) {
  const [passScore, setPassScore] = useState(config.passScore);
  const [selected, setSelected] = useState<ScoreConfig["selected"]>(config.selected);
  const [notes, setNotes] = useState(config.notes);

  useEffect(() => {
    setPassScore(config.passScore);
    setSelected(config.selected);
    setNotes(config.notes);
  }, [config]);

  function toggle(id: ScoreConfig["selected"][number]) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(28,24,20,0.45)] p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-[28px] border border-line bg-paper p-6 shadow-[var(--shadow)]">
        <h2 className="font-display text-2xl">Scoring for this Excel</h2>
        <p className="mt-1 mb-5 text-sm text-muted">
          These marks apply to every candidate in this file
          {jobRole ? ` for ${jobRole}` : ""}. Gemini scores the call against the
          boxes you tick. You click Next round or Rejected after you read Screening.
        </p>
        <label className="block text-sm font-medium text-ink">
          Pass mark: {passScore} / 10
          <input
            className="mt-2 w-full"
            max={10}
            min={1}
            onChange={(event) => setPassScore(Number(event.target.value))}
            type="range"
            value={passScore}
          />
        </label>
        <p className="mt-5 mb-2 text-sm font-medium text-ink">What Gemini should score</p>
        <ul className="flex flex-col gap-2">
          {SCORE_CRITERIA_OPTIONS.map((row) => (
            <li key={row.id}>
              <label className="flex items-start gap-2 text-sm text-ink">
                <input
                  checked={selected.includes(row.id)}
                  className="mt-0.5"
                  onChange={() => toggle(row.id)}
                  type="checkbox"
                />
                {row.label}
              </label>
            </li>
          ))}
        </ul>
        <label className="mt-5 block text-sm font-medium text-ink">
          Extra notes for this job role
          <textarea
            className="mt-1 h-24 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Must explain one project in their own words. Java internships count more than coursework."
            value={notes}
          />
        </label>
        <div className="mt-6 flex justify-end gap-3">
          <button
            className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
          <button
            className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
            disabled={busy || selected.length === 0}
            onClick={() => onSave({ passScore, selected, notes: notes.trim(), autoDecision: false })}
            type="button"
          >
            Save criteria
          </button>
        </div>
      </div>
    </div>
  );
}

function ScreeningResultCard({
  busy,
  candidate,
  criteria,
  onDecision,
}: {
  busy: boolean;
  candidate: Candidate;
  criteria: string[];
  onDecision: (decision: Exclude<RecruiterDecision, "">) => void;
}) {
  const response = candidate.callResponse;
  if (!response) {
    return (
      <p className="rounded-2xl border border-line bg-canvas px-4 py-6 text-sm text-muted">
        No call result yet. Place a call first.
      </p>
    );
  }

  const result = response.result;
  const decisionKey = response.decision || "pending";
  const fields = result
    ? [
        ["Identity", result.identity_confirmed],
        ["Good time", result.good_time],
        ["Education", result.education || "—"],
        ["Projects", result.projects || "—"],
        ["Work / internship", result.work_or_internship || "—"],
        ["Off-script", result.off_script || "—"],
        ["End reason", result.end_reason],
        ["Follow-up note", result.recruiter_follow_up || "—"],
        ["Quote", result.callee_quote ? `“${result.callee_quote}”` : "—"],
      ]
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-2xl border border-line bg-canvas px-4 py-3">
          <p className="text-xs tracking-wide text-muted uppercase">Call</p>
          <p className={`mt-1 text-sm font-medium ${CALL_COPY[response.status].className}`}>
            {CALL_COPY[response.status].label}
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-canvas px-4 py-3">
          <p className="text-xs tracking-wide text-muted uppercase">Call time</p>
          <p className="mt-1 text-sm font-medium text-ink">
            {response.startedAt ? formatUploadedAt(response.startedAt) : "—"}
          </p>
          {response.endedAt ? (
            <p className="mt-0.5 text-xs text-muted">Ended {formatUploadedAt(response.endedAt)}</p>
          ) : null}
        </div>
        <div className="rounded-2xl border border-line bg-canvas px-4 py-3">
          <p className="text-xs tracking-wide text-muted uppercase">Duration</p>
          <p className="mt-1 text-sm font-medium text-ink">{formatCallDuration(response.durationSeconds)}</p>
        </div>
        <div className="rounded-2xl border border-line bg-canvas px-4 py-3">
          <p className="text-xs tracking-wide text-muted uppercase">
            {(response.calleCallId || candidate.calleCallId || "").startsWith("dry-run:")
              ? "Call id"
              : "CALL-E id"}
          </p>
          <p className="mt-1 font-mono text-sm break-all text-ink">
            {shortCalleId(response.calleCallId || candidate.calleCallId || "") || "—"}
          </p>
          <p className="mt-0.5 text-xs text-muted">Attempt {candidate.callAttempt || 1}</p>
        </div>
        <div className="rounded-2xl border border-line bg-canvas px-4 py-3">
          <p className="text-xs tracking-wide text-muted uppercase">Gemini score</p>
          <p className="mt-1 text-sm font-medium text-ink">
            {(response.calleCallId || candidate.calleCallId || "").startsWith("dry-run:")
              ? "No live call"
              : response.score == null
                ? "Scoring…"
                : `${response.score}/10`}
            {(response.calleCallId || candidate.calleCallId || "").startsWith("dry-run:") ? (
              <span className="mt-0.5 block text-xs font-normal text-muted">
                Dry-run does not ask Gemini for a score.
              </span>
            ) : (
              <span className="mt-0.5 block text-xs font-normal text-muted">
                Pass mark {response.passScore}
              </span>
            )}
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-canvas px-4 py-3">
          <p className="text-xs tracking-wide text-muted uppercase">Your decision</p>
          <p className={`mt-1 text-sm font-medium ${DECISION_COPY[decisionKey].className}`}>
            {DECISION_COPY[decisionKey].label}
          </p>
        </div>
      </div>
      {criteria.length > 0 ? (
        <div className="rounded-2xl border border-line bg-canvas px-4 py-4">
          <p className="text-xs tracking-wide text-muted uppercase">Scored against</p>
          <ul className="mt-2 flex flex-col gap-1">
            {criteria.map((line) => (
              <li className="text-sm text-ink" key={line}>
                ✓ {line}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="rounded-2xl border border-line bg-canvas px-4 py-4">
        <p className="text-xs tracking-wide text-muted uppercase">Gemini summary</p>
        <p className="mt-2 text-sm leading-relaxed text-ink">
          {response.summary || "Summary will appear after Gemini reads this screening. Refresh the page if it is still empty."}
        </p>
      </div>
      <div>
        <h3 className="font-display text-xl">Screening details</h3>
        <p className="mt-1 mb-3 text-sm text-muted">
          What they said on the call, stored on this person. Call again needed after
          a completed screen rewrites the next script for unclear answers. If they
          asked to be called later, or nobody picked up, the script stays the same.
        </p>
        {fields.length > 0 ? (
          <div className="overflow-hidden rounded-2xl border border-line">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-canvas text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">Field</th>
                  <th className="px-4 py-3 font-medium">Answer</th>
                </tr>
              </thead>
              <tbody>
                {fields.map(([label, value]) => (
                  <tr className="border-t border-line" key={label}>
                    <td className="w-40 px-4 py-3 font-medium whitespace-nowrap text-ink">{label}</td>
                    <td className="px-4 py-3 text-muted">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">Structured answers are not in yet.</p>
        )}
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-ink">
          Mark this screening after you read the answers
        </p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["call_again", "Call again needed"],
              ["next_round", "Next round"],
              ["rejected", "Rejected"],
            ] as const
          ).map(([value, label]) => (
            <button
              className={`rounded-full px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                response.decision === value
                  ? "bg-accent text-paper"
                  : "border border-line text-ink"
              }`}
              disabled={busy}
              key={value}
              onClick={() => onDecision(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
