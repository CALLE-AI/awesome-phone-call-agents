import type { DialResult } from "./calle";
import { placeCall, toDialRequest } from "./calle";
import { MOCK_CASES, queueRows } from "./cases";
import { composeOutcome, composeOutcomeOrUnknown } from "./outcome";
import { mapLiveResult } from "./map-live-result";
import { evaluateGate } from "./policy";
import { DISPOSITIONS, TOOL_IDS as TYPE_TOOL_IDS } from "./types";
import {
  assertNvcSafe,
  buildCalleTaskPrompt,
  buildHostilityDeescalation,
  detectHostility,
  formatNvcOpening,
  handleHostilityTurn,
  HOSTILITY_HANDOFF_SCRIPT,
  nextNvcState,
  scanForbiddenLanguage,
  shouldHandoffAfterRejects,
  slaFor,
} from "./nvc";
import { validateOutcome } from "./validate";

export async function runSelfCheck(): Promise<void> {
  const { buildCallPlan, maskE164, TOOL_IDS, DEMO_DISPOSITION } = await import("./plan");
  const now = new Date("2026-09-09T04:00:00.000Z");
  const rows = queueRows();
  if (rows.length !== 4) {
    throw new Error(`expected 4 queue rows, got ${rows.length}`);
  }
  if (rows[0]?.intent !== "kyc_chase") {
    throw new Error("KYC must stay the demo-lead queue row");
  }
  if (rows[1]?.intent !== "evidence_collection" || rows[1].cases.length !== 2) {
    throw new Error("second queue row must be the two-party evidence investigation");
  }

  for (const fraudCase of MOCK_CASES) {
    const gate = evaluateGate(fraudCase, now);
    if (!gate.automate) {
      throw new Error(`${fraudCase.case_id} should automate at 12:00 HKT`);
    }
    const dial = await placeCall(toDialRequest(fraudCase), { delayMs: 0, now });
    const outcome = composeOutcome(fraudCase, dial);
    const issues = validateOutcome(outcome);
    if (issues.length) {
      throw new Error(`${fraudCase.case_id} outcome: ${issues.join(", ")}`);
    }
    const expected = DEMO_DISPOSITION[fraudCase.case_id];
    if (outcome.disposition !== expected) {
      throw new Error(`${fraudCase.case_id} expected ${expected}`);
    }
    if (!DISPOSITIONS[fraudCase.intent].includes(outcome.disposition as never)) {
      throw new Error(`${fraudCase.case_id} disposition not on intent list`);
    }
    const toolByCase: Record<string, string> = {
      case_demo_kyc_001: "none",
      case_demo_col_001: "generate_hardship_plan",
      case_demo_mer_001: "none",
      case_demo_ev_001a: "none",
      case_demo_ev_001b: "none",
    };
    if (outcome.fields.tool_invoked !== toolByCase[fraudCase.case_id]) {
      throw new Error(`${fraudCase.case_id} tool_invoked ${outcome.fields.tool_invoked}`);
    }
  }

  const a = MOCK_CASES.find((c) => c.case_id === "case_demo_ev_001a");
  const b = MOCK_CASES.find((c) => c.case_id === "case_demo_ev_001b");
  if (
    !a ||
    !b ||
    a.counterpart_case_id !== b.case_id ||
    b.counterpart_case_id !== a.case_id ||
    !a.safety_sensitive ||
    !b.deep_links.evidence_share
  ) {
    throw new Error("evidence pair must be linked, safety_sensitive, with share links");
  }

  const paidOnKyc = validateOutcome({
    case_id: "x",
    intent: "kyc_chase",
    call_id: "c",
    recording_id: "r",
    disposition: "paid",
    quotes: ["q"],
    next_action: "n",
    fields: {},
    transcript_snippet: "",
    ended_at: now.toISOString(),
  });
  if (!paidOnKyc.length) {
    throw new Error("kyc_chase must reject collections disposition paid");
  }

  const ptpOnEvidence = validateOutcome({
    case_id: "x",
    intent: "evidence_collection",
    call_id: "c",
    recording_id: "r",
    disposition: "ptp",
    quotes: ["q"],
    next_action: "n",
    fields: {},
    transcript_snippet: "",
    ended_at: now.toISOString(),
  });
  if (!ptpOnEvidence.length) {
    throw new Error("evidence_collection must reject collections disposition ptp");
  }

  // --- NVC stress ---
  const bad = scanForbiddenLanguage(
    "You failed to pay. It is company policy. You must pay now or else."
  );
  if (bad.length < 3) throw new Error("forbidden scanner too weak");
  try {
    assertNvcSafe("You must update billing immediately");
    throw new Error("assertNvcSafe should throw");
  } catch (e) {
    if (!(e instanceof Error) || !e.message.includes("NVC guardrail")) {
      throw e;
    }
  }

  for (const fraudCase of MOCK_CASES) {
    const opening = formatNvcOpening(fraudCase);
    assertNvcSafe(opening);
    assertNvcSafe(buildCalleTaskPrompt(fraudCase));
    const dial = await placeCall(toDialRequest(fraudCase), { delayMs: 0, now });
    const outcome = composeOutcome(fraudCase, dial);
    const sla = slaFor(fraudCase.intent, outcome.disposition);
    if (sla && !outcome.fields.follow_up_at) {
      throw new Error(`${fraudCase.case_id} missing follow_up_at for SLA disposition`);
    }
    if (
      (outcome.disposition === "handoff" ||
        outcome.disposition === "unsafe_escalate") &&
      !outcome.fields.advocate_assigned
    ) {
      throw new Error(`${fraudCase.case_id} handoff without advocate_assigned`);
    }
  }

  let state = nextNvcState("intake", "accept");
  if (state !== "deescalation") throw new Error("intake→deescalation");
  state = nextNvcState(state, "anger");
  if (state !== "deep_validation") throw new Error("anger→deep_validation");
  state = nextNvcState(state, "accept");
  if (state !== "solution_mapping") throw new Error("accept→solution_mapping");
  if (!shouldHandoffAfterRejects(2)) throw new Error("double-reject handoff");
  if (shouldHandoffAfterRejects(1)) throw new Error("single reject must not handoff");

  // --- Hostility Absorb/Separate/Pivot/Bound ---
  const scold = scanForbiddenLanguage(
    "Please refrain from foul language. Maintain professional language."
  );
  if (scold.length < 2) throw new Error("scold-language forbidden list too weak");

  const col = MOCK_CASES.find((c) => c.case_id === "case_demo_col_001");
  if (!col) throw new Error("missing collections mock");
  const boom =
    "This is absolute bullshit! I told you I don't have the money. Stop harassing me!";
  if (!detectHostility(boom).deescalationOverride) {
    throw new Error("hostility detector missed collections blast");
  }
  const strike1 = handleHostilityTurn(col, boom, 0);
  if (!strike1 || strike1.strike !== 1 || strike1.handoff) {
    throw new Error("strike1 must de-escalate without handoff");
  }
  assertNvcSafe(strike1.spoken);
  assertNvcSafe(buildHostilityDeescalation(col).spoken);
  const strike2 = handleHostilityTurn(col, "Fuck you, still useless!", 1);
  if (!strike2 || strike2.strike !== 2 || !strike2.handoff) {
    throw new Error("strike2 must handoff");
  }
  assertNvcSafe(strike2.spoken);
  if (handleHostilityTurn(col, "Friday works for me", 0) !== null) {
    throw new Error("calm utterance must not trigger hostility path");
  }

  if (maskE164("+12125550101") !== "+121****0101") {
    throw new Error("maskE164 must keep last 4");
  }
  const {
    maskE164: maskFromView,
    toolsForIntent,
    demoSlaHours,
    DEMO_DISPOSITION: demoFromView,
  } = await import("./plan-view");
  if (maskFromView("+12125550101") !== "+121****0101") {
    throw new Error("plan-view maskE164 must keep last 4");
  }
  const kyc = MOCK_CASES.find((item) => item.case_id === "case_demo_kyc_001");
  if (!kyc || demoSlaHours(kyc) !== 24) {
    throw new Error("KYC demo SLA must be 24h from plan-view");
  }
  if (toolsForIntent("kyc_chase").join(",") !== "fetch_previous_context,assign_human_spoc") {
    throw new Error("KYC tools drifted in plan-view");
  }
  if (demoFromView.case_demo_kyc_001 !== "uploading_now") {
    throw new Error("plan-view DEMO_DISPOSITION drifted");
  }
  for (const fraudCase of MOCK_CASES) {
    const plan = await buildCallPlan(fraudCase, now);
    assertNvcSafe(plan.taskPrompt);
    if (!plan.taskPrompt.includes("# Tools")) {
      throw new Error(`${fraudCase.case_id} task missing # Tools`);
    }
    for (const toolId of plan.tools) {
      if (!plan.taskPrompt.includes(toolId)) {
        throw new Error(`${fraudCase.case_id} task missing tool ${toolId}`);
      }
    }
    const disp = (plan.recipientResultSchema as { properties: { disposition: { enum: string[] } } })
      .properties.disposition.enum;
    if (JSON.stringify(disp) !== JSON.stringify([...DISPOSITIONS[fraudCase.intent]])) {
      throw new Error(`${fraudCase.case_id} disposition enum drifted`);
    }
    const tools = (plan.recipientResultSchema as { properties: { tool_invoked: { enum: string[] } } })
      .properties.tool_invoked.enum;
    if (JSON.stringify(tools) !== JSON.stringify([...TOOL_IDS])) {
      throw new Error("tool_invoked enum drifted");
    }
    if (plan.maskedTo.includes(fraudCase.contact.phone_e164.slice(4, -4))) {
      throw new Error(`${fraudCase.case_id} middle digits leaked`);
    }
    const again = await buildCallPlan(fraudCase, now);
    if (plan.idempotencyKey !== again.idempotencyKey) {
      throw new Error(`${fraudCase.case_id} idempotency not stable`);
    }
    const bumped = {
      ...fraudCase,
      policy: { ...fraudCase.policy, attempt_n: fraudCase.policy.attempt_n + 1 },
    };
    const changed = await buildCallPlan(bumped, now);
    if (changed.idempotencyKey === plan.idempotencyKey) {
      throw new Error(`${fraudCase.case_id} attempt_n must change key`);
    }
    const expected = DEMO_DISPOSITION[fraudCase.case_id];
    if (expected && plan.demoSlaHours !== (slaFor(fraudCase.intent, expected)?.followUpHours ?? null)) {
      throw new Error(`${fraudCase.case_id} demo SLA hours mismatch`);
    }
  }
  if (!HOSTILITY_HANDOFF_SCRIPT.includes("senior specialist")) {
    throw new Error("handoff must say senior specialist");
  }
  if (HOSTILITY_HANDOFF_SCRIPT.toLowerCase().includes("senior human")) {
    throw new Error("handoff must not say senior human");
  }

  const kycCase = MOCK_CASES.find((item) => item.case_id === "case_demo_kyc_001");
  const evCase = MOCK_CASES.find((item) => item.case_id === "case_demo_ev_001a");
  if (!kycCase || !evCase) throw new Error("missing KYC or evidence mock");

  const legalLive = mapLiveResult(kycCase, {
    id: "call_live_legal",
    recording_id: "rec_live_legal",
    disposition: "uploading_now",
    quotes: ["I can upload tonight"],
    next_action: "Watch the portal",
    tool_invoked: "none",
  });
  if (legalLive.disposition !== "uploading_now" || legalLive.provider !== "calle") {
    throw new Error("legal structured live result must map");
  }
  if (legalLive.toolInvoked !== "none") {
    throw new Error("legal tool_invoked none must pass through");
  }

  const illegalDisp = mapLiveResult(kycCase, {
    disposition: "paid",
    quotes: ["x"],
    next_action: "n",
  });
  if (
    illegalDisp.disposition !== "handoff" ||
    illegalDisp.handoffReason !== "outcome_unknown"
  ) {
    throw new Error("illegal disposition must fail-closed to outcome_unknown");
  }

  let garbageTool: ReturnType<typeof mapLiveResult>;
  try {
    garbageTool = mapLiveResult(kycCase, {
      disposition: "uploading_now",
      quotes: ["ok"],
      next_action: "watch",
      tool_invoked: "rm_rf_not_a_tool",
      ptp_date: "Friday",
    });
  } catch (err) {
    throw new Error(
      `garbage tool_invoked must not throw: ${err instanceof Error ? err.message : err}`
    );
  }
  if (!TYPE_TOOL_IDS.includes(garbageTool.toolInvoked as (typeof TYPE_TOOL_IDS)[number])) {
    throw new Error("garbage tool_invoked must be dropped, not forwarded");
  }
  if (garbageTool.disposition !== "uploading_now") {
    throw new Error("garbage tool must not discard a legal disposition");
  }
  if (garbageTool.ptpDate) {
    throw new Error("illegal ptp_date must be dropped");
  }
  composeOutcome(kycCase, garbageTool);

  const unsafeMapped = mapLiveResult(evCase, {
    disposition: "unsafe_escalate",
    quotes: ["I am afraid now"],
    next_action: "Escalate",
  });
  if (unsafeMapped.toolInvoked !== "assign_human_spoc") {
    throw new Error("unsafe_escalate must stamp assign_human_spoc");
  }
  if (!unsafeMapped.unsafeFlag) {
    throw new Error("unsafe_escalate must set unsafeFlag");
  }

  const stubHandoff: DialResult = {
    callId: "call_stub_handoff",
    recordingId: "rec_pending_calle_swap",
    provider: "calle-stub",
    durationMs: 1000,
    disposition: "handoff",
    quotes: ["I need a senior specialist"],
    nextAction: "Assign a senior specialist",
    transcriptSnippet: "",
    endedAt: now.toISOString(),
  };
  const handoffOutcome = composeOutcome(kycCase, stubHandoff);
  if (handoffOutcome.fields.tool_invoked !== "assign_human_spoc") {
    throw new Error("composeOutcome handoff must stamp assign_human_spoc");
  }
  if (!handoffOutcome.fields.advocate_assigned) {
    throw new Error("composeOutcome handoff must assign advocate");
  }

  const poisoned: DialResult = {
    callId: "call_poison",
    recordingId: "rec_pending_calle_swap",
    provider: "calle",
    durationMs: 1,
    disposition: "uploading_now",
    quotes: ["ok"],
    nextAction: "watch",
    transcriptSnippet: "",
    endedAt: now.toISOString(),
    ptpDate: "not-a-date",
    toolInvoked: "not_a_tool" as never,
  };
  const closed = composeOutcomeOrUnknown(kycCase, poisoned);
  if (closed.disposition !== "handoff" || closed.fields.handoff_reason !== "outcome_unknown") {
    throw new Error("compose after live validate failure must persist outcome_unknown");
  }

  process.env.CALL_CLAIMS_PATH = `/tmp/fraud-ops-claims-self-check-${process.pid}.json`;
  const { executeCallRun, resetIdempotencyForTests, LIVE_CONFIRM_PHRASE, durableClaimKey } =
    await import("./run-call");
  if (
    durableClaimKey(kycCase.case_id, kycCase.contact.phone_e164, "plan") !==
    `${kycCase.case_id}|${kycCase.contact.phone_e164}|plan`
  ) {
    throw new Error("durable claim must be keyed by case+destination");
  }
  resetIdempotencyForTests();
  const missing = await executeCallRun({ caseId: "nope", mode: "demo", fast: true, now });
  if (missing.status !== 404) throw new Error("unknown case must 404");

  const calleKeys = [
    "CALLE_API_KEY",
    "CALLE_BASE_URL",
    "CALLE_LIVE_CALLS_ENABLED",
    "OPS_RUN_SECRET",
    "LIVE_DIAL_ALLOWLIST",
  ] as const;
  const calleSnap = Object.fromEntries(calleKeys.map((key) => [key, process.env[key]]));
  try {
    for (const key of calleKeys) delete process.env[key];
    const liveDenied = await executeCallRun({
      caseId: "case_demo_kyc_001",
      mode: "live",
      confirmLive: LIVE_CONFIRM_PHRASE,
      fast: true,
      now,
    });
    if (liveDenied.status !== 403) throw new Error("live without env must 403");

    process.env.CALLE_API_KEY = "must-not-dial";
    process.env.CALLE_BASE_URL = "https://api.heycall-e.com";
    process.env.CALLE_LIVE_CALLS_ENABLED = "true";
    const wrongPhrase = await executeCallRun({
      caseId: "case_demo_kyc_001",
      mode: "live",
      confirmLive: "wrong phrase",
      fast: true,
      now,
    });
    if (wrongPhrase.status !== 403) {
      throw new Error("live with flags on but wrong phrase must 403");
    }

    process.env.OPS_RUN_SECRET = "self-check-ops-secret";
    const { signLiveGrant } = await import("./ops-auth");
    const grant = signLiveGrant(kycCase.case_id, kycCase.contact.phone_e164);
    const noGrant = await executeCallRun({
      caseId: "case_demo_kyc_001",
      mode: "live",
      confirmLive: LIVE_CONFIRM_PHRASE,
      fast: true,
      now,
    });
    if (noGrant.status !== 403) {
      throw new Error("live without destination grant must 403");
    }
    const wrongTo = await executeCallRun({
      caseId: "case_demo_kyc_001",
      mode: "live",
      confirmLive: LIVE_CONFIRM_PHRASE,
      liveGrant: grant.token,
      to: "+12125550199",
      fast: true,
      now,
    });
    if (wrongTo.status !== 403) {
      throw new Error("live with mismatched destination must 403");
    }
    const wrongGrantPhone = signLiveGrant(kycCase.case_id, "+12125550199");
    const boundWrong = await executeCallRun({
      caseId: "case_demo_kyc_001",
      mode: "live",
      confirmLive: LIVE_CONFIRM_PHRASE,
      liveGrant: wrongGrantPhone.token,
      to: kycCase.contact.phone_e164,
      fast: true,
      now,
    });
    if (boundWrong.status !== 403) {
      throw new Error("grant bound to a different phone must 403");
    }
  } finally {
    for (const key of calleKeys) {
      if (calleSnap[key] === undefined) delete process.env[key];
      else process.env[key] = calleSnap[key];
    }
  }

  const first = await executeCallRun({
    caseId: "case_demo_kyc_001",
    mode: "demo",
    fast: true,
    now,
  });
  if (!first.ok || first.body.outcome.disposition !== "uploading_now") {
    throw new Error("demo KYC must uploading_now");
  }
  const replay = await executeCallRun({
    caseId: "case_demo_kyc_001",
    mode: "demo",
    fast: true,
    now,
  });
  if (!replay.ok || replay.body.outcome.call_id !== first.body.outcome.call_id) {
    throw new Error("replay must return same outcome");
  }
  if (
    first.body.outcome.transcript_snippet.includes("+12125550101") ||
    /\+[1-9][0-9]{7,14}/.test(JSON.stringify(first.body.outcome))
  ) {
    throw new Error("browser outcome must not contain a raw E.164");
  }

  const { assertCalleBaseUrl, CALLE_PRODUCTION_ORIGIN } = await import("./calle-origin");
  assertCalleBaseUrl(CALLE_PRODUCTION_ORIGIN);
  for (const bad of [
    "http://127.0.0.1:9",
    "http://localhost:43127",
    "https://evil.example",
    "https://api.heycall-e.com/extra",
    "https://user:pass@api.heycall-e.com",
  ]) {
    let rejected = false;
    try {
      assertCalleBaseUrl(bad);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`CALLE_BASE_URL must reject ${bad}`);
  }

  const { authorizeOpsRequest, signLiveGrant, verifyLiveGrant, safeEqual } = await import("./ops-auth");
  const { maskOutcomeForBrowser } = await import("./mask-public");
  const priorSecret = process.env.OPS_RUN_SECRET;
  delete process.env.OPS_RUN_SECRET;
  const unconfigured = authorizeOpsRequest(new Request("http://127.0.0.1/api/calls/run"));
  if (unconfigured.ok || unconfigured.status !== 503) {
    throw new Error("missing OPS_RUN_SECRET must fail closed");
  }
  process.env.OPS_RUN_SECRET = "self-check-ops-secret";
  const denied = authorizeOpsRequest(new Request("http://127.0.0.1/api/calls/run"));
  if (denied.ok || denied.status !== 401) {
    throw new Error("anonymous call run must 401");
  }
  const allowed = authorizeOpsRequest(
    new Request("http://127.0.0.1/api/calls/run", {
      headers: { authorization: "Bearer self-check-ops-secret" },
    })
  );
  if (!allowed.ok) throw new Error("bearer OPS_RUN_SECRET must authorize");
  if (!safeEqual("self-check-ops-secret", "self-check-ops-secret")) {
    throw new Error("safeEqual true path");
  }
  const grant = signLiveGrant(kycCase.case_id, kycCase.contact.phone_e164);
  if (!verifyLiveGrant(grant.token, kycCase.case_id, kycCase.contact.phone_e164)) {
    throw new Error("live grant must verify against the approved phone");
  }
  if (verifyLiveGrant(grant.token, kycCase.case_id, "+12125550199")) {
    throw new Error("live grant must not verify a different phone");
  }
  const leaked = maskOutcomeForBrowser({
    ...first.body.outcome,
    transcript_snippet: `Call ${kycCase.contact.phone_e164} please also try +12125550199`,
    quotes: [`Reach me at ${kycCase.contact.phone_e164}`],
  });
  if (leaked.transcript_snippet.includes(kycCase.contact.phone_e164)) {
    throw new Error("transcript mask leaked approved phone");
  }
  if (leaked.quotes.some((q) => q.includes(kycCase.contact.phone_e164))) {
    throw new Error("quote mask leaked approved phone");
  }

  const reservedE164 = "+12125550101";
  const reservedMasked = "+121****0101";
  if (maskE164(reservedE164) !== reservedMasked) {
    throw new Error("maskE164 must keep last 4 on reserved NPA-555-01xx");
  }
  if (maskFromView(reservedE164) !== reservedMasked) {
    throw new Error("plan-view maskE164 must keep last 4 on reserved NPA-555-01xx");
  }
  const ukOfcomE164 = "+447700900123";
  const ukOfcomMasked = "+447*****0123";
  if (maskE164(ukOfcomE164) !== ukOfcomMasked) {
    throw new Error("maskE164 must still mask non-NANP E.164");
  }
  const { redactPhones } = await import("./mask-public");
  if (redactPhones(`Reach ${ukOfcomE164}`) !== `Reach ${ukOfcomMasked}`) {
    throw new Error("redactPhones must not weaken E.164 masking");
  }
  if (redactPhones(`Call ${reservedE164}`) !== `Call ${reservedMasked}`) {
    throw new Error("redactPhones must still mask reserved E.164");
  }
  const formattedLeaks = [
    "(212) 555-0101",
    "212-555-0101",
    "212.555.0101",
    "212 555 0101",
    "555-0101",
    "555.0101",
    "555 0101",
    "12125550101",
    "2125550101",
    "1-212-555-0101",
    "+1 212 555 0101",
    "+1 (212) 555-0101",
  ];
  for (const raw of formattedLeaks) {
    const masked = redactPhones(`Please call ${raw} today`);
    if (masked.includes(raw)) {
      throw new Error(`redactPhones leaked formatted phone ${raw}`);
    }
    if (masked.includes("2125550101") || masked.includes("555-0101") || masked.includes("(212)")) {
      throw new Error(`redactPhones left reconstructable digits for ${raw}`);
    }
    if (!masked.includes("0101") && !masked.includes("****")) {
      throw new Error(`redactPhones fail-closed mask missing for ${raw}: ${masked}`);
    }
  }
  const formatOutcome = maskOutcomeForBrowser({
    ...first.body.outcome,
    transcript_snippet: "Call (212) 555-0101 or 212-555-0101 or 555-0101",
    quotes: ["Reach me at 212.555.0101"],
    next_action: "Try 1-212-555-0101 if needed",
  });
  const formatBlob = JSON.stringify(formatOutcome);
  for (const raw of ["(212) 555-0101", "212-555-0101", "212.555.0101", "555-0101", "1-212-555-0101"]) {
    if (formatBlob.includes(raw)) {
      throw new Error(`browser outcome leaked formatted phone ${raw}`);
    }
  }
  const intact = redactPhones("HKD 2,400 due 21:00-08:00 case_demo_kyc_001 on 2026-09-10");
  if (intact !== "HKD 2,400 due 21:00-08:00 case_demo_kyc_001 on 2026-09-10") {
    throw new Error(`redactPhones must not eat non-phone text: ${intact}`);
  }

  const { forceHaltForTests, dropClaimsMemoryForTests } = await import("./claims-store");
  forceHaltForTests("case_demo_mer_001", "outcome_unknown");
  dropClaimsMemoryForTests();
  const halted = await executeCallRun({
    caseId: "case_demo_mer_001",
    mode: "demo",
    fast: true,
    now,
  });
  if (halted.status !== 409 || halted.body.error !== "halted for reconciliation") {
    throw new Error("ambiguous halt must block later submissions after reload");
  }

  for (const fraudCase of MOCK_CASES) {
    if (!/^\+121255501\d{2}$/.test(fraudCase.contact.phone_e164)) {
      throw new Error(`${fraudCase.case_id} must use reserved NPA-555-01xx`);
    }
    if (!/Example|Placeholder/.test(fraudCase.contact.name)) {
      throw new Error(`${fraudCase.case_id} contact.name must be clearly fictional`);
    }
  }

  if (priorSecret === undefined) delete process.env.OPS_RUN_SECRET;
  else process.env.OPS_RUN_SECRET = priorSecret;
}
