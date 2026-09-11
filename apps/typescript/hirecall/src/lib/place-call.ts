import { emptyScreeningResult, parseScreeningResult, type ScreeningResult } from "@/lib/call-result-schema";
import { bindCalleSnapshot, calleIdentityMatches, CalleApiError, CalleConfigError, createCalleCall, getCalleCall, isDryRunCallId, type CalleBindExpected, type CalleSnapshot } from "@/lib/calle";
import { summarizeScreeningCall } from "@/lib/generate-call-prompt";
import {
  getBatch,
  loadCandidate,
  markCallFailed,
  markCandidateQueued,
  requireActiveBatch,
  saveCallProgress,
  saveCallVerdict,
  saveDialledCall,
} from "@/lib/db";
import { DEFAULT_SCORE_CONFIG } from "@/lib/score-config";
import { canPlaceCall, isLiveCall, isScoringPending, isTerminalCall } from "@/lib/status";
import type { CallStatus, Candidate } from "@/lib/types";

const DEFINITE_CALLE_REJECTION = new Set([400, 401, 403, 404, 405, 413, 415, 422]);

function isDefiniteCalleRejection(error: unknown) {
  return error instanceof CalleApiError && error.status != null && DEFINITE_CALLE_REJECTION.has(error.status);
}

function isTerminal(status: CallStatus) {
  return isTerminalCall(status);
}

function snapshotTimes(snapshot: CalleSnapshot) {
  const attempt = snapshot.recipients?.[0]?.attempts?.at(-1);
  const startedAt = attempt?.startedAt || snapshot.createdAt || "";
  const endedAt = attempt?.completedAt || snapshot.completedAt || "";
  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(endedAt);
  const durationSeconds =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
      ? Math.round((endMs - startMs) / 1000)
      : null;
  return { startedAt, endedAt, durationSeconds };
}

function snapshotResult(snapshot: CalleSnapshot): ScreeningResult | null {
  return parseScreeningResult(
    snapshot.recipients?.[0]?.structuredResult ?? snapshot.structuredResult ?? null,
  );
}

function bindExpected(batchId: string, candidate: Candidate): CalleBindExpected {
  return {
    task: candidate.callPrompt,
    phone: candidate.phone,
    batchId,
    candidateId: candidate.id,
  };
}

function usableResult(snapshot: CalleSnapshot, expected: CalleBindExpected) {
  return bindCalleSnapshot(snapshot, expected) ? snapshotResult(snapshot) : null;
}

function progressStatus(snapshot: CalleSnapshot, expected: CalleBindExpected): CallStatus {
  if (bindCalleSnapshot(snapshot, expected)) {
    return mapCalleSnapshotToStatus(snapshot);
  }
  if (!calleIdentityMatches(snapshot, expected)) return "calling";
  const mapped = mapCalleSnapshotToStatus(snapshot);
  if (mapped === "failed") return "failed";
  return isTerminal(mapped) ? "calling" : mapped;
}

export function mapCalleSnapshotToStatus(snapshot: CalleSnapshot): CallStatus {
  const recipient = snapshot.recipients?.[0];
  const attempt = recipient?.attempts?.at(-1);
  const tokens = [snapshot.status, recipient?.status, attempt?.status].map((value) =>
    String(value ?? "")
      .toLowerCase()
      .replace(/-/g, "_"),
  );
  const live = tokens.find(Boolean) ?? "";

  if (live === "talking" || live === "in_progress") return "talking";
  if (live === "ringing" || live === "queued" || live === "calling" || live === "created") {
    return "calling";
  }
  if (live === "completed") {
    const result = snapshotResult(snapshot);
    if (result?.end_reason === "no_answer") return "no_answer";
    if (result?.end_reason === "failed") return "failed";
    return "completed";
  }
  if (live === "failed" || live === "canceled" || live === "cancelled") return "failed";
  return "calling";
}

async function dialCandidate(batchId: string, candidate: Candidate): Promise<Candidate> {
  if (isLiveCall(candidate.callStatus) && candidate.calleCallId) {
    return candidate;
  }
  if (!candidate.callPrompt) {
    throw new Error("Prepare the resume first so Gemini can write the call script.");
  }

  const attempt = candidate.callAttempt + 1;
  try {
    const snapshot = await createCalleCall({
      task: candidate.callPrompt,
      phone: candidate.phone,
      batchId,
      candidateId: candidate.id,
      attempt,
    });
    const expected = bindExpected(batchId, candidate);
    const status = progressStatus(snapshot, expected);
    const times = snapshotTimes(snapshot);
    const ended = isTerminal(status);
    const saved = await saveDialledCall({
      batchId,
      candidateId: candidate.id,
      calleCallId: snapshot.id,
      attempt,
      status: status === "queued" ? "calling" : status,
      startedAt: times.startedAt || new Date().toISOString(),
      endedAt: ended ? times.endedAt || new Date().toISOString() : "",
      durationSeconds: times.durationSeconds,
      result: usableResult(snapshot, expected),
      raw: snapshot,
    });
    if (isDryRunCallId(snapshot.id) && saved.callResponse && saved.callResponse.score == null) {
      await saveCallVerdict(saved.callResponse.id, {
        score: 0,
        summary: "Dry-run: no live call was placed. Set HIRECALL_LIVE_CALLS=true and CALLE_API_KEY to dial.",
        decision: "",
      });
      return loadCandidate(batchId, candidate.id);
    }
    return saved;
  } catch (error) {
    if (isDefiniteCalleRejection(error)) {
      const message = error instanceof Error ? error.message : "CALL-E did not place the call.";
      await markCallFailed(batchId, candidate.id, message);
    }
    throw error;
  }
}

