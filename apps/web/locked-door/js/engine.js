/**
 * ORCHESTRATOR. Ingest -> risk -> plan -> simulated calls -> grounded extraction
 * -> changeset -> review/publish -> evaluation.
 *
 * Runs identically headless (used to score the baseline counterfactually) and
 * with UI hooks (used for the live runner).
 */

import { scoreDirectory, FIELDS, publishedLineClass } from './risk.js';
import { planGreedy, planOldestFirst, totalAvailableHarm } from './planner.js';
import {
  SimulatedFacilityTransport,
  CalleTelephonyAdapter,
  buildCanonicalRequest,
  toE164,
  DISCLOSURE,
  MAX_ATTEMPTS,
} from './transport.js';
import { extractFromAttempt, mergeAttempts } from './extract.js';
import { buildChangeset, DirectoryStore, ROUTE, assertPublishable, verifySpansResolve } from './publish.js';
import { evaluateRun, countUngroundedPublishes } from './evaluate.js';

export const RESULT_SCHEMA_VERSION = 'heat-relief-verification/2026-08';

export class VerificationEngine {
  constructor(directory, groundTruth, { seed = 'calle-sim-v1', now = Date.now() } = {}) {
    this.directory = directory;
    this.facilities = directory.facilities;
    this.now = now;
    this.nowIso = new Date(now).toISOString();
    this.seed = seed;

    this.truthById = new Map(groundTruth.facilities.map((t) => [t.id, t]));
    this.transport = new SimulatedFacilityTransport(this.truthById, seed);
    this.realAdapter = new CalleTelephonyAdapter(); // present and disabled

    // OBSERVABLE line class: derived from the published record only.
    this.facilityById = new Map(this.facilities.map((f) => [f.id, f]));
    this.lineClassById = (id) => publishedLineClass(this.facilityById.get(id));
    // Duplicate listings that share a phone number are detectable from the
    // directory itself (same digits), so collapsing them is fair game.
    const phoneKey = new Map();
    for (const f of this.facilities) {
      const digits = String(f.phone ?? '').replace(/\D/g, '').slice(-10);
      if (!digits) continue;
      if (!phoneKey.has(digits)) phoneKey.set(digits, f.id);
    }
    this.lineKeyById = (id) => {
      const f = this.facilityById.get(id);
      const digits = String(f?.phone ?? '').replace(/\D/g, '').slice(-10);
      return digits ? phoneKey.get(digits) : id;
    };

    this.riskRows = scoreDirectory(this.facilities, this.lineClassById, this.now);
    this.riskIndex = new Map(this.riskRows.map((r) => [`${r.facilityId}:${r.field}`, r]));
    this.rowFor = (id, field) => this.riskIndex.get(`${id}:${field}`);

    this.ctx = {
      rowFor: this.rowFor,
      lineClassById: this.lineClassById,
      lineKeyById: this.lineKeyById,
    };

    this.totalAvailableHarm = totalAvailableHarm(this.facilities, this.ctx);

    this.reset();
  }

  reset() {
    this.store = new DirectoryStore(this.facilities);
    this.calls = [];
    this.changeset = [];
    this.reviewQueue = [];
    this.transcripts = new Map();
    this.plan = null;
    this.baselinePlan = null;
    this.baselineResult = null;
    this.evaluation = null;
    this.runId = `run_${new Date(this.now).toISOString().slice(0, 10)}_${Math.abs(hash(this.seed)).toString(36)}`;
  }

  /* ------------------------------------------------------------ plan ---- */
  planCalls(budget = 25) {
    this.plan = planGreedy(this.facilities, this.ctx, budget);
    this.baselinePlan = planOldestFirst(this.facilities, this.ctx, budget);
    return { plan: this.plan, baseline: this.baselinePlan };
  }

  /** The payload the real CALL-E adapter would receive for one queued call. */
  buildCallPlan(entry) {
    const facility = this.facilityById.get(entry.facilityId);
    const questions = entry.questions.map((q) => q.field);
    const payload = {
      runId: this.runId,
      facilityId: facility.id,
      facility,
      phoneE164: toE164(facility.phone),
      disclosure: DISCLOSURE,
      questions,
      resultSchemaVersion: RESULT_SCHEMA_VERSION,
      maximumAttempts: MAX_ATTEMPTS,
      approvedPlanDigest: null,
    };
    const req = buildCanonicalRequest(payload);
    payload.approvedPlanDigest = req.requestBodyDigest;
    return { payload, request: buildCanonicalRequest(payload) };
  }

