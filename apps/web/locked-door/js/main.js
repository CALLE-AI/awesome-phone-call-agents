/**
 * UI + DEMO HARNESS.
 *
 * This file is presentation and orchestration only. Every number it renders is
 * computed by the engine modules at runtime from the ingested directory and the
 * simulator's ground truth — nothing on this screen is a constant typed in by
 * hand, and nothing is a placeholder.
 *
 * The exposed `window.__demo` surface drives an automated recorder.
 */

import { VerificationEngine, FIELDS, ROUTE } from './engine.js';
import { extractFromAttempt } from './extract.js';
import { freshness, halfLifeDays, REVIEW_THRESHOLD } from './publish.js';
import { TAU_DAYS } from './risk.js';
import { MAX_ATTEMPTS, BACKOFF_REAL_MINUTES, toE164 } from './transport.js';

/* ===================================================================== */
/* pacing                                                                */
/* ===================================================================== */

/**
 * Wall-clock budget per call at speed = 1. 25 calls x 880ms = 22.0 seconds,
 * which is the filmable window the recorder expects.
 *
 * Pacing is DEADLINE-BASED, not delay-based: each call gets a slice, turns
 * inside it sleep a shrinking fraction of the time remaining in that slice, and
 * the call sleeps off any surplus at the end. A call with 40 turns and a call
 * with 8 turns therefore both take one slice, so total runtime stays ~= N x 880ms
 * on a fast machine and on a slow one.
 */
const MS_PER_CALL_AT_SPEED_1 = 880;

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

function makePacer(speed, callCount) {
  const instant = speed === 'instant' || speed === 0 || speed === '0';
  const mult = instant ? 0 : Number(speed) > 0 ? Number(speed) : 1;
  const perCall = instant ? 0 : MS_PER_CALL_AT_SPEED_1 / mult;
  const t0 = performance.now();
  let index = 0;
  let deadline = t0;
  return {
    instant,
    perCall,
    totalPlannedMs: perCall * callCount,
    startCall() {
      index += 1;
      deadline = t0 + index * perCall;
    },
    /** Sleep a shrinking slice of the time left in this call. Never overruns. */
    async turn() {
      if (instant) return;
      const left = deadline - performance.now();
      if (left <= 0) return;
      await sleep(Math.max(8, Math.min(78, left / 7)));
    },
    async endCall() {
      if (instant) return;
      await sleep(deadline - performance.now());
    },
    elapsed: () => performance.now() - t0,
  };
}

/* ===================================================================== */
/* tiny dom helpers                                                      */
/* ===================================================================== */

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const num = (x, d = 2) => Number(x).toFixed(d);

/* ===================================================================== */
/* value formatting                                                      */
/* ===================================================================== */

const FIELD_LABEL = {
  open_now: 'open now',
  hours: 'hours',
  pet_policy: 'pets',
  accessibility: 'accessibility',
  intake_requirements: 'intake',
  capacity_status: 'capacity',
};

const FIELD_COLOR = {
  open_now: '#e8963c',
  hours: '#6ea8d8',
  capacity_status: '#d9705f',
  intake_requirements: '#4fb3a4',
  pet_policy: '#b58fd0',
  accessibility: '#d8a13a',
};

const VALUE_LABEL = {
  true: 'OPEN',
  false: 'CLOSED',
  no_pets: 'no pets',
  crated_pets_only: 'crated only',
  service_animals_only: 'service animals',
  pets_allowed: 'pets allowed',
  fully_accessible: 'fully accessible',
  ramp_only: 'ramp only',
  not_accessible: 'not accessible',
  no_id_required: 'no ID needed',
  id_requested_not_required: 'ID asked, optional',
  photo_id_required: 'photo ID required',
  referral_required: 'referral required',
  space_available: 'space available',
  near_capacity: 'near capacity',
  at_capacity: 'at capacity',
};

function fmtValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  return VALUE_LABEL[String(v)] ?? String(v);
}

const OUTCOME_LABEL = {
  connected: 'connected',
  connected_via_ivr: 'connected via IVR',
  voicemail: 'voicemail',
  no_answer: 'no answer',
  busy: 'busy',
  disconnected: 'disconnected',
  no_number: 'no number',
  ivr_dead_end: 'IVR dead end',
};

/* ===================================================================== */
/* app state                                                             */
/* ===================================================================== */

const S = {
  engine: null,
  directory: null,
  ran: false,
  running: false,
  /** facilityId -> { outcome, attempts, connected, rows } */
  callState: new Map(),
  /* live transcript render state for the centre panel.
     A call can span up to MAX_ATTEMPTS attempts, and each attempt numbers its
     turns from 0 again — so every rendered turn is keyed by `attempt:index`,
     never by index alone. */
  attempt: 0,
  liveTurns: [], // turns of the CURRENT attempt (used for prefix extraction)
  allTurns: new Map(), // "attempt:index" -> turn, for the whole call
  liveMarks: new Map(), // "attempt:index" -> [{start,end,field}]
  liveFields: new Map(), // field -> extraction
  activeFacilityId: null,
};

const turnKey = (attempt, index) => `${attempt}:${index}`;

/* ===================================================================== */
/* boot                                                                  */
/* ===================================================================== */

