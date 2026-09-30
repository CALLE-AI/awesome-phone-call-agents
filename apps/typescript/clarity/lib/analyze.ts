/**
 * Stage 1 — ambiguity detection.
 *
 * One Gemini call with a constrained JSON response schema and high thinking
 * turns an application into 2–3 clarifications, each anchored to a verbatim
 * span of what the candidate actually wrote. Guardrails in `lib/guardrails.ts`
 * decide what survives.
 */
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { MAX_CLARIFICATIONS, applyGuardrails } from "./guardrails";
import type { AnalyzeResult, ApplicationInput } from "./types";

/** Override with GEMINI_MODEL to use another analyzer model. */
const DEFAULT_MODEL = "gemini-3.5-flash-lite";

const ProposedClarification = z.object({
  claim: z
    .string()
    .describe(
      "A span copied CHARACTER FOR CHARACTER from the resume or the written answers. Never paraphrase, never fix typos, never add or drop words.",
    ),
  topic: z
    .string()
    .describe(
      "Two to four words naming the SUBJECT of this claim. This is printed as the BEFORE side of the result, so it must be the shortest TRUE form of the claim — '98% CSAT', not 'Maintained 98% CSAT'; 'Production incidents'; 'Team size'. A noun phrase: no verb, no judgement, never a restatement of the whole claim.",
    ),
  need: z
    .string()
    .describe(
      "The ambiguity itself, written for a hiring manager to read rather than to be spoken: ONE question of at most twelve words that names the two things the claim could mean. Use the candidate's first name if you know it. E.g. \"Was 98% Devan's own score or the team's?\". Not a request for detail — a fork.",
    ),
  whyItMatters: z
    .string()
    .describe(
      "One sentence naming the specific job-description requirement this claim speaks to, and what a hiring manager still cannot tell from the written text.",
    ),
  question: z
    .string()
    .describe(
      "The single question the caller SPEAKS to open with. Under twenty words, conversational, quoting the candidate's own words back to them so they know what is being referred to — e.g. \"You mentioned 98% CSAT. Was that your own score or the team's?\". One question, not a list, and never two joined with 'and'.",
    ),
  probes: z
    .array(z.string())
    .describe(
      "Two or three follow-up questions to fall back on. The caller normally invents its follow-up from what the candidate actually said, so these are the ones worth reaching for when the answer gives it nothing to work with. Each must ask for one concrete thing: a number, a reporting line, a timeframe, or the split between personal and team work.",
    ),
  extract: z
    .array(z.string())
    .describe("Short names of the specific facts worth pulling out of the answer, e.g. 'direct reports vs. dotted line'."),
});

const AnalysisSchema = z.object({
  clarifications: z
    .array(ProposedClarification)
    .describe(`Between 2 and ${MAX_CLARIFICATIONS} clarifications, ordered most valuable first.`),
});

/** Gemini rejects unknown `$`-prefixed keys, and Zod always emits `$schema`. */
function responseJsonSchema(): unknown {
  const { $schema, ...schema } = z.toJSONSchema(AnalysisSchema) as Record<string, unknown>;
  return schema;
}

const SYSTEM_PROMPT = `You find the places where a job application is polished but imprecise, so a short phone call can turn them into facts.

You are given a job description, a resume, and the candidate's written answers. Return the 2 to ${MAX_CLARIFICATIONS} written claims where a single spoken question would change the picture the most.

Rank candidate ambiguities by JOB RELEVANCE multiplied by DECISION IMPACT — how much a hiring manager's understanding would move once the answer is known. Do NOT rank by how vague a sentence sounds. The first clarification you return is the only one that gets called about, so treat the top slot as the whole decision: it should be the claim where one spoken question, followed by one follow-up chosen from the answer, would change the picture most. Prefer a claim that could describe either this person or the people around them — a number, an ownership, a role — because that is the fork a phone call settles and a form cannot. A beautifully vague sentence about something the job does not need is worth nothing; a small imprecision at the centre of the role is worth everything.

The claims that are worth asking about share a shape: they are written in a way that is true under several very different realities, and those realities are not equally relevant to this job. "Led a team of six engineers" is true whether the person was their manager, their tech lead, or the person who ran the standup — and the job description cares which. Prefer those. Avoid claims that are merely brief, claims a resume screen already answers, and claims whose answer would not change anything.

Hard rules:
- \`claim\` MUST be copied character for character from the resume or the written answers. If you cannot copy it exactly, choose a different claim. This is checked against the submitted text, and an inexact claim is discarded.
- Never ask about age, nationality, citizenship, immigration or work-authorization status, marital or family status, pregnancy, health, disability, religion, ethnicity, gender, sexual orientation, or political affiliation. These are off-limits regardless of what the application says.
- Never produce a score, a rating, a rank of the candidate, a recommendation, or any judgment of their suitability. You are locating what is unknown, not assessing the person.
- Questions must be neutral and non-leading. Ask what happened, not whether they really did it.
- One question per clarification. Save the rest for \`probes\`.`;

