/** CALL-E client, task brief, and structured result schema. */
import { CalleClient } from "@call-e/calle";
import type { Clarification } from "./types";

/**
 * The opening line is fixed and must be spoken verbatim: it identifies the
 * caller as an AI, states the purpose, and takes consent before any question is
 * asked. It is also the first thing in the call record, which is the only
 * artifact the result screen can show.
 */
export const OPENING_LINE =
  "Hi, I'm an AI assistant calling on behalf of the hiring team with a few " +
  "follow-up questions about your application. Is now a good time for a brief call?";

export function calleClient(): CalleClient {
  const origin = "https://api.heycall-e.com";
  const configured = process.env.CALLE_BASE_URL || origin;
  if (configured !== origin && configured !== `${origin}/`) {
    throw new Error("CALL-E credentials require https://api.heycall-e.com.");
  }
  const apiKey = process.env.CALLE_API_KEY;
  if (!apiKey) throw new Error("CALLE_API_KEY is not set");
  return new CalleClient({
    apiKey,
    baseUrl: origin,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.origin !== origin || url.username || url.password) {
        throw new Error("Unapproved CALL-E origin.");
      }
      return fetch(new Request(request, { redirect: "error", signal: AbortSignal.timeout(30_000) }));
    },
  });
}

// ---------------------------------------------------------------------------
// Task composition
// ---------------------------------------------------------------------------

/**
 * The line CALL-E ends on once it has what it came for. Fixed, because the
 * whole promise of this call is that it is short: a caller that trails off into
 * pleasantries has already broken it.
 */
export const CLOSING_LINE = "Thanks, that's all I needed.";

/**
 * The brief for one claim.
 *
 * This call asks about a single ambiguity and then stops. The value it
 * demonstrates is not coverage, it is the SECOND question: which follow-up is
 * worth asking cannot be known until the candidate answers the first one, which
 * is exactly what a form cannot do. So the brief scripts the opening question
 * word for word, refuses to script the follow-up, and says when to hang up.
 */
export function buildTask(
  clarification: Clarification,
  opts: { candidateName?: string; roleTitle?: string } = {},
): string {
  const who = opts.candidateName ? ` The person you are calling is ${opts.candidateName}.` : "";
  const role = opts.roleTitle ? ` They applied for the role of ${opts.roleTitle}.` : "";
  const probes = clarification.probes.map((probe) => `- ${probe}`).join("\n");

  return [
    `You are calling a job candidate about ONE specific thing they wrote in their application.${who}${role} This is a two-question call and should last well under two minutes.`,
    ``,
    `Open with exactly this line, word for word:`,
    `"${OPENING_LINE}"`,
    ``,
    `If they say it is not a good time, or they decline, thank them warmly, tell them someone will follow up later, and end the call. Do not ask the question below in that case.`,
    ``,
    `They wrote: "${clarification.claim}"`,
    ``,
    `If they agree, ask this and only this, word for word:`,
    `"${clarification.question}"`,
    ``,
    `THEN ASK EXACTLY ONE FOLLOW-UP, AND CHOOSE IT FROM WHAT THEY JUST SAID.`,
    `This is the only reason the call exists. The follow-up is not scripted, because the right one depends on their answer:`,
    `- If they attribute the claim to a team, a queue, a pod, a manager or anyone other than themselves, ask for their own figure or their own part. That is the whole point.`,
    `- If the answer is about them but carries no number, no name, no timeframe and no scale, ask for the one that is missing.`,
    `- If the answer does not address the question at all, ask the same question again in a narrower form, one whose answer is a number or a name.`,
    `These are the follow-ups worth reaching for if none of the above fits:`,
    probes,
    ``,
    `The call is done once you know: ${clarification.extract.join("; ")}.`,
    `Then say "${CLOSING_LINE}" Thank them for their time and end the call.`,
    ``,
    `How to conduct the call:`,
    `- Ask two questions. The scripted one, then one follow-up. Ask a third only if the follow-up was not answered at all. This is not an interview and you are not gathering their background.`,
    `- What you are after is a specific: a number, a name, a reporting line, a date, or a plain statement of what this person did themselves. A pleasant answer containing none of those has not answered the question.`,
    `- Ask exactly one thing at a time. Never join two questions with "and" — a compound question gets you one answer to whichever half they happened to hear, and you will not know which.`,
    `- Statements about communication, collaboration, culture, or effort are never answers to questions about structure, ownership, or personal contribution. If you get one, acknowledge it briefly and ask the narrower question again.`,
    `- Let them finish speaking before you reply. If they trail off or pause mid-sentence, wait a beat; they are still thinking. Never speak over them.`,
    `- If an answer is garbled or you are not confident you heard it correctly, say what you think you heard and ask them to confirm. A misheard answer recorded as fact is worse than no answer.`,
    `- Do not pad. No small talk, no recap of their resume, no closing questions about the role. When you have the answer, close.`,
    `- Speak English throughout.`,
    `- Do not evaluate them, do not judge their answer, and do not hint at any hiring outcome. You are collecting one fact, not assessing a person.`,
    `- Do not ask about age, nationality, immigration or family status, health, disability, religion, or any other personal characteristic, even if they raise it themselves.`,
  ].join("\n");
}

