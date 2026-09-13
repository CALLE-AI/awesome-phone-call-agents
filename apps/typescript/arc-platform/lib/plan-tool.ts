/**
 * The media-selection call, expressed as a tool the model has to fill in.
 *
 * Telling the model "copy an id from the list above, character for character"
 * is an instruction, and instructions are advice. Twice in a row it answered
 * with station ids that are not in the catalogue, and the guard in
 * joinCatalogue threw the whole 82-second generation away - correctly, but
 * after the fact and after the scripts had been written too.
 *
 * A tool schema is not advice. Every id the model may return is an `enum` on
 * the field, `strict: true` makes the API validate the arguments against that
 * schema before it hands them back, and a value outside the enum is simply not
 * a thing the response can contain. The route still runs joinCatalogue
 * afterwards: the schema is the lock, the join is the check that the lock held.
 *
 * The enum is built from a SHORTLIST, not the whole catalogue - see
 * shortlist() in lib/catalogue.ts. Seventy-one ids is a large prompt and a
 * large decision; a dozen in the right city is the actual question.
 */
import type Anthropic from "@anthropic-ai/sdk";

import type { Catalogue } from "@/lib/catalogue";

export const SELECTION_TOOL = "submit_media_plan";

/** A whole-number percentage split. Kept with selection because it is a
 *  statement about the media mix, not about the creative. */
const BUDGET_SPLIT = {
  type: "object" as const,
  properties: {
    radio: { type: "integer" as const, description: "percent of budget on radio" },
    influencer: { type: "integer" as const, description: "percent on creators" },
    platformFee: { type: "integer" as const, description: "percent platform fee" },
  },
  required: ["radio", "influencer", "platformFee"],
  additionalProperties: false,
};

export function buildSelectionTool(cat: Catalogue): Anthropic.Tool {
  const stationIds = cat.stations.map((s) => s.stationId);
  const creatorIds = cat.creators.map((c) => c.id);

  const properties: Record<string, unknown> = { budgetAllocation: BUDGET_SPLIT };
  const required: string[] = ["budgetAllocation"];

  /* An empty enum is not a schema the API will take, and a brief whose
     channels exclude radio should not be offered stations at all. Absent, not
     empty - the model is never shown a field it has nothing to put in. */
  if (stationIds.length) {
    properties.stations = {
      type: "array",
      description: "3-5 stations, best first. Fewer is fine; never pad.",
      items: {
        type: "object",
        properties: {
          stationId: { type: "string", enum: stationIds },
          recommendedSlots: { type: "array", items: { type: "string" } },
          audienceMatchScore: { type: "integer", description: "0-100" },
          rationale: { type: "string", description: "why this station, for THIS brief" },
        },
        required: ["stationId", "recommendedSlots", "audienceMatchScore", "rationale"],
        additionalProperties: false,
      },
    };
    required.push("stations");
  }

  if (creatorIds.length) {
    properties.creators = {
      type: "array",
      description: "4-6 creators, best first. Fewer is fine; never pad.",
      items: {
        type: "object",
        properties: {
          id: { type: "string", enum: creatorIds },
          matchScore: { type: "integer", description: "0-100" },
          matchRationale: { type: "string", description: "why this creator, for THIS brief" },
        },
        required: ["id", "matchScore", "matchRationale"],
        additionalProperties: false,
      },
    };
    required.push("creators");
  }

  return {
    name: SELECTION_TOOL,
    description:
      "Submit the media half of the plan: which stations and creators to buy, " +
      "in what order, why, and how to split the budget. Names, cities, audience " +
      "figures and rates are held on our side and filled in after you answer - " +
      "return ids and judgement only.",
    /* Validated by the API against the schema above, so the enum is enforced
       rather than requested. */
    strict: true,
    input_schema: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    } as Anthropic.Tool["input_schema"],
  };
}

/**
 * The tool's arguments in the shape the rest of the plan already speaks.
 *
 * Deliberately tolerant of a missing array: a radio-only brief returns no
 * `creators` field at all, and that is a correct answer rather than a
 * malformed one.
 */
export function selectionToPlan(input: unknown): Record<string, unknown> {
  const raw = (input ?? {}) as Record<string, unknown>;
  return {
    stationRecommendations: Array.isArray(raw.stations) ? raw.stations : [],
    influencerMatches: Array.isArray(raw.creators) ? raw.creators : [],
    budgetAllocation: raw.budgetAllocation ?? { radio: 55, influencer: 35, platformFee: 10 },
  };
}
