#!/usr/bin/env node
/**
 * is-it-accessible — ask venues the accessibility questions that matter to one
 * person, and return an evidence-backed answer per need.
 *
 * Standalone by design: this file can be lifted out of the skill folder and run
 * anywhere. Dry runs need nothing but Node — the CALL-E SDK is imported lazily,
 * and only when actually placing a call, so `npm install @call-e/calle` is
 * required for `--real` and `--call`, and for nothing else.
 *
 * Dry run is the default. Placing a real call requires --real *and* a
 * CALLE_API_KEY, and IIA_FORCE_DRY_RUN=1 overrides both.
 *
 * Usage:
 *   node check_access.mjs --profile profile.json --venue "Name" --phone +15555550123
 *   node check_access.mjs --profile profile.json --venue "Name" --phone +15555550123 --real [--wait 120]
 *   node check_access.mjs --profile profile.json --call call_…    # rebuild a report, no dial
 *   node check_access.mjs --list-needs
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

const CATALOGUE_URL = new URL("./needs.json", import.meta.url);

// --------------------------------------------------------------- phone rules

const E164 = /^\+[1-9]\d{1,14}$/;

/**
 * Normalise to E.164 or throw.
 *
 * Country codes are never inferred. A number without a "+" is ambiguous, and
 * guessing wrong means calling a stranger.
 */
function parsePhone(input) {
  const cleaned = String(input ?? "").trim().replace(/[\s\-().]/g, "");
  if (!cleaned.startsWith("+")) {
    throw new Error(
      `"${input}" has no country code. Use international format, e.g. +15555550123. ` +
        "Country codes are never guessed, because guessing wrong means calling a stranger.",
    );
  }
  if (!E164.test(cleaned)) {
    throw new Error(`"${input}" is not a valid international phone number.`);
  }
  return cleaned;
}

/** Hide the last four digits. Full numbers never reach output. */
function maskPhone(input) {
  let e164;
  try {
    e164 = parsePhone(input);
  } catch {
    return "[redacted]";
  }
  const digits = e164.slice(1);
  if (digits.length <= 4) return `+${"*".repeat(digits.length)}`;
  return `+${digits.slice(0, -4)}****`;
}

/** Strip runs of 8+ digits from free text before it is logged or shown. */
function scrubNumbers(text) {
  return String(text).replace(/\+?[\d][\d\s\-().]{6,}[\d]/g, (match) =>
    (match.match(/\d/g) ?? []).length >= 8 ? "[number redacted]" : match,
  );
}

// --------------------------------------------------------------------- locale

/**
 * CALL-E's own language names → BCP 47 primary subtags.
 *
 * Their supported-languages table names languages in prose — "English, Hindi,
 * Tamil" — while `recipients[].locale` is documented as BCP 47 ("en-US"). The
 * two disagree, so a profile written in either vocabulary is translated here
 * rather than passed through as free text.
 *
 * Duplicated from the main library on purpose: this script may import only
 * `@call-e/calle` and node builtins, because upstream forbids depending on an
 * unpublished private package.
 */
const LANGUAGE_NAMES = {
  english: "en",
  chinese: "zh",
  malay: "ms",
  hindi: "hi",
  tamil: "ta",
  arabic: "ar",
  vietnamese: "vi",
  german: "de",
  japanese: "ja",
  french: "fr",
  spanish: "es",
  portuguese: "pt",
  polish: "pl",
  bengali: "bn",
  thai: "th",
  finnish: "fi",
  ukrainian: "uk",
  sinhala: "si",
  urdu: "ur",
  turkish: "tr",
  hebrew: "he",
};

/**
 * `locale` as CALL-E documents it: a language subtag, plus the region when the
 * profile states one. Neither half is guessed — a language it cannot read is
 * dropped rather than sent, and no region is invented for one.
 *
 * The length check matters: a 5–8 letter primary subtag is structurally
 * well-formed BCP 47, so `new Intl.Locale("Klingon")` parses happily. Real
 * language subtags are two or three letters.
 */
