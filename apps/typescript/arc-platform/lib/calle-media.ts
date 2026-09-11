/**
 * Media-specific helpers for CALL-E: builds the call task prompt and result
 * schema for a radio/TV station vs. an influencer, and scores the returned
 * result into a ranked media-plan row.
 */

import {
  buildMandate,
  mandatePrompt,
  NEGOTIATION_SCHEMA_FIELDS,
  type NegotiationMandate,
  /* Relative, not "@/lib/...": this module is loaded by scripts/ through jiti,
     which does not resolve the tsconfig path alias. An aliased import here
     breaks every one of them at require time - as it did, twice. */
} from "./negotiation";

export type TargetType = "station" | "creator";

export interface CallTarget {
  name: string;
  type: TargetType;
  channel?: string; // radio | tv | instagram | tiktok | youtube
  phone?: string;
  /** Catalogue id (app/radio/_data.ts, app/influencers/_data.ts). Carried so
   *  the SERVER can look a number up in lib/contacts.ts - the client is never
   *  sent the contact book, and a target arriving without a phone is not the
   *  same thing as a target we cannot reach. */
  externalId?: string;
  contactName?: string;
  audienceSize?: number;
  /** The catalogue's rate estimate for this line. The negotiation mandate is
   *  built from it; with no estimate there is no mandate and the call runs as
   *  a plain enquiry. See lib/negotiation.ts. */
  estimatePkr?: number | null;
}

export interface CampaignContext {
  advertiser?: string;
  campaignName?: string;
  market?: string;
  flightStart?: string;
  flightEnd?: string;
  durationDays?: number;
  audience?: string;
  budgetTotal?: number;
  currency?: string;
  language?: string; // e.g. "Urdu", "English"
  region?: string; // ISO region for the recipient (omit to let CALL-E infer)
  locale?: string; // e.g. "en-US"; omit to let CALL-E infer
  /** How many other lines this campaign is buying. A bundle is only offered
   *  when there is genuinely something to bundle with. */
  otherLines?: number;
}

/* `rate_per_spot` is NOT required, and that is the point.
 *
 * It used to be. A station with no availability in the flight has no rate to
 * give, so the call could not satisfy its own result schema - and the agent
 * was simultaneously told the rate was the most important field and not to
 * end the call without it. Three pressures to keep asking a question that had
 * already been answered "no". A required field that a legitimate call cannot
 * fill is a bug in the schema, not a gap in the conversation.
 *
 * `available` stays required because every call can answer it, including the
 * ones that answer it "no". */
export const STATION_SCHEMA = {
  type: "object",
  required: ["available"],
  properties: {
    available: { type: "string", enum: ["yes", "no", "unknown"] },
    avail_dates: { type: "string" },
    rate_per_spot: { type: "number" },
    /* Whether the figure above was read back digit by digit and explicitly
       confirmed. A rate we heard is not the same as a rate they agreed we
       heard - see NUMBERS. */
    rate_confirmed: { type: "boolean" },
    /* What that number buys, in their words. A rate with no basis is a
       number nobody can check - see the note on CREATOR_SCHEMA. */
    rate_basis: { type: "string" },
    spots_available: { type: "integer" },
    audience_estimate: { type: "string" },
    notes: { type: "string" },
  },
} as const;

/* `rate` is not required, for the reason given on STATION_SCHEMA: a creator
   who does not take paid collaborations has no rate, and demanding one leaves
   the agent asking after it has been told no.
 *
 * `rate_basis` exists because one scalar cannot hold two prices. A creator
 * quotes per post AND per story - often per reel too - and one
 * call came back `rate: 8000` when 8,000 was the story price and the post was
 * 18,000. The UI then rendered it under a hardcoded "per post".
 *
 * This does not fix that: the second number still has nowhere to go. It makes
 * the omission VISIBLE, which was the actual harm - a plan priced on the
 * cheaper of two numbers with nothing saying so. Holding several prices
 * properly means a rate per deliverable and a booking that references one,
 * which is a schema change and a rethink of what confirmedRatePkr means. */
