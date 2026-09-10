// src/parser/parseTranscript.ts — assemble a ParsedTranscript (PRD §6.5, ARCH §4.3).
// Fully deterministic. The value in resolved_targets always comes from dateGrammar (PRD §5.4).

import type {
  CandidateDateTime,
  CorrectionEvent,
  ParsedTranscript,
  ResolvedDateTime,
  TranscriptTurn,
} from "../domain/types.js";
import { extractDates, extractTimes, type GrammarContext, type RawDate } from "./dateGrammar.js";
import { findCorrectionCue, isAffirmative, isInterrogative } from "./confirmation.js";

export interface ParseContext {
  businessTz: string;
  callCreatedAt: string;
}

interface WorkCand extends CandidateDateTime {
  charIndex: number;
}

const TZ_CUE_RE =
  /\b(EST|EDT|PST|PDT|CST|CDT|MST|MDT|eastern|pacific|central time|mountain time|America\/[A-Za-z_]+|UTC|GMT)\b/i;

function eq(a: ResolvedDateTime, b: ResolvedDateTime): boolean {
  return a.date === b.date && a.time === b.time && a.timezone === b.timezone;
}
const hhmm = (h: number, m: number): string =>
  `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

export function parseTranscript(turns: TranscriptTurn[], ctx: ParseContext): ParsedTranscript {
  const grammar: GrammarContext = { businessTz: ctx.businessTz, callCreatedAt: ctx.callCreatedAt };

  const hasUser = turns.some((t) => t.speaker === "user");
  const partial = turns.length === 0 || !hasUser || turns.length < 2;

  const candidates: WorkCand[] = [];
  let dateContext: RawDate | undefined;

  turns.forEach((turn, turn_index) => {
    const dates = extractDates(turn.text, grammar);
    const times = extractTimes(turn.text);

    for (const t of times) {
      // nearest date in this turn at/or before the time; else rolling context
      const inTurn = dates
        .filter((d) => d.index <= t.index)
        .sort((a, b) => b.index - a.index)[0] ?? dates[0];
      const src = inTurn ?? dateContext;

      const cand: WorkCand = {
        turn_index,
        speaker: turn.speaker,
        raw_text: t.raw,
        resolution_confidence: src ? t.confidence : "low",
        is_relative: src ? src.is_relative : false,
        charIndex: t.index,
      };
      if (src) {
        cand.resolved = { date: src.date, time: hhmm(t.hour24, t.minute), timezone: ctx.businessTz };
        if (src.relative_resolutions.length > 1) cand.relative_resolutions = [...src.relative_resolutions];
      }
      candidates.push(cand);
    }

    if (dates.length > 0) dateContext = dates[dates.length - 1];
  });

  // ── correction events (first cue per turn) ─────────────────────────────────
  const correction_events: CorrectionEvent[] = [];
  const correctedTurns = new Set<number>();
  turns.forEach((turn, turn_index) => {
    const cue = findCorrectionCue(turn.text);
    if (!cue) return;
    const inTurn = candidates.filter((c) => c.turn_index === turn_index);
    const before = inTurn.filter((c) => c.charIndex < cue.index).at(-1) ?? null;
    const after = inTurn.find((c) => c.charIndex >= cue.index) ?? null;
    if (!before && !after && inTurn.length < 2) return;
    correction_events.push({
      cue: cue.cue,
      turn_index,
      before_turn_index: before ? before.turn_index : null,
      after_turn_index: after ? after.turn_index : null,
    });
    correctedTurns.add(turn_index);
  });

  // ── resolved targets ─────────────────────────────────────────────────────
  const declarativeUser = turns.map((t) => t.speaker === "user" && !isInterrogative(t.text));
  const surviving: WorkCand[] = [];
  const byTurn = new Map<number, WorkCand[]>();
  for (const c of candidates) {
    if (!c.resolved || c.speaker !== "user" || !declarativeUser[c.turn_index]) continue;
    const list = byTurn.get(c.turn_index) ?? [];
    list.push(c);
    byTurn.set(c.turn_index, list);
  }
  for (const [turn_index, list] of byTurn) {
    list.sort((a, b) => a.charIndex - b.charIndex);
    if (correctedTurns.has(turn_index) && list.length > 1) surviving.push(list[list.length - 1]!);
    else surviving.push(...list);
  }
  surviving.sort((a, b) =>
    a.turn_index - b.turn_index || a.charIndex - b.charIndex,
  );

  const userTargets: ResolvedDateTime[] = [];
  for (const c of surviving) {
    if (c.resolved && !userTargets.some((t) => eq(t, c.resolved!))) userTargets.push(c.resolved);
  }

  // ── strict E4 explicit confirmation ─────────────────────────────────────
  let explicit_confirmation = false;
  let confirmation_turn_index: number | null = null;
  for (let i = 0; i < turns.length; i++) {
    if (turns[i]!.speaker !== "user" || !isAffirmative(turns[i]!.text)) continue;
    const prev = turns[i - 1];
    if (!prev || prev.speaker !== "bot") continue;
    const botCand = candidates.find((c) => c.turn_index === i - 1 && c.resolved);
    if (!botCand?.resolved) continue;
    if (userTargets.length > 0 && !eq(botCand.resolved, userTargets[0]!)) continue;
    explicit_confirmation = true;
    confirmation_turn_index = i;
    break;
  }

  const resolved_targets: ResolvedDateTime[] =
    userTargets.length > 0
      ? userTargets
      : explicit_confirmation && confirmation_turn_index !== null
        ? [candidates.find((c) => c.turn_index === confirmation_turn_index! - 1 && c.resolved)!.resolved!]
        : [];

  // ── timezone source ────────────────────────────────────────────────────
  const anyTz = turns.some((t) => TZ_CUE_RE.test(t.text));
  const timezone_source: ParsedTranscript["timezone_source"] = anyTz
    ? "explicit"
    : resolved_targets.length > 0 || candidates.some((c) => c.resolved)
      ? "business_default"
      : "unknown";

  // ── parse confidence ──────────────────────────────────────────────────
  let parse_confidence: ParsedTranscript["parse_confidence"];
  if (partial || resolved_targets.length === 0) parse_confidence = "low";
  else if (
    surviving.some((c) => c.resolution_confidence !== "high" || (c.relative_resolutions?.length ?? 0) > 1)
  )
    parse_confidence = "medium";
  else parse_confidence = "high";

  const candidate_datetimes: CandidateDateTime[] = candidates.map(({ charIndex: _c, ...rest }) => rest);

  return {
    candidate_datetimes,
    resolved_targets,
    correction_events,
    explicit_confirmation,
    confirmation_turn_index,
    timezone_source,
    partial,
    parse_confidence,
  };
}
