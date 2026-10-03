import { canonicalSha256, hashEvent } from "./crypto.js";
import type { IntentState, MissionEvent, MissionStatus, StructuredFact } from "./types.js";

export type EvidencePack = {
  version: 1;
  mission_id: string;
  mission_status: string;
  exported_at: string;
  events: MissionEvent[];
  facts: StructuredFact[];
  ledger_summary: Array<{
    call_intent_id: string;
    attempt_no: number;
    state: string;
    outcome: string | null;
    provider_run_id: string | null;
    provider_runs: number;
    validated_facts?: Record<string, string>;
  }>;
};

export type RecomputedIntent = {
  call_intent_id: string;
  attempt_no: number | null;
  state: IntentState | "unknown";
  outcome: string | null;
  provider_run_id: string | null;
  provider_runs: number;
  validated_facts_sha256: string | null;
};

export type EvidenceVerification = {
  ok: boolean;
  provider_runs_per_intent_ok: boolean;
  illegal_unresolved_unlocks: number;
  facts_traceable: string;
  event_chain_intact: boolean;
  no_cancelled_downstream_dispatch: boolean;
  ledger_matches_recompute: boolean;
  mission_status_matches: boolean;
  errors: string[];
  recomputed: {
    mission_status: MissionStatus | "unknown";
    intents: RecomputedIntent[];
  };
  /** PROJECT §5.6 jury badge lines */
  badge: {
    dup_runs: string;
    unsafe_unlocks: string;
    facts: string;
    chain: string;
  };
};

/**
 * Rebuild intent + mission status purely from the append-only event stream.
 */
export function recomputeFromEvents(events: MissionEvent[]): {
  mission_status: MissionStatus | "unknown";
  intents: Map<string, RecomputedIntent>;
  provider_run_ids: Map<string, Set<string>>;
} {
  const ordered = [...events].sort((a, b) => a.sequence_no - b.sequence_no);
  let mission_status: MissionStatus | "unknown" = "unknown";
  const intents = new Map<string, RecomputedIntent>();
  const provider_run_ids = new Map<string, Set<string>>();

  const touch = (id: string): RecomputedIntent => {
    let row = intents.get(id);
    if (!row) {
      row = {
        call_intent_id: id,
        attempt_no: null,
        state: "unknown",
        outcome: null,
        provider_run_id: null,
        provider_runs: 0,
        validated_facts_sha256: null,
      };
      intents.set(id, row);
    }
    return row;
  };

  for (const ev of ordered) {
    if (ev.event_type === "mission_status" && typeof ev.redacted_payload?.status === "string") {
      mission_status = ev.redacted_payload.status as MissionStatus;
    }
    if (ev.event_type === "mission_created") {
      mission_status = "running";
    }

    const id = ev.call_intent_id;
    if (!id) continue;
    const row = touch(id);

    switch (ev.event_type) {
      case "intent_authorized":
        row.state = "planned";
        row.attempt_no =
          typeof ev.redacted_payload?.attempt_no === "number"
            ? ev.redacted_payload.attempt_no
            : null;
        break;
      case "dispatch_begun":
        row.state = "dispatching";
        break;
      case "provider_run_known":
      case "provider_run_recovered":
        row.state = "run_known";
        {
          const runId =
            typeof ev.redacted_payload?.provider_run_id === "string"
              ? ev.redacted_payload.provider_run_id
              : ev.provider_run_id;
          if (runId) {
            const ids = provider_run_ids.get(id) ?? new Set<string>();
            ids.add(runId);
            provider_run_ids.set(id, ids);
            row.provider_run_id = runId;
            row.provider_runs = ids.size;
          }
        }
        break;
      case "marked_ambiguous":
        row.state = "ambiguous";
        break;
      case "intent_terminal":
        row.state = "terminal";
        row.outcome =
          typeof ev.redacted_payload?.outcome === "string"
            ? ev.redacted_payload.outcome
            : null;
        row.validated_facts_sha256 =
          typeof ev.redacted_payload?.validated_facts_sha256 === "string"
            ? ev.redacted_payload.validated_facts_sha256
            : null;
        break;
      case "intent_cancelled":
        row.state = "cancelled";
        break;
      default:
        break;
    }
  }

  return { mission_status, intents, provider_run_ids };
}