  /* ------------------------------------------------------------- run ---- */
  /**
   * Executes a plan through the simulated transport.
   * hooks: { onCallStart, onTurn, onCallEnd, onBackoff, delay }
   */
  async runPlan(plan, { hooks = {}, store = this.store, collect = true } = {}) {
    const calls = [];
    for (const entry of plan.calls) {
      const { payload, request } = this.buildCallPlan(entry);
      const callId = `${this.runId}:${entry.facilityId}`;
      const facility = payload.facility;

      if (hooks.onCallStart) await hooks.onCallStart({ entry, payload, request, callId, facility });

      const attempts = await this.transport.placeCall(payload, {
        onTurn: hooks.onTurn ? (t, c) => hooks.onTurn(t, { ...c, callId, facility, entry }) : undefined,
        onAttemptStart: hooks.onAttemptStart
          ? (a) => hooks.onAttemptStart({ ...a, callId, facility, entry })
          : undefined,
        onBackoff: hooks.onBackoff,
      });

      const perAttempt = attempts.map((a) => extractFromAttempt(a, payload.questions));
      const merged = mergeAttempts(perAttempt);
      const used = attempts[attempts.length - 1];
      const callMeta = {
        callId,
        attempts: attempts.length,
        attemptUsed: used.attempt,
        outcome: used.outcome,
        connected: attempts.some((a) => a.connected),
        idempotencyKey: request.idempotencyKey,
      };

      // A citation resolves against the transcript of the attempt that produced
      // it, so every attempt is retained and addressed by callId#attempt.
      for (const a of attempts) this.transcripts.set(`${callId}#${a.attempt}`, a.transcript);
      const groundingAttempt =
        attempts.find((a) => a.connected) ?? attempts.find((a) => a.outcome === 'voicemail') ?? used;

      const rows = buildChangeset(facility, merged, callMeta, this.nowIso);

      const call = {
        callId,
        facilityId: facility.id,
        facility,
        entry,
        payload,
        request,
        attempts,
        callMeta,
        extractions: merged,
        rows,
        transcript: groundingAttempt.transcript,
      };

      // standing operator policy: high-confidence confirmations and blank-fills
      // publish automatically; everything else waits for a human.
      for (const r of rows) {
        if (r.route === ROUTE.AUTO) {
          r.publishedBy = 'auto-policy';
          store.approve(r, 'auto-policy');
        } else if (r.route === ROUTE.REVIEW && collect) {
          this.reviewQueue.push(r);
        }
      }

      if (collect) {
        this.calls.push(call);
        this.changeset.push(...rows);
      }
      calls.push(call);
      if (hooks.onCallEnd) await hooks.onCallEnd(call);
    }
    return calls;
  }

  /** Counterfactual: what would the naive baseline actually have achieved? */
  async runBaselineCounterfactual() {
    const shadowStore = new DirectoryStore(this.facilities);
    const savedReview = this.reviewQueue;
    const savedTranscripts = this.transcripts;
    this.reviewQueue = [];
    this.transcripts = new Map();
    const calls = await this.runPlan(this.baselinePlan, { store: shadowStore, collect: false });
    const rows = calls.flatMap((c) => c.rows);
    const result = evaluateRun({
      rows,
      truthById: this.truthById,
      riskRowFor: this.rowFor,
      publishedRows: shadowStore.published,
      autoPublishedRows: shadowStore.published,
    });
    this.reviewQueue = savedReview;
    this.transcripts = savedTranscripts;
    this.baselineResult = {
      ...result,
      callsPlaced: calls.length,
      connected: calls.filter((c) => c.callMeta.connected).length,
    };
    return this.baselineResult;
  }

  /* ------------------------------------------------------- evaluation ---- */
  evaluate() {
    const rows = this.changeset;
    const published = this.store.published;
    const autoOnly = published.filter((p) => p.approvedBy === 'auto-policy');
    const result = evaluateRun({
      rows,
      truthById: this.truthById,
      riskRowFor: this.rowFor,
      publishedRows: published,
      autoPublishedRows: autoOnly,
    });

    // enforced invariants, measured rather than asserted in prose
    const gate = assertPublishable(published);
    const spans = verifySpansResolve(published, this.transcripts);
    const ungrounded = countUngroundedPublishes(published);

    this.evaluation = {
      ...result,
      callsPlaced: this.calls.length,
      connected: this.calls.filter((c) => c.callMeta.connected).length,
      voicemail: this.calls.filter((c) => c.callMeta.outcome === 'voicemail').length,
      noAnswer: this.calls.filter((c) => ['no_answer', 'busy'].includes(c.callMeta.outcome)).length,
      deadLine: this.calls.filter((c) => ['disconnected', 'no_number', 'ivr_dead_end'].includes(c.callMeta.outcome)).length,
      totalAttempts: this.calls.reduce((a, c) => a + c.attempts.length, 0),
      attemptOutcomes: this.calls.reduce((acc, c) => {
        for (const a of c.attempts) acc[a.outcome] = (acc[a.outcome] ?? 0) + 1;
        return acc;
      }, {}),
      reviewQueueSize: this.reviewQueue.length,
      publishedCount: published.length,
      citationGate: { ...gate, ungroundedPublishes: ungrounded, spanCheck: spans },
      plannedHarm: this.plan?.expectedHarmReduction ?? 0,
      baselinePlannedHarm: this.baselinePlan?.expectedHarmReduction ?? 0,
      baseline: this.baselineResult,
      totalAvailableHarm: this.totalAvailableHarm,
    };
    return this.evaluation;
  }

  approveAll(approver = 'operator@county') {
    const approved = [];
    for (const row of this.reviewQueue) {
      this.store.approve(row, approver);
      row.publishedBy = approver;
      approved.push(row);
    }
    this.reviewQueue = [];
    return approved;
  }

  /* -------------------------------------------------------- accessors ---- */
  fieldsExtracted() {
    return this.changeset.filter((r) => r.newValue !== 'unknown').length;
  }
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

export { FIELDS, ROUTE };