export async function startCandidateCall(batchId: string, candidateId: string): Promise<Candidate> {
  await requireActiveBatch(batchId);
  const candidate = await loadCandidate(batchId, candidateId);
  if (!candidate.active) {
    throw new Error("This candidate is inactive.");
  }
  if (isLiveCall(candidate.callStatus) && candidate.calleCallId) {
    return candidate;
  }
  if (!canPlaceCall(candidate) && candidate.callStatus !== "queued") {
    throw new Error(
      "Prepare the resume first so Gemini can write the call script. Call only dials a person who already has a prompt.",
    );
  }
  return dialCandidate(batchId, candidate);
}

export async function queueReadyCalls(batchId: string): Promise<{ queued: number; failed: number; started: number }> {
  await requireActiveBatch(batchId);
  const detail = await getBatch(batchId);
  if (!detail) {
    throw new Error("Excel batch not found.");
  }

  const callable = detail.candidates.filter(
    (row) => canPlaceCall(row) && row.callStatus !== "completed",
  );
  let queued = 0;
  let failed = 0;
  for (const row of callable) {
    try {
      await markCandidateQueued(batchId, row.id);
      queued += 1;
    } catch {
      failed += 1;
    }
  }
  if (queued === 0 && callable.length > 0) {
    throw new Error("Could not queue anyone in this Excel.");
  }

  const started = (await startNextQueuedCall(batchId)) ? 1 : 0;
  return { queued, failed, started };
}

export async function startNextQueuedCall(batchId: string): Promise<Candidate | null> {
  const detail = await getBatch(batchId);
  if (!detail?.batch.active) return null;
  if (detail.candidates.some((row) => isLiveCall(row.callStatus))) return null;
  if (detail.candidates.some((row) => isScoringPending(row))) return null;
  const next = detail.candidates.find((row) => row.callStatus === "queued");
  if (!next) return null;
  return dialCandidate(batchId, next);
}

export async function syncBatchCalls(batchId: string): Promise<void> {
  const detail = await getBatch(batchId);
  if (!detail) return;

  const live = detail.candidates.filter((row) => isLiveCall(row.callStatus) && row.calleCallId);

  try {
    for (const row of live) {
      const expected = bindExpected(batchId, row);
      const snapshot = await getCalleCall(row.calleCallId, expected);
      if (!calleIdentityMatches(snapshot, expected)) {
        continue;
      }
      const status = progressStatus(snapshot, expected);
      const times = snapshotTimes(snapshot);
      const result = usableResult(snapshot, expected);
      await saveCallProgress({
        batchId,
        candidateId: row.id,
        calleCallId: row.calleCallId,
        status,
        startedAt: times.startedAt || row.callResponse?.startedAt || "",
        endedAt: isTerminal(status) ? times.endedAt || new Date().toISOString() : "",
        durationSeconds: times.durationSeconds,
        result,
        raw: snapshot,
      });
      if (isTerminal(status)) {
        const updated = await loadCandidate(batchId, row.id);
        await ensureCallSummary(updated);
      }
    }
  } catch (error) {
    if (error instanceof CalleConfigError) {
      return;
    }
    throw error;
  }

  await ensureBatchSummaries(batchId);
  await startNextQueuedCall(batchId);
}

export async function ensureCallSummary(candidate: Candidate): Promise<void> {
  const response = candidate.callResponse;
  if (!response || response.score != null) return;
  if (!isTerminal(response.status) && !isTerminal(candidate.callStatus)) return;

  if (isDryRunCallId(response.calleCallId) || isDryRunCallId(candidate.calleCallId)) {
    await saveCallVerdict(response.id, {
      score: 0,
      summary: "Dry-run: no live call was placed. Set HIRECALL_LIVE_CALLS=true and CALLE_API_KEY to dial.",
      decision: "",
    });
    return;
  }

  const endReason =
    response.result?.end_reason ||
    (candidate.callStatus === "no_answer" || candidate.callStatus === "completed" || candidate.callStatus === "failed"
      ? candidate.callStatus
      : "failed");
  const result = response.result ?? emptyScreeningResult(endReason);
  const scoreConfig = (await getBatch(candidate.batchId))?.batch.scoreConfig ?? DEFAULT_SCORE_CONFIG;

  if (endReason === "no_answer" || candidate.callStatus === "no_answer") {
    await saveCallVerdict(response.id, {
      score: 0,
      summary: "No answer. There was no screening to score.",
      decision: "",
    });
    return;
  }

  if (!response.result) {
    await saveCallVerdict(response.id, {
      score: 0,
      summary: "This call did not return a bound screening result. Next round and Rejected were not recorded.",
      decision: "",
    });
    return;
  }

  try {
    const verdict = await summarizeScreeningCall({
      name: candidate.name,
      jobRole: candidate.jobRole,
      durationSeconds: response.durationSeconds,
      scoreConfig,
      result,
    });
    await saveCallVerdict(response.id, verdict);
  } catch {
    await saveCallVerdict(response.id, {
      score: 0,
      summary: "Call ended. Gemini could not write a score and summary.",
      decision: "",
    });
  }
}

export async function ensureBatchSummaries(batchId: string): Promise<void> {
  const detail = await getBatch(batchId);
  if (!detail) return;
  for (const row of detail.candidates) {
    await ensureCallSummary(row);
  }
}
