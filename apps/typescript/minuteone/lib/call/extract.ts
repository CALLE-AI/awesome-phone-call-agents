import Anthropic from "@anthropic-ai/sdk";
import type { JsonSchema } from "./provider";

/** Cheap/fast model — this is a bounded extraction task, not open-ended generation. */
const MODEL = "claude-haiku-4-5-20251001";

export interface CallText {
  summary: string;
  transcript: string | null;
}

/**
 * CALL-E's real API has no structured-output parameter (see calle.ts) — the qualification
 * answers only ever come back as prose in `summary`/`transcript`. This turns that prose back
 * into the flat JSON shape dispatch.ts's scoreAnswers()/mapResult() expect, using the same
 * resultSchema task-builder.ts already builds from the business config.
 */
export async function extractStructuredAnswers(
  resultSchema: JsonSchema,
  callText: CallText,
): Promise<Record<string, unknown>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — required to extract structured answers from real CALL-E " +
        "calls. See .env.example.",
    );
  }

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: buildPrompt(resultSchema, callText) }],
  });

  const text = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  )?.text;
  if (!text) throw new Error("Extraction call returned no text content.");

  return parseJsonObject(text);
}

function buildPrompt(resultSchema: JsonSchema, callText: CallText): string {
  const properties = (resultSchema.properties ?? {}) as Record<string, JsonSchema>;
  const fieldLines = Object.entries(properties).map(([key, schema]) => {
    const enumValues = schema.enum as string[] | undefined;
    const type = enumValues ? `one of: ${enumValues.join(", ")}` : String(schema.type ?? "string");
    return `- "${key}" (${type}): ${String(schema.description ?? "")}`;
  });

  return [
    "You extract structured answers from a phone call transcript for a lead-qualification app.",
    "Read the call summary and transcript below and output ONLY a single JSON object with",
    "exactly these fields (no markdown fences, no commentary, no extra fields):",
    ...fieldLines,
    "",
    "If a field's value truly cannot be determined from the call, use null for that field.",
    "Match single-select fields to the closest listed option even if the caller's wording was",
    'informal or slightly mistranscribed (e.g. "repay" clearly means "repair").',
    "",
    `Call summary: ${callText.summary}`,
    "",
    `Call transcript:\n${callText.transcript ?? "(no transcript available)"}`,
  ].join("\n");
}

function parseJsonObject(text: string): Record<string, unknown> {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  const parsed: unknown = JSON.parse(cleaned);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Extraction did not return a JSON object.");
  }
  return parsed as Record<string, unknown>;
}