export const CREATOR_SCHEMA = {
  type: "object",
  required: ["interested"],
  properties: {
    interested: { type: "string", enum: ["yes", "no", "unknown"] },
    rate: { type: "number" },
    /** Read back digit by digit and explicitly confirmed? See NUMBERS. */
    rate_confirmed: { type: "boolean" },
    /** What the rate covers: "per post", "per 24-hour story", "per reel". */
    rate_basis: { type: "string" },
    deliverables: { type: "string" },
    available_dates: { type: "string" },
    audience_size: { type: "string" },
    notes: { type: "string" },
  },
} as const;

/**
 * The result schema for this target, with negotiation fields ONLY when there
 * is a mandate behind them.
 *
 * They used to be unconditional, and one September call shows why
 * that was wrong. That call had no mandate - the line carried no rate estimate
 * - so the prompt never mentioned negotiating. The schema asked for
 * `opening_rate`, `concessions` and `within_mandate` anyway, and the model
 * filled them in: opening_rate 1500 (the number ASR had misheard before the
 * digits were read back), concessions [], within_mandate true. An assertion
 * about a mandate that did not exist.
 *
 * A field with no instruction behind it is an invitation to invent one. If we
 * are not asking the agent to negotiate, we do not ask it what it negotiated.
 */
export function schemaFor(target: CallTarget, ctx?: CampaignContext): Record<string, unknown> {
  const base = target.type === "station" ? STATION_SCHEMA : CREATOR_SCHEMA;
  const mandate = buildMandate({
    estimatePkr: target.estimatePkr ?? null,
    durationDays: ctx?.durationDays ?? null,
    otherLines: ctx?.otherLines ?? null,
    kind: target.type,
  });
  if (!mandate) return base;
  return {
    ...base,
    properties: { ...base.properties, ...NEGOTIATION_SCHEMA_FIELDS },
  };
}

/** A concrete, self-sufficient flight phrase so the agent never has to ask for dates. */
function flight(ctx: CampaignContext): string {
  if (ctx.flightStart && ctx.flightEnd) return `from ${ctx.flightStart} to ${ctx.flightEnd}`;
  if (ctx.durationDays) return `for a ${ctx.durationDays}-day flight starting within the next two weeks`;
  return "for a 30-day flight starting within the next two weeks";
}

/* How to speak, before what to say.
 *
 * The API exposes no voice, accent or speaking-rate control - only `locale`
 * and this instruction - so conversational behaviour has to be written here.
 * Every line comes from a real 31-turn call that returned nothing: the agent
 * opened with four questions in one breath, never repeated a number back to
 * check it, and recovered from confusion by restating everything at once.
 * "2020 2030" and "2020 30 second" in that transcript were a rate being
 * misheard, and nothing asked the agent to confirm it. */
const MANNER =
  `Speak slowly and clearly, in short sentences. Ask ONE question at a time and wait for an ` +
  `answer before asking the next - never list several questions in one turn. ` +
  `Ask any one question at most twice. If you still do not have a usable answer after the ` +
  `second attempt, say you will note it as not confirmed, and move on to the next question - a ` +
  `question asked a third time is a question they have already answered as well as they can. ` +
  `This limit is absolute and it includes the opening question and the introduction: NEVER ask ` +
  `the same question a third time, and never restart the call from the beginning. ` +
  `The one exception is confirming a rate - see the rule about money below, where reading a ` +
  `figure back is the point and not a repetition.`;

/* The opening loop, twice.
 *
 * First on one call: "have I reached the ad sales desk?"
 * thirteen times while the recipient said yes nine times. The answer was an
 * instruction - name the affirmatives, forbid a third ask, forbid restarting.
 *
 * It did not hold. On another the agent re-read its ENTIRE
 * introduction ten times:
 *
 *    Arc:  Hello, this is Arc, an AI assistant calling on behalf of ...
 *          is this the ad sales desk or the right person?
 *    Them: Aaj Tak                      <- ASR noise, not a refusal
 *    Arc:  Hello, this is Arc, ... is this the ad sales desk or the right person?
 *    Them: apps  Status
 *    Arc:  Hello, this is Arc, ...
 *
 * and the prompt it ran under contained every one of those rules. Verified
 * from the task text CALL-E stored: "Ask it ONCE", "never repeat your
 * introduction", the affirmatives list, all present. The instruction was not
 * being followed, and writing it a third time was not going to work.
 *
 * So the GATE goes instead of the wording. The prompt used to say: ask who you
 * have reached, and "only once they have engaged" explain why you are calling.
 * That makes every later question conditional on a check the agent must first
 * believe it has passed - and on a line transcribing "kiss", "video" and
 * "attitude status", it never believes that. A precondition that cannot be
 * satisfied is a loop with extra steps.
 *
 * There is now no qualifying question at all. Disclosure, then the first real
 * question. Whoever answered either knows the rate or says they do not, and
 * "you have the wrong desk" is a thing people say without being asked. */
