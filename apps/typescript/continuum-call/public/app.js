const OPS_TOKEN = localStorage.getItem("OPS_TOKEN") || "dev-mock";
const SESSION_KEY =
  localStorage.getItem("SESSION_KEY") ||
  `sess_${Math.random().toString(36).slice(2, 10)}`;
localStorage.setItem("SESSION_KEY", SESSION_KEY);

const $ = (id) => document.getElementById(id);

const ledgerBody = $("ledger-body");
const previewBody = $("preview-body");
const missionMeta = $("mission-meta");
const modeLine = $("mode-line");
const modePill = $("mode-pill");
const eventsEl = $("events");
const verifyEl = $("verify");
const verifyList = $("verify-list");
const verifyTitle = $("verify-title");
const verifyHeading = $("verify-heading");
const badgeRow = $("badge-row");
const btnEvidence = $("btn-evidence");
const evidencePackType = document.querySelector(".evidence-pack-type");
const handoffEl = $("handoff");
const handoffBody = $("handoff-body");
const hardRule = $("hard-rule");
const blockBanner = $("block-banner");
const blockBannerBody = $("block-banner-body");
const templateLine = $("template-line");
const previewTemplate = $("preview-template");
const previewMeta = $("preview-meta");
const ledgerPanel = $("ledger-panel");
const cancelNote = $("cancel-note");
const juryHint = $("jury-hint");
const siteHeader = $("site-header");
const runtimeDisclosure = $("runtime-disclosure");
const runtimeLabel = $("runtime-label");
const runtimeDetail = $("runtime-detail");
const footerMode = $("footer-mode");
const proofPanel = $("proof-panel");
const proofModeChip = $("proof-mode-chip");
const proofVerdict = $("proof-verdict");
const verdictKicker = $("verdict-kicker");
const verdictTitle = $("verdict-title");
const verdictDetail = $("verdict-detail");
const proofIntentState = $("proof-intent-state");
const proofProviderRuns = $("proof-provider-runs");
const proofLiveCalls = $("proof-live-calls");
const proofChain = $("proof-chain");
const proofRunReceipt = $("proof-run-receipt");
const proofEvidenceLink = $("proof-evidence-link");
const previewInvariant = $("preview-invariant");
const previewRunCount = $("preview-run-count");
const previewDispatch = $("preview-dispatch");
const previewCrash = $("preview-crash");
const previewReconcile = $("preview-reconcile");
const eventSummary = $("event-summary");
const opsSecondary = $("ops-secondary");

const btnCrash = $("btn-crash");
const btnAmbiguous = $("btn-ambiguous");
const btnHandoff = $("btn-handoff");
const btnCrashRt = $("btn-crash-rt");
const btnReconcile = $("btn-reconcile");
const btnNewMission = $("btn-new-mission");
const btnJuryPath = $("btn-jury-path");
const juryPathLabel = $("jury-path-label");
const btnPause = $("btn-pause");
const btnResume = $("btn-resume");
const btnCancel = $("btn-cancel");
const btnStop = $("btn-stop");
const btnGlobalStop = $("btn-global-stop");
const btnTamper = $("btn-tamper");
const opReason = $("op-reason");
const opStatus = $("op-status");
const tamperStatus = $("tamper-status");

let hasMission = false;
let lastSnapshot = null;
let lastStuckIds = new Set();
let proofBusy = false;
let runtimeAccess = {
  kind: "checking",
  canMutate: false,
  canDemo: false,
  liveCalls: 0,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function icon(name) {
  return `<svg aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}

function authHeaders() {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${OPS_TOKEN}`,
    "x-session-key": SESSION_KEY,
  };
}

function stateIcon(state, outcome) {
  if (state === "ambiguous" || outcome === "unresolved") return "stuck";
  if (state === "dispatching") return "dispatching";
  if (state === "pending" || state === "planned") return "pending";
  if (state === "cancelled" || state === "cancellation_requested") return "blocked";
  if (state === "terminal" || state === "run_known") return "terminal";
  return "pending";
}

function pillClass(state, outcome) {
  if (state === "ambiguous" || outcome === "unresolved") return "warn";
  if (
    outcome === "practice_acknowledged" ||
    outcome === "verbally_confirmed" ||
    outcome === "candidate_accepted"
  ) {
    return "ok";
  }
  if (state === "terminal" && outcome === "declined") return "ok";
  if (state === "dispatching") return "warn";
  if (state === "pending" || state === "planned") return "cyan";
  if (state === "cancelled" || state === "cancellation_requested") return "danger";
  if (state === "run_known" || state === "terminal") return "ok";
  return "";
}

function shortId(id) {
  if (!id) return "—";
  return id.length > 18 ? `${id.slice(0, 14)}…` : id;
}

function runtimePrefix() {
  if (runtimeAccess.kind === "mock") return "INTERACTIVE MOCK";
  if (runtimeAccess.kind === "dry") return "DRY PREVIEW";
  if (runtimeAccess.kind === "live") return "LIVE GATE LOCKED";
  if (runtimeAccess.kind === "offline") return "OFFLINE UI";
  return "CHECKING RUNTIME";
}