function composeLocale(language, region) {
  const trimmed = String(language ?? "").trim();
  if (!trimmed) return undefined;

  let tag = LANGUAGE_NAMES[trimmed.toLowerCase()];
  if (!tag) {
    try {
      const parsed = new Intl.Locale(trimmed).language;
      if (/^[a-z]{2,3}$/.test(parsed)) tag = parsed;
    } catch {
      return undefined;
    }
  }
  if (!tag) return undefined;

  const code = String(region ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? `${tag}-${code}` : tag;
}

// ------------------------------------------------------------------ catalogue

async function loadCatalogue() {
  const raw = JSON.parse(await readFile(CATALOGUE_URL, "utf8"));
  const byId = new Map(raw.needs.map((n) => [n.id, n]));
  return { ...raw, byId };
}

// -------------------------------------------------------------------- profile

const MAX_NEEDS = 12;

/**
 * Validate a profile.
 *
 * An unknown need id is an error, not a silent drop: a profile quietly missing
 * the need someone cares about most is worse than one that refuses to load.
 */
function parseProfile(input, catalogue) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Profile must be a JSON object.");
  }
  if (!Array.isArray(input.needs)) {
    throw new Error('Profile must have a "needs" array.');
  }

  const issues = [];
  const seen = new Set();
  const needs = [];

  for (const [index, entry] of input.needs.entries()) {
    if (typeof entry !== "object" || entry === null) {
      issues.push(`needs[${index}] must be an object.`);
      continue;
    }
    if (!catalogue.byId.has(entry.id)) {
      issues.push(`needs[${index}] refers to an unknown need "${entry.id}".`);
      continue;
    }
    if (seen.has(entry.id)) {
      issues.push(`needs[${index}] repeats "${entry.id}".`);
      continue;
    }
    seen.add(entry.id);

    const severity = entry.severity ?? "must-have";
    if (severity !== "must-have" && severity !== "nice-to-have") {
      issues.push(`needs[${index}] has an invalid severity "${severity}".`);
      continue;
    }
    needs.push({ id: entry.id, severity, note: entry.note });
  }

  if (needs.length === 0 && issues.length === 0) {
    issues.push("Profile has no needs selected.");
  }
  if (needs.length > MAX_NEEDS) {
    // A call that runs past a dozen questions outlasts the patience of whoever
    // picked up, and the later answers get terse and unreliable.
    issues.push(`Profile has ${needs.length} needs; the maximum is ${MAX_NEEDS}.`);
  }
  if (issues.length > 0) {
    throw new Error(`Profile is not usable:\n  - ${issues.join("\n  - ")}`);
  }

  return {
    id: input.id ?? "default",
    label: input.label ?? "Accessibility profile",
    needs,
    language: input.language,
    region: input.region,
    notes: input.notes,
  };
}

/** Must-haves first, then catalogue order. */
function orderedNeeds(profile, catalogue) {
  const order = new Map(catalogue.needs.map((n, i) => [n.id, i]));
  return [...profile.needs].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "must-have" ? -1 : 1;
    return order.get(a.id) - order.get(b.id);
  });
}

// ------------------------------------------------------------ idempotency key