function userPrompt(input: ApplicationInput): string {
  const name = input.candidateName?.trim();
  return [
    ...(name ? [`The candidate is ${name}.`, ""] : []),
    "<job_description>",
    input.jobDescription.trim(),
    "</job_description>",
    "",
    "<resume>",
    input.resume.trim(),
    "</resume>",
    "",
    "<written_answers>",
    input.answers.trim(),
    "</written_answers>",
    "",
    `Find the 2 to ${MAX_CLARIFICATIONS} claims most worth a phone call, MOST VALUABLE FIRST. Only the first one is called about, so the ordering is the decision — put the claim whose answer would move a hiring manager most at the top.`,
  ].join("\n");
}

function geminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenAI({ apiKey });
}

export async function analyze(
  input: ApplicationInput,
  client = geminiClient(),
): Promise<AnalyzeResult> {
  const first = await requestClarifications(client, input);
  let outcome = applyGuardrails(first, input);

  // One retry: a dropped claim usually means the model paraphrased instead of
  // copying, and naming the exact failure is enough to fix it.
  if (outcome.kept.length < 2) {
    const retry = await requestClarifications(client, input, outcome.rejected);
    const retried = applyGuardrails(retry, input);
    if (retried.kept.length > outcome.kept.length) {
      outcome = { kept: retried.kept, rejected: [...outcome.rejected, ...retried.rejected] };
    }
  }

  return { clarifications: outcome.kept, rejected: outcome.rejected };
}

async function requestClarifications(
  client: GoogleGenAI,
  input: ApplicationInput,
  previouslyRejected: Array<{ claim: string; reason: string }> = [],
) {
  const notes = correctionNotes(previouslyRejected);
  const prompt = notes ? `${userPrompt(input)}\n\n${notes}` : userPrompt(input);

  const response = await client.models.generateContent({
    model: process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
    contents: prompt,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseJsonSchema: responseJsonSchema(),
      thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
      maxOutputTokens: 16000,
    },
  });

  const blocked = response.promptFeedback?.blockReason;
  if (blocked) throw new Error(`The analyzer declined this application (${blocked}).`);

  const finishReason = response.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== "STOP") {
    throw new Error(`The analyzer stopped early (${finishReason}).`);
  }

  const text = response.text;
  if (!text) throw new Error("The analyzer returned no content.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The analyzer returned malformed JSON.");
  }

  // The response schema constrains the shape, but validating it here is what
  // lets a bad response fail loudly instead of half-rendering.
  const result = AnalysisSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`The analyzer returned an unexpected shape: ${result.error.issues[0]?.message}`);
  }

  return result.data.clarifications;
}

/** Names the exact guardrail failure so the retry can correct it. */
function correctionNotes(rejected: Array<{ claim: string; reason: string }>): string | null {
  if (rejected.length === 0) return null;
  const lines = rejected.flatMap((r) => {
    if (r.reason === "not-verbatim") {
      return [
        `- "${r.claim}" does not appear character for character in the application. Copy an exact span, or choose a different claim.`,
      ];
    }
    if (r.reason === "sensitive-attribute") {
      return [`- "${r.claim}" touched a protected personal attribute and was discarded.`];
    }
    return [];
  });
  if (lines.length === 0) return null;
  return ["A previous attempt was rejected for these reasons. Avoid them:", ...lines].join("\n");
}
