import { liveGateOpen, type SkillEnv } from "./config/env.js";
import { normalizeEvent } from "./ingest/normalize.js";
import { pickOptions } from "./policy/options.js";
import {
  cueDedupeKey,
  maskPhone,
  requireLivePhone,
  shouldRing,
  type RingMode,
} from "./policy/shouldRing.js";
import { resolveHouseDarkWindow } from "./policy/houseDark.js";
import {
  releaseCueReservation,
  reserveCue,
  type CueReservation,
} from "./policy/cueLock.js";
import { buildCallIntent } from "./calle/intent.js";
import { curtainUp, fetchCallResult, type CurtainUpResult } from "./calle/client.js";
import { categorizeCalleError } from "./calle/errors.js";
import { previewIntentSummary, toDecision } from "./map/toDecision.js";
import {
  collectFailureCodes,
  collectFailureMessages,
} from "./map/sdkOutcome.js";
import { loadRecentCueKeys, loadRecentOwnerRingCount, writeback } from "./writeback/index.js";
import type { AccountEvent, CallIntent, DecisionResult, CsOwner } from "./schemas.js";
import { CsOwnerSchema, DecisionResultSchema } from "./schemas.js";

export type ExitKind = "ok" | "hold" | "failure";

export interface RunSignalArgs {
  raw: unknown;
  env: SkillEnv;
  liveFlag: boolean;
  placesTyped: boolean;
  dryRunFlag: boolean;
  verbose?: boolean;
  log?: (msg: string) => void;
  /** Injectable curtain-up for tests (defaults to real client). */
  dial?: typeof curtainUp;
  /** Fetch an existing CALL-E run and map it — no new ring. */
  fromCallId?: string;
  /** Injectable GET for --from-call tests. */
  fetchCall?: typeof fetchCallResult;
}

export interface RunSignalOutcome {
  exit: ExitKind;
  mode: RingMode;
  event: AccountEvent;
  intent: CallIntent | null;
  result: DecisionResult | null;
  message: string;
}

function resolveOwner(event: AccountEvent, env: SkillEnv, mode: RingMode): CsOwner {
  if (mode === "curtain_up" && env.csOwnerE164) {
    return CsOwnerSchema.parse({
      ...event.cs_owner,
      e164: env.csOwnerE164,
      name: env.csOwnerName || event.cs_owner.name,
      id: env.csOwnerId || event.cs_owner.id,
    });
  }
  return event.cs_owner;
}

function resolveMode(args: RunSignalArgs): RingMode {
  if (args.dryRunFlag) return "dress_rehearsal";
  if (args.fromCallId) return "curtain_up";
  if (liveGateOpen({ liveFlag: args.liveFlag, placesTyped: args.placesTyped, env: args.env })) {
    return "curtain_up";
  }
  return "dress_rehearsal";
}

function decisionFromCurtainUp(args: {
  event: AccountEvent;
  intent: CallIntent;
  options: ReturnType<typeof pickOptions>;
  mode: RingMode;
  call: CurtainUpResult["call"];
  structured: Record<string, unknown> | null;
}): DecisionResult {
  const stageCode =
    typeof args.intent.metadata?.stage_code === "string"
      ? args.intent.metadata.stage_code
      : null;
  const rec = args.call.recipients?.[0];
  return toDecision({
    event: args.event,
    intent: args.intent,
    options: args.options,
    mode: args.mode,
    callRunId: args.call.id,
    structured: args.structured,
    callSummary: args.call.summary ?? rec?.summary ?? null,
    taskCompleted: args.call.taskCompleted,
    failureCodes: collectFailureCodes(args.call),
    failureMessages: collectFailureMessages(args.call),
    completionConfidence: args.call.completionConfidence ?? null,
    evidence: args.call.evidence ?? [],
    expectedStageCode: stageCode,
    transcriptTexts: rec?.attempts?.[0]?.transcriptTurns
      ?.filter((t) => t.speaker === "user")
      .map((t) => t.text ?? "")
      .filter(Boolean),
  });
}