/** FNV-1a. Short, stable, dependency-free — not a security hash. */
function hash(input) {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * The `Idempotency-Key` for one check: profile id, the needs asked, the venue
 * numbers and the UTC day, hashed. Kept in step with `checkKey` in the main
 * library.
 *
 * Same key, same request: CALL-E replays the original call and nobody is rung
 * twice. The needs are in it because the same key with a *different* body is
 * not a replay but a `409 idempotency_conflict`, and a profile edited between
 * two runs is exactly that. The day is in it so a venue checked last month can
 * be checked again; `attempt` is what `--again` adds, so it can be checked
 * again today.
 */
function checkKey(profile, venues, attempt) {
  const needs = profile.needs.map((n) => `${n.id}:${n.severity}`).sort().join(",");
  const phones = venues.map((v) => v.phone).sort().join(",");
  const day = new Date().toISOString().slice(0, 10);
  const distinct = attempt ? `|attempt:${attempt}` : "";
  return `iia_${hash(`${profile.id}|${needs}|${phones}|${day}${distinct}`)}`;
}

// ------------------------------------------------------------- goal and schema

/**
 * Build the CALL-E task instruction.
 *
 * The value of this skill lives in this string. A generic "ask if they're
 * accessible" gets a sincere "yes" from a venue with a step at the door,
 * because whoever answers has never had to notice it.
 */
function composeGoal(profile, venue, catalogue) {
  const needs = orderedNeeds(profile, catalogue);
  const mustHaves = needs.filter((n) => n.severity === "must-have");

  const questions = needs.map((selected, index) => {
    const need = catalogue.byId.get(selected.id);
    const priority = selected.severity === "must-have" ? "ESSENTIAL" : "optional";
    const lines = [
      `${index + 1}. [${priority}] (record as "${need.id}") ${need.question}`,
      `   A complete answer includes: ${need.evidenceHint}`,
    ];
    if (selected.note) lines.push(`   Caller's own detail to mention if relevant: ${selected.note}`);
    return lines.join("\n");
  });

  return [
    `Call ${venue.name} and ask about physical accessibility on behalf of a customer who is planning a visit.`,
    "",
    "WHO YOU ARE",
    "Say you are an assistant calling on behalf of a customer who wants to visit, and that you have a few quick questions about accessibility.",
    "Be warm, brief and appreciative. The person answering did not design the building and is not responsible for its shortcomings.",
    "This is a question, never a complaint, an inspection, or a compliance check. Do not imply any obligation or cite any law.",
    "If they are busy, ask when would be a better time and offer to let them go. Do not press.",
    "If they ask who the customer is, say only that it is a customer planning a visit. Never give the customer's name, number, or condition.",
    "",
    "WHAT TO ASK",
    `Work through these ${needs.length} question${needs.length === 1 ? "" : "s"} in order.`,
    mustHaves.length > 0
      ? `The ${mustHaves.length} marked ESSENTIAL decide whether the visit can happen at all — if the call has to be cut short, make sure those are answered.`
      : "",
    "",
    questions.join("\n"),
    "",
    "HOW TO ASK",
    "Ask for specifics, not reassurance. Venues sincerely answer 'yes, we're accessible' while having a step at the door, because the person answering has never had to notice it.",
    "So when an answer is vague — 'yes we're accessible', 'I think so', 'should be fine' — ask one concrete follow-up: how many steps, which floor, how wide, is it working today.",
    // Kept word for word in step with src/core/goal.ts. A vague answer and one
    // you could not make out are different failures, and only the first was
    // covered until a real call answered a yes-or-no question with a number
    // and the bot congratulated it.
    "An answer you cannot make out is not a vague answer. If what they say does not fit the question — a number where you asked yes or no, a word you did not catch, anything that does not make sense — say you did not catch it and ask once more.",
    "Never acknowledge an answer you did not understand. 'Great, thank you' tells them they have answered, and they will not say it again. If you still cannot make it out, record it as unknown rather than your best guess at what they meant.",
    "If they still do not know, that is a perfectly good outcome. Record it as unknown and move on. Do not guess on their behalf and do not push a third time.",
    "If they offer to check with a colleague and come back to you on the call, wait for them.",
    "Never suggest an answer or offer one to agree with. Ask the question and let the silence do the work.",
    "",
    "WHAT TO RECORD",
    "For each question, record the answer using the matching id shown in brackets above.",
    "Capture a short direct quote of what they actually said, in their words, as evidence for each answer.",
    "An answer with no quote will be discarded, so quote something for every question you get an answer to.",
    // Kept word for word in step with src/core/goal.ts. A barrier and a
    // workaround in the same breath is what has produced every laundered
    // "yes" on a real call — 77 steps and a ramp, four steps and a ramp.
    "A barrier plus a workaround is not a clean pass. If they describe a barrier — steps, a lift that is out of service, a door that is kept locked — and then a way around it, record 'partial' rather than 'yes', unless they confirm the way around is there today and usable without help.",
    "Mark confidence as low when the person sounded unsure, was guessing, or said they would need to check.",
    "",
    "AT THE END",
    "Thank them for their time and end the call. Do not ask for a booking, a manager, a callback, or any personal detail.",
    profile.notes ? `\nCONTEXT FROM THE CUSTOMER\n${profile.notes}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * Per-venue result schema.
 *
 * Only `verdict` is required. Requiring `quote` at schema level would pressure
 * CALL-E into inventing one; its absence is enforced downstream instead, where
 * it downgrades the verdict safely.
 */
function buildRecipientSchema(profile, catalogue) {
  const properties = {};
  const required = [];

  for (const selected of orderedNeeds(profile, catalogue)) {
    const need = catalogue.byId.get(selected.id);
    properties[need.id] = {
      type: "object",
      description: need.schemaDescription,
      required: ["verdict"],
      properties: {
        verdict: {
          type: "string",
          enum: ["yes", "no", "partial", "unknown"],
          description: `${need.schemaDescription} Use "unknown" when staff could not say.`,
        },
        quote: {
          type: "string",
          description:
            "A short direct quote of what the person actually said, in their own words. Omit if they gave no answer — never paraphrase or invent.",
        },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        note: { type: "string" },
      },
    };
    required.push(need.id);
  }

  return { type: "object", required, properties };
}

// --------------------------------------------------------------------- report

const VERDICTS = new Set(["yes", "no", "partial", "unknown"]);
const VALID_CONFIDENCE = new Set(["high", "medium", "low"]);

/**
 * Turn raw answers into findings.
 *
 * The rule that matters: a positive claim with no supporting quote becomes
 * `unknown`. Without it, this launders whatever a venue felt like saying into
 * an authoritative green tick, and someone plans a journey around it. A "no"
 * survives unevidenced — a wasted enquiry costs less than a wasted journey.
 */
function buildFindings(profile, structuredResult, catalogue) {
  const answers = structuredResult ?? {};

  return orderedNeeds(profile, catalogue).map((selected) => {
    const need = catalogue.byId.get(selected.id);
    const raw = answers[selected.id];
    const base = { needId: need.id, label: need.label, severity: selected.severity };

    if (typeof raw !== "object" || raw === null) {
      return { ...base, verdict: "unknown", confidence: "low" };
    }

    const claimed = VERDICTS.has(raw.verdict) ? raw.verdict : "unknown";
    const quote = typeof raw.quote === "string" && raw.quote.trim() ? scrubNumbers(raw.quote.trim()) : undefined;
    const unevidenced = !quote && (claimed === "yes" || claimed === "partial");
    // Undefined when the extraction did not say so. Not the same as "medium":
    // the goal text asks for doubt to be flagged, so silence means there was
    // none to flag, and inventing a figure here would then be shown to someone.
    const stated = VALID_CONFIDENCE.has(raw.confidence) ? raw.confidence : undefined;

    // The same rule by the other route. A quote proves the venue said
    // something; it does not prove the something supports the verdict. A real
    // call answered "77" to how many steps are at the entrance and still came
    // back `yes` on step-free entry, quoting "We do have a RAM." — at `medium`
    // confidence. The extractor's own hedge was the one honest signal in that
    // record, so an essential `yes` it is unsure of is an open question too.
    // Narrow on purpose: `yes` only, essentials only, and only when a
    // confidence was actually stated — reading silence as a hedge would
    // downgrade every essential the extraction had no reservation about.
    // `no` and `partial` are untouched: only an affirmative costs a journey.
    const hedged =
      !unevidenced && claimed === "yes" && selected.severity === "must-have" && stated !== undefined && stated !== "high";

    const why = `The venue answered "yes", but the answer was recorded with only ${stated} confidence, so it is an open question rather than a fact.`;
    const theirNote = raw.note ? scrubNumbers(raw.note) : undefined;

    return {
      ...base,
      verdict: unevidenced || hedged ? "unknown" : claimed,
      confidence: unevidenced ? "low" : stated,
      quote,
      note: unevidenced
        ? `The venue answered "${claimed}" but gave nothing quotable to back it up, so this is recorded as unconfirmed.`
        : hedged
          // Their words and their note are the evidence and both stay. Only
          // the verdict is withdrawn.
          ? (theirNote ? `${why} ${theirNote}` : why)
          : theirNote,
    };
  });
}

/** A failed must-have sinks the venue. There is no averaging past a step. */
function overallVerdict(findings) {
  if (findings.length === 0) return "unverified";
  const mustHaves = findings.filter((f) => f.severity === "must-have");
  const relevant = mustHaves.length > 0 ? mustHaves : findings;

  if (relevant.some((f) => f.verdict === "no")) return "not-suitable";
  if (relevant.every((f) => f.verdict === "unknown")) return "unverified";
  if (relevant.some((f) => f.verdict === "unknown" || f.verdict === "partial")) {
    return "partly-suitable";
  }
  // Every essential is a confirmed yes; a nice-to-have that is missing or
  // limited still costs the venue a grade. One that simply went unanswered
  // does not — an optional nobody could speak to changes nobody's plans.
  const optional = findings.filter((f) => f.severity === "nice-to-have");
  if (optional.some((f) => f.verdict === "no" || f.verdict === "partial")) {
    return "partly-suitable";
  }
  return "suitable";
}

/**
 * Did the venue claim anything at all, whatever we then did with it?
 *
 * Read from the raw answers, because findings are what is left *after* the
 * downgrade rules have run — and when every finding is `unknown`, those rules
 * are exactly what the report has to own up to.
 */
function anyClaimMade(structuredResult) {
  if (typeof structuredResult !== "object" || structuredResult === null) return false;
  return Object.values(structuredResult).some(
    (raw) => typeof raw === "object" && raw !== null && VERDICTS.has(raw.verdict) && raw.verdict !== "unknown",
  );
}

/**
 * SIP codes seen on attempts CALL-E could not place at all: `603` and `503`,
 * then `500` and `480`, all to numbers that never rang — no ringing event, no
 * transcript, zero duration. CALL-E have said a `603` "does not necessarily
 * mean the recipient declined the call".
 */
const NOT_PLACED_CODES = new Set(["480", "500", "503", "603"]);

/** `408`, Request Timeout: observed on a call that rang for ninety seconds. */
const RANG_OUT_CODES = new Set(["408"]);

/**
 * Which side a failed call failed on, from the *attempt's* `failure_code`.
 *
 * The call-level code cannot do this: a phone that rang out unanswered and one
 * that was never dialled both come back `call_failed` with the message
 * "calling task status=NO ANSWER (Hangup by: bot)", identically.
 *
 * An unrecognised code is `unclassified` and the report says only that the
 * call failed. That default is the point rather than a gap — saying "nobody
 * picked up" of a call the provider never placed blames a venue for someone
 * else's outage, and the field is undocumented (`string | null`, no enum), so
 * these sets are observation and can go stale.
 */
function classifyFailure(failureCode) {
  const code = typeof failureCode === "string" ? failureCode.trim() : "";
  if (NOT_PLACED_CODES.has(code)) return "not-placed";
  if (RANG_OUT_CODES.has(code)) return "no-answer";
  return "unclassified";
}

/** Statuses under which the phone may still be about to ring, task or recipient level. */
const PENDING_STATUSES = new Set(["queued", "in_progress", "pending"]);

function buildReport(profile, venue, outcome, catalogue) {
  const findings = buildFindings(profile, outcome.structuredResult, catalogue);
  const gotAnswers = findings.some((f) => f.verdict !== "unknown");

  let unverifiedReason;
  let callFailure;
  if (PENDING_STATUSES.has(outcome.status)) {
    // Not finished is not failed. A call read back with --call while CALL-E
    // is still on it has no answers *yet*; "the call ended" would be a lie
    // about a phone that may be ringing right now.
    unverifiedReason =
      "This call has not finished yet, so there are no answers to show. Check again later.";
  } else if (outcome.status !== "completed") {
    // A task that failed before it created any outbound attempt — seen as
    // `botlab create bot failed` on a real call — never reached a phone, and
    // carries no SIP code to say so. Zero attempts is the evidence.
    callFailure = outcome.dialAttempted === false ? "not-placed" : classifyFailure(outcome.failureCode);
    // CALL-E's own explanation, when the task itself failed. Scrubbed like
    // any other free text, and the provider's name swapped out: this sentence
    // reaches a reader, and the reader wants to know which side failed, not
    // who the vendor is.
    const serviceReason = outcome.failureMessage
      ? scrubNumbers(String(outcome.failureMessage).trim()).replaceAll(/CALL-E/gi, "the calling service")
      : undefined;
    unverifiedReason =
      callFailure === "not-placed"
        ? "The calling service could not connect the call, so nobody at the venue was rung and these questions were never asked. " +
          (serviceReason ? `The calling service reported: "${serviceReason}". ` : "") +
          "That is not the venue's doing, and it is worth trying again."
        : callFailure === "no-answer"
          ? "The phone rang and nobody picked up, so these questions were never asked."
          : `The call ended as "${outcome.status}", so these questions were never asked.`;
  } else if (outcome.structuredResult === null) {
    unverifiedReason =
      "The call connected but no structured answers could be extracted. The summary is the only record.";
  } else if (!gotAnswers) {
    // Every finding is `unknown`, which has two very different causes: nobody
    // could answer, or answers came back and the rules above declined to
    // record any of them as fact. "Nobody could answer" in the second case
    // hides the one thing the person most needs to see.
    unverifiedReason = anyClaimMade(outcome.structuredResult)
      ? "The venue answered, but nothing came back firmly enough to record as a fact. Each answer below says why."
      : "The call connected but nobody could answer any of the questions.";
  }

  return {
    venue: { name: venue.name, phoneMasked: maskPhone(venue.phone) },
    profileId: profile.id,
    verdict: unverifiedReason ? "unverified" : overallVerdict(findings),
    findings,
    unverifiedReason,
    callFailure,
    // Dropped only where there is positive evidence nobody was rung: CALL-E's
    // summary on such a call reads "the recipient may be busy or unavailable",
    // which is an insinuation about a venue that was never dialled. A call
    // that connected and hit an answering machine keeps its summary, since
    // there it may be the only record.
    summary:
      outcome.summary && callFailure !== "not-placed" ? scrubNumbers(outcome.summary) : undefined,
    callId: outcome.callId,
    callStatus: outcome.status,
    checkedAt: new Date().toISOString(),
  };
}

// ------------------------------------------------------------------- dry run

/** Recorded answers, so the whole pipeline runs without spending a call. */
function fixtureOutcome(profile, venue, fixture, catalogue) {
  if (fixture === "voicemail") {
    return {
      structuredResult: null,
      status: "failed",
      summary: `${venue.name} did not pick up.`,
      callId: "call_dryrun_voicemail",
      // 408, Request Timeout: the phone rang and nobody lifted it.
      failureCode: "408",
    };
  }
  if (fixture === "not-placed") {
    return {
      structuredResult: null,
      status: "failed",
      // CALL-E's own wording on a call it never placed. Here so the fixture
      // proves the report does not repeat it back to the reader.
      summary: "The first call did not connect and the recipient may be busy or unavailable.",
      callId: "call_dryrun_notplaced",
      failureCode: "603",
    };
  }
  if (fixture === "not-placed-no-attempt") {
    return {
      structuredResult: null,
      status: "failed",
      summary: null,
      callId: "call_dryrun_noattempt",
      // The voice agent failed before dialling: no attempt, no code, and the
      // recipient frozen at `pending`. Only the attempt count says what happened.
      failureCode: undefined,
      dialAttempted: false,
      failureMessage: "calling task status=FAILED: botlab create bot failed",
    };
  }
  if (fixture === "no-structured-result") {
    return {
      structuredResult: null,
      status: "completed",
      summary: `Someone at ${venue.name} answered but could only say they would have to check.`,
      callId: "call_dryrun_nostruct",
    };
  }

  const answers = {};
  for (const selected of orderedNeeds(profile, catalogue)) {
    const need = catalogue.byId.get(selected.id);
    if (fixture === "unevidenced-claim") {
      // The case the quote rule exists for. Must come back as unknown.
      answers[need.id] = { verdict: "yes", confidence: "high" };
    } else if (fixture === "hedged-claim") {
      // The case the confidence gate exists for, from a real call: a quote is
      // present, so the quote rule passes it, but the quote evidences a ramp
      // of unknown location while the note says 77 steps. Must come back as
      // unknown on an essential.
      answers[need.id] =
        need.id === "step-free-entry"
          ? {
              verdict: "yes",
              quote: "We do have a RAM.",
              confidence: "medium",
              note: 'They gave a step count as "77" and confirmed a ramp exists, but did not confirm where the ramp is located.',
            }
          : {
              verdict: "yes",
              quote: `Yes, ${need.label.toLowerCase()} is fine here`,
              confidence: "medium",
            };
    } else if (fixture === "unsure") {
      answers[need.id] = { verdict: "unknown", confidence: "low" };
    } else if (fixture === "not-accessible" && selected.severity === "must-have") {
      answers[need.id] = {
        verdict: "no",
        quote: `No, sorry, we don't have ${need.label.toLowerCase()}`,
        confidence: "high",
      };
    } else {
      answers[need.id] = {
        verdict: "yes",
        quote: `Yes, ${need.label.toLowerCase()} is fine here`,
        confidence: "high",
      };
    }
  }

  return {
    structuredResult: answers,
    status: "completed",
    summary: `Dry-run answers for ${venue.name} (${fixture}).`,
    callId: `call_dryrun_${fixture}`,
  };
}