const OPENING =
  `Do NOT ask whether you have reached the right person, the right desk or the right department, ` +
  `and do not wait to be told. There is no qualifying question: after your one-sentence ` +
  `introduction, go straight to your first real question. ` +
  `Never repeat your introduction. If you have said who you are once, you have said it - if they ` +
  `sound confused later, answer in one sentence and carry on from where you were, and never start ` +
  `the call again from the beginning. ` +
  `If a reply is unintelligible, that is a bad line and not a refusal: ask your CURRENT question ` +
  `again in fewer words, never an earlier one. Only an explicit "wrong number", "not interested" ` +
  `or a request to stop ends the call. ` +
  `If they say you have the wrong desk, ask once to be put through to whoever handles advertising ` +
  `rates, then carry on with that person.`;



/* How the call ENDS.
 *
 * A call that had answered every question once spent its last fifty
 * seconds asking "Anything else to add?" six times, and only stopped when the
 * recipient fell silent. The wrap-up had no exit condition: anything the
 * person said - including ASR noise - counted as more to discuss, so it asked
 * again. A closing question that can be re-asked is not a closing question.
 *
 * Asked once, then the call ends whatever the answer is. */
const CLOSING =
  `When you have been through the list, ask ONCE whether there is anything else they want to ` +
  `add. Then thank them and end the call, whatever they say to that - do not ask it a second ` +
  `time, and do not wait for them to stop talking before closing.`;

/* Money, and why the old rule never fired.
 *
 * The previous instruction was "repeat it back to confirm it before moving
 * on", with digit-by-digit as a fallback "if you do not understand a number
 * after two attempts". Both failed on that call, in different ways.
 *
 * The readback was skipped entirely for the rate: the reply was noisy and
 * carried several numbers, the agent said "Got it" and asked the next
 * question. CALL-E's own evidence array says so - "The bot did not repeat back
 * or clarify the rate before moving to later questions." Repeating a number
 * back was a behaviour, not a gate, so skipping it cost nothing.
 *
 * And the fallback was conditioned on NOT UNDERSTANDING. ASR failure does not
 * feel like not understanding: the agent heard "8000" clearly and confidently,
 * and 8,000 was the wrong price. A rule that fires on confusion can never fire
 * when the agent is wrong but sure - which is the only dangerous case.
 *
 * So: digit by digit FIRST rather than as a fallback, and the recording is
 * conditional on an explicit confirmation rather than the politeness being
 * conditional on confusion. An unconfirmed rate is useful; a confidently wrong
 * one is worse than none. */
const NUMBERS =
  `Money is the thing you must not get wrong, and mishearing an amount does not feel like ` +
  `mishearing - a wrong figure arrives sounding exactly like a right one. So whenever they give ` +
  `you a rate or any amount of money, FIRST ask them to say it digit by digit, before you write ` +
  `anything down. Do not save that for when you are confused; do it every time. Then read the ` +
  `digits back and ask them to confirm. ` +
  `Do NOT record a rate you have not read back and had confirmed. A confirmation is an explicit ` +
  `yes to the exact figure you said. Silence is not a confirmation, "OK" is not a confirmation, ` +
  `and moving on to another subject is not a confirmation. If they will not or cannot confirm ` +
  `it, tell them plainly that you will note the rate as unconfirmed, set rate_confirmed to ` +
  `false, and carry on - we would far rather have a rate marked unconfirmed than a wrong one ` +
  `recorded as fact. Set rate_confirmed to true ONLY when they confirmed the exact figure you ` +
  `read back to them. ` +
  `For numbers that are not money - spot counts, audience figures - repeat them back before ` +
  `moving on.`;

