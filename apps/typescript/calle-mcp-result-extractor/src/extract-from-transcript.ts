import type { z } from "zod";
import type { ReasoningProvider } from "./reasoning/types.js";

/**
 * CALL-E's MCP tool surface (plan_call / run_call / get_call_run) has no
 * result_schema parameter — that is a REST-API-only feature of the CALL-E
 * Developer API. Over MCP, the `extracted` field on a completed run is
 * always CALL-E's own generic call metadata, never output constrained to a
 * schema you supply. If your agent host talks to CALL-E over MCP (Claude
 * Code, Cowork-style agents, skills.sh-installed agents, or anything else
 * wired up as an MCP client) and you need a typed, validated result rather
 * than a wall of transcript text, you have to extract it yourself from the
 * transcript CALL-E does return. This function does that: given a
 * transcript and a Zod schema describing exactly what you need, it runs one
 * extraction pass through a reasoning provider and returns a value
 * guaranteed to satisfy the schema (or throws).
 */
export interface ExtractStructuredResultOptions<TSchema extends z.ZodTypeAny> {
  task: string;
  systemPrompt: string;
  transcript: string;
  questionsToResolve: string[];
  schema: TSchema;
}

export function buildExtractionPrompt(
  transcript: string,
  questionsToResolve: string[],
): string {
  return [
    "QUESTIONS THE CALL WAS SUPPOSED TO ANSWER:",
    questionsToResolve.map((q, i) => `${i + 1}. ${q}`).join("\n"),
    "",
    "TRANSCRIPT:",
    transcript,
    "",
    "Extract the structured result from this transcript.",
  ].join("\n");
}

export async function extractStructuredResult<TSchema extends z.ZodTypeAny>(
  reasoning: ReasoningProvider,
  options: ExtractStructuredResultOptions<TSchema>,
): Promise<z.infer<TSchema>> {
  return reasoning.complete({
    task: options.task,
    systemPrompt: options.systemPrompt,
    userPrompt: buildExtractionPrompt(options.transcript, options.questionsToResolve),
    schema: options.schema,
  });
}

/**
 * A reasonable default system prompt for transcript extraction: read
 * literally, never fabricate, unknown stays unknown. Pass your own if your
 * domain needs different framing — this is a sane starting point, not a
 * requirement.
 */
export const DEFAULT_EXTRACTION_SYSTEM_PROMPT = `You extract structured findings from a real
phone-call transcript. Read the transcript literally — do not infer facts that were not said.
Unknown data must remain unknown: use null for any field the transcript does not clearly answer.
Never fabricate identifiers, reference numbers, dates, or outcomes that were not actually stated
on the call.`;