// ------------------------------------------------------------- from a call

/** The SIP code from the last attempt that carried one — see `classifyFailure`. */
function attemptFailureCode(recipient) {
  let code;
  for (const attempt of recipient?.attempts ?? []) {
    if (attempt.failureCode) code = attempt.failureCode;
  }
  return code;
}

/**
 * Map a finished CALL-E call back onto venues.
 *
 * Recipients are matched by phone number, never by array position — CALL-E
 * makes no promise about ordering, and matching positionally would attribute
 * one venue's answers to another.
 */
function reportsFromCall(profile, venues, call, catalogue) {
  return venues.map((venue) => {
    const recipient = call.recipients.find((r) =>
      r.phones.some((p) => {
        try {
          return parsePhone(p) === venue.phone;
        } catch {
          return false;
        }
      }),
    );

    // A task that failed during setup can leave its recipient frozen at
    // `pending`. Once the parent is terminal, that child status no longer
    // describes whether anything can still happen, so the parent's wins.
    const recipientStatus = recipient?.status;
    const status =
      (call.status === "failed" || call.status === "canceled") &&
      (recipientStatus === undefined || recipientStatus === "pending" || recipientStatus === "in_progress")
        ? call.status
        : (recipientStatus ?? call.status);

    return buildReport(
      profile,
      venue,
      {
        structuredResult: recipient?.structuredResult ?? null,
        status,
        summary: recipient?.summary ?? call.summary,
        callId: call.id,
        failureCode: attemptFailureCode(recipient),
        dialAttempted: (recipient?.attempts?.length ?? 0) > 0,
        failureMessage: call.failureMessage,
      },
      catalogue,
    );
  });
}