/**
 * Self-verifying evidence: recompute hash chain, replay state, check invariants.
 */
export function verifyEvidencePack(pack: EvidencePack): EvidenceVerification {
  const errors: string[] = [];
  const validActors = new Set(["system", "operator", "provider", "agent"]);
  const validMissionStatuses = new Set([
    "running",
    "paused",
    "blocked_needs_resolution",
    "cancellation_requested",
    "completed",
    "cancelled",
  ]);

  // 1) Event envelope + hash chain (recompute expected hashes)
  let prev: string | null = null;
  const ordered = [...pack.events].sort((a, b) => a.sequence_no - b.sequence_no);
  const eventIds = new Set<string>();
  const chainErrorStart = errors.length;
  if (pack.version !== 1) errors.push(`unsupported evidence version ${pack.version}`);
  if (!pack.mission_id) errors.push("mission_id missing");
  if (ordered.length === 0) errors.push("event stream empty");
  for (const [index, ev] of ordered.entries()) {
    if (ev.sequence_no !== index + 1) {
      errors.push(`seq ${ev.sequence_no}: expected contiguous seq ${index + 1}`);
    }
    if (ev.mission_id !== pack.mission_id) {
      errors.push(`seq ${ev.sequence_no}: event mission_id mismatch`);
    }
    if (eventIds.has(ev.event_id)) {
      errors.push(`seq ${ev.sequence_no}: duplicate event_id ${ev.event_id}`);
    }
    eventIds.add(ev.event_id);
    if (ev.hash_version !== 2) {
      errors.push(`seq ${ev.sequence_no}: unsupported hash_version`);
    }
    if (!ev.event_id || !validActors.has(ev.actor)) {
      errors.push(`seq ${ev.sequence_no}: invalid event identity or actor`);
    }
    if (!ev.occurred_at || Number.isNaN(Date.parse(ev.occurred_at))) {
      errors.push(`seq ${ev.sequence_no}: invalid occurred_at`);
    }
    if (
      ev.event_type === "mission_status" &&
      !validMissionStatuses.has(String(ev.redacted_payload?.status ?? ""))
    ) {
      errors.push(`seq ${ev.sequence_no}: invalid mission status`);
    }
    if (ev.prev_hash !== prev) {
      errors.push(`seq ${ev.sequence_no}: prev_hash mismatch`);
    }
    const { event_hash: _eventHash, ...envelope } = ev;
    const expected = hashEvent(envelope);
    if (ev.event_hash !== expected) {
      errors.push(`seq ${ev.sequence_no}: event_hash mismatch vs recompute`);
    }
    prev = ev.event_hash;
  }
  const created = ordered.filter((event) => event.event_type === "mission_created");
  if (created.length !== 1 || created[0]?.sequence_no !== 1) {
    errors.push("event stream must start with exactly one mission_created");
  }
  const event_chain_intact = errors.length === chainErrorStart;

  // 2) Replay state from events
  const recomputed = recomputeFromEvents(pack.events);

  // 3) Ledger must match recompute
  let ledger_matches_recompute = true;
  const ledgerIds = new Set<string>();
  for (const row of pack.ledger_summary) {
    if (ledgerIds.has(row.call_intent_id)) {
      ledger_matches_recompute = false;
      errors.push(`duplicate ledger intent ${row.call_intent_id}`);
    }
    ledgerIds.add(row.call_intent_id);
    const r = recomputed.intents.get(row.call_intent_id);
    if (!r) {
      ledger_matches_recompute = false;
      errors.push(`ledger intent ${row.call_intent_id} missing from event replay`);
      continue;
    }
    if (r.state !== "unknown" && r.state !== row.state) {
      ledger_matches_recompute = false;
      errors.push(
        `intent ${row.call_intent_id}: ledger state ${row.state} ≠ replay ${r.state}`,
      );
    }
    if ((r.provider_run_id || null) !== (row.provider_run_id || null)) {
      ledger_matches_recompute = false;
      errors.push(`intent ${row.call_intent_id}: provider_run_id mismatch`);
    }
    if (r.provider_runs !== row.provider_runs) {
      ledger_matches_recompute = false;
      errors.push(`intent ${row.call_intent_id}: provider_runs mismatch`);
    }
    if ((r.outcome ?? null) !== (row.outcome ?? null)) {
      ledger_matches_recompute = false;
      errors.push(`intent ${row.call_intent_id}: outcome mismatch`);
    }
    if (r.attempt_no !== row.attempt_no) {
      ledger_matches_recompute = false;
      errors.push(`intent ${row.call_intent_id}: attempt_no mismatch`);
    }
    if (
      r.state === "terminal" &&
      r.validated_facts_sha256 !==
        canonicalSha256(row.validated_facts ?? {})
    ) {
      ledger_matches_recompute = false;
      errors.push(`intent ${row.call_intent_id}: validated facts mismatch`);
    }
  }
  for (const id of recomputed.intents.keys()) {
    if (!ledgerIds.has(id)) {
      ledger_matches_recompute = false;
      errors.push(`replayed intent ${id} missing from ledger`);
    }
  }

  const mission_status_matches =
    recomputed.mission_status !== "unknown" &&
    recomputed.mission_status === pack.mission_status;
  if (!mission_status_matches) {
    errors.push(
      `mission_status pack=${pack.mission_status} replay=${recomputed.mission_status}`,
    );
  }

  // 4) ≤1 provider run per intent
  const runs = new Map<string, Set<string>>();
  for (const row of pack.ledger_summary) {
    const set = runs.get(row.call_intent_id) ?? new Set();
    if (row.provider_run_id) set.add(row.provider_run_id);
    runs.set(row.call_intent_id, set);
  }
  for (const [intentId, providerIds] of recomputed.provider_run_ids) {
    const set = runs.get(intentId) ?? new Set<string>();
    for (const providerId of providerIds) set.add(providerId);
    runs.set(intentId, set);
  }
  let provider_runs_per_intent_ok = true;
  const ownerByProviderRun = new Map<string, string>();
  for (const [id, set] of runs) {
    if (set.size > 1) {
      provider_runs_per_intent_ok = false;
      errors.push(`intent ${id}: ${set.size} provider runs`);
    }
    for (const providerRunId of set) {
      const owner = ownerByProviderRun.get(providerRunId);
      if (owner && owner !== id) {
        provider_runs_per_intent_ok = false;
        errors.push(
          `provider run ${providerRunId}: shared by intents ${owner} and ${id}`,
        );
      } else {
        ownerByProviderRun.set(providerRunId, id);
      }
    }
  }

  // 5) Facts provenance must resolve to a positive terminal source and event.
  const positiveOutcomes = new Set([
    "candidate_accepted",
    "verbally_confirmed",
    "practice_acknowledged",
  ]);
  let traceableFacts = 0;
  for (const fact of pack.facts) {
    const source = recomputed.intents.get(fact.sourceCallIntentId);
    const sourceLedger = pack.ledger_summary.find(
      (row) => row.call_intent_id === fact.sourceCallIntentId,
    );
    const matchingEvent = ordered.some(
      (event) =>
        event.event_type === "fact_recorded" &&
        event.call_intent_id === fact.sourceCallIntentId &&
        event.provider_run_id === fact.sourceRunId &&
        event.redacted_payload?.sourceRunId === fact.sourceRunId &&
        event.redacted_payload?.fact === fact.fact &&
        event.redacted_payload?.value === fact.value,
    );
    const traceable = Boolean(
      fact.sourceRunId &&
        fact.sourceCallIntentId &&
        source?.state === "terminal" &&
        source.provider_run_id === fact.sourceRunId &&
        source.attempt_no === fact.sourceAttemptNo &&
        source.outcome &&
        positiveOutcomes.has(source.outcome) &&
        sourceLedger?.validated_facts?.[fact.fact] === fact.value &&
        matchingEvent,
    );
    if (traceable) {
      traceableFacts += 1;
    } else {
      errors.push(`fact ${fact.fact}: missing or invalid provenance`);
    }
  }
  let factEventsCovered = true;
  for (const event of ordered.filter(
    (candidate) => candidate.event_type === "fact_recorded",
  )) {
    const covered = pack.facts.some(
      (fact) =>
        fact.sourceCallIntentId === event.call_intent_id &&
        fact.sourceRunId === event.provider_run_id &&
        fact.fact === event.redacted_payload?.fact &&
        fact.value === event.redacted_payload?.value &&
        fact.confirmedBy === event.redacted_payload?.confirmedBy,
    );
    if (!covered) {
      factEventsCovered = false;
      errors.push(`seq ${event.sequence_no}: recorded fact missing from facts export`);
    }
  }
  const authorizedPayloadHashes = new Map<string, string>();
  for (const event of ordered) {
    if (
      event.event_type === "intent_authorized" &&
      event.call_intent_id &&
      typeof event.redacted_payload?.payload_sha256 === "string"
    ) {
      authorizedPayloadHashes.set(
        event.call_intent_id,
        event.redacted_payload.payload_sha256,
      );
    }
  }
  let factConsumptionOk = true;
  for (const event of ordered.filter(
    (candidate) => candidate.event_type === "fact_consumed",
  )) {
    const payload = event.redacted_payload;
    const matchingFact = pack.facts.some(
      (fact) =>
        fact.fact === payload?.fact &&
        fact.value === payload?.value &&
        fact.sourceRunId === payload?.source_run_id &&
        fact.sourceCallIntentId === payload?.source_call_intent_id &&
        fact.sourceAttemptNo === payload?.source_attempt_no,
    );
    const authorizedHash = event.call_intent_id
      ? authorizedPayloadHashes.get(event.call_intent_id)
      : undefined;
    if (
      !event.call_intent_id ||
      !matchingFact ||
      event.provider_run_id !== payload?.source_run_id ||
      authorizedHash !== payload?.consuming_payload_sha256
    ) {
      factConsumptionOk = false;
      errors.push(
        `seq ${event.sequence_no}: fact consumption lacks payload-bound provenance`,
      );
    }
  }
  const factsOk =
    traceableFacts === pack.facts.length && factEventsCovered && factConsumptionOk;
  const facts_traceable = `${traceableFacts}/${pack.facts.length}`;

  const terminalFingerprints = new Map<string, string>();
  for (const event of ordered) {
    if (!event.call_intent_id) continue;
    if (
      event.event_type === "intent_terminal" &&
      typeof event.redacted_payload?.result_fingerprint === "string"
    ) {
      terminalFingerprints.set(
        event.call_intent_id,
        event.redacted_payload.result_fingerprint,
      );
    }
    if (event.event_type === "duplicate_result_ignored") {
      const expected = terminalFingerprints.get(event.call_intent_id);
      if (
        !expected ||
        event.redacted_payload?.result_fingerprint !== expected
      ) {
        errors.push(
          `seq ${event.sequence_no}: duplicate result fingerprint mismatch`,
        );
      }
    }
    if (event.event_type === "result_conflict") {
      errors.push(`seq ${event.sequence_no}: conflicting terminal provider result`);
    }
  }

  // 6) Illegal unlock after unresolved/ambiguous
  let illegal_unresolved_unlocks = 0;
  const stateAtEvent = new Map<
    string,
    { state: IntentState | "unknown"; outcome: string | null }
  >();
  const getEventState = (id: string) => {
    const existing = stateAtEvent.get(id);
    if (existing) return existing;
    const createdState = { state: "unknown" as const, outcome: null };
    stateAtEvent.set(id, createdState);
    return createdState;
  };
  const safeUnlockOutcomes = new Set([
    "declined",
    "no_answer",
    "voicemail",
  ]);
  for (const ev of ordered) {
    if (ev.call_intent_id) {
      const current = getEventState(ev.call_intent_id);
      switch (ev.event_type) {
        case "intent_authorized":
          if (current.state !== "unknown") {
            errors.push(`seq ${ev.sequence_no}: duplicate intent authorization`);
          }
          current.state = "planned";
          current.outcome = null;
          break;
        case "dispatch_begun":
          if (current.state !== "planned") {
            errors.push(
              `seq ${ev.sequence_no}: illegal replay transition ${current.state} -> dispatching`,
            );
          }
          current.state = "dispatching";
          break;
        case "provider_run_known":
          if (current.state !== "dispatching") {
            errors.push(
              `seq ${ev.sequence_no}: illegal replay transition ${current.state} -> run_known`,
            );
          }
          current.state = "run_known";
          break;
        case "provider_run_recovered":
          if (current.state !== "ambiguous" && current.state !== "dispatching") {
            errors.push(
              `seq ${ev.sequence_no}: illegal recovery transition ${current.state} -> run_known`,
            );
          }
          current.state = "run_known";
          break;
        case "marked_ambiguous":
          if (current.state !== "dispatching") {
            errors.push(
              `seq ${ev.sequence_no}: illegal replay transition ${current.state} -> ambiguous`,
            );
          }
          current.state = "ambiguous";
          break;
        case "intent_terminal":
          if (current.state !== "run_known") {
            errors.push(
              `seq ${ev.sequence_no}: illegal replay transition ${current.state} -> terminal`,
            );
          }
          current.state = "terminal";
          current.outcome =
            typeof ev.redacted_payload?.outcome === "string"
              ? ev.redacted_payload.outcome
              : null;
          break;
        case "intent_cancelled":
          if (current.state !== "planned") {
            errors.push(
              `seq ${ev.sequence_no}: illegal replay transition ${current.state} -> cancelled`,
            );
          }
          current.state = "cancelled";
          break;
      }
      if (
        ev.event_type === "unlock_allowed" &&
        !(
          current.state === "terminal" &&
          current.outcome !== null &&
          safeUnlockOutcomes.has(current.outcome)
        )
      ) {
        illegal_unresolved_unlocks += 1;
        errors.push(
          `seq ${ev.sequence_no}: unlock after unresolved/ambiguous or non-terminal upstream`,
        );
      }
    } else if (ev.event_type === "unlock_allowed") {
      illegal_unresolved_unlocks += 1;
      errors.push(`seq ${ev.sequence_no}: unlock missing upstream intent`);
    }
  }

  // 7) No dispatch after mission cancellation_requested / cancelled
  let cancelled = false;
  let no_cancelled_downstream_dispatch = true;
  for (const ev of ordered) {
    if (
      ev.event_type === "mission_status" &&
      (ev.redacted_payload?.status === "cancellation_requested" ||
        ev.redacted_payload?.status === "cancelled")
    ) {
      cancelled = true;
    }
    if (cancelled && ev.event_type === "dispatch_begun") {
      no_cancelled_downstream_dispatch = false;
      errors.push(`seq ${ev.sequence_no}: dispatch after cancel`);
    }
  }

  const ok =
    errors.length === 0 &&
    event_chain_intact &&
    provider_runs_per_intent_ok &&
    factsOk &&
    illegal_unresolved_unlocks === 0 &&
    no_cancelled_downstream_dispatch &&
    ledger_matches_recompute &&
    mission_status_matches;

  return {
    ok,
    provider_runs_per_intent_ok,
    illegal_unresolved_unlocks,
    facts_traceable,
    event_chain_intact,
    no_cancelled_downstream_dispatch,
    ledger_matches_recompute,
    mission_status_matches,
    errors,
    recomputed: {
      mission_status: recomputed.mission_status,
      intents: [...recomputed.intents.values()],
    },
    badge: {
      dup_runs: provider_runs_per_intent_ok ? "0 dup runs" : "DUP RUNS",
      unsafe_unlocks:
        illegal_unresolved_unlocks === 0
          ? "0 unsafe unlocks"
          : `${illegal_unresolved_unlocks} unsafe unlocks`,
      facts: `${facts_traceable} facts`,
      chain: event_chain_intact ? "chain intact" : "chain BROKEN",
    },
  };
}

