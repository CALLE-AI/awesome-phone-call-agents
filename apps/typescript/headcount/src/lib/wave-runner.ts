import {
  DEFAULT_PROJECT_CAP,
  accountWave,
  canDial,
  headcountKey,
  isRetryable,
  linkEvidence,
  type Disposition,
  type TranscriptTurn,
} from "@caller-ai/core";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { triageAttempt } from "./escalate";
import { loadCallScript, ROSTER_SCRIPTS, scriptForWaveTwo, type ScriptId } from "./scripts";
import { parseJson } from "./utils";
import { WAVE_STAGGER_MS, callDurationMs } from "./wave-timing";

export { WAVE_RING_MS, WAVE_STAGGER_MS, WAVE_TALK_MS, callDurationMs, phaseForAttempt } from "./wave-timing";
export type { LivePhase } from "./wave-timing";

export type WavePreview = {
  waveNo: number;
  alreadyRan: boolean;
  running: boolean;
  killed: boolean;
  targets: Array<{
    rosterEntryId: string;
    displayName: string;
    phoneMasked: string;
    reason: string;
  }>;
  wouldDial: number;
  wouldRemain: number;
};

export function scriptForRoster(rosterEntryId: string): ScriptId {
  return ROSTER_SCRIPTS[rosterEntryId] ?? "cooperative";
}

export function getKilled(): boolean {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, "killed")).get();
  return row?.value === "1";
}

export function setKilled(killed: boolean) {
  const value = killed ? "1" : "0";
  const existing = db.select().from(schema.settings).where(eq(schema.settings.key, "killed")).get();
  if (existing) {
    db.update(schema.settings).set({ value }).where(eq(schema.settings.key, "killed")).run();
    return;
  }
  db.insert(schema.settings).values({ key: "killed", value }).run();
}

export function countAttempts(): number {
  return db.select().from(schema.attempts).all().length;
}

export function previewNextWave(eventId: string): WavePreview {
  const waves = db.select().from(schema.waves).where(eq(schema.waves.eventId, eventId)).all();
  const nextNo = waves.reduce((max, wave) => Math.max(max, wave.waveNo), 0) + 1;
  const already = waves.some((wave) => wave.waveNo === nextNo);
  const running = waves.some((wave) => wave.status === "running");
  const killed = getKilled();
  const used = countAttempts();
  const targets = already || running ? [] : selectTargets(eventId, nextNo);
  const budget = accountWave(
    { projectCap: DEFAULT_PROJECT_CAP, used, killed, blocklist: [] },
    targets.length,
  );

  return {
    waveNo: nextNo,
    alreadyRan: already,
    running,
    killed,
    targets: targets.slice(0, budget.wouldDial),
    wouldDial: budget.wouldDial,
    wouldRemain: budget.wouldRemain,
  };
}

export function runNextWave(eventId: string): { ok: true; waveId: string } | { ok: false; reason: string } {
  const preview = previewNextWave(eventId);
  if (preview.killed) return { ok: false, reason: "kill_switch" };
  if (preview.running) return { ok: false, reason: "wave_running" };
  if (preview.alreadyRan) return { ok: false, reason: "already_ran" };
  if (preview.wouldDial === 0) return { ok: false, reason: "no_targets" };

  const event = db.select().from(schema.events).where(eq(schema.events.id, eventId)).get();
  const instrument = db
    .select()
    .from(schema.instruments)
    .where(eq(schema.instruments.eventId, eventId))
    .get();
  if (!event || !instrument) return { ok: false, reason: "missing_event" };

  const waveId = `wav_${preview.waveNo}`;
  db.insert(schema.waves)
    .values({
      id: waveId,
      eventId,
      instrumentId: instrument.id,
      waveNo: preview.waveNo,
      filterJson: JSON.stringify({ slice: preview.waveNo === 1 ? "full_roster" : "retryable_and_needs" }),
      budgetCap: preview.wouldDial,
      status: "running",
    })
    .run();

  const origin = Date.now();
  preview.targets.forEach((target, index) => {
    enqueueAttempt({
      eventId,
      waveId,
      waveNo: preview.waveNo,
      instrumentVersion: instrument.version,
      rosterEntryId: target.rosterEntryId,
      startedAt: origin + index * WAVE_STAGGER_MS,
    });
  });

  return { ok: true, waveId };
}