/* A rate on its own is not an answer. "8,000" from a creator who charges
   8,000 per story and 18,000 per post is true and useless, and we have no
   field for the second number - so at minimum record which one this is. */
const RATE_BASIS =
  `Whenever they give you a rate, also establish what that rate covers - per spot, per post, ` +
  `per 24-hour story, per reel - and record it. If they quote more than one price for different ` +
  `things, report the one for what we asked about and say in your notes what the others were.`;

/* AI disclosure - the first thing said on every call, before anything is asked.
 *
 * Deliberately not a flag. There is no context field that turns this off and
 * no code path that reaches CALL-E without it, because the version of this
 * that can be disabled is the version that eventually ships disabled. It also
 * makes the product better rather than worse: a sales desk that knows it is
 * talking to software says so, and a call that opens honestly is a stronger
 * demo than one that hopes nobody asks.
 *
 * The refusal path matters as much as the disclosure. A person who says stop
 * has to be able to stop the call, not be walked through four questions first.
 */
/**
 * What this agent is not for.
 *
 * Arc phones ad sales desks about airtime. It has no business giving advice on
 * anything else, and it must not be the thing standing between somebody and
 * real help - a voice agent that stays on script through an emergency is worse
 * than one that hangs up.
 *
 * Added because the CALL-E contribution rules require a call-placing agent to
 * carry rules for medical, legal, financial and emergency content, and this
 * one carried none. Deliberately placed beside the disclosure and nowhere near
 * NUMBERS: the read-back gate is not a thing to edit while adding features.
 */
const BOUNDARIES =
  `You are here to ask about advertising rates and availability, and nothing else. ` +
  `Do not give medical, legal, financial or investment advice, and do not offer an ` +
  `opinion on any of them - if you are asked, say you cannot help with that and bring ` +
  `the call back to the advertising question, or end it. ` +
  `If anyone indicates a medical or safety emergency, stop immediately: tell them to ` +
  `contact their local emergency services, say nothing else, and end the call. ` +
  `Never collect payment details, card numbers, bank details or identity documents. ` +
  `You are not authorised to agree a contract, sign anything, or commit to a booking.`;

function disclosure(onBehalfOf: string): string {
  return (
    `Your FIRST sentence identifies you as an AI, before anything else and before you ` +
    `ask anything: "Hello, this is Arc, an AI assistant calling on behalf of ` +
    `${onBehalfOf}." Never claim or imply that you are a person. If you are asked at any ` +
    `point whether you are a human, a recording or a bot, say plainly that you are an AI ` +
    `assistant and offer to have a colleague call back instead. If the person asks you ` +
    `not to call, says they are not interested, or asks to be removed from the list, ` +
    `acknowledge it, stop asking questions, thank them and end the call.`
  );
}

/**
 * Is there actually a campaign behind this call?
 *
 * The station and creator pages mount the call card with no campaign in scope.
 * Before this, that produced a task describing "an advertising campaign in the
 * local market" running "for a 30-day flight starting within the next two
 * weeks" - a flight invented on the spot and spoken aloud to a real station,
 * followed by an instruction to "mention the campaign by name" when there was
 * no name. A rate enquiry is a legitimate call in its own right, so it gets
 * its own task rather than a hollowed-out campaign one.
 */
function hasCampaign(ctx: CampaignContext): boolean {
  return Boolean(ctx.advertiser || ctx.campaignName || ctx.flightStart);
}

/**
 * A standalone rate enquiry: no campaign, no dates, nothing invented.
 */