/**
 * One strict object, keyed by the clarification's id.
 *
 * `corrected`, `correction` and `basis` are the result screen — the whole of
 * it. They are asked for here rather than derived from `answer`, because
 * reducing "ninety-six percent, on about forty-five surveys that came back" to
 * `96% personal` and `45 surveys` is a judgment about what the candidate meant,
 * and the thing that just heard them say it is better placed to make it than a
 * regular expression over the transcript.
 *
 * CALL-E supports nested `object` fields, `enum`, `required` and
 * `additionalProperties: false`; it does not support `$ref`/`oneOf`/`anyOf`, so
 * the schema is spelled out flat.
 */
export function buildResultSchema(clarification: Clarification) {
  const before = clarification.topic?.trim() || clarification.claim;

  return {
    type: "object",
    properties: {
      [clarification.id]: {
        type: "object",
        description: `What the candidate said about their written claim: "${clarification.claim}"`,
        properties: {
          corrected: {
            type: "string",
            description:
              `The corrected fact, in at most five words, as it would be printed in large type next to the written claim "${before}". Lead with the number or the noun and qualify it: "96% personal", "responder, not incident commander", "two of the six". No verb phrase, no sentence, no hedging. If they never addressed it, write "Not answered".`,
          },
          correction: {
            type: "string",
            description:
              `What the written claim "${before}" turned out to actually describe, in at most eight words: "98% was the team metric", "the duty manager ran the bridge". This is the line that explains why the corrected fact differs from what was written. Empty string if the written claim turned out to be exactly right.`,
          },
          basis: {
            type: "string",
            description:
              "The scale, sample or scope the corrected fact rests on, in at most six words: \"45 surveys\", \"across 2 incidents\", \"over FY2025\". Empty string if they gave none.",
          },
          headline: {
            type: "string",
            description:
              `A single line of 6 to 14 words replacing the written claim "${clarification.claim}" with what the candidate actually described. State it flatly. No hedging, no praise, no judgement of the person, and no restating of the vague original. If they did not address it, write 'Not answered on this call.'`,
          },
          answer: {
            type: "string",
            description:
              "One or two sentences stating the corrected, precise version of the written claim, based only on what the candidate actually said. If they did not address it, write 'Not answered.'",
          },
          specifics: {
            type: "string",
            description: `The concrete details they gave, covering where possible: ${clarification.extract.join("; ")}. Write 'None given.' if they stayed general.`,
          },
          still_unclear: {
            type: "string",
            description:
              "What this call did NOT resolve about the claim. Be concrete and specific. Write 'Nothing.' only when the claim is now fully pinned down.",
          },
          open_question: {
            type: "string",
            description:
              "The single most important thing still unknown, as a short question of at most 10 words. Empty string when `still_unclear` is 'Nothing.'",
          },
          quote: {
            type: "string",
            description:
              "The candidate's own words that best support `answer`, copied verbatim from what they said on the call — not paraphrased, and not the AI caller's words. Empty string if they never addressed this.",
          },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low"],
            description:
              "How directly the candidate's own words support `answer`. Use 'high' only when they stated it plainly, 'low' when it is inferred from an indirect or evasive answer.",
          },
        },
        required: [
          "corrected",
          "correction",
          "basis",
          "headline",
          "answer",
          "specifics",
          "still_unclear",
          "open_question",
          "quote",
          "confidence",
        ],
        additionalProperties: false,
      },
    },
    required: [clarification.id],
    additionalProperties: false,
  };
}