/**
 * The venues a call was placed to, for `--call` when none are given.
 *
 * Names come from the `venues` this script writes into call metadata, keyed
 * back by number. That is data sent once and read back from a service, so it
 * is validated rather than trusted: an entry whose number will not parse is
 * dropped, and a recipient with no name falls back to its masked number. A
 * misnamed venue is the one thing worse than an unnamed one.
 */
function venuesFromCall(call) {
  const names = new Map();
  const raw = call.metadata?.venues;
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry?.name !== "string" || !entry.name.trim()) continue;
      try {
        names.set(parsePhone(entry.phone), entry.name.trim());
      } catch {
        // Skip it; see above.
      }
    }
  }
  return call.recipients.flatMap((recipient) => {
    const phone = recipient.phones[0];
    if (phone === undefined) return [];
    try {
      const parsed = parsePhone(phone);
      return [{ name: names.get(parsed) ?? maskPhone(parsed), phone: parsed }];
    } catch {
      return [];
    }
  });
}

// ----------------------------------------------------------------------- main

function parseArgs(argv) {
  const args = {
    venues: [],
    phones: [],
    real: false,
    again: false,
    yes: false,
    json: false,
    listNeeds: false,
    fixture: "accessible",
    // The SDK's own default. Calls have taken 74 and 119 minutes, so a person
    // at a terminal may well want more; --call is there for when they do not.
    waitMinutes: 10,
  };
  const rest = [...argv];
  while (rest.length) {
    const token = rest.shift();
    if (token === "--profile") args.profile = rest.shift();
    else if (token === "--venue") args.venues.push(rest.shift());
    else if (token === "--phone") args.phones.push(rest.shift());
    else if (token === "--fixture") args.fixture = rest.shift();
    else if (token === "--call") args.call = rest.shift();
    else if (token === "--wait") args.waitMinutes = Number(rest.shift());
    else if (token === "--real") args.real = true;
    else if (token === "--again") args.again = true;
    else if (token === "--yes" || token === "-y") args.yes = true;
    else if (token === "--json") args.json = true;
    else if (token === "--list-needs") args.listNeeds = true;
    else throw new Error(`Unknown option "${token}".`);
  }
  if (!Number.isFinite(args.waitMinutes) || args.waitMinutes < 0) {
    throw new Error("--wait takes a number of minutes.");
  }
  return args;
}

