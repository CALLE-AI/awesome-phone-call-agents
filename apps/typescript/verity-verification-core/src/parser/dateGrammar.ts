// src/parser/dateGrammar.ts — deterministic date/time resolver (PRD §6.5, ARCH §4.3).
// Luxon-backed. No LLM: every value in resolved_targets comes from here (PRD §5.4 hard rule).

import { DateTime } from "luxon";

export interface GrammarContext {
  businessTz: string;
  /** ISO 8601 — anchors relative dates ("Thursday", "tomorrow"). */
  callCreatedAt: string;
}

export interface RawTime {
  index: number; // char offset in the source string (ordering)
  hour24: number;
  minute: number;
  confidence: "high" | "medium";
  raw: string;
}

export interface RawDate {
  index: number;
  date: string; // YYYY-MM-DD (first resolution)
  is_relative: boolean;
  relative_resolutions: string[]; // length > 1 ⇒ ambiguous
  raw: string;
}

const WEEKDAY: Record<string, number> = {
  sunday: 7, sun: 7,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};
const MONTH: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const NUMWORD: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12,
};

/** Bare hour → 24h, salon-hours heuristic (09:00–17:00). 1–7 ⇒ PM, 8–11 ⇒ AM, 12 ⇒ noon. */
function inferMeridiem(h: number): number {
  if (h === 12) return 12;
  if (h >= 1 && h <= 7) return h + 12;
  return h; // 8..11 AM
}

function hourFromToken(tok: string): number | null {
  const t = tok.toLowerCase();
  if (/^\d{1,2}$/.test(t)) return Number(t);
  return NUMWORD[t] ?? null;
}

function push(times: RawTime[], t: RawTime): void {
  // dedupe within the same string by (hour,minute); keep the higher-confidence / earlier hit
  const dup = times.find((x) => x.hour24 === t.hour24 && x.minute === t.minute);
  if (!dup) times.push(t);
  else if (dup.confidence === "medium" && t.confidence === "high") Object.assign(dup, t);
}

