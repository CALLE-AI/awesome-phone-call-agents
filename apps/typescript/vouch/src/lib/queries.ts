import { DEFAULT_PROJECT_CAP, remainingCalls, resolveCalleMode, type TranscriptTurn } from "@caller-ai/core";
import { sqlite } from "@/db";
import { consentGate } from "./consent";
import type { ConsentRow } from "./consent";
import { permittedFields } from "./scope";
import { loadVouchScript } from "./scripts";
import { categorizeVouch, type VouchSeverity } from "./triage";
import { phaseForAttempt, type LivePhase } from "./vouch-timing";

type ConsentSql = {
  id: string;
  candidate_name: string;
  employer: string;
  employer_id: string | null;
  jurisdiction: string;
  requested_json: string;
  consent_fields_json: string;
  signed_at: string;
  expires_at: string;
  revoked_at: string | null;
  requesting_org: string | null;
  employer_code: string | null;
  phone_masked: string | null;
  script_id: string | null;
};

export type RunRow = {
  id: string;
  consentId: string;
  idempotencyKey: string;
  runId: string | null;
  disposition: string | null;
  resultJson: string | null;
  transcriptJson: string | null;
  evidenceJson: string | null;
  confidenceScore: string | null;
  status: string;
  startedAt: number | null;
};

function mapConsent(row: ConsentSql): ConsentRow {
  return {
    id: row.id,
    candidateName: row.candidate_name,
    employer: row.employer,
    employerId: row.employer_id ?? row.employer,
    jurisdiction: row.jurisdiction,
    requestedJson: row.requested_json,
    consentFieldsJson: row.consent_fields_json,
    signedAt: row.signed_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    requestingOrg: row.requesting_org ?? "Harbor Lane Staffing",
    employerCode: row.employer_code ?? "—",
    phoneMasked: row.phone_masked ?? "+1 ••• ••• ••••",
    scriptId: row.script_id ?? "hr_confirm",
  };
}

export function listConsents(): ConsentRow[] {
  return (sqlite.prepare("SELECT * FROM consents ORDER BY candidate_name").all() as ConsentSql[]).map(mapConsent);
}

export function getConsent(id: string): ConsentRow | undefined {
  const row = sqlite.prepare("SELECT * FROM consents WHERE id = ?").get(id) as ConsentSql | undefined;
  return row ? mapConsent(row) : undefined;
}

export function getRun(id: string): RunRow | undefined {
  const row = sqlite.prepare("SELECT * FROM runs WHERE id = ?").get(id) as
    | {
        id: string;
        consent_id: string;
        idempotency_key: string;
        run_id: string | null;
        disposition: string | null;
        result_json: string | null;
        transcript_json: string | null;
        evidence_json: string | null;
        confidence_score: string | null;
        status: string;
        started_at: number | null;
      }
    | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    consentId: row.consent_id,
    idempotencyKey: row.idempotency_key,
    runId: row.run_id,
    disposition: row.disposition,
    resultJson: row.result_json,
    transcriptJson: row.transcript_json,
    evidenceJson: row.evidence_json,
    confidenceScore: row.confidence_score,
    status: row.status,
    startedAt: row.started_at ?? null,
  };
}

export function scopeTranscript(consent: ConsentRow, run?: RunRow): TranscriptTurn[] {
  if (run?.transcriptJson) {
    const turns = JSON.parse(run.transcriptJson) as TranscriptTurn[];
    if (turns.length > 0) return turns;
  }
  return loadVouchScript(consent.scriptId).turns;
}

export function latestRunForConsent(consentId: string): RunRow | undefined {
  const row = sqlite.prepare("SELECT * FROM runs WHERE consent_id = ? ORDER BY id DESC LIMIT 1").get(consentId) as
    | { id: string }
    | undefined;
  return row ? getRun(row.id) : undefined;
}

export function countRuns() {
  const row = sqlite.prepare("SELECT COUNT(*) AS n FROM runs").get() as { n: number };
  return row.n;
}

export function getKilled() {
  const row = sqlite.prepare("SELECT value FROM settings WHERE key = 'killed'").get() as { value: string } | undefined;
  return row?.value === "1";
}