function syncControls() {
  const proofLocked =
    proofBusy || !(runtimeAccess.canMutate || runtimeAccess.canDemo);
  const mutationLocked = proofBusy || !runtimeAccess.canMutate;
  for (const btn of [btnCrashRt, btnJuryPath]) {
    if (btn) btn.disabled = proofLocked;
  }
  for (const btn of [btnCrash, btnAmbiguous, btnHandoff, btnNewMission]) {
    if (btn) btn.disabled = mutationLocked;
  }

  const stuck = Number(lastSnapshot?.stuck_intents || 0);
  if (btnReconcile) {
    btnReconcile.disabled = proofLocked || !hasMission || stuck === 0;
  }

  for (const btn of [btnPause, btnResume, btnCancel, btnStop, btnTamper]) {
    if (btn) btn.disabled = mutationLocked || !hasMission;
  }
  if (btnGlobalStop) btnGlobalStop.disabled = mutationLocked;
}

function setProofBusy(busy) {
  proofBusy = busy;
  proofPanel?.setAttribute("aria-busy", busy ? "true" : "false");
  document.body.classList.toggle("is-proof-busy", busy);
  syncControls();
}

function setOperatorEnabled(enabled) {
  hasMission = enabled;
  syncControls();
}

function setEnvironment(health = {}, error = null) {
  const isDry = health.demo === "dry-run";
  const isLive = health.mode === "live" || health.spike_live === true;
  const isMock = !error && health.ok === true && health.mode === "mock" && !isDry;

  runtimeAccess = {
    kind: isDry ? "dry" : isLive ? "live" : isMock ? "mock" : "offline",
    canMutate: isMock,
    canDemo: isDry,
    liveCalls: Number(health.live_calls || 0),
  };

  const copy = {
    mock: {
      label: "Interactive mock · zero live dials",
      detail:
        "The SQLite crash/reconcile path is real. CALL-E provider responses are simulated, so this proof cannot place a phone call.",
      footer: "Interactive mock · SQLite durable · CALL-E adapter simulated · 0 live dials",
    },
    dry: {
      label: "Dry preview · client fixture · zero live dials",
      detail:
        "Worker APIs are read-only. The two primary buttons replay a deterministic client-side fixture; no SQLite write or server-side evidence is claimed.",
      footer: "Dry Worker preview · deterministic client fixture · no API writes · 0 live dials",
    },
    live: {
      label: "Live adapter detected · jury controls locked",
      detail:
        "Automated proof controls stay disabled in live mode to prevent accidental dialing. Use the audited operator workflow instead.",
      footer: "Live adapter gate detected · automated proof controls locked",
    },
    offline: {
      label: "Runtime unavailable · controls locked",
      detail:
        "The interface loaded, but the runtime health check did not. No request and no phone call can be started from this page.",
      footer: "Runtime unavailable · controls locked · no calls initiated",
    },
  }[runtimeAccess.kind];

  document.body.dataset.runtime = runtimeAccess.kind;
  runtimeDisclosure.dataset.runtime = runtimeAccess.kind;
  runtimeLabel.textContent = copy.label;
  runtimeDetail.textContent = copy.detail;
  footerMode.textContent = copy.footer;
  proofModeChip.textContent = runtimePrefix().toLowerCase();
  modeLine.textContent = `${runtimePrefix()} · live calls: ${runtimeAccess.liveCalls}`;
  modePill.classList.toggle("warn", runtimeAccess.kind === "dry");
  modePill.classList.toggle(
    "danger",
    runtimeAccess.kind === "live" || runtimeAccess.kind === "offline",
  );

  if (!runtimeAccess.canMutate && !runtimeAccess.canDemo) {
    missionMeta.textContent = copy.label;
    juryHint.textContent = copy.detail;
  } else if (runtimeAccess.canDemo) {
    missionMeta.textContent = "No dry-preview mission yet · start the client fixture.";
    juryHint.textContent =
      "Dry preview: no POST requests. Step 1 shows the recorded crash state; step 2 shows the recorded reconciliation result.";
  } else if (!hasMission) {
    missionMeta.textContent = "No mission yet · start the zero-dial proof.";
    juryHint.textContent =
      "Step 1 injects a controlled lost response. Step 2 reconciles from durable SQLite.";
  }
  syncControls();
}

function flashRows(selector) {
  document.querySelectorAll(selector).forEach((el) => {
    el.classList.remove("flash-ok");
    void el.offsetWidth;
    el.classList.add("flash-ok");
  });
}

function setStageStatuses(statuses) {
  document.querySelectorAll("#proof-sequence [data-stage]").forEach((stage) => {
    stage.dataset.status = statuses[stage.dataset.stage] || "pending";
  });
  document.querySelectorAll("#preview-trace [data-preview-step]").forEach((stage) => {
    stage.dataset.status = statuses[stage.dataset.previewStep] || "pending";
  });
}

function intentB(snapshot) {
  return (snapshot?.ledger || []).find(
    (row) => row.label?.includes("B") || row.state === "dispatching",
  );
}