export function extractTimes(text: string): RawTime[] {
  const times: RawTime[] = [];
  const add = (index: number, hour24: number, minute: number, confidence: "high" | "medium", raw: string) => {
    if (hour24 < 0 || hour24 > 23 || minute < 0 || minute > 59) return;
    push(times, { index, hour24, minute, confidence, raw });
  };

  // 1. HH:MM with optional meridiem
  for (const m of text.matchAll(/\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?/gi)) {
    let h = Number(m[1]!);
    const min = Number(m[2]!);
    const mer = m[3]?.toLowerCase().replace(/\./g, "");
    let conf: "high" | "medium" = "high";
    if (mer === "pm" && h < 12) h += 12;
    else if (mer === "am" && h === 12) h = 0;
    else if (!mer) {
      h = inferMeridiem(h);
      conf = "medium";
    }
    add(m.index ?? 0, h, min, conf, m[0]!);
  }

  // 2. "9 AM", "3pm"  (not the "00" inside "9:00 AM")
  for (const m of text.matchAll(/(?<![\d:])(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)\b/gi)) {
    let h = Number(m[1]!);
    const mer = m[2]!.toLowerCase().replace(/\./g, "");
    if (mer === "pm" && h < 12) h += 12;
    else if (mer === "am" && h === 12) h = 0;
    add(m.index ?? 0, h, 0, "high", m[0]!);
  }

  // 3. noon / midnight
  for (const m of text.matchAll(/\bnoon\b/gi)) add(m.index ?? 0, 12, 0, "high", m[0]!);
  for (const m of text.matchAll(/\bmidnight\b/gi)) add(m.index ?? 0, 0, 0, "high", m[0]!);

  // 4. "<n> o'clock" / word o'clock
  for (const m of text.matchAll(/\b([a-z]+|\d{1,2})\s*o'?clock\b/gi)) {
    const h = hourFromToken(m[1]!);
    if (h !== null) add(m.index ?? 0, inferMeridiem(h), 0, "medium", m[0]!);
  }

  // 5. "<n> thirty" / "<n> fifteen" / "<n> forty-five"
  for (const m of text.matchAll(/\b([a-z]+|\d{1,2})[- ](thirty|fifteen|forty-?five|o'?clock)\b/gi)) {
    const h = hourFromToken(m[1]!);
    if (h === null) continue;
    const kind = m[2]!.toLowerCase();
    const min = kind.startsWith("thirty") ? 30 : kind.startsWith("fifteen") ? 15 : kind.startsWith("forty") ? 45 : 0;
    add(m.index ?? 0, inferMeridiem(h), min, "medium", m[0]!);
  }

  // 6. "half/quarter past|to <n>"
  for (const m of text.matchAll(/\b(quarter|half)\s+(past|to|after)\s+([a-z]+|\d{1,2})\b/gi)) {
    const h = hourFromToken(m[3]!);
    if (h === null) continue;
    const base = inferMeridiem(h);
    if (/past|after/i.test(m[2]!)) add(m.index ?? 0, base, m[1]!.toLowerCase() === "half" ? 30 : 15, "medium", m[0]!);
    else add(m.index ?? 0, (base + 23) % 24, m[1]!.toLowerCase() === "half" ? 30 : 45, "medium", m[0]!);
  }

  // 7. "X or Y[:MM]" option pairs
  for (const m of text.matchAll(/\b(\d{1,2})\s+or\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/gi)) {
    add(m.index ?? 0, inferMeridiem(Number(m[1]!)), 0, "medium", `${m[1]!}`);
    let h2 = Number(m[2]!);
    const min2 = m[3]! ? Number(m[3]!) : 0;
    const mer = m[4]?.toLowerCase().replace(/\./g, "");
    if (mer === "pm" && h2 < 12) h2 += 12;
    else if (mer === "am" && h2 === 12) h2 = 0;
    else h2 = inferMeridiem(h2);
    add((m.index ?? 0) + 1, h2, min2, m[3]! || mer ? "high" : "medium", `${m[2]!}${m[3]! ? `:${m[3]!}` : ""}`);
  }

  // 8. bare number in a time context: "at 3", "make it 3", "say 11", "4 works"
  for (const m of text.matchAll(
    /\b(?:at|by|around|for|make it|makes it|do|say|to)\s+([a-z]+|\d{1,2})\b(?!\s*(?:st|nd|rd|th|:|\/|-\d))/gi,
  )) {
    const h = hourFromToken(m[1]!);
    if (h !== null) add(m.index ?? 0, inferMeridiem(h), 0, "medium", m[0]!.trim());
  }
  for (const m of text.matchAll(/\b([a-z]+|\d{1,2})\s+(works|is fine|is good|sounds good)\b/gi)) {
    const h = hourFromToken(m[1]!);
    if (h !== null) add(m.index ?? 0, inferMeridiem(h), 0, "medium", m[0]!);
  }

  return times.sort((a, b) => a.index - b.index);
}

export function extractDates(text: string, ctx: GrammarContext): RawDate[] {
  const dates: RawDate[] = [];
  const anchor = DateTime.fromISO(ctx.callCreatedAt, { zone: ctx.businessTz });
  const anchorDay = anchor.startOf("day");

  const nextWeekday = (target: number, addWeeks = 0): DateTime => {
    let d = anchorDay;
    // 1..7 Luxon weekday (Mon=1..Sun=7)
    const delta = (target - d.weekday + 7) % 7;
    d = d.plus({ days: delta === 0 ? 7 : delta }); // strictly after "today" for a bare weekday
    return d.plus({ weeks: addWeeks });
  };

  // "next <weekday>" — ambiguous (this coming one vs the following week)
  for (const m of text.matchAll(/\bnext\s+(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*\b/gi)) {
    const wd = WEEKDAY[m[1]!.toLowerCase()];
    if (wd === undefined) continue;
    const a = nextWeekday(wd, 0);
    const b = nextWeekday(wd, 1);
    dates.push({
      index: m.index ?? 0,
      date: a.toISODate()!,
      is_relative: true,
      relative_resolutions: [a.toISODate()!, b.toISODate()!],
      raw: m[0]!,
    });
  }

  // bare "<weekday>"
  for (const m of text.matchAll(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi)) {
    if (/\bnext\s+$/i.test(text.slice(0, m.index ?? 0))) continue; // already handled
    const wd = WEEKDAY[m[1]!.toLowerCase()]!;
    const d = nextWeekday(wd);
    dates.push({
      index: m.index ?? 0,
      date: d.toISODate()!,
      is_relative: true,
      relative_resolutions: [d.toISODate()!],
      raw: m[0]!,
    });
  }

  // "September 8th", "Sep 8"
  for (const m of text.matchAll(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi,
  )) {
    const mon = MONTH[m[1]!.toLowerCase()]!;
    const day = Number(m[2]!);
    let d = DateTime.fromObject({ year: anchor.year, month: mon, day }, { zone: ctx.businessTz });
    if (d.isValid && d < anchorDay) d = d.plus({ years: 1 });
    if (d.isValid) {
      dates.push({ index: m.index ?? 0, date: d.toISODate()!, is_relative: false, relative_resolutions: [d.toISODate()!], raw: m[0]! });
    }
  }

  // "today" / "tomorrow"
  for (const m of text.matchAll(/\btoday\b/gi)) {
    dates.push({ index: m.index ?? 0, date: anchorDay.toISODate()!, is_relative: true, relative_resolutions: [anchorDay.toISODate()!], raw: m[0]! });
  }
  for (const m of text.matchAll(/\btomorrow\b/gi)) {
    const d = anchorDay.plus({ days: 1 });
    dates.push({ index: m.index ?? 0, date: d.toISODate()!, is_relative: true, relative_resolutions: [d.toISODate()!], raw: m[0]! });
  }

  // numeric M/D
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\b/g)) {
    let d = DateTime.fromObject({ year: anchor.year, month: Number(m[1]!), day: Number(m[2]!) }, { zone: ctx.businessTz });
    if (d.isValid && d < anchorDay) d = d.plus({ years: 1 });
    if (d.isValid) dates.push({ index: m.index ?? 0, date: d.toISODate()!, is_relative: false, relative_resolutions: [d.toISODate()!], raw: m[0]! });
  }

  return dates.sort((a, b) => a.index - b.index);
}