async function boot() {
  const [directory, groundTruth] = await Promise.all([
    fetch('./data/directory.json').then((r) => r.json()),
    fetch('./data/ground-truth.json').then((r) => r.json()),
  ]);

  S.directory = directory;
  // "now" is pinned to the directory's as_of stamp so field ages — and therefore
  // every risk score on screen — are reproducible rather than drifting with the
  // wall clock of whoever opens the page.
  S.engine = new VerificationEngine(directory, groundTruth, { now: Date.parse(directory.as_of) });

  $('dataset-line').textContent =
    `${directory.facilities.length} facilities · ${directory.dataset} · as of ` +
    `${new Date(directory.as_of).toISOString().slice(0, 10)} · ` +
    `${countMissing(directory)} missing field values · ${countDuplicates(directory)} duplicate listings`;

  $('transport-name').textContent = S.engine.transport.name.toLowerCase();
  $('adapter-state').textContent = `${S.engine.realAdapter.name}, enabled = ${S.engine.realAdapter.enabled}`;

  wireControls();
  doPlan(readBudget());
  renderEmptyRunner();
  renderReview();
  renderDelta();
  renderEvaluationPlaceholder();
}

function countMissing(directory) {
  let n = 0;
  for (const f of directory.facilities) for (const v of Object.values(f.fields)) if (v.value === null) n++;
  return n;
}
function countDuplicates(directory) {
  return directory.facilities.filter((f) => f.duplicate_of).length;
}

function readBudget() {
  const v = parseInt($('budget-input').value, 10);
  return Number.isFinite(v) && v > 0 ? Math.min(v, S.directory.facilities.length) : 25;
}
function readSpeed() {
  const v = $('speed-input').value;
  return v === 'instant' ? 'instant' : Number(v);
}

function wireControls() {
  $('btn-plan').addEventListener('click', () => doPlan(readBudget()));
  $('btn-run').addEventListener('click', () => {
    if (!S.running) runBatch({ speed: readSpeed() });
  });
  $('btn-approve').addEventListener('click', () => approveAll());
  $('budget-input').addEventListener('change', () => doPlan(readBudget()));
  $('btn-show-adapter').addEventListener('click', showAdapterModal);
  $('btn-close-adapter').addEventListener('click', () => ($('adapter-modal').hidden = true));
  $('adapter-modal').addEventListener('click', (e) => {
    if (e.target === $('adapter-modal')) $('adapter-modal').hidden = true;
  });
}

/* ===================================================================== */
/* PLAN                                                                  */
/* ===================================================================== */

function doPlan(budget) {
  const { plan, baseline } = S.engine.planCalls(budget);
  S.callState.clear();
  S.ran = false;
  renderQueue();
  renderBudgetBox();
  renderEvaluationPlaceholder();
  return {
    budget,
    calls: plan.calls.length,
    plannedHarmReduction: plan.expectedHarmReduction,
    baselinePlannedHarmReduction: baseline.expectedHarmReduction,
    totalAvailableHarm: S.engine.totalAvailableHarm,
  };
}

function renderBudgetBox() {
  const plan = S.engine.plan;
  const base = S.engine.baselinePlan;
  const total = S.engine.totalAvailableHarm;

  $('bb-total').textContent = num(total, 1);
  $('bb-bought').textContent = `${num(plan.expectedHarmReduction, 1)} (${pct(plan.expectedHarmReduction / total, 0)})`;
  $('bb-bar-fill').style.width = `${Math.min(100, (plan.expectedHarmReduction / total) * 100)}%`;
  $('bb-plan').textContent = num(plan.expectedHarmReduction, 2);
  $('bb-base').textContent = num(base.expectedHarmReduction, 2);

  const lift = plan.expectedHarmReduction / base.expectedHarmReduction - 1;
  $('bb-lift').textContent = `+${pct(lift, 1)}`;

  $('queue-count').textContent = `${plan.calls.length} of ${S.directory.facilities.length} · budget ${plan.budget}`;
}

function renderQueue() {
  const list = $('queue');
  clear(list);
  const plan = S.engine.plan;
  const top = plan.calls[0]?.expectedGain ?? 1;

  for (const call of plan.calls) {
    const f = S.engine.facilityById.get(call.facilityId);
    const st = S.callState.get(call.facilityId);

    const row = el('li', 'qrow');
    row.dataset.fid = call.facilityId;
    if (st) row.classList.add('done');
    if (S.activeFacilityId === call.facilityId) row.classList.add('active');

    row.appendChild(el('div', 'qrank', String(call.rank)));

    const mid = el('div');
    mid.appendChild(el('div', 'qname', f.name));
    const sub = el('div', 'qsub');
    sub.textContent = `${f.id} · ${f.phone ?? 'no number'} · ${call.line}`;
    mid.appendChild(sub);

    const chips = el('div', 'qchips');
    for (const q of call.questions) {
      const chip = el('span', 'chip', FIELD_LABEL[q.field]);
      if (st) {
        const r = st.rows.find((x) => x.field === q.field);
        if (!r || r.newValue === 'unknown') chip.classList.add('u');
        else if (r.route === ROUTE.REVIEW) chip.classList.add('r');
        else chip.classList.add('g');
      }
      chip.title =
        `${q.field}: harm ${num(q.harm ?? 0, 2)} x P(stale) ${num(q.pStale ?? 0, 2)} ` +
        `x observability ${num(q.observability ?? 0, 2)} = EHR ${num(q.ehr ?? 0, 3)}` +
        (q.staleReason ? ` · ${q.staleReason}` : '');
      chips.appendChild(chip);
    }
    mid.appendChild(chips);

    if (st) {
      const s = el('div', `qstatus s-${st.outcome}`);
      s.textContent = `${OUTCOME_LABEL[st.outcome] ?? st.outcome} · ${st.attempts} attempt${st.attempts > 1 ? 's' : ''}`;
      mid.appendChild(s);
    }
    row.appendChild(mid);

    const score = el('div', 'qscore');
    score.textContent = num(call.expectedGain, 2);
    score.appendChild(el('small', null, `p(conn) ${num(call.pConnect, 2)}`));
    const bar = el('div', 'qbar');
    const fill = el('i');
    fill.style.width = `${Math.max(3, (call.expectedGain / top) * 100)}%`;
    bar.appendChild(fill);
    score.appendChild(bar);
    row.appendChild(score);

    list.appendChild(row);
  }
}