async function recordFromExistingCall(
  args: RunSignalArgs,
  event: AccountEvent,
  log: (msg: string) => void,
): Promise<RunSignalOutcome> {
  const callId = args.fromCallId ?? "";
  const mode: RingMode = "curtain_up";
  const owner = resolveOwner(event, args.env, mode);
  const options = event.option_set ?? pickOptions(event.trigger_id);
  const intent = buildCallIntent({ ...event, cs_owner: owner }, owner.e164, options);
  const preview = previewIntentSummary(intent);
  if (args.verbose) log(preview);

  if (!args.env.calleApiKey) {
    return {
      exit: "failure",
      mode,
      event,
      intent,
      result: null,
      message: "Failure: CALLE_API_KEY missing — cannot fetch an existing call.",
    };
  }

  const fetch = args.fetchCall ?? fetchCallResult;
  try {
    log(`Remap — fetching CALL-E run ${callId} (no new ring).`);
    const { call, structured } = await fetch(callId, {
      apiKey: args.env.calleApiKey,
      baseUrl: args.env.calleBaseUrl,
    });
    const result = decisionFromCurtainUp({
      event,
      intent,
      options,
      mode,
      call,
      structured,
    });
    const paths = await writeback({
      dataDir: args.env.dataDir,
      mode,
      event,
      intent,
      result,
      preview,
      note: `Remap of existing CALL-E run ${call.id} — no new ring.`,
      recordDedupe: false,
    });
    log(
      [
        "=== Remap (no ring) ===",
        `Call run: ${call.id}`,
        `Status: ${call.status}`,
        call.completionConfidence
          ? `completionConfidence: ${call.completionConfidence.score} (${call.completionConfidence.label})`
          : null,
        `Decision: ${result.option_id} — ${result.decision_label}`,
        `Prompt book: ${paths.promptBook}`,
        `Show report: ${paths.showReport}`,
        paths.actionIntent ? `Action intent: ${paths.actionIntent}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    return {
      exit: "ok",
      mode,
      event,
      intent,
      result,
      message: "Remap complete — existing CALL-E run mapped into the prompt book.",
    };
  } catch (err) {
    const { category, summary } = categorizeCalleError(err);
    const result = toDecision({
      event,
      intent,
      options,
      mode,
      callRunId: callId,
      failure: { category, summary },
    });
    await writeback({
      dataDir: args.env.dataDir,
      mode,
      event,
      intent,
      result,
      preview,
      note: `Remap fetch failed for ${callId} — cue-history not appended.`,
      recordDedupe: false,
    });
    return {
      exit: "failure",
      mode,
      event,
      intent,
      result,
      message: `Failure: could not fetch CALL-E run ${callId} — ${summary}`,
    };
  }
}

/**
 * Stage Manager main cue path: normalize → policy → dress rehearsal | curtain-up → writeback.
 */
export async function runSignal(args: RunSignalArgs): Promise<RunSignalOutcome> {
  const log = args.log ?? (() => undefined);
  const dial = args.dial ?? curtainUp;
  const mode = resolveMode(args);

  if (args.liveFlag && !args.dryRunFlag && mode === "dress_rehearsal") {
    let event: AccountEvent | null = null;
    try {
      event = normalizeEvent(args.raw);
    } catch {
      /* ignore — gate HOLD takes priority messaging */
    }
    return {
      exit: "hold",
      mode: "dress_rehearsal",
      event: event as AccountEvent,
      intent: null,
      result: null,
      message:
        "HOLD: --live requires type/env PLACES (set SIGNAL_CONFIRM=PLACES or pass PLACES). Staying in dress rehearsal.",
    };
  }

  let event: AccountEvent;
  try {
    event = normalizeEvent(args.raw);
  } catch (err) {
    return {
      exit: "failure",
      mode,
      event: {
        event_id: "invalid",
        trigger_id: "stuck_support",
        account: { id: "?", name: "?", tier: "standard", health_flags: [] },
        cs_owner: {
          id: "?",
          name: "?",
          e164: "+15555550100",
          opt_in_phone: false,
        },
        severity: "low",
        summary: "invalid",
        brief: "invalid",
        metadata: {},
      },
      intent: null,
      result: null,
      message: `Failure: could not normalize cue — ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (args.fromCallId) {
    return recordFromExistingCall(args, event, log);
  }

  const owner = resolveOwner(event, args.env, mode);
  const recent =
    mode === "curtain_up"
      ? await loadRecentCueKeys(args.env.dataDir, args.env.dedupeMinutes)
      : new Set<string>();
  const recentOwnerRings =
    mode === "curtain_up"
      ? await loadRecentOwnerRingCount(
          args.env.dataDir,
          owner.id,
          args.env.dedupeMinutes,
        )
      : 0;

  const houseResolved = resolveHouseDarkWindow({
    envStart: args.env.houseDarkStart || undefined,
    envEnd: args.env.houseDarkEnd || undefined,
    envTimezone: args.env.houseDarkTimezone || undefined,
    ownerQuietHours: owner.quiet_hours,
  });

  if (!houseResolved.ok && mode === "curtain_up") {
    const options = event.option_set ?? pickOptions(event.trigger_id);
    const intent = buildCallIntent({ ...event, cs_owner: owner }, owner.e164, options);
    const preview = previewIntentSummary(intent);
    const result = toDecision({
      event,
      intent,
      options,
      mode,
      holdReason: "house_dark",
    });
    await writeback({
      dataDir: args.env.dataDir,
      mode,
      event,
      intent,
      result,
      preview,
      note: houseResolved.reason,
    });
    return {
      exit: "hold",
      mode,
      event,
      intent,
      result,
      message: `HOLD (house_dark): ${houseResolved.reason}`,
    };
  }

  const houseDark = houseResolved.ok ? houseResolved.window : undefined;

  const policy = shouldRing({
    event: { ...event, cs_owner: owner },
    owner,
    mode,
    houseDark,
    recentCueKeys: recent,
    dedupeMinutes: args.env.dedupeMinutes,
    recentOwnerRingCount: recentOwnerRings,
    ownerMaxRings: args.env.ownerMaxRings,
  });

  const options = event.option_set ?? pickOptions(event.trigger_id);
  const intent = buildCallIntent({ ...event, cs_owner: owner }, owner.e164, options);
  const preview = previewIntentSummary(intent);

  if (args.verbose) {
    log(preview);
    if (policy.note) log(`Note: ${policy.note}`);
  }

  if (!policy.ring || policy.hold) {
    const result = toDecision({
      event,
      intent,
      options,
      mode,
      holdReason: policy.reason ?? "hold",
    });
    await writeback({
      dataDir: args.env.dataDir,
      mode,
      event,
      intent,
      result,
      preview,
      note: policy.note,
    });
    return {
      exit: "hold",
      mode,
      event,
      intent,
      result,
      message: `HOLD (${policy.reason}): ${policy.note ?? "cue withheld"}`,
    };
  }

  if (mode === "dress_rehearsal") {
    const result = toDecision({
      event,
      intent,
      options,
      mode,
      simulatedOptionId: "1",
    });
    const paths = await writeback({
      dataDir: args.env.dataDir,
      mode,
      event,
      intent,
      result,
      preview,
      note: policy.note ?? "Dress rehearsal — no ring, cue-history not appended.",
    });
    log(
      [
        "=== Dress rehearsal (no ring) ===",
        preview,
        "",
        `Simulated line reading: ${result.option_id} — ${result.decision_label}`,
        `Prompt book: ${paths.promptBook}`,
        `Show report: ${paths.showReport}`,
        paths.actionIntent ? `Action intent: ${paths.actionIntent}` : null,
        policy.note ? `Note: ${policy.note}` : null,
        `Call sheet phone (masked): ${maskPhone(owner.e164)}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    return {
      exit: "ok",
      mode,
      event,
      intent,
      result,
      message: "Dress rehearsal complete — house ready, no live ring.",
    };
  }

  // Curtain-up
  let reservation: CueReservation | null = null;
  try {
    try {
      requireLivePhone(owner.e164);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const result = toDecision({
        event,
        intent,
        options,
        mode,
        holdReason: "placeholder_phone",
      });
      await writeback({
        dataDir: args.env.dataDir,
        mode,
        event,
        intent,
        result,
        preview,
        note: msg,
      });
      return {
        exit: "hold",
        mode,
        event,
        intent,
        result,
        message: msg,
      };
    }

    if (!args.env.calleApiKey) {
      const result = toDecision({
        event,
        intent,
        options,
        mode,
        failure: {
          category: "authentication",
          summary: "CALLE_API_KEY missing — cannot curtain-up.",
        },
      });
      await writeback({
        dataDir: args.env.dataDir,
        mode,
        event,
        intent,
        result,
        preview,
        note: "Pre-dial failure — cue-history not appended.",
      });
      return {
        exit: "failure",
        mode,
        event,
        intent,
        result,
        message: "Failure: CALLE_API_KEY missing — cannot curtain-up.",
      };
    }

    const reserved = await reserveCue({
      dataDir: args.env.dataDir,
      event,
    });
    if (!reserved.ok) {
      const result = toDecision({
        event,
        intent,
        options,
        mode,
        holdReason: "already_cued",
      });
      await writeback({
        dataDir: args.env.dataDir,
        mode,
        event,
        intent,
        result,
        preview,
        note: reserved.reason,
      });
      return {
        exit: "hold",
        mode,
        event,
        intent,
        result,
        message: `HOLD (already_cued): ${reserved.reason}`,
      };
    }
    reservation = reserved.reservation;

    log(`Curtain up — cueing CALL-E for ${maskPhone(owner.e164)} (CS owner only).`);
    try {
      const webhookUrl = args.env.calleWebhookUrl || undefined;
      // Async enqueue only when webhook is configured AND CALLE_WAIT=0
      const asyncEnqueue = Boolean(webhookUrl) && args.env.calleWait === false;

      const { call, structured, awaited } = await dial(intent, {
        apiKey: args.env.calleApiKey,
        baseUrl: args.env.calleBaseUrl,
        region: args.env.calleRegion,
        locale: args.env.calleLocale,
        dataDir: args.env.dataDir,
        webhookUrl,
        wait: !asyncEnqueue,
        onStatus: (msg) => log(msg),
      });

      const stageCode =
        typeof intent.metadata?.stage_code === "string"
          ? intent.metadata.stage_code
          : null;

      if (!awaited) {
        const queued = DecisionResultSchema.parse({
          trigger_id: event.trigger_id,
          account_id: event.account.id,
          account_name: event.account.name,
          cs_owner_id: event.cs_owner.id,
          call_run_id: call.id,
          decision: "queued",
          decision_label: "Call queued — awaiting CALL-E webhook",
          option_id: "unknown",
          notes_short: `call.id=${call.id}; completion via CALLE_WEBHOOK_URL`,
          follow_up_at: null,
          completed_at: new Date().toISOString(),
          mode,
          hold_reason: "awaiting_webhook",
        });
        const paths = await writeback({
          dataDir: args.env.dataDir,
          mode,
          event,
          intent,
          result: queued,
          preview,
          note: `Async curtain-up — waiting on webhook. call.id ${call.id}.`,
        });
        log(
          [
            "=== Curtain up (async) ===",
            `Call run: ${call.id}`,
            `Status: ${call.status}`,
            `webhookUrl set; CALLE_WAIT=0 — not blocking on waitForResult`,
            `Prompt book: ${paths.promptBook}`,
          ].join("\n"),
        );
        return {
          exit: "ok",
          mode,
          event,
          intent,
          result: queued,
          message:
            "Curtain-up queued — call.id persisted; completion via CALLE_WEBHOOK_URL.",
        };
      }

      const result = decisionFromCurtainUp({
        event,
        intent,
        options,
        mode,
        call,
        structured,
      });
      const paths = await writeback({
        dataDir: args.env.dataDir,
        mode,
        event,
        intent,
        result,
        preview,
        note: `Curtain-up complete. Dedupe key ${cueDedupeKey(event)}.`,
      });
      log(
        [
          "=== Curtain up ===",
          `Call run: ${call.id}`,
          `Status: ${call.status}`,
          call.failureCode ? `failureCode: ${call.failureCode}` : null,
          call.completionConfidence
            ? `completionConfidence: ${call.completionConfidence.score} (${call.completionConfidence.label})`
            : null,
          stageCode ? `Stage code (identity): ${stageCode}` : null,
          `Decision: ${result.option_id} — ${result.decision_label}`,
          `Prompt book: ${paths.promptBook}`,
          `Show report: ${paths.showReport}`,
          paths.cueHistory ? `Cue history: ${paths.cueHistory}` : null,
          paths.actionIntent ? `Action intent: ${paths.actionIntent}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      );
      return {
        exit: "ok",
        mode,
        event,
        intent,
        result,
        message: "Curtain-up complete — decision in the prompt book.",
      };
    } catch (err) {
      const { category, summary } = categorizeCalleError(err);
      const result = toDecision({
        event,
        intent,
        options,
        mode,
        failure: { category, summary },
      });
      await writeback({
        dataDir: args.env.dataDir,
        mode,
        event,
        intent,
        result,
        preview,
        note: `Provider failure (${category}) — cue-history not appended.`,
      });
      return {
        exit: "failure",
        mode,
        event,
        intent,
        result,
        message: `Failure during curtain-up (${category}): ${summary}`,
      };
    }
  } finally {
    await releaseCueReservation(reservation);
  }
}