/** Tamper helpers for jury demo / matrix. */
export function tamperEvidencePack(pack: EvidencePack): EvidencePack {
  const clone = structuredClone(pack);
  if (clone.events[0]) {
    clone.events[0] = {
      ...clone.events[0],
      event_hash: "tampered_" + clone.events[0].event_hash.slice(8),
    };
  }
  return clone;
}

export type TamperKind =
  | "hash"
  | "event_id"
  | "event_actor"
  | "illegal_unlock"
  | "dup_run"
  | "missing_fact"
  | "post_cancel_dispatch";

export function tamperPackByKind(
  pack: EvidencePack,
  kind: TamperKind,
): EvidencePack {
  const clone = structuredClone(pack);
  const appendSealed = (
    event: Omit<MissionEvent, "event_hash" | "hash_version" | "sequence_no" | "prev_hash">,
  ): void => {
    const previous = clone.events.at(-1) ?? null;
    const envelope: Omit<MissionEvent, "event_hash"> = {
      ...event,
      hash_version: 2,
      sequence_no: (previous?.sequence_no ?? 0) + 1,
      prev_hash: previous?.event_hash ?? null,
    };
    clone.events.push({ ...envelope, event_hash: hashEvent(envelope) });
  };
  switch (kind) {
    case "hash":
      return tamperEvidencePack(clone);
    case "event_id":
      if (clone.events[0]) clone.events[0].event_id = "evt_rewritten_identity";
      return clone;
    case "event_actor":
      if (clone.events[0]) clone.events[0].actor = "operator";
      return clone;
    case "illegal_unlock": {
      appendSealed({
        event_id: "evt_tamper_unlock",
        mission_id: clone.mission_id,
        event_type: "marked_ambiguous",
        actor: "system",
        occurred_at: new Date().toISOString(),
        call_intent_id: clone.ledger_summary[0]?.call_intent_id,
        redacted_payload: { reason: "tamper" },
      });
      appendSealed({
        event_id: "evt_tamper_unlock2",
        mission_id: clone.mission_id,
        event_type: "unlock_allowed",
        actor: "system",
        occurred_at: new Date().toISOString(),
        call_intent_id: clone.ledger_summary[0]?.call_intent_id,
        redacted_payload: { reason: "tamper_illegal" },
      });
      return clone;
    }
    case "dup_run": {
      const row = clone.ledger_summary[0];
      if (row) {
        appendSealed({
          event_id: "evt_tamper_dup_run",
          mission_id: clone.mission_id,
          event_type: "provider_run_known",
          actor: "provider",
          occurred_at: new Date().toISOString(),
          call_intent_id: row.call_intent_id,
          provider_run_id: "dup_run_tamper",
          redacted_payload: { provider_run_id: "dup_run_tamper" },
        });
      }
      return clone;
    }
    case "missing_fact": {
      clone.facts.push({
        fact: "tampered_fact",
        value: "x",
        confirmedBy: "nobody",
        sourceRunId: "",
        sourceCallIntentId: "",
        sourceAttemptNo: 1,
      });
      return clone;
    }
    case "post_cancel_dispatch": {
      appendSealed({
        event_id: "evt_tamper_cancel",
        mission_id: clone.mission_id,
        event_type: "mission_status",
        actor: "operator",
        occurred_at: new Date().toISOString(),
        redacted_payload: { status: "cancellation_requested", reason: "tamper" },
      });
      appendSealed({
        event_id: "evt_tamper_dispatch",
        mission_id: clone.mission_id,
        event_type: "dispatch_begun",
        actor: "system",
        occurred_at: new Date().toISOString(),
        call_intent_id: clone.ledger_summary[0]?.call_intent_id,
        redacted_payload: { from: "planned", to: "dispatching" },
      });
      return clone;
    }
  }
}