function markQueueActive(facilityId) {
  S.activeFacilityId = facilityId;
  for (const row of $('queue').querySelectorAll('.qrow')) {
    row.classList.toggle('active', row.dataset.fid === facilityId);
  }
  const active = $('queue').querySelector('.qrow.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

/* ===================================================================== */
/* RUNNER (centre)                                                       */
/* ===================================================================== */

function renderEmptyRunner() {
  $('ch-name').textContent = 'No call in progress';
  $('ch-meta').textContent = 'Plan a batch, then press Run.';
  clear($('ch-badges'));
  clear($('transcript'));
  $('transcript-hint').textContent = '—';
  renderFieldCards([]);
}

function startCallUI(call) {
  const f = call.facility;
  S.attempt = 0;
  S.liveTurns = [];
  S.allTurns = new Map();
  S.liveMarks = new Map();
  S.liveFields = new Map();

  $('ch-name').textContent = f.name;
  $('ch-meta').textContent =
    `${f.id} · ${f.phone ?? 'no number on file'} · ${toE164(f.phone) ?? 'unroutable'} · ` +
    `${f.kind_label} · ~${f.est_daily_visitors} visitors/day · flag: ${f.seasonal_activation_flag}`;

  clear($('ch-badges'));
  addBadge('SIMULATED', 'warn');
  addBadge(`rank ${call.entry.rank}`, null);
  addBadge(`EHR ${num(call.entry.expectedGain, 2)}`, null);
  addBadge(`${call.entry.questions.length} questions`, null);

  clear($('transcript'));
  $('transcript-hint').textContent = 'dialing…';
  renderFieldCards(call.entry.questions.map((q) => q.field));
  markQueueActive(f.id);
}

function addBadge(text, kind) {
  const b = el('span', kind ? `badge ${kind}` : 'badge', text);
  $('ch-badges').appendChild(b);
  return b;
}

function appendTurn(turn, attempt = S.attempt, addressable = true) {
  if (addressable) {
    S.liveTurns.push(turn);
    S.allTurns.set(turnKey(attempt, turn.index), turn);
  }
  const wrap = el('div', `turn ${turn.speaker}`);
  if (addressable) wrap.dataset.turnKey = turnKey(attempt, turn.index);
  wrap.appendChild(el('div', 'who', turn.speaker));
  const said = el('div', 'said');
  said.textContent = turn.text;
  wrap.appendChild(said);
  const tx = $('transcript');
  tx.appendChild(wrap);
  tx.scrollTop = tx.scrollHeight;
}

/** Re-render one turn's text with <mark> around every cited span. */
function paintTurnMarks(key) {
  const turn = S.allTurns.get(key);
  if (!turn) return;
  const node = $('transcript').querySelector(`[data-turn-key="${key}"] .said`);
  if (!node) return;
  const marks = (S.liveMarks.get(key) ?? [])
    .slice()
    .sort((a, b) => a.start - b.start)
    .filter((m, i, arr) => i === 0 || m.start >= arr[i - 1].end);

  clear(node);
  let cursor = 0;
  for (const m of marks) {
    const rs = m.start - turn.textStart;
    const re = m.end - turn.textStart;
    if (rs < cursor || re > turn.text.length) continue;
    if (rs > cursor) node.appendChild(document.createTextNode(turn.text.slice(cursor, rs)));
    const mark = el('mark', 'flash', turn.text.slice(rs, re));
    mark.dataset.field = m.field;
    node.appendChild(mark);
    cursor = re;
  }
  if (cursor < turn.text.length) node.appendChild(document.createTextNode(turn.text.slice(cursor)));
}

function renderFieldCards(fields, extractions = new Map()) {
  const wrap = $('fields');
  clear(wrap);
  const list = fields.length ? fields : FIELDS;

  for (const field of list) {
    const ex = extractions.get(field);
    const card = el('div', 'fcard');
    card.dataset.field = field;
    card.appendChild(el('div', 'fname', FIELD_LABEL[field]));

    if (!ex || ex.value === 'unknown') {
      card.classList.add('unknown');
      card.appendChild(el('div', 'fval', ex ? 'unknown' : '—'));
      card.appendChild(el('div', 'fmeta', ex ? '' : 'awaiting answer'));
      if (ex) {
        const nc = el('div', 'no-cite', 'no supporting span → unknown');
        nc.title = ex.reason;
        card.appendChild(nc);
      }
    } else {
      const low = ex.confidence < REVIEW_THRESHOLD || ex.internalConflict;
      card.classList.add(low ? 'review' : 'grounded');
      card.appendChild(el('div', 'fval', fmtValue(ex.value)));
      card.appendChild(
        el('div', 'fmeta', `conf ${num(ex.confidence, 2)}${ex.hedged ? ' · hedged' : ''} · ${ex.channel}`),
      );
      const cite = el('div', 'cite', `“${ex.quote}”`);
      cite.title = 'jump to the cited span in the transcript';
      cite.addEventListener('click', () => jumpToSpan(field));
      card.appendChild(cite);
    }
    wrap.appendChild(card);
  }
}

function jumpToSpan(field) {
  const mark = $('transcript').querySelector(`mark[data-field="${field}"]`);
  if (!mark) return;
  mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
  mark.classList.remove('flash');
  void mark.offsetWidth;
  mark.classList.add('flash');
}

/* ===================================================================== */
/* RUN BATCH                                                             */
/* ===================================================================== */

async function runBatch({ speed } = {}) {
  if (S.running) return null;
  S.running = true;
  $('btn-run').disabled = true;
  $('btn-plan').disabled = true;

  const spd = speed === undefined ? readSpeed() : speed;

  // Preserve the plan across the engine reset so re-running is idempotent.
  const plan = S.engine.plan ?? S.engine.planCalls(readBudget()).plan;
  const baselinePlan = S.engine.baselinePlan;
  S.engine.reset();
  S.engine.plan = plan;
  S.engine.baselinePlan = baselinePlan;
  S.callState.clear();

  const pacer = makePacer(spd, plan.calls.length);
  let done = 0;

  const hooks = {
    onCallStart: async (call) => {
      pacer.startCall();
      startCallUI(call);
      $('runner-progress').textContent = `call ${done + 1} / ${plan.calls.length}`;
      await pacer.turn();
    },

    onAttemptStart: async ({ attempt, outcome }) => {
      // Each attempt is a fresh transcript with its own turn numbering.
      S.attempt = attempt;
      S.liveTurns = [];
      $('transcript-hint').textContent =
        `attempt ${attempt + 1} of ${MAX_ATTEMPTS} · outcome ${OUTCOME_LABEL[outcome] ?? outcome}`;
    },

    onTurn: async (turn, ctx) => {
      appendTurn(turn);
      // Live grounding: re-run the REAL extractor over the transcript prefix so
      // a field lights up at the moment its answer is spoken, using exactly the
      // same code path that produces the published value.
      if (turn.speaker === 'staff') {
        liveExtract(ctx);
      }
      await pacer.turn();
    },

    onBackoff: async ({ attempt, nextInMinutes }) => {
      appendTurn(
        {
          index: -1,
          speaker: 'system',
          text: `No usable answer on attempt ${attempt + 1}. Backing off ${nextInMinutes} minutes before retry (simulated — no wait is actually served).`,
          textStart: 0,
        },
        attempt,
        false,
      );
      await pacer.turn();
    },

    onCallEnd: async (call) => {
      done += 1;
      S.callState.set(call.facilityId, {
        outcome: call.callMeta.outcome,
        attempts: call.attempts.length,
        connected: call.callMeta.connected,
        rows: call.rows,
      });
      finalizeCallUI(call);
      renderQueue();
      renderReview();
      renderDelta();
      renderEvaluation({ live: true });
      $('runner-progress').textContent = `call ${done} / ${plan.calls.length} complete`;
      await pacer.endCall();
    },
  };

  await S.engine.runPlan(plan, { hooks });

  // Counterfactual baseline: same simulator, same seeds, naive ordering.
  await S.engine.runBaselineCounterfactual();

  S.ran = true;
  S.running = false;
  $('btn-run').disabled = false;
  $('btn-plan').disabled = false;
  $('runner-progress').textContent = `${done} calls complete in ${(pacer.elapsed() / 1000).toFixed(1)}s`;

  renderQueue();
  renderReview();
  renderDelta();
  renderEvaluation();

  return stats();
}

/** Run the real extractor over the streamed prefix of the current attempt. */
function liveExtract(ctx) {
  const questions = ctx.plan.questions;
  const turns = S.liveTurns;
  if (!turns.length) return;
  const text = turns.map((t) => t.prefix + t.text).join('\n');
  const synthetic = {
    attempt: ctx.attempt,
    outcome: ctx.outcome,
    connected: ctx.outcome === 'connected' || ctx.outcome === 'connected_via_ivr',
    transcript: { turns, text },
  };

  let extractions;
  try {
    // The engine's own extractor, on a transcript PREFIX. If an answer has not
    // been spoken yet it returns unknown, which is the correct behaviour rather
    // than an error — so the card stays dark until a span actually supports it.
    extractions = extractFromAttempt(synthetic, questions);
  } catch {
    return;
  }

  let changed = false;
  for (const ex of extractions) {
    if (ex.value === 'unknown') continue;
    const prev = S.liveFields.get(ex.field);
    if (prev && prev.value === ex.value) continue;
    S.liveFields.set(ex.field, ex);
    changed = true;
    if (ex.span) {
      const key = turnKey(ctx.attempt, ex.span.turnIndex);
      const arr = S.liveMarks.get(key) ?? [];
      if (!arr.some((m) => m.start === ex.span.start && m.field === ex.field)) {
        arr.push({ start: ex.span.start, end: ex.span.end, field: ex.field });
        S.liveMarks.set(key, arr);
        paintTurnMarks(key);
      }
    }
  }
  if (changed) renderFieldCards(questions, S.liveFields);
}

function finalizeCallUI(call) {
  // Replace the live view with the authoritative merged extraction.
  const merged = new Map(call.extractions.map((e) => [e.field, e]));
  S.liveFields = merged;
  S.liveMarks = new Map();
  for (const ex of call.extractions) {
    if (!ex.span) continue;
    // A merged extraction remembers which attempt produced it, so the citation
    // is painted on the right attempt's transcript.
    const key = turnKey(ex.attemptIndex ?? 0, ex.span.turnIndex);
    const arr = S.liveMarks.get(key) ?? [];
    if (!arr.some((m) => m.start === ex.span.start && m.field === ex.field)) {
      arr.push({ start: ex.span.start, end: ex.span.end, field: ex.field });
    }
    S.liveMarks.set(key, arr);
  }
  for (const key of S.liveMarks.keys()) paintTurnMarks(key);
  renderFieldCards(
    call.entry.questions.map((q) => q.field),
    merged,
  );

  clear($('ch-badges'));
  addBadge('SIMULATED', 'warn');
  const oc = call.callMeta.outcome;
  addBadge(
    OUTCOME_LABEL[oc] ?? oc,
    call.callMeta.connected ? 'ok' : oc === 'voicemail' ? 'warn' : 'bad',
  );
  addBadge(`${call.attempts.length}/${MAX_ATTEMPTS} attempts`, null);
  const grounded = call.rows.filter((r) => r.newValue !== 'unknown').length;
  addBadge(`${grounded}/${call.rows.length} grounded`, grounded ? 'ok' : null);
  const rev = call.rows.filter((r) => r.route === ROUTE.REVIEW).length;
  if (rev) addBadge(`${rev} to review`, 'warn');

  $('transcript-hint').textContent =
    `${call.attempts.length} attempt(s) · backoff ${call.attempts.map((a) => BACKOFF_REAL_MINUTES[a.attempt]).join('/')} min · ` +
    `idempotency ${call.callMeta.idempotencyKey.slice(-12)}`;
}

/* ===================================================================== */
/* REVIEW + DELTA (right)                                                */
/* ===================================================================== */

function renderReview() {
  const wrap = $('review-list');
  clear(wrap);
  const q = S.engine.reviewQueue;
  $('review-count').textContent = `${q.length} waiting`;

  if (!q.length) {
    wrap.appendChild(
      el(
        'p',
        'empty',
        'Contradictions, hedged answers and low-confidence extractions land here instead of in the directory.',
      ),
    );
    return;
  }

  // Highest-risk contradictions first: a human reviewing 30 rows should see the
  // one that sends someone to a locked door before the one about pets.
  const sorted = [...q].sort((a, b) => {
    const ra = S.engine.rowFor(a.facilityId, a.field);
    const rb = S.engine.rowFor(b.facilityId, b.field);
    return rb.harm * rb.pStale - ra.harm * ra.pStale;
  });

  for (const row of sorted) wrap.appendChild(reviewRow(row));
}

function reviewRow(row) {
  const box = el('div', 'rrow needs');

  const top = el('div', 'rr-top');
  top.appendChild(el('div', 'rr-field', FIELD_LABEL[row.field]));
  top.appendChild(el('div', 'rr-fac', `${row.facilityId} · ${row.facilityName}`));
  box.appendChild(top);

  const chg = el('div', 'rr-change');
  chg.appendChild(el('span', 'rr-old', fmtValue(row.oldCanonical)));
  chg.appendChild(el('span', 'rr-arrow', '→'));
  chg.appendChild(el('span', 'rr-new', fmtValue(row.newCanonical)));
  box.appendChild(chg);

  box.appendChild(el('div', 'rr-why', row.reason));

  if (row.evidence?.quote) {
    const q = el('div', 'rr-quote', `“${row.evidence.contextQuote ?? row.evidence.quote}”`);
    q.title = `cited span ${row.evidence.span.start}–${row.evidence.span.end} of attempt ${row.evidence.attempt + 1} transcript`;
    box.appendChild(q);
  }

  const foot = el('div', 'rr-foot');
  const conf = el('div', 'rr-conf');
  conf.textContent = `conf ${num(row.confidence, 2)}`;
  const bar = el('span', 'confbar');
  const fill = el('i');
  fill.style.width = `${Math.round(row.confidence * 100)}%`;
  fill.style.background = row.confidence >= REVIEW_THRESHOLD ? 'var(--verified)' : 'var(--review)';
  bar.appendChild(fill);
  conf.appendChild(bar);
  foot.appendChild(conf);

  const actions = el('div', 'rr-actions');
  const ok = el('button', 'primary', 'Approve');
  ok.addEventListener('click', () => {
    S.engine.store.approve(row, 'operator@county');
    row.publishedBy = 'operator@county';
    S.engine.reviewQueue = S.engine.reviewQueue.filter((r) => r !== row);
    renderReview();
    renderDelta();
    if (S.ran) renderEvaluation();
  });
  const no = el('button', 'ghost', 'Reject');
  no.addEventListener('click', () => {
    S.engine.store.reject(row, 'operator@county');
    S.engine.reviewQueue = S.engine.reviewQueue.filter((r) => r !== row);
    renderReview();
    if (S.ran) renderEvaluation();
  });
  actions.appendChild(ok);
  actions.appendChild(no);
  foot.appendChild(actions);
  box.appendChild(foot);

  return box;
}

function renderDelta() {
  const wrap = $('delta-list');
  clear(wrap);
  const published = S.engine.store.published;
  $('delta-count').textContent = `${published.length} rows`;

  if (!published.length) {
    wrap.appendChild(
      el('p', 'empty', 'Approved changes append to a per-field history. Nothing is overwritten.'),
    );
    return;
  }

  const recent = [...published].reverse().slice(0, 60);
  for (const row of recent) {
    const box = el('div', `rrow ${row.approvedBy === 'auto-policy' ? 'auto' : 'human'}`);

    const top = el('div', 'rr-top');
    top.appendChild(el('div', 'rr-field', FIELD_LABEL[row.field]));
    top.appendChild(el('div', 'rr-fac', `${row.facilityId} · ${row.status}`));
    box.appendChild(top);

    const chg = el('div', 'rr-change');
    if (row.status === 'confirmed') {
      // Old and new are the same value: showing "X → X" with a strikethrough
      // would imply a change that did not happen. A re-verification is still a
      // new version, because its freshness clock restarts.
      chg.appendChild(el('span', 'rr-new', fmtValue(row.newCanonical)));
      chg.appendChild(el('span', 'rr-arrow', 're-verified, unchanged'));
    } else {
      chg.appendChild(el('span', 'rr-old', fmtValue(row.oldCanonical)));
      chg.appendChild(el('span', 'rr-arrow', '→'));
      chg.appendChild(el('span', 'rr-new', fmtValue(row.newCanonical)));
    }
    const v = S.engine.store.versionCount(row.facilityId, row.field);
    chg.appendChild(el('span', 'rr-conf', `v${v}`));
    box.appendChild(chg);

    const q = el('div', 'rr-quote', `“${row.evidence.quote}”`);
    q.title =
      `span ${row.evidence.span.start}–${row.evidence.span.end} · turn ${row.evidence.turnIndex} · ` +
      `${row.evidence.channel} · attempt ${row.evidence.attempt + 1}`;
    box.appendChild(q);

    const foot = el('div', 'rr-foot');
    foot.appendChild(
      el(
        'div',
        'rr-conf',
        `conf ${num(row.confidence, 2)} · fresh ${pct(freshness(row.field, row.verifiedAt, S.engine.now), 0)} · ` +
          `50% in ${halfLifeDays(row.field).toFixed(0)}d`,
      ),
    );
    foot.appendChild(el('div', 'rr-conf', row.approvedBy === 'auto-policy' ? 'auto-policy' : row.approvedBy));
    box.appendChild(foot);

    const ts = el('div', 'rr-why');
    ts.textContent = `verified_at ${row.verifiedAt}`;
    box.appendChild(ts);

    wrap.appendChild(box);
  }
}

function approveAll() {
  const approved = S.engine.approveAll('operator@county');
  renderReview();
  renderDelta();
  if (S.ran) renderEvaluation();
  return approved.length;
}

/* ===================================================================== */
/* EVALUATION (bottom)                                                   */
/* ===================================================================== */

function renderEvaluationPlaceholder() {
  $('eval-state').textContent = 'run a batch to populate';
  clear($('eval-tiles'));
  clear($('eval-table').querySelector('tbody'));
  clear($('harm-bars'));
  clear($('decay-legend'));
  clear($('decay-chart'));
}

function tile(value, label, detail, kind = 'neutral') {
  const t = el('div', `tile ${kind}`);
  t.appendChild(el('div', 'tv', value));
  t.appendChild(el('div', 'tl', label));
  if (detail) t.appendChild(el('div', 'td', detail));
  return t;
}

/**
 * `live` renders the same measurements mid-batch. Everything shown is real and
 * final for the calls completed SO FAR — the only thing missing is the baseline
 * counterfactual, which cannot exist until the batch finishes, so the headline
 * comparison is replaced by progress rather than by a placeholder number.
 */
function renderEvaluation({ live = false } = {}) {
  const ev = S.engine.evaluate();
  const hasBaseline = !!ev.baseline;

  $('eval-state').textContent = live
    ? `LIVE · ${ev.callsPlaced}/${S.engine.plan.calls.length} calls · ${ev.attempted} field-facts so far · ` +
      `baseline counterfactual runs when the batch completes`
    : `${ev.callsPlaced} calls · ${ev.totalAttempts} attempts · ${ev.attempted} field-facts attempted · ` +
      `measured against ${S.engine.truthById.size} ground-truth records`;

  /* ---- tiles ---- */
  const tiles = $('eval-tiles');
  clear(tiles);

  // The headline comparison leads, because it is the claim the product makes.
  if (hasBaseline) {
    const lift = ev.harmRealized / ev.baseline.harmRealized - 1;
    tiles.appendChild(
      tile(
        `${num(ev.harmRealized, 1)} vs ${num(ev.baseline.harmRealized, 1)} harm units  ·  +${pct(lift, 1)}`,
        'risk-ranked plan vs naive oldest-first, realized against ground truth',
        `same budget (${ev.callsPlaced} calls), same simulator, same seeds · ` +
          `${num(ev.harmForfeited, 1)} units forfeited to "unknown" rather than guessed`,
        'hero',
      ),
    );
  } else {
    tiles.appendChild(
      tile(
        `${num(ev.harmRealized, 1)} harm units recovered so far`,
        `batch running — ${ev.callsPlaced} of ${S.engine.plan.calls.length} calls placed`,
        `the naive oldest-first counterfactual is replayed through the same simulator ` +
          `once this batch finishes, so no comparison is shown yet`,
        'hero',
      ),
    );
  }

  tiles.appendChild(
    tile(pct(ev.precision), 'precision', `${ev.correct}/${ev.grounded} grounded correct`, ev.precision >= 0.9 ? 'good' : 'warn'),
  );
  tiles.appendChild(
    tile(pct(ev.recall), 'recall', `${ev.correct}/${ev.attempted} attempted · ${ev.connected}/${ev.callsPlaced} connected`, 'neutral'),
  );
  tiles.appendChild(
    tile(pct(ev.unknownRate), 'unknown rate', `the price of not guessing · vm ${ev.voicemail} · no-ans ${ev.noAnswer}`, 'warn'),
  );

  tiles.appendChild(
    tile(
      pct(ev.falsePublishAutoOnly.rate, 2),
      'false publish (machine)',
      `${ev.falsePublishAutoOnly.wrong}/${ev.falsePublishAutoOnly.published} on machine authority · ` +
        `incl. human-approved rows ${pct(ev.falsePublish.rate, 1)} (${ev.falsePublish.wrong}/${ev.falsePublish.published})`,
      ev.falsePublishAutoOnly.wrong === 0 ? 'good' : 'bad',
    ),
  );
  tiles.appendChild(
    tile(
      String(ev.citationGate.ungroundedPublishes),
      'ungrounded publishes',
      `${ev.citationGate.spanCheck.resolved}/${ev.citationGate.spanCheck.total} spans re-resolve to their quote`,
      ev.citationGate.ungroundedPublishes === 0 ? 'good' : 'bad',
    ),
  );

  const wr = ev.wrongValueRouting;
  tiles.appendChild(
    tile(
      `${wr.toReview}/${wr.total}`,
      'wrong values caught',
      wr.total
        ? `router held ${pct(wr.caughtRate, 0)} of its own errors · ${ev.reviewQueueSize} in queue`
        : `no wrong values produced · ${ev.reviewQueueSize} in queue`,
      wr.toAuto === 0 ? 'good' : 'bad',
    ),
  );

  /* ---- per-field table ---- */
  const tbody = $('eval-table').querySelector('tbody');
  clear(tbody);
  for (const [field, v] of Object.entries(ev.perField)) {
    const tr = el('tr');
    tr.appendChild(el('td', null, field));
    tr.appendChild(el('td', null, String(v.attempted)));
    tr.appendChild(el('td', 'v', String(v.grounded)));
    tr.appendChild(el('td', 'v', v.precision === null ? 'n/a' : pct(v.precision, 0)));
    tr.appendChild(el('td', null, v.recall === null ? 'n/a' : pct(v.recall, 0)));
    tr.appendChild(el('td', null, v.unknownRate === null ? 'n/a' : pct(v.unknownRate, 0)));
    tbody.appendChild(tr);
  }

  /* ---- harm bars ---- */
  const bars = $('harm-bars');
  clear(bars);
  const maxHarm = Math.max(
    ev.harmRealized,
    ev.baseline?.harmRealized ?? 0,
    ev.harmForfeited,
    ev.plannedHarm,
  );
  const rows = [
    ['risk-ranked (realized)', ev.harmRealized, 'var(--verified)'],
    ...(hasBaseline ? [['oldest-first (realized)', ev.baseline.harmRealized, 'var(--base)']] : []),
    ['risk-ranked (planned)', ev.plannedHarm, 'var(--plan)'],
    ['forfeited to unknown', ev.harmForfeited, 'var(--review)'],
  ];
  for (const [label, value, color] of rows) {
    const hb = el('div', 'hb');
    hb.appendChild(el('div', 'hb-label', label));
    const track = el('div', 'hb-track');
    const fill = el('div', 'hb-fill');
    fill.style.width = `${maxHarm ? (value / maxHarm) * 100 : 0}%`;
    fill.style.background = color;
    track.appendChild(fill);
    hb.appendChild(track);
    hb.appendChild(el('div', 'hb-val', num(value, 2)));
    bars.appendChild(hb);
  }

  renderDecayChart();
}

/**
 * Freshness decay of what was just verified, per field, over the next 21 days.
 * Drawn from the same tau priors the risk model uses, so the chart is the model
 * rather than an illustration of it.
 */
function renderDecayChart() {
  const svg = $('decay-chart');
  const W = 460;
  const H = 118;
  const pad = { l: 26, r: 16, t: 8, b: 16 };
  const DAYS = 21;
  clear(svg);

  const ns = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => {
    const n = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  };

  const x = (d) => pad.l + (d / DAYS) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - v) * (H - pad.t - pad.b);

  for (const v of [0, 0.5, 1]) {
    svg.appendChild(mk('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), stroke: '#232d3a', 'stroke-width': 1 }));
    const t = mk('text', { x: 2, y: y(v) + 3, fill: '#677484', 'font-size': 8, 'font-family': 'ui-monospace, monospace' });
    t.textContent = v === 1 ? '100%' : v === 0.5 ? '50%' : '0';
    svg.appendChild(t);
  }
  for (const d of [0, 7, 14, 21]) {
    const t = mk('text', { x: x(d), y: H - 4, fill: '#677484', 'font-size': 8, 'font-family': 'ui-monospace, monospace', 'text-anchor': 'middle' });
    t.textContent = `${d}d`;
    svg.appendChild(t);
  }

  // Only chart fields that were actually published in this run.
  const publishedFields = new Set(S.engine.store.published.map((p) => p.field));
  const fields = FIELDS.filter((f) => publishedFields.has(f));
  const list = fields.length ? fields : FIELDS;

  for (const field of list) {
    const pts = [];
    for (let d = 0; d <= DAYS; d += 0.5) {
      pts.push(`${x(d).toFixed(1)},${y(Math.exp(-d / TAU_DAYS[field])).toFixed(1)}`);
    }
    svg.appendChild(
      mk('polyline', { points: pts.join(' '), fill: 'none', stroke: FIELD_COLOR[field], 'stroke-width': 1.6, opacity: 0.9 }),
    );
  }

  const legend = $('decay-legend');
  clear(legend);
  for (const field of list) {
    const s = el('span');
    const i = el('i');
    i.style.background = FIELD_COLOR[field];
    s.appendChild(i);
    s.appendChild(document.createTextNode(`${FIELD_LABEL[field]} τ${TAU_DAYS[field]}d`));
    legend.appendChild(s);
  }
}

/* ===================================================================== */
/* adapter modal                                                         */
/* ===================================================================== */

function showAdapterModal() {
  const entry = S.engine.plan?.calls[0];
  const body = $('adapter-body');
  if (!entry) {
    body.textContent = 'Plan a batch first.';
    $('adapter-modal').hidden = false;
    return;
  }
  const { payload, request } = S.engine.buildCallPlan(entry);

  let refusal;
  try {
    // Proves the refusal is real by actually calling it.
    S.engine.realAdapter.placeCall(payload);
    refusal = 'NO ERROR THROWN — this would be a bug.';
  } catch (e) {
    refusal = e.message;
  }

  body.textContent =
    `${request.method} ${request.url}\n` +
    Object.entries(request.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n') +
    `\n\n${JSON.stringify(JSON.parse(request.canonicalBody), null, 2)}\n\n` +
    `request-body-digest: ${request.requestBodyDigest}\n` +
    `idempotency-key:     ${request.idempotencyKey}\n\n` +
    `--- what happens when placeCall() is invoked ---\n${refusal}\n\n` +
    `--- disclosure read at the top of every call ---\n${payload.disclosure}`;

  $('adapter-modal').hidden = false;
}

/* ===================================================================== */
/* stats + demo surface                                                  */
/* ===================================================================== */

function stats() {
  const ev = S.ran ? S.engine.evaluate() : null;
  const plan = S.engine.plan;

  return {
    facilities: S.directory ? S.directory.facilities.length : 0,
    budget: plan ? plan.budget : 0,
    callsPlaced: ev ? ev.callsPlaced : 0,
    connected: ev ? ev.connected : 0,
    voicemail: ev ? ev.voicemail : 0,
    noAnswer: ev ? ev.noAnswer : 0,
    fieldsExtracted: S.engine ? S.engine.fieldsExtracted() : 0,
    unknownRate: ev ? ev.unknownRate : 0,
    precision: ev ? ev.precision : 0,
    recall: ev ? ev.recall : 0,
    // The rate at which the SYSTEM publishes a wrong value on its own authority.
    // Rows a human pulled out of the review queue are that human's decision, and
    // are reported separately below rather than being folded in silently.
    falsePublishRate: ev ? ev.falsePublishAutoOnly.rate : 0,
    harmReduction: ev ? ev.harmRealized : plan ? plan.expectedHarmReduction : 0,
    baselineHarmReduction: ev
      ? (ev.baseline?.harmRealized ?? 0)
      : S.engine?.baselinePlan?.expectedHarmReduction ?? 0,
    reviewQueueSize: S.engine ? S.engine.reviewQueue.length : 0,

    /* ---- additional measured detail, beyond the required keys ---- */
    deadLine: ev ? ev.deadLine : 0,
    totalAttempts: ev ? ev.totalAttempts : 0,
    attempted: ev ? ev.attempted : 0,
    grounded: ev ? ev.grounded : 0,
    publishedCount: ev ? ev.publishedCount : 0,
    autoPublished: ev ? ev.falsePublishAutoOnly.published : 0,
    falsePublishRateAllPublished: ev ? ev.falsePublish.rate : 0,
    wrongValuesProduced: ev ? ev.wrongValueRouting.total : 0,
    wrongValuesHeldForReview: ev ? ev.wrongValueRouting.toReview : 0,
    wrongValuesAutoPublished: ev ? ev.wrongValueRouting.toAuto : 0,
    ungroundedPublishes: ev ? ev.citationGate.ungroundedPublishes : 0,
    spansResolved: ev ? ev.citationGate.spanCheck.resolved : 0,
    spansChecked: ev ? ev.citationGate.spanCheck.total : 0,
    plannedHarmReduction: plan ? plan.expectedHarmReduction : 0,
    plannedBaselineHarmReduction: S.engine?.baselinePlan?.expectedHarmReduction ?? 0,
    totalAvailableHarm: S.engine ? S.engine.totalAvailableHarm : 0,
    harmForfeitedToUnknown: ev ? ev.harmForfeited : 0,
    realCallsPlaced: 0,
    transportIsReal: S.engine ? S.engine.transport.isReal : false,
    realAdapterEnabled: S.engine ? S.engine.realAdapter.enabled : false,
  };
}

function flash(node) {
  node.style.transition = 'box-shadow 0.3s';
  node.style.boxShadow = '0 0 0 2px rgba(110,168,216,0.65)';
  setTimeout(() => {
    node.style.boxShadow = '';
  }, 1100);
}

const ready = boot();

window.__demo = {
  ready,

  async planCalls(budget = 25) {
    await ready;
    $('budget-input').value = String(budget);
    return doPlan(budget);
  },

  async runBatch(opts = {}) {
    await ready;
    return runBatch(opts);
  },

  async openReview() {
    await ready;
    const panel = $('review-list').closest('.panel');
    $('review-list').scrollTop = 0;
    flash(panel);
    await sleep(320);
    return { reviewQueueSize: S.engine.reviewQueue.length };
  },

  async approveAll() {
    await ready;
    const n = approveAll();
    await sleep(220);
    return { approved: n, published: S.engine.store.published.length };
  },

  async showEvaluation() {
    await ready;
    if (S.ran) renderEvaluation();
    flash(document.querySelector('.evalpanel'));
    await sleep(320);
    return stats();
  },

  stats,

  /* escape hatches used by the verification harness */
  _engine: () => S.engine,
  _citationAudit: citationAudit,
};

/**
 * INDEPENDENT CITATION AUDIT.
 *
 * Re-derives, from scratch, the claim the whole product rests on: every
 * published field carries a transcript span, and that span still contains
 * exactly the quoted text. Deliberately does not reuse the engine's own gate.
 */
function citationAudit() {
  const published = S.engine.store.published;
  const failures = [];
  let withSpan = 0;

  for (const p of published) {
    if (p.newValue === 'unknown') {
      failures.push(`${p.facilityId}/${p.field}: value is "unknown" but was published`);
      continue;
    }
    const sp = p.evidence?.span;
    if (!sp || typeof sp.start !== 'number' || typeof sp.end !== 'number' || sp.end <= sp.start) {
      failures.push(`${p.facilityId}/${p.field}: no usable span`);
      continue;
    }
    const tx = S.engine.transcripts.get(`${p.callMeta.callId}#${p.evidence.attempt}`);
    if (!tx) {
      failures.push(`${p.facilityId}/${p.field}: transcript not retained`);
      continue;
    }
    const slice = tx.text.slice(sp.start, sp.end);
    if (slice !== p.evidence.quote) {
      failures.push(`${p.facilityId}/${p.field}: span "${slice}" != quote "${p.evidence.quote}"`);
      continue;
    }
    withSpan++;
  }

  return {
    publishedRows: published.length,
    rowsWithResolvingSpan: withSpan,
    failures,
    pass: failures.length === 0 && withSpan === published.length,
  };
}
