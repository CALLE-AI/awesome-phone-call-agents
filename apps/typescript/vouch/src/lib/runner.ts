import { DEFAULT_PROJECT_CAP, canDial, vouchKey } from "@caller-ai/core";
import { sqlite } from "@/db";
import { blockCopy, consentGate, type ConsentRow } from "./consent";
import { fieldSetHash } from "./fields";
import { countRuns, getConsent, getKilled, getRun, listRuns } from "./queries";
import { permittedFields } from "./scope";
import { loadVouchScript } from "./scripts";
import { callDurationMs } from "./vouch-timing";

export function confirmDial(consent: ConsentRow): { ok: true; runId: string } | { ok: false; reason: string } {
  const gate = consentGate(consent);
  if (!gate.ok) return { ok: false, reason: blockCopy(gate.reason) };
  if (getKilled()) return { ok: false, reason: "kill_switch" };

  const requested = JSON.parse(consent.requestedJson) as string[];
  const consentFields = JSON.parse(consent.consentFieldsJson) as string[];
  const scope = permittedFields({
    requested,
    jurisdiction: consent.jurisdiction,
    consentFields,
  });
  const key = vouchKey({
    consentId: consent.id,
    employerId: consent.employerId,
    fieldSetHash: fieldSetHash(scope.permitted),
    scopeVersion: 1,
  });

  const existing = sqlite.prepare("SELECT id FROM runs WHERE idempotency_key = ?").get(key) as { id: string } | undefined;
  if (existing) return { ok: true, runId: existing.id };

  const decision = canDial(
    { projectCap: DEFAULT_PROJECT_CAP, used: countRuns(), killed: getKilled(), blocklist: [] },
    "+15555550140",
  );
  if (!decision.ok) return { ok: false, reason: decision.reason };

  const runId = `run_${consent.id}`;
  sqlite
    .prepare(
      `INSERT INTO runs (
        id, consent_id, idempotency_key, run_id, disposition, result_json, transcript_json,
        evidence_json, confidence_score, status, started_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, 'in_progress', ?)`,
    )
    .run(runId, consent.id, key, `sim_${consent.scriptId}`, Date.now());

  return { ok: true, runId };
}

export function finalizeRun(runId: string, opts?: { cancelled?: boolean }) {
  const run = getRun(runId);
  if (!run || run.status !== "in_progress") return null;
  const consent = getConsent(run.consentId);
  if (!consent) return null;

  if (opts?.cancelled) {
    sqlite
      .prepare(
        `UPDATE runs SET disposition = ?, result_json = ?, transcript_json = ?, evidence_json = ?,
         confidence_score = ?, status = 'terminal' WHERE id = ?`,
      )
      .run("cancelled", "{}", "[]", "[]", "0", runId);
    return runId;
  }

  const requested = JSON.parse(consent.requestedJson) as string[];
  const consentFields = JSON.parse(consent.consentFieldsJson) as string[];
  const scope = permittedFields({
    requested,
    jurisdiction: consent.jurisdiction,
    consentFields,
  });
  const script = loadVouchScript(consent.scriptId);
  const permitted = new Set(scope.permitted);
  const result: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(script.result)) {
    if (field === "salary_history") continue;
    if (
      ["employment_confirmed", "title_stated", "start_date_stated", "end_date_stated", "eligible_for_rehire"].includes(
        field,
      ) &&
      !permitted.has(field)
    ) {
      continue;
    }
    result[field] = value;
  }

  sqlite
    .prepare(
      `UPDATE runs SET disposition = ?, result_json = ?, transcript_json = ?, evidence_json = ?,
       confidence_score = ?, status = 'terminal' WHERE id = ?`,
    )
    .run(
      script.disposition,
      JSON.stringify(result),
      JSON.stringify(script.turns),
      JSON.stringify(script.evidence),
      String(script.confidence),
      runId,
    );
  return runId;
}

export function advanceInProgress() {
  if (getKilled()) {
    cancelInProgress();
    return;
  }
  const now = Date.now();
  for (const run of listRuns()) {
    if (run.status !== "in_progress") continue;
    if (now >= (run.startedAt ?? 0) + callDurationMs()) finalizeRun(run.id);
  }
}

export function cancelInProgress() {
  for (const run of listRuns()) {
    if (run.status === "in_progress") finalizeRun(run.id, { cancelled: true });
  }
}