function setJourneyState(state, snapshot = null, message = "") {
  const b = intentB(snapshot);
  const dryFixture = snapshot?.demo === "client-fixture";
  const eventCount = Number(snapshot?.verify?.eventCount || snapshot?.events?.length || 0);
  const chainIntact = Boolean(snapshot?.verify?.chainIntact);
  const providerRun = b?.provider_run_id || null;
  const providerRuns = Number(b?.provider_runs || 0);
  const liveCalls = Number(snapshot?.live_calls ?? runtimeAccess.liveCalls ?? 0);

  document.body.dataset.proof = state;
  proofVerdict.dataset.state = state;
  previewInvariant.dataset.state = state;
  proofLiveCalls.textContent = String(liveCalls);
  proofEvidenceLink.hidden = true;

  if (state === "loading") {
    setStageStatuses({ dispatch: "active" });
    verdictKicker.textContent = "Controlled fault in flight";
    verdictTitle.textContent = "Waiting for the durable crash receipt";
    verdictDetail.textContent = runtimeAccess.canDemo
      ? "The read-only Worker cannot mutate state. This browser-only walkthrough waits for its deterministic crash fixture before showing an expected state."
      : "The interface will not claim a stuck or recovered intent until the mock runtime returns its SQLite-backed snapshot.";
    proofIntentState.textContent = "awaiting receipt";
    proofProviderRuns.textContent = "not claimed";
    proofChain.textContent = "awaiting";
    proofRunReceipt.textContent = "provider run ID · awaiting confirmed state";
    previewDispatch.textContent = "request in flight";
    previewCrash.textContent = "awaiting fault receipt";
    previewReconcile.textContent = "not started";
    previewRunCount.textContent = "—";
    juryPathLabel.textContent = "Injecting the controlled crash…";
    return;
  }

  if (state === "crashed") {
    setStageStatuses({
      dispatch: "complete",
      crash: "complete",
      reconcile: "active",
      verify: "pending",
    });
    verdictKicker.textContent = dryFixture
      ? "Dry fixture · recorded crash state"
      : "Failure boundary confirmed";
    verdictTitle.textContent = dryFixture
      ? "Preview: response lost; intent B becomes stuck."
      : "Response lost. Intent B is stuck—not duplicated.";
    verdictDetail.textContent = dryFixture
      ? "This deterministic browser fixture shows the expected state transition only. The read-only Worker did not write SQLite and no server recovery claim is made."
      : "The provider accepted a mock run, then the fault fired before its ID reached local intent state. A fresh runtime reloaded the dispatching intent and idempotency key from SQLite.";
    proofIntentState.textContent = `${b?.state || "dispatching"} · stuck`;
    proofProviderRuns.textContent = "unknown locally";
    proofChain.textContent = dryFixture
      ? `${eventCount} fixture events`
      : chainIntact
        ? `${eventCount} events intact`
        : `${eventCount} events`;
    proofRunReceipt.textContent = "provider run ID · response deliberately lost";
    previewDispatch.textContent = "mock provider accepted run";
    previewCrash.textContent = dryFixture
      ? "recorded fixture boundary"
      : "RAM cleared · SQLite retained intent";
    previewReconcile.textContent = dryFixture
      ? "preview next state"
      : "ready to find existing run";
    previewRunCount.textContent = "?";
    juryPathLabel.textContent = "Restart the zero-dial proof";
    return;
  }

  if (state === "reconciling") {
    setStageStatuses({
      dispatch: "complete",
      crash: "complete",
      reconcile: "active",
      verify: "pending",
    });
    verdictKicker.textContent = dryFixture
      ? "Dry fixture · advancing preview"
      : "Fresh request in flight";
    verdictTitle.textContent = dryFixture
      ? "Loading the recorded reconcile result"
      : "Reconciling the durable intent";
    verdictDetail.textContent = dryFixture
      ? "No provider lookup or SQLite read occurs here. The client is advancing from one labeled fixture state to the next."
      : "The reconciler is querying the mock provider with the original idempotency key. It must discover the run—not create another one.";
    proofIntentState.textContent = dryFixture ? "fixture transition" : "reconciling";
    proofProviderRuns.textContent = dryFixture ? "expected: 1" : "must remain 1";
    proofChain.textContent = dryFixture ? "fixture only" : "awaiting receipt";
    proofRunReceipt.textContent = dryFixture
      ? "provider run ID · recorded fixture"
      : "provider run ID · lookup in progress";
    previewReconcile.textContent = dryFixture ? "loading recorded state" : "lookup in progress";
    return;
  }

  if (state === "verified") {
    setStageStatuses({
      dispatch: "complete",
      crash: "complete",
      reconcile: "complete",
      verify: "complete",
    });
    verdictKicker.textContent = dryFixture
      ? "Dry fixture · expected result"
      : "Recovery invariant verified";
    verdictTitle.textContent = dryFixture
      ? "Preview: existing run found; no second dispatch."
      : "Existing run recovered. No second dispatch.";
    verdictDetail.textContent = dryFixture
      ? `The client fixture advances intent B to ${providerRun} with Provider Runs = ${providerRuns}. This is a UI walkthrough, not server-generated evidence; run the local interactive mock for the SQLite proof.`
      : `A fresh runtime matched ${providerRun || "the existing provider run"} from durable intent state. Provider Runs for intent B is ${providerRuns}; the hash-chained Evidence Pack independently recomputes the result.`;
    proofIntentState.textContent = b?.state || "run_known";
    proofProviderRuns.textContent = `${providerRuns} · invariant held`;
    proofChain.textContent = dryFixture
      ? `${eventCount} fixture events`
      : chainIntact
        ? `${eventCount} events intact`
        : `${eventCount} events`;
    proofRunReceipt.textContent = `provider run ID · ${providerRun || "confirmed"}`;
    proofEvidenceLink.hidden = false;
    previewDispatch.textContent = "original provider run";
    previewCrash.textContent = "failure boundary preserved";
    previewReconcile.textContent = "existing run recovered";
    previewRunCount.textContent = String(providerRuns || 1);
    juryPathLabel.textContent = "Replay the zero-dial proof";
    return;
  }

  if (state === "alternate") {
    const maxRuns = Math.max(
      0,
      ...(snapshot?.ledger || []).map((row) => Number(row.provider_runs || 0)),
    );
    setStageStatuses({
      dispatch: "complete",
      crash: "complete",
      reconcile: "complete",
      verify: "complete",
    });
    verdictKicker.textContent = "Secondary proof complete";
    verdictTitle.textContent =
      snapshot?.proof === "ambiguous_block"
        ? "Ambiguity blocked the downstream call."
        : snapshot?.proof === "cross_party"
          ? "Cross-party fact provenance verified."
          : "Lost-response recovery verified.";
    verdictDetail.textContent =
      snapshot?.proof === "ambiguous_block"
        ? "An unresolved upstream answer left Waitlist C pending with Provider Runs = 0."
        : "The durable ledger and Evidence Pack recomputed the expected safety invariants.";
    proofIntentState.textContent = snapshot?.mission_status || "verified";
    proofProviderRuns.textContent = `max ${maxRuns} / intent`;
    proofChain.textContent = chainIntact
      ? `${eventCount} events intact`
      : `${eventCount} events`;
    proofRunReceipt.textContent = `proof · ${snapshot?.proof || "complete"}`;
    proofEvidenceLink.hidden = false;
    previewRunCount.textContent = String(maxRuns);
    juryPathLabel.textContent = "Run the primary proof";
    return;
  }

  if (state === "error") {
    setStageStatuses({});
    verdictKicker.textContent = "No proof claim";
    verdictTitle.textContent = "The request did not return a receipt";
    verdictDetail.textContent = message || "Nothing was marked recovered. Retry in interactive mock mode.";
    proofIntentState.textContent = "unknown";
    proofProviderRuns.textContent = "not claimed";
    proofChain.textContent = "not claimed";
    proofRunReceipt.textContent = "provider run ID · unavailable";
    previewRunCount.textContent = "—";
    juryPathLabel.textContent = "Retry the zero-dial proof";
    return;
  }

  setStageStatuses({});
  verdictKicker.textContent = "Invariant armed";
  verdictTitle.textContent = "No proof receipt yet";
  verdictDetail.textContent =
    "Inject the controlled failure. The first confirmed state should expose one stuck intent and no locally known run ID.";
  proofIntentState.textContent = "not created";
  proofProviderRuns.textContent = "—";
  proofChain.textContent = "awaiting";
  proofRunReceipt.textContent = "provider run ID · not known yet";
  previewDispatch.textContent = "awaiting mock run";
  previewCrash.textContent = "runtime memory clears";
  previewReconcile.textContent = "find existing run; never redial";
  previewRunCount.textContent = "—";
  juryPathLabel.textContent = "Start the zero-dial proof";
}