/**
 * The SDK, imported only when a call is placed or read back, so dry runs need
 * nothing installed. A bare ERR_MODULE_NOT_FOUND tells the user nothing they
 * can act on.
 */
async function loadSdk() {
  try {
    return await import("@call-e/calle");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      throw new Error(
        "Reaching CALL-E needs its SDK, which is not installed here.\n" +
          "  Install it with:  npm install @call-e/calle\n" +
          "Dry runs need no dependencies, so everything except --real and --call works without it.",
      );
    }
    throw error;
  }
}

function makeClient(CalleClient) {
  const apiKey = process.env.CALLE_API_KEY;
  if (!apiKey) throw new Error("CALLE_API_KEY is required for --real and --call.");
  return new CalleClient({
    apiKey,
    ...(process.env.CALLE_BASE_URL ? { baseUrl: process.env.CALLE_BASE_URL } : {}),
  });
}

function renderReport(report) {
  const lines = [`\n${report.venue.name}  ${report.venue.phoneMasked}`, `  ${report.verdict.toUpperCase()}`];
  if (report.unverifiedReason) lines.push(`  ${report.unverifiedReason}`);
  lines.push("");
  for (const finding of report.findings) {
    const optional = finding.severity === "nice-to-have" ? " (optional)" : "";
    // How sure the extraction was, in words, beside the answer it qualifies.
    // Not on an `unknown`: that confidence is a placeholder for "there was no
    // answer to be confident about", and printing it beside every unanswered
    // question is noise.
    const sure = finding.verdict === "unknown" || !finding.confidence ? "" : ` · ${finding.confidence} confidence`;
    lines.push(`  ${finding.verdict.padEnd(8)} ${finding.label}${optional}${sure}`);
    if (finding.quote) lines.push(`           "${finding.quote}"`);
    if (finding.note) lines.push(`           ${finding.note}`);
  }
  return `${lines.join("\n")}\n`;
}