export function buildStandaloneTask(target: CallTarget): string {
  const who = target.contactName ?? (target.type === "station" ? "the sales contact" : "the creator or their manager");
  const common =
    `You are Arc, an AI assistant researching advertising rates on behalf of a media buyer. You ` +
    `are calling ${target.name} to ask about their rates and availability. You are not booking ` +
    `anything and there is no specific campaign yet - this is a rate enquiry. ${MANNER} ${OPENING} ` +
    `${disclosure("a media buying client")} ${BOUNDARIES} ` +
    `Then, in ONE sentence, say you are calling to ask about advertising rates. Then ask your first ` +
    `question immediately - do not wait for permission to begin. If they ask which dates or which ` +
    `campaign, say you are gathering rates and that dates are not fixed yet.`;

  if (target.type === "station") {
    return (
      common +
      ` Then work through these one at a time, confirming each answer before moving on: (1) do they ` +
      `currently have advertising availability, (2) their standard rate per spot, (3) how many spots ` +
      `are typically available, (4) their audience or reach estimate. The rate per spot is the most ` +
      `important - do not end the call without it unless they refuse. ${NUMBERS} ${RATE_BASIS} ${CLOSING}`
    );
  }
  return (
    common +
    ` Then work through these one at a time, confirming each answer before moving on: (1) do they ` +
    `take paid collaborations, (2) their usual rate, (3) what deliverables that includes, (4) their ` +
    `audience size. The rate is the most important - do not end the call without it unless they ` +
    `refuse. ${NUMBERS} ${RATE_BASIS} ${CLOSING}`
  );
}

export function buildTask(ctx: CampaignContext, target: CallTarget): string {
  // No campaign in scope - do not invent one. See buildStandaloneTask.
  if (!hasCampaign(ctx)) return buildStandaloneTask(target);

  const cur = ctx.currency ?? "PKR";
  const budget =
    ctx.budgetTotal && ctx.budgetTotal > 0
      ? ` The total campaign budget is about ${cur} ${Number(ctx.budgetTotal).toLocaleString()}.`
      : "";
  const language = ctx.language ? ` Conduct the call in ${ctx.language}.` : "";

  /* Null when we hold no rate estimate for this line, which is most of the
     catalogue. No estimate, no mandate: a target price invented from nothing
     is the fiction this project keeps taking out. */
  const mandate = buildMandate({
    estimatePkr: target.estimatePkr ?? null,
    durationDays: ctx.durationDays ?? null,
    otherLines: ctx.otherLines ?? null,
    kind: target.type,
  });
  /* AFTER the money rules, never instead of them. The agent reads how to hear
     a number correctly, then what price to push for. */
  const negotiation = mandate ? ` ${mandatePrompt(mandate, cur)}` : "";
  const common =
    `You are Arc, an AI assistant placing media-buying calls for ${ctx.advertiser ?? "our client"}, planning ` +
    `${ctx.campaignName ? `the "${ctx.campaignName}" campaign` : "an advertising campaign"} in ` +
    `${ctx.market ?? "the local market"}. The campaign runs ${flight(ctx)}. The target audience is ` +
    `${ctx.audience ?? "a general adult audience"}.${budget}${language} ` +
    `${MANNER} ${OPENING} ` +
    `${disclosure(ctx.advertiser ?? "our client")} ${BOUNDARIES} ` +
    `Then, in ONE sentence, say you are calling about radio advertising for the campaign and that ` +
    `this is an availability and pricing inquiry, not a commitment. Then ask your first question ` +
    `immediately - do not wait for permission to begin.`;

  if (target.type === "station") {
    return (
      common +
      ` Then work through these one at a time, in this order, confirming each answer before ` +
      `moving on: (1) do they have advertising availability during those dates, (2) the rate per ` +
      `spot, (3) how many spots are available, (4) their audience or reach estimate. The rate per ` +
      `spot is the most important - do not end the call without it unless they refuse. If they ask ` +
      `for exact dates, say the campaign is flexible within that window. ${NUMBERS} ${RATE_BASIS}${negotiation} ${CLOSING}`
    );
  }
  return (
    common +
    ` Then work through these one at a time, in this order, confirming each answer before moving ` +
    `on: (1) is the creator interested in a paid collaboration, (2) their rate, (3) what ` +
    `deliverables that includes, (4) which dates they are available, (5) their audience size. The ` +
    `rate is the most important - do not end the call without it unless they refuse. If they ask ` +
    `for exact dates, say timing is flexible within the next month. ${NUMBERS} ${RATE_BASIS}${negotiation} ${CLOSING}`
  );
}