function displayLabel(value) {
  return String(value || "—");
}

function makeDrySnapshot(stage) {
  const recovered = stage === "verified";
  const missionId = "dry_fixture_mission_001";
  const intentA = "dry_intent_waitlist_a";
  const intentBId = "dry_intent_waitlist_b";
  const baseEvents = [
    "mission_created",
    "task_added",
    "intent_authorized",
    "dispatch_begun",
    "provider_run_known",
    "intent_terminal",
    "unlock_allowed",
    "task_added",
    "intent_authorized",
    "dispatch_begun",
    "fault_injected",
  ];
  const eventTypes = recovered
    ? [...baseEvents, "reconcile_started", "provider_run_known", "reconcile_recovered"]
    : baseEvents;
  const badge = {
    dup_runs: "0 dup runs",
    unsafe_unlocks: "0 unsafe unlocks",
    facts: "0/0 facts",
    chain: "chain intact",
  };

  return {
    mode: "mock",
    demo: "client-fixture",
    live_calls: 0,
    mission_id: missionId,
    mission_status: "running",
    proof: "crash_runtime",
    template: "slot-recovery",
    durable: false,
    dispatches_stopped: false,
    stuck_intents: recovered ? 0 : 1,
    ledger: [
      {
        label: "Waitlist A",
        call_intent_id: intentA,
        attempt_no: 1,
        state: "terminal",
        outcome: "declined",
        provider_run_id: "dry_mock_run_001",
        provider_runs: 1,
      },
      {
        label: "Waitlist B",
        call_intent_id: intentBId,
        attempt_no: 1,
        state: recovered ? "run_known" : "dispatching",
        outcome: null,
        provider_run_id: recovered ? "dry_mock_run_002" : null,
        provider_runs: recovered ? 1 : 0,
      },
      {
        label: "Waitlist C",
        call_intent_id: null,
        attempt_no: null,
        state: "pending",
        outcome: null,
        provider_run_id: null,
        provider_runs: 0,
      },
    ],
    events: eventTypes.map((event_type, index) => ({
      sequence_no: index + 1,
      event_type,
      call_intent_id: index >= 7 ? intentBId : intentA,
      redacted_payload: {},
    })),
    facts: [],
    handoff: null,
    safety: {
      consent_recorded: true,
      timezone: "Europe/Berlin",
      quiet_hours: "08:00–20:00",
      allowlist_label: "+49 dry fixture",
      max_calls_per_mission: 8,
    },
    verify: {
      ok: true,
      chainIntact: true,
      eventCount: eventTypes.length,
      errors: [],
      facts_traceable: "0/0",
      badge,
      evidence: { badge },
    },
    evidence: {
      preview: true,
      disclaimer:
        "Deterministic client fixture only. No server-side recovery or SQLite write occurred.",
      mission_id: missionId,
      provider_runs_per_intent: { [intentA]: 1, [intentBId]: recovered ? 1 : 0 },
      event_types: eventTypes,
    },
    updated_at: "2026-08-04T12:00:00.000Z",
  };
}