const DISCLAIMER = `
This records what staff said on the phone. It is not an inspection, an audit,
or a legal determination, and people answer in good faith about buildings they
did not design. Treat it as a much better starting point than a website, not
as a guarantee.
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalogue = await loadCatalogue();

  if (args.listNeeds) {
    for (const need of catalogue.needs) {
      console.log(`${need.id.padEnd(24)} ${need.label}`);
      console.log(`${" ".repeat(24)} ${need.question}`);
    }
    return 0;
  }

  if (args.call) {
    if (!args.profile) {
      throw new Error(
        "--call needs --profile: the call carries no copy of the profile, so pass the one it was placed with. " +
          "Needs the venue was never asked about come back as unknown.",
      );
    }
  } else if (!args.profile) {
    throw new Error("--profile is required. See assets/example-profile.json.");
  }

  const profile = parseProfile(JSON.parse(await readFile(args.profile, "utf8")), catalogue);

  if (args.venues.length !== args.phones.length) {
    throw new Error("Each --venue needs a --phone, in the same order.");
  }
  if (args.venues.length === 0 && !args.call) {
    throw new Error("At least one --venue and --phone is required.");
  }

  // Validate every number before calling anyone. Finding out venue three is
  // malformed after ringing venues one and two is the worst possible moment.
  const given = args.venues.map((name, i) => ({ name, phone: parsePhone(args.phones[i]) }));

  const forcedDryRun = process.env.IIA_FORCE_DRY_RUN === "1";
  if (forcedDryRun && args.real) console.error("IIA_FORCE_DRY_RUN=1 is set; ignoring --real.");
  const dryRun = !args.call && (!args.real || forcedDryRun);

  let reports;

  if (args.call) {
    // One GET, no dial, no credit, no confirmation: nothing here can ring
    // anybody. This is how a call that outlived the wait — or the terminal it
    // was started from — becomes a report.
    const { CalleClient } = await loadSdk();
    const call = await makeClient(CalleClient).calls.get(args.call);
    const venues = given.length > 0 ? given : venuesFromCall(call);
    if (venues.length === 0) {
      throw new Error(`Call ${call.id} lists no recipients that could be matched to a venue.`);
    }
    console.error(`Call ${call.id} is "${call.status}".`);
    reports = reportsFromCall(profile, venues, call, catalogue);
  } else if (dryRun) {
    console.error("Dry run — no call will be placed and no credit spent.");
    reports = given.map((venue) =>
      buildReport(profile, venue, fixtureOutcome(profile, venue, args.fixture, catalogue), catalogue),
    );
  } else {
    const venues = given;
    const { CalleClient, CalleAPIError, CalleTimeoutError } = await loadSdk();
    const client = makeClient(CalleClient);

    if (!args.yes) {
      console.error("\nAbout to place a REAL phone call to:");
      for (const venue of venues) console.error(`  ${venue.name}  ${maskPhone(venue.phone)}`);
      console.error(`\nThis spends ${venues.length} CALL-E credit(s) and rings a real business.`);
      if (!process.stdin.isTTY) {
        throw new Error("Not an interactive terminal; pass --yes to confirm.");
      }
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      const answer = await rl.question("Go ahead? [y/N] ");
      rl.close();
      if (answer.trim().toLowerCase() !== "y") {
        console.error("Cancelled. No call was placed.");
        return 1;
      }
    }

    // `locale` is documented as BCP 47 while the profile may say "English" in
    // prose, so it is composed rather than passed through.
    const locale = composeLocale(profile.language, profile.region);

    // A stable key means a retry re-reads the original call instead of
    // dialling a real business a second time. `--again` is the one way to
    // ring the same venue twice in a day, and it has to be asked for.
    const idempotencyKey = checkKey(profile, venues, args.again ? randomUUID() : undefined);

    let call;
    try {
      call = await client.calls.create(
        {
          task: composeGoal(profile, venues.length === 1 ? venues[0] : { name: "this venue" }, catalogue),
          recipients: venues.map((v) => ({
            phones: [v.phone],
            ...(profile.region ? { region: profile.region } : {}),
            ...(locale ? { locale } : {}),
          })),
          recipientResultSchema: buildRecipientSchema(profile, catalogue),
          // The names travel with the call so `--call` can label the report
          // later; CALL-E knows the numbers it rang and not what anyone calls
          // the place.
          metadata: { app: "is-it-accessible", profileId: profile.id, venues },
        },
        { idempotencyKey },
      );
    } catch (error) {
      // Named, because the generic advice for a refused call is to try again,
      // and a conflict is the one refusal a retry cannot get past.
      if (error instanceof CalleAPIError && error.code === "idempotency_conflict") {
        throw new Error(
          "A matching call was already placed today with different questions, so CALL-E would not reuse it. " +
            "Run the identical check to read that call back, or pass --again to place a new one.",
        );
      }
      // Any other refusal is CALL-E's, in CALL-E's words — the account's
      // concurrency limit, for one — and the reader should know whose it is.
      if (error instanceof CalleAPIError) {
        throw new Error(`CALL-E would not accept the call: ${scrubNumbers(error.message)}`);
      }
      throw error;
    }

    // Printed the moment CALL-E accepts it, before anything waits. A call can
    // take two hours to complete; if this process does not outlive it, the id
    // is what turns it into a report later.
    // A call created more than a minute ago is one CALL-E already had under
    // this key: the idempotency replay doing its job, said in words so a
    // "retry" that appears to work instantly is not read as a fresh dial.
    const ageMs = Date.now() - Date.parse(call.createdAt ?? "");
    if (Number.isFinite(ageMs) && ageMs > 60_000) {
      console.error(
        `Call ${call.id} was already placed ${Math.round(ageMs / 60_000)} minutes ago with these exact questions; ` +
          "nobody was rung a second time. Pass --again to place a new call.",
      );
    } else {
      console.error(`Call ${call.id} accepted.`);
    }
    console.error("Waiting for it to finish; this can take an hour or more.");
    console.error(`If you stop waiting, read it back later with:  --call ${call.id} --profile ${args.profile}`);

    try {
      call = await client.calls.waitForResult(call.id, { timeoutMs: args.waitMinutes * 60_000 });
    } catch (error) {
      if (error instanceof CalleTimeoutError) {
        console.error(
          `Still not finished after ${args.waitMinutes} minutes; the call is not cancelled and CALL-E will finish it.\n` +
            `Read it back later with:  --call ${call.id} --profile ${args.profile}`,
        );
        return 2;
      }
      throw error;
    }

    console.error(`Call ${call.id} finished with status "${call.status}".`);
    reports = reportsFromCall(profile, venues, call, catalogue);
  }


  if (args.json) {
    console.log(JSON.stringify({ dryRun, reports }, null, 2));
  } else {
    for (const report of reports) process.stdout.write(renderReport(report));
    if (dryRun) console.log("\nDry run against recorded answers. Nobody was called.");
    console.log(DISCLAIMER);
  }

  return reports.every((r) => r.verdict === "unverified") ? 2 : 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