export function setKilled(killed: boolean) {
  sqlite.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('killed', ?)").run(killed ? "1" : "0");
}

export function listRuns(): RunRow[] {
  const rows = sqlite.prepare("SELECT id FROM runs").all() as Array<{ id: string }>;
  return rows.flatMap((row) => {
    const run = getRun(row.id);
    return run ? [run] : [];
  });
}

export type VouchCard = {
  consentId: string;
  runId: string | null;
  candidateName: string;
  employer: string;
  phoneMasked: string;
  severity: VouchSeverity;
  hint: string;
};

export type LiveCall = {
  runId: string;
  displayName: string;
  phoneMasked: string;
  phase: LivePhase;
  startedAt: number | null;
};

export type VouchSnapshot = {
  coverage: {
    dialed: number;
    confirmed: number;
    blocked: number;
    inFlight: number;
    queued: number;
  };
  live: LiveCall[];
  cards: VouchCard[];
  scope: {
    candidate: string;
    jurisdiction: string;
    requested: string[];
    permitted: string[];
    blocked: Array<{ field: string; reason: string }>;
    peerLabel: string;
    transcript_turns: TranscriptTurn[];
  };
};

export function getVouchSnapshot(): VouchSnapshot {
  const consents = listConsents();
  const now = Date.now();
  const live: LiveCall[] = [];
  const cards: VouchCard[] = [];
  let dialed = 0;
  let confirmed = 0;
  let blocked = 0;

  for (const consent of consents) {
    const run = latestRunForConsent(consent.id);
    const gate = consentGate(consent);
    if (run && (run.status === "terminal" || now >= (run.startedAt ?? 0))) dialed += 1;
    if (run?.status === "in_progress") {
      const phase = phaseForAttempt(run.startedAt, now);
      live.push({
        runId: run.id,
        displayName: consent.candidateName,
        phoneMasked: consent.phoneMasked,
        phase,
        startedAt: run.startedAt,
      });
    }
    const severity = categorizeVouch(consent, run);
    if (severity === "confirmed") confirmed += 1;
    if (severity === "blocked" || severity === "third_party") blocked += 1;
    if (run?.status === "in_progress") continue;
    cards.push({
      consentId: consent.id,
      runId: run?.status === "terminal" ? run.id : null,
      candidateName: consent.candidateName,
      employer: consent.employer,
      phoneMasked: consent.phoneMasked,
      severity,
      hint:
        severity === "blocked"
          ? gate.ok
            ? "blocked"
            : gate.reason.replaceAll("_", " ")
          : severity === "third_party"
            ? "third party only"
            : severity === "confirmed"
              ? "employment confirmed"
              : "not dialed",
    });
  }

  live.sort((a, b) => a.displayName.localeCompare(b.displayName));
  const hero = consents.find((row) => row.id === "cns_demo") ?? consents[0];
  const requested = hero ? (JSON.parse(hero.requestedJson) as string[]) : [];
  const consentFields = hero ? (JSON.parse(hero.consentFieldsJson) as string[]) : [];
  const scope = hero
    ? permittedFields({ requested, jurisdiction: hero.jurisdiction, consentFields })
    : { permitted: [], blocked: [] };

  return {
    coverage: {
      dialed,
      confirmed,
      blocked,
      inFlight: live.filter((call) => call.phase !== "queued").length,
      queued: live.filter((call) => call.phase === "queued").length,
    },
    live,
    cards,
    scope: {
      candidate: hero?.candidateName ?? "Candidate",
      jurisdiction: hero?.jurisdiction ?? "US-CA",
      requested,
      permitted: scope.permitted,
      blocked: scope.blocked,
      peerLabel: "Verifier",
      transcript_turns: hero ? scopeTranscript(hero, latestRunForConsent(hero.id)) : [],
    },
  };
}

export function getConsoleState() {
  const used = countRuns();
  const killed = getKilled();
  const cap = DEFAULT_PROJECT_CAP;
  return {
    used,
    cap,
    remaining: remainingCalls({ projectCap: cap, used, killed, blocklist: [] }),
    killed,
    mode: resolveCalleMode(),
  };
}