export function enqueueAttempt(input: {
  eventId: string;
  waveId: string;
  waveNo: number;
  instrumentVersion: number;
  rosterEntryId: string;
  startedAt: number;
}) {
  const key = headcountKey({
    eventId: input.eventId,
    rosterEntryId: input.rosterEntryId,
    waveNo: input.waveNo,
    instrumentVersion: input.instrumentVersion,
  });
  const existing = db.select().from(schema.attempts).where(eq(schema.attempts.idempotencyKey, key)).get();
  if (existing) return existing.id;

  const roster = db.select().from(schema.roster).where(eq(schema.roster.id, input.rosterEntryId)).get();
  const decision = canDial(
    { projectCap: DEFAULT_PROJECT_CAP, used: countAttempts(), killed: getKilled(), blocklist: [] },
    roster?.phoneE164 ?? "",
  );
  if (!decision.ok) return null;

  const scriptId =
    input.waveNo > 1
      ? scriptForWaveTwo(scriptForRoster(input.rosterEntryId))
      : scriptForRoster(input.rosterEntryId);
  const attemptId = `att_${input.rosterEntryId}_w${input.waveNo}`;
  db.insert(schema.attempts)
    .values({
      id: attemptId,
      waveId: input.waveId,
      rosterEntryId: input.rosterEntryId,
      runId: `sim_${scriptId}_${input.waveNo}`,
      idempotencyKey: key,
      disposition: null,
      resultJson: null,
      transcriptJson: null,
      evidenceJson: null,
      confidenceScore: null,
      status: "in_progress",
      startedAt: input.startedAt,
    })
    .run();

  return attemptId;
}

export function finalizeAttempt(attemptId: string, opts?: { cancelled?: boolean }) {
  const attempt = db.select().from(schema.attempts).where(eq(schema.attempts.id, attemptId)).get();
  if (!attempt || attempt.status !== "in_progress") return null;

  const wave = db.select().from(schema.waves).where(eq(schema.waves.id, attempt.waveId)).get();
  if (!wave) return null;

  if (opts?.cancelled) {
    writeTerminal(attemptId, wave.eventId, attempt.rosterEntryId, {
      disposition: "cancelled",
      result: {},
      turns: [],
      evidence: [],
      confidence: 0,
    });
    return attemptId;
  }

  const waveNo = wave.waveNo;
  const scriptId =
    waveNo > 1 ? scriptForWaveTwo(scriptForRoster(attempt.rosterEntryId)) : scriptForRoster(attempt.rosterEntryId);
  const script = loadCallScript(scriptId);
  writeTerminal(attemptId, wave.eventId, attempt.rosterEntryId, {
    disposition: script.disposition as Disposition,
    result: script.result,
    turns: script.turns,
    evidence: script.evidence,
    confidence: script.confidence,
  });
  return attemptId;
}

export function advanceInProgress(eventId?: string) {
  if (getKilled()) {
    cancelInProgress(eventId);
    return;
  }

  const now = Date.now();
  const pending = pendingAttempts(eventId);
  for (const attempt of pending) {
    const due = (attempt.startedAt ?? 0) + callDurationMs();
    if (now >= due) finalizeAttempt(attempt.id);
  }
  settleWaves(eventId);
}

export function cancelInProgress(eventId?: string) {
  for (const attempt of pendingAttempts(eventId)) {
    finalizeAttempt(attempt.id, { cancelled: true });
  }
  const waves = eventId
    ? db.select().from(schema.waves).where(eq(schema.waves.eventId, eventId)).all()
    : db.select().from(schema.waves).all();
  for (const wave of waves) {
    if (wave.status !== "running") continue;
    db.update(schema.waves).set({ status: "killed" }).where(eq(schema.waves.id, wave.id)).run();
  }
}

