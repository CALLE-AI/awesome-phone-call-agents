/**
 * The negotiation mandate (C-03).
 *
 * This shipped once before and was pulled out on 2 September. That version had
 * the agent negotiating with nothing checking the number it came back with,
 * and it returned `rate: 8000` - a real figure for a different deliverable,
 * confidently wrong and schema-valid. The operator's ruling was that a wrong
 * number that passes validation is worse than no number, and the mandate came
 * out rather than the gate going in.
 *
 * The gate went in afterwards and worked: a rate read back digit by digit,
 * an explicit ask, an affirmative, `rate_confirmed: true`. So the mandate
 * returns
 * ON TOP of that, never in place of it. Everything here is about which price
 * to ask for; nothing here decides whether a number was heard correctly. That
 * is still NUMBERS in lib/calle-media.ts, untouched.
 *
 * A note on "floor". The brief calls it a walk-away floor; every rule about it
 * describes a ceiling on what we will pay ("never commit below it", "if it
 * goes past it, say you will confirm internally and close"). It is modelled
 * here as the walk-away point - the most we will agree to - because that is
 * what the policy actually asks for.
 */

export interface NegotiationMandate {
  /** What we want to pay. The opening position, not the limit. */
  targetPkr: number;
  /** The walk-away point: the most the agent may agree to. Past this it must
   *  not commit, whatever is offered. */
  walkAwayPkr: number;
  /** What we can offer in exchange for a better rate, in the order to try. */
  levers: NegotiationLever[];
  /** Written out for the transcript, so a concession is a thing we sanctioned
   *  rather than something the agent improvised. */
  allowedConcessions: string[];
}

export interface NegotiationLever {
  key: "volume" | "flight" | "bundle";
  /** The offer, in the agent's own words. */
  offer: string;
}

export interface MandateInput {
  /** The catalogue's rate estimate for this line, when we hold one. */
  estimatePkr?: number | null;
  /** Flight length, which is what makes a volume offer concrete. */
  durationDays?: number | null;
  /** How many other lines this campaign is buying - a bundle is only a real
   *  lever when there is something to bundle with. */
  otherLines?: number | null;
  kind: "station" | "creator";
}

/** Rounded to something a person would actually say out loud. */
const say = (n: number) => Math.round(n / 500) * 500;

/**
 * Build the mandate.
 *
 * With no estimate on file there is no mandate: most of the catalogue has no
 * rate, and a target invented from nothing is exactly the fiction this project
 * keeps removing. The call then runs as a plain enquiry, which is what it was
 * before C-03 and is still a useful call.
 */
export function buildMandate(input: MandateInput): NegotiationMandate | null {
  const estimate = input.estimatePkr ?? null;
  if (!estimate || estimate <= 0) return null;

  /* Open below the estimate and walk away above it. The estimate is our own
     reference price, so it belongs between the two rather than at either end. */
  const targetPkr = Math.max(500, say(estimate * 0.85));
  const walkAwayPkr = say(estimate * 1.15);

  const weeks = Math.max(1, Math.round((input.durationDays ?? 30) / 7));
  const levers: NegotiationLever[] = [];

  levers.push({
    key: "volume",
    offer:
      input.kind === "station"
        ? `six spots a week for ${weeks} week${weeks === 1 ? "" : "s"}`
        : `a package of three posts rather than one`,
  });

  levers.push({
    key: "flight",
    offer:
      input.kind === "station"
        ? `committing to the full ${weeks}-week flight up front rather than week by week`
        : `booking across the whole campaign window rather than a single date`,
  });

  /* Only offered when there is genuinely something else in the plan. An agent
     promising a bundle we are not buying is making a commitment on our
     behalf. */
  if ((input.otherLines ?? 0) > 0) {
    levers.push({
      key: "bundle",
      offer:
        input.kind === "station"
          ? `placing other stations in the same campaign through them where they carry them`
          : `working with other creators on the same campaign through the same manager`,
    });
  }

  return {
    targetPkr,
    walkAwayPkr,
    levers,
    allowedConcessions: levers.map((l) => l.offer),
  };
}

/**
 * The mandate as instructions, appended AFTER the rules about money.
 *
 * Order matters and is load-bearing: the agent reads how to hear a number
 * correctly, and only then what price to push for. The text below never
 * mentions reading back, confirming, or recording - those belong to the gate
 * and saying them twice in different words is how two rules become one
 * muddle.
 */
export function mandatePrompt(m: NegotiationMandate, currency = "PKR"): string {
  const money = (n: number) => `${currency} ${n.toLocaleString()}`;
  const levers = m.levers
    .map((l, i) => `(${i + 1}) offer ${l.offer}`)
    .join(", then ");

  return (
    `You have room to negotiate on price, and you should use it. ` +
    `Ask for their rate FIRST and let them name it - never open with a number of your own. ` +
    `Our target is ${money(m.targetPkr)}, which is our own estimate and not a published rate - do not present it to them as what they charge or as a figure you have been quoted. ` +
    `If the rate they give is above the target, do not simply accept it and do not argue about ` +
    `the price on its own. Offer something in exchange, one thing at a time, and ask what it does ` +
    `to the price: ${levers}. Ask about the price again after each offer, for example "six spots ` +
    `a week for three weeks - what does that do to the rate?". ` +
    `Try at most TWO of these. If the second one does not move the price, stop negotiating and ` +
    `accept the number as their rate - pushing a third time on a line that has not moved wastes ` +
    `the call and sours the relationship. ` +
    `${money(m.walkAwayPkr)} is our walk-away. You must NEVER agree to, accept or commit to any ` +
    `price above ${money(m.walkAwayPkr)}, however it is presented. If their best price is still ` +
    `above it, do not refuse and do not haggle further - say "I will need to confirm that ` +
    `internally", thank them, and close the call. That is a good outcome, not a failed one. ` +
    `You are gathering a price, not signing a contract: never promise a booking, a budget, or a ` +
    `start date. ` +
    `Record every offer you made and what it did to the price, each one separately, in ` +
    `"concessions" - the sequence is what we need, not just the last number. Put the first rate ` +
    `they quoted in "opening_rate" and the rate you finished on in the rate field.`
  );
}

/** Negotiation fields, merged into whichever result schema the target uses. */
export const NEGOTIATION_SCHEMA_FIELDS = {
  /** The first price they named, before any offer was made. */
  opening_rate: { type: "number" },
  /** One entry per offer, in the order they were made. */
  concessions: {
    type: "array",
    items: {
      type: "object",
      properties: {
        offered: { type: "string" },
        response: { type: "string" },
        rate_after: { type: "number" },
      },
    },
  },
  /** Did their final price sit inside the mandate? */
  within_mandate: { type: "boolean" },
} as const;