export interface PlanRow {
  name: string;
  type: TargetType;
  channel: string;
  verdict: string; // yes | no | unknown
  price: number | null;
  /** What `price` covers, in their words. Empty when they did not say. */
  rateBasis: string;
  /** Did they confirm the figure read back to them? Null when the call did
   *  not say either way - which is not the same as "no". */
  rateConfirmed: boolean | null;

  /* Negotiation (C-03). Null on every call that ran without a mandate, which
     is every call placed before the mandate existed, and every line we hold no
     estimate for. */
  openingPrice: number | null;
  mandateTarget: number | null;
  mandateWalkAway: number | null;
  /** Every offer made, in order. The sequence is the story; the last number
   *  alone cannot show that the price moved because we offered volume. */
  concessions: { offered: string; response: string; rateAfter: number | null }[];
  /** CALL-E's own read on the call. Set by the caller from the call state,
   *  not derived from the result. */
  confidenceLabel: string;
  evidence: string[];
  reach: number;
  detail: string;
  notes: string;
  score: number;
  summary?: string;
  callId?: string;
  mock?: boolean;
}

function reachNumber(target: CallTarget, result: Record<string, unknown>): number {
  if (typeof result._reach === "number") return result._reach as number;
  if (target.audienceSize) return target.audienceSize;
  return 0;
}

function price(target: CallTarget, result: Record<string, unknown>): number | null {
  const v = target.type === "station" ? result.rate_per_spot : result.rate;
  return typeof v === "number" ? v : null;
}

function detail(target: CallTarget, result: Record<string, unknown>): string {
  if (target.type === "station") {
    return `${result.spots_available ?? "?"} spots, ${result.avail_dates ?? ""}`.trim();
  }
  return `${result.deliverables ?? ""} — ${result.available_dates ?? ""}`
    .replace(/^ — | — $/g, "")
    .trim();
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

/** The model's concession list, read defensively. A malformed entry is
 *  dropped rather than rendered as an empty row on the quote. */
function readConcessions(v: unknown): PlanRow["concessions"] {
  if (!Array.isArray(v)) return [];
  return v
    .map((raw) => {
      const c = (raw ?? {}) as Record<string, unknown>;
      return {
        offered: String(c.offered ?? "").trim(),
        response: String(c.response ?? "").trim(),
        rateAfter: num(c.rate_after),
      };
    })
    .filter((c) => c.offered.length > 0);
}

export function scoreRow(
  ctx: CampaignContext,
  target: CallTarget,
  result: Record<string, unknown>
): PlanRow {
  const yesField = target.type === "station" ? "available" : "interested";
  const verdict = String(result[yesField] ?? "unknown");
  const p = price(target, result);
  const reach = reachNumber(target, result);
  const budget = ctx.budgetTotal ?? 0;
  /* Rebuilt rather than stored on the row: it is a pure function of the same
     inputs the call was placed with, so it cannot drift from what the agent
     was told. */
  const mandate = buildMandate({
    estimatePkr: target.estimatePkr ?? null,
    durationDays: ctx.durationDays ?? null,
    otherLines: ctx.otherLines ?? null,
    kind: target.type,
  });

  let score = 0;
  if (verdict === "yes") score += 100;
  else if (verdict === "unknown") score += 20;
  if (p && p > 0) {
    score += Math.min(50, reach / p / 100);
    if (budget && p <= budget) score += 10;
  }

  return {
    name: target.name,
    type: target.type,
    channel: target.channel ?? "",
    verdict,
    price: p,
    rateBasis: String(result.rate_basis ?? ""),
    rateConfirmed: typeof result.rate_confirmed === "boolean" ? result.rate_confirmed : null,
    openingPrice: num(result.opening_rate),
    mandateTarget: mandate?.targetPkr ?? null,
    mandateWalkAway: mandate?.walkAwayPkr ?? null,
    concessions: readConcessions(result.concessions),
    confidenceLabel: "",
    evidence: [],
    reach,
    detail: detail(target, result),
    notes: String(result.notes ?? ""),
    score: Math.round(score * 10) / 10,
  };
}