function renderSafety(snapshot) {
  const s = snapshot.safety || {
    consent_recorded: true,
    timezone: "Europe/Berlin",
    quiet_hours: "08:00–20:00",
    allowlist_label: "+49 mock",
    max_calls_per_mission: 8,
  };
  $("safety-consent").textContent = s.consent_recorded ? "recorded" : "missing";
  $("safety-tz").textContent = s.timezone;
  $("safety-hours").textContent = s.quiet_hours;
  $("safety-allow").textContent = s.allowlist_label;
  $("safety-max").textContent = String(s.max_calls_per_mission);
}

function renderPreview(ledger, meta) {
  previewMeta.textContent = meta;
  if (!ledger?.length) {
    previewBody.innerHTML =
      '<tr class="empty"><td colspan="3">Start the proof to populate</td></tr>';
    return;
  }
  previewBody.innerHTML = "";
  for (const row of ledger) {
    const tr = document.createElement("tr");
    const stuck = row.state === "dispatching" || row.state === "ambiguous";
    if (stuck) tr.classList.add("is-stuck");
    const pc = pillClass(row.state, row.outcome);
    tr.innerHTML = `
      <td>${escapeHtml(displayLabel(row.label))}</td>
      <td><span class="pill ${pc}">${icon(stateIcon(row.state, row.outcome))}${escapeHtml(row.state)}</span></td>
      <td><span class="pill ${row.provider_runs === 1 ? "ok" : ""}">${escapeHtml(row.provider_runs)}</span></td>
    `;
    previewBody.appendChild(tr);
  }
}

function renderBadge(ok, badge) {
  if (!badge) {
    badgeRow.innerHTML = "";
    return;
  }
  const chips = [
    { text: badge.dup_runs, ico: "shield" },
    { text: badge.unsafe_unlocks, ico: "lock" },
    {
      text: badge.facts === "0/0 facts" ? "0 facts required" : badge.facts,
      ico: "facts",
    },
    { text: badge.chain, ico: "chain" },
  ];
  badgeRow.innerHTML = chips
    .map(
      (c) =>
        `<span class="badge-chip ${ok ? "ok" : "fail"}">${icon(c.ico)}${escapeHtml(c.text)}</span>`,
    )
    .join("");
}

function renderHandoff(h) {
  if (!h) {
    handoffEl.hidden = true;
    handoffBody.innerHTML = "";
    return;
  }
  handoffEl.hidden = false;
  handoffBody.innerHTML = `
    <div class="handoff-card">
      <span class="label">Fact A · provenance</span>
      <p class="fact-value">${escapeHtml(h.value)}</p>
      <p class="detail">fact: <span class="mono">${escapeHtml(h.fact || "appointment_time")}</span></p>
      <p class="detail">source intent <span class="mono">${escapeHtml(shortId(h.source_intent_id))}</span></p>
      <p class="detail">source run <span class="mono">${escapeHtml(shortId(h.source_run_id))}</span></p>
    </div>
    <div class="handoff-arrow" aria-hidden="true">${icon("arrow")}</div>
    <div class="handoff-card">
      <span class="label">Call B · uses fact</span>
      <p class="fact-value">${escapeHtml(h.used_by_label)}</p>
      <p class="detail">run <span class="mono">${escapeHtml(shortId(h.used_by_run_id))}</span></p>
      <p class="detail">practice outcome: <strong>${escapeHtml(h.practice_outcome ?? "—")}</strong></p>
    </div>
  `;
}

function updateCancelNote(status) {
  if (!cancelNote) return;
  if (status === "cancellation_requested") {
    cancelNote.innerHTML = `<strong>cancellation_requested</strong> — in-flight intents stay unsettled; results still reconciled. Intent is <em>not</em> cancelled while a provider run may be live.`;
  } else if (status === "cancelled") {
    cancelNote.innerHTML = `<strong>Mission cancelled</strong> — only planned (never-dispatched) intents were cancelled.`;
  } else if (status === "paused") {
    cancelNote.innerHTML = `<strong>Paused</strong> — no new dispatches; in-flight stays visible. Resume continues from cursor with frozen payload.`;
  } else {
    cancelNote.innerHTML = `<strong>Cancel semantics:</strong> planned → cancelled. In-flight → mission <span class="mono">cancellation_requested</span> — Intent stays unsettled until reconcile.`;
  }
}