function pendingAttempts(eventId?: string) {
  const waves = eventId
    ? db.select().from(schema.waves).where(eq(schema.waves.eventId, eventId)).all()
    : db.select().from(schema.waves).all();
  const waveIds = new Set(waves.map((wave) => wave.id));
  return db
    .select()
    .from(schema.attempts)
    .all()
    .filter((row) => row.status === "in_progress" && waveIds.has(row.waveId));
}

function settleWaves(eventId?: string) {
  const waves = eventId
    ? db.select().from(schema.waves).where(eq(schema.waves.eventId, eventId)).all()
    : db.select().from(schema.waves).all();
  for (const wave of waves) {
    if (wave.status !== "running") continue;
    const open = db
      .select()
      .from(schema.attempts)
      .all()
      .some((row) => row.waveId === wave.id && row.status === "in_progress");
    if (!open) {
      db.update(schema.waves).set({ status: "complete" }).where(eq(schema.waves.id, wave.id)).run();
    }
  }
}

function writeTerminal(
  attemptId: string,
  eventId: string,
  rosterEntryId: string,
  payload: {
    disposition: Disposition;
    result: Record<string, unknown>;
    turns: TranscriptTurn[];
    evidence: string[];
    confidence: number;
  },
) {
  const linked = linkEvidence({
    structuredResult: payload.result,
    evidence: payload.evidence,
    turns: payload.turns,
  });
  const triage = triageAttempt({
    disposition: payload.disposition,
    result: payload.result,
    linked,
    confidence: payload.confidence,
  });

  db.update(schema.attempts)
    .set({
      disposition: payload.disposition,
      resultJson: JSON.stringify(payload.result),
      transcriptJson: JSON.stringify(payload.turns),
      evidenceJson: JSON.stringify(payload.evidence),
      confidenceScore: String(payload.confidence),
      status: "terminal",
    })
    .where(eq(schema.attempts.id, attemptId))
    .run();

  const triageId = `tri_${rosterEntryId}_${attemptId}`;
  const existing = db.select().from(schema.triageCards).where(eq(schema.triageCards.id, triageId)).get();
  if (existing) return;

  db.insert(schema.triageCards)
    .values({
      id: triageId,
      eventId,
      attemptId,
      rosterEntryId,
      severity: triage.severity,
      needsJson: JSON.stringify(triage.needs),
      assignee: null,
      status: triage.dispatch ? "open" : triage.severity === "safe" ? "closed" : "open",
    })
    .run();
}

function selectTargets(eventId: string, waveNo: number) {
  const roster = db.select().from(schema.roster).where(eq(schema.roster.eventId, eventId)).all();
  if (waveNo === 1) {
    return roster.map((row) => ({
      rosterEntryId: row.id,
      displayName: row.displayName,
      phoneMasked: row.phoneMasked,
      reason: "full roster",
    }));
  }

  const attempts = db.select().from(schema.attempts).all();
  const latest = new Map<string, (typeof attempts)[number]>();
  for (const attempt of attempts) {
    const current = latest.get(attempt.rosterEntryId);
    if (!current || attempt.id > current.id) latest.set(attempt.rosterEntryId, attempt);
  }

  return roster.flatMap((row) => {
    const attempt = latest.get(row.id);
    if (!attempt?.disposition) return [];
    const result = parseJson<Record<string, unknown>>(attempt.resultJson, {});
    const retryable = isRetryable(attempt.disposition as Disposition);
    const needsHelp = result.safety_status === "needs_assistance";
    if (!retryable && !needsHelp) return [];
    return [
      {
        rosterEntryId: row.id,
        displayName: row.displayName,
        phoneMasked: row.phoneMasked,
        reason: retryable ? attempt.disposition : "needs assistance",
      },
    ];
  });
}