function render(snapshot, opts = {}) {
  if (!snapshot || snapshot.empty) return;
  lastSnapshot = snapshot;

  setOperatorEnabled(true);

  const stuck = snapshot.stuck_intents ?? 0;
  const narrow = window.matchMedia("(max-width: 480px)").matches;
  modeLine.textContent = narrow
    ? `${runtimePrefix()} · ${snapshot.proof} · stuck:${stuck}${snapshot.global_stop ? " · STOP" : ""}`
    : `${runtimePrefix()} · live calls: ${snapshot.live_calls} · proof: ${snapshot.proof} · stuck: ${stuck}${
        snapshot.global_stop ? " · GLOBAL STOP" : ""
      }`;
  modePill.classList.toggle(
    "warn",
    stuck > 0 || runtimeAccess.kind === "dry",
  );
  modePill.classList.toggle(
    "danger",
    Boolean(snapshot.global_stop) || runtimeAccess.kind === "live",
  );

  const statusLabel = snapshot.mission_status;
  missionMeta.textContent = `${shortId(snapshot.mission_id)} · ${statusLabel}`;
  opStatus.textContent = `status: ${statusLabel}${
    snapshot.dispatches_stopped ? " · dispatches stopped" : ""
  }${snapshot.durable ? " · durable" : ""}`;

  const tplName =
    snapshot.template === "dispatch-bridge"
      ? "Dispatch Bridge"
      : "Slot Recovery · Appointment operations";
  templateLine.textContent = tplName;
  previewTemplate.textContent =
    snapshot.template === "dispatch-bridge" ? "Dispatch Bridge" : "Slot Recovery";

  renderSafety(snapshot);
  updateCancelNote(snapshot.mission_status);

  const showHardRule =
    snapshot.proof === "ambiguous_block" ||
    snapshot.proof === "crash_recover" ||
    snapshot.proof === "crash_runtime" ||
    snapshot.proof === "operator_created" ||
    snapshot.template === "slot-recovery";
  hardRule.hidden = !showHardRule;

  const blocked =
    snapshot.mission_status === "blocked_needs_resolution" ||
    snapshot.proof === "ambiguous_block";
  blockBanner.hidden = !blocked;
  if (blocked) {
    const cPending = (snapshot.ledger || []).find(
      (r) => r.label.includes("C") && (r.state === "pending" || !r.provider_run_id),
    );
    blockBannerBody.textContent = cPending
      ? `Ambiguous upstream blocks conflicting downstream — ${displayLabel(cPending.label)} stays pending (Provider Runs = 0).`
      : "Ambiguous / unresolved upstream blocks conflicting downstream unlock.";
  }

  const prevStuck = lastStuckIds;
  lastStuckIds = new Set(
    (snapshot.ledger || [])
      .filter((r) => r.state === "dispatching" || r.state === "ambiguous")
      .map((r) => r.call_intent_id),
  );

  ledgerBody.innerHTML = "";
  for (const row of snapshot.ledger) {
    const tr = document.createElement("tr");
    const isStuck = row.state === "dispatching" || row.state === "ambiguous";
    if (isStuck) tr.classList.add("is-stuck");
    if (
      opts.flashReconcile &&
      row.provider_runs === 1 &&
      prevStuck.has(row.call_intent_id)
    ) {
      tr.classList.add("flash-ok");
    }
    const runsClass =
      row.provider_runs === 1
        ? "pill ok"
        : row.provider_runs === 0
          ? "pill"
          : "pill danger";
    const stuckBtn = isStuck
      ? `<button type="button" class="linkish" data-reconcile="${escapeHtml(row.call_intent_id)}" aria-label="Reconcile ${escapeHtml(displayLabel(row.label))}">Reconcile</button>`
      : "";
    const pc = pillClass(row.state, row.outcome);
    tr.innerHTML = `
      <td data-label="Candidate">${escapeHtml(displayLabel(row.label))} ${stuckBtn}</td>
      <td data-label="Attempt">${escapeHtml(row.attempt_no ?? "—")}</td>
      <td data-label="State"><span class="pill ${pc}">${icon(stateIcon(row.state, row.outcome))}${escapeHtml(row.state)}</span></td>
      <td data-label="Outcome">${escapeHtml(row.outcome ?? "—")}</td>
      <td data-label="Provider run" class="mono">${escapeHtml(shortId(row.provider_run_id))}</td>
      <td data-label="Provider runs"><span class="${runsClass}">${escapeHtml(row.provider_runs)}</span></td>
    `;
    ledgerBody.appendChild(tr);
  }
  ledgerBody.querySelectorAll("[data-reconcile]").forEach((el) => {
    el.addEventListener("click", () =>
      runReconcile(el.getAttribute("data-reconcile")),
    );
  });

  renderPreview(
    snapshot.ledger,
    `${shortId(snapshot.mission_id)} · ${statusLabel}`,
  );

  renderHandoff(snapshot.handoff);

  eventsEl.innerHTML = "";
  for (const ev of snapshot.events.slice().reverse()) {
    const li = document.createElement("li");
    const hot = /fault_|reconcile_|guard_blocked|stop_dispatches|global_|cancellation_/.test(
      ev.event_type,
    );
    if (hot) li.classList.add("hot");
    li.innerHTML = `<div><strong>#${escapeHtml(ev.sequence_no)} ${escapeHtml(ev.event_type)}</strong> ${
      ev.call_intent_id
        ? `<span class="mono">${escapeHtml(shortId(ev.call_intent_id))}</span>`
        : ""
    }</div>`;
    eventsEl.appendChild(li);
  }
  eventSummary.textContent = `${snapshot.events.length} events · ${
    snapshot.verify?.chainIntact ? "chain intact" : "inspect chain"
  }`;

  const dryFixture = snapshot.demo === "client-fixture";
  const showFinalEvidence =
    Boolean(snapshot.verify) &&
    !(snapshot.proof === "crash_runtime" && stuck > 0);
  verifyEl.hidden = !showFinalEvidence;
  if (showFinalEvidence) {
    verifyEl.hidden = false;
    const ok = snapshot.verify.ok;
    verifyHeading.textContent = dryFixture
      ? "Deterministic preview Evidence Pack"
      : "Evidence Pack verifier";
    evidencePackType.textContent = dryFixture
      ? "CLIENT FIXTURE · JSON"
      : "JSON · HASH CHAINED";
    verifyTitle.textContent = dryFixture
      ? "Dry preview result · not server evidence"
      : ok
        ? "Mission consistency verified"
        : "Mission verify FAIL";
    verifyTitle.classList.toggle("fail", !ok);
    const badge = snapshot.verify.badge || snapshot.verify.evidence?.badge;
    renderBadge(ok, badge);
    const lines = dryFixture
      ? [
          "Client fixture only · no Worker mutation or SQLite write",
          "Expected invariant: Provider Runs for intent B = 1",
          "Expected result: 0 duplicate provider runs",
          `${snapshot.verify.eventCount} deterministic fixture events`,
        ]
      : [
          "Recovered existing run · Provider Runs stayed 1",
          "0 duplicate provider runs",
          "0 unsafe unlocks",
          snapshot.verify.facts_traceable === "0/0"
            ? "0 cross-party facts required for this proof"
            : `Facts traceable ${snapshot.verify.facts_traceable}`,
          `Event chain intact (${snapshot.verify.eventCount} events)`,
        ];
    verifyList.innerHTML = lines
      .map((t) => `<li>${icon("terminal")}<span>${escapeHtml(t)}</span></li>`)
      .join("");

    if (dryFixture) {
      const previewJson = JSON.stringify(snapshot.evidence, null, 2);
      btnEvidence.href = `data:application/json;charset=utf-8,${encodeURIComponent(previewJson)}`;
      btnEvidence.download = "continuum-call-dry-preview-evidence.json";
      btnEvidence.textContent = "Download preview fixture";
    } else {
      btnEvidence.href = "/api/evidence";
      btnEvidence.download = "";
      btnEvidence.textContent = "Download evidence pack";
    }
  }

  syncControls();

  if (opts.flashReconcile) {
    ledgerPanel?.classList.remove("flash-ok");
    void ledgerPanel?.offsetWidth;
    ledgerPanel?.classList.add("flash-ok");
    flashRows("#preview-body tr");
  }

  if (opts.scrollOps) {
    $("ops")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (opts.hint) {
    juryHint.textContent = opts.hint;
  }

  tamperStatus.textContent = "";

  if (snapshot.proof === "crash_runtime") {
    setJourneyState(stuck > 0 ? "crashed" : "verified", snapshot);
  } else if (snapshot.verify) {
    setJourneyState("alternate", snapshot);
  }
}

async function api(path, body) {
  if (!runtimeAccess.canMutate) {
    throw new Error("Mutating API is unavailable in this runtime mode.");
  }
  const res = await fetch(path, {
    method: "POST",
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : "{}",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function showActionError(error) {
  const message = String(error?.message || error || "Request failed");
  missionMeta.textContent = message;
  juryHint.textContent = `No proof claim: ${message}`;
  setJourneyState("error", null, message);
  window.requestAnimationFrame(() =>
    proofVerdict?.focus({ preventScroll: true }),
  );
}

async function runProof(kind) {
  if (!runtimeAccess.canMutate) return;
  setProofBusy(true);
  try {
    const snap = await api("/api/proof", { kind });
    const blocked = kind === "ambiguous_block";
    render(snap, {
      scrollOps: true,
      hint: blocked
        ? "Ambiguous path: C stays pending — blocked_needs_resolution."
        : "Proof complete — inspect ledger + evidence.",
    });
    if (blocked) {
      $("more-proofs")?.setAttribute("open", "");
      opsSecondary?.setAttribute("open", "");
    }
  } catch (e) {
    showActionError(e);
  } finally {
    setProofBusy(false);
  }
}

async function runCrashRuntime({ fromHero = false } = {}) {
  if (!(runtimeAccess.canMutate || runtimeAccess.canDemo)) return;
  setProofBusy(true);
  setJourneyState("loading");
  juryHint.textContent = runtimeAccess.canDemo
    ? "Dry preview in progress · no POST request and no phone call."
    : "Injecting the controlled fault after provider create and before local persistence…";
  proofPanel?.scrollIntoView({
    behavior: fromHero ? "smooth" : "auto",
    block: "start",
  });
  let shouldFocusReconcile = false;
  try {
    const snapshot = runtimeAccess.canDemo
      ? (await delay(260), makeDrySnapshot("crashed"))
      : await api("/api/crash-runtime");
    render(snapshot, {
      scrollOps: true,
      hint: runtimeAccess.canDemo
        ? "DRY PREVIEW · recorded crash state loaded. Continue to the fixture reconciliation."
        : "Crash confirmed · response lost, SQLite holds stuck intent B. Reconcile next.",
    });
    opStatus.textContent = runtimeAccess.canDemo
      ? "Dry client fixture · no server mutation."
      : "Runtime crashed · RAM dropped · SQLite holds stuck intent B.";
    shouldFocusReconcile = true;
  } catch (e) {
    showActionError(e);
  } finally {
    setProofBusy(false);
    if (shouldFocusReconcile) {
      window.requestAnimationFrame(() =>
        btnReconcile?.focus({ preventScroll: true }),
      );
    }
  }
}

async function runReconcile(callIntentId) {
  if (!(runtimeAccess.canMutate || runtimeAccess.canDemo)) return;
  setProofBusy(true);
  setJourneyState("reconciling", lastSnapshot);
  juryHint.textContent = runtimeAccess.canDemo
    ? "Dry preview · advancing to the recorded reconciliation fixture."
    : "Fresh request in flight · matching the existing provider run by idempotency key…";
  let recovered = false;
  try {
    const snapshot = runtimeAccess.canDemo
      ? (await delay(260), makeDrySnapshot("verified"))
      : await api(
          "/api/reconcile",
          callIntentId ? { call_intent_id: callIntentId } : {},
        );
    render(
      snapshot,
      {
        flashReconcile: true,
        hint: runtimeAccess.canDemo
          ? "DRY PREVIEW complete · expected Provider Runs = 1. This is not server evidence."
          : "Recovery verified · Provider Runs for intent B is 1. No second dispatch.",
        scrollOps: true,
      },
    );
    recovered = true;
  } catch (e) {
    showActionError(e);
  } finally {
    setProofBusy(false);
    if (recovered) {
      proofPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
      window.requestAnimationFrame(() =>
        proofVerdict?.focus({ preventScroll: true }),
      );
    }
  }
}

async function runNewMission() {
  if (!runtimeAccess.canMutate) return;
  setProofBusy(true);
  try {
    render(await api("/api/missions", { template: "slot-recovery" }), {
      scrollOps: true,
      hint: "Mission created — run CRASH RUNTIME for the jury path.",
    });
  } catch (e) {
    showActionError(e);
  } finally {
    setProofBusy(false);
  }
}

/** Hero CTA: one request creates the mission and injects the crash boundary. */
async function runJuryPath() {
  await runCrashRuntime({ fromHero: true });
}

async function runOperator(action) {
  if (!runtimeAccess.canMutate) return;
  try {
    const data = await api("/api/operator", {
      action,
      reason: opReason.value || action,
    });
    if (data.mission_id) {
      render(data, {
        hint:
          action === "cancel_pending"
            ? "Cancel applied — check cancellation_requested vs cancelled labels."
            : `Operator: ${action}`,
      });
    } else opStatus.textContent = JSON.stringify(data);
  } catch (e) {
    opStatus.textContent = String(e.message || e);
  }
}

async function runTamper() {
  if (!runtimeAccess.canMutate) return;
  tamperStatus.textContent = "Running tamper…";
  try {
    const data = await api("/api/evidence/tamper");
    const b = data.badge;
    verifyTitle.textContent = "Mission verify FAIL";
    verifyTitle.classList.add("fail");
    renderBadge(false, b);
    tamperStatus.textContent = `Tamper demo: verify FAIL — ${
      data.errors?.[0] || "chain broken"
    }`;
  } catch (e) {
    tamperStatus.textContent = String(e.message || e);
  }
}

btnCrash.addEventListener("click", () => runProof("crash_recover"));
btnAmbiguous.addEventListener("click", () => runProof("ambiguous_block"));
btnHandoff.addEventListener("click", () => runProof("cross_party"));
btnCrashRt.addEventListener("click", () => runCrashRuntime());
btnReconcile.addEventListener("click", () => runReconcile());
if (btnNewMission) btnNewMission.addEventListener("click", () => runNewMission());
if (btnJuryPath) btnJuryPath.addEventListener("click", () => runJuryPath());
btnPause.addEventListener("click", () => runOperator("pause"));
btnResume.addEventListener("click", () => runOperator("resume"));
btnCancel.addEventListener("click", () => runOperator("cancel_pending"));
btnStop.addEventListener("click", () => runOperator("stop_dispatches"));
if (btnGlobalStop)
  btnGlobalStop.addEventListener("click", () => runOperator("global_stop"));
btnTamper.addEventListener("click", () => runTamper());

window.addEventListener(
  "scroll",
  () => {
    siteHeader?.classList.toggle("is-stuck", window.scrollY > 8);
  },
  { passive: true },
);

async function bootstrapRuntime() {
  setJourneyState("ready");
  setOperatorEnabled(false);

  let health = null;
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) throw new Error(`health ${response.status}`);
    health = await response.json();
    setEnvironment(health);
  } catch (error) {
    setEnvironment({}, error);
    return;
  }

  try {
    const response = await fetch("/api/mission", { cache: "no-store" });
    if (!response.ok) throw new Error(`mission ${response.status}`);
    const data = await response.json();
    if (!data.empty) render(data);
  } catch (error) {
    missionMeta.textContent = `Read failed · ${String(error.message || error)}`;
  }
}

bootstrapRuntime();
