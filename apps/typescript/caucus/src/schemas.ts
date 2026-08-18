/**
 * CALL-E result-schema builders and tolerant result parsers.
 *
 * Two layers, deliberately separate:
 *
 *  1. JSON-schema builders (`consentSchema`, `offerRelaySchema`, `attestationSchema`)
 *     produce the STRICT SUBSET of JSON Schema that CALL-E's extraction model
 *     accepts: `type` (object/string/number/integer/boolean/array), `properties`,
 *     `required`, `enum`, `description`, `additionalProperties:false`, and simple
 *     (single-schema) array `items`. No `$ref`/`oneOf`/`anyOf`/`allOf`/`format`.
 *     Field descriptions are prompt material for the extraction model — they are
 *     written to force explicitness ("unknown" over guessing) and provenance
 *     (verbatim quotes over paraphrase).
 *
 *  2. zod parsers (`parseConsent`, `parseOffer`, `parseAttestation`) validate the
 *     `structured` payload CALL-E returns. Model output is untrusted: parsers
 *     return `null` on any mismatch and never throw.
 *
 * `validateStrictSubset` walks an arbitrary schema and throws listing every
 * violation — a guardrail so no rendered call can ship a schema CALL-E rejects.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Strict-subset validation
// ---------------------------------------------------------------------------

const ALLOWED_TYPES = new Set(["object", "string", "number", "integer", "boolean", "array"]);
const COMMON_KEYWORDS = ["type", "description", "enum"] as const;
const KEYWORDS_BY_TYPE: Record<string, ReadonlySet<string>> = {
  object: new Set([...COMMON_KEYWORDS, "properties", "required", "additionalProperties"]),
  array: new Set([...COMMON_KEYWORDS, "items"]),
  string: new Set(COMMON_KEYWORDS),
  number: new Set(COMMON_KEYWORDS),
  integer: new Set(COMMON_KEYWORDS),
  boolean: new Set(COMMON_KEYWORDS),
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function enumMemberMatchesType(member: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof member === "string";
    case "number":
      return typeof member === "number";
    case "integer":
      return typeof member === "number" && Number.isInteger(member);
    case "boolean":
      return typeof member === "boolean";
    default:
      return false;
  }
}

function walk(node: unknown, path: string, out: string[]): void {
  if (!isPlainObject(node)) {
    out.push(`${path}: schema node must be a plain object`);
    return;
  }

  const type = node["type"];
  if (typeof type !== "string" || !ALLOWED_TYPES.has(type)) {
    out.push(
      `${path}.type: must be one of ${[...ALLOWED_TYPES].join("/")} (got ${JSON.stringify(type)})`,
    );
    // Without a usable type we still flag unknown keywords against the common set.
  }
  const allowed = (typeof type === "string" && KEYWORDS_BY_TYPE[type]) || new Set(COMMON_KEYWORDS);

  for (const key of Object.keys(node)) {
    if (!allowed.has(key)) {
      out.push(`${path}.${key}: keyword not in CALL-E strict subset`);
    }
  }

  const description = node["description"];
  if (description !== undefined && typeof description !== "string") {
    out.push(`${path}.description: must be a string`);
  }

  const enumValue = node["enum"];
  if (enumValue !== undefined) {
    if (!Array.isArray(enumValue) || enumValue.length === 0) {
      out.push(`${path}.enum: must be a non-empty array`);
    } else if (typeof type === "string") {
      for (const [i, member] of enumValue.entries()) {
        if (!enumMemberMatchesType(member, type)) {
          out.push(`${path}.enum[${i}]: member ${JSON.stringify(member)} does not match type "${type}"`);
        }
      }
    }
  }

  if (type === "object") {
    if (node["additionalProperties"] !== false) {
      out.push(`${path}.additionalProperties: must be exactly false on object nodes`);
    }
    const properties = node["properties"];
    if (!isPlainObject(properties)) {
      out.push(`${path}.properties: object nodes must declare properties`);
    } else {
      for (const [name, child] of Object.entries(properties)) {
        walk(child, `${path}.properties.${name}`, out);
      }
      const required = node["required"];
      if (required !== undefined) {
        if (!Array.isArray(required) || required.some((r) => typeof r !== "string")) {
          out.push(`${path}.required: must be an array of strings`);
        } else {
          for (const name of required as string[]) {
            if (!(name in properties)) {
              out.push(`${path}.required: "${name}" is not a declared property`);
            }
          }
        }
      }
    }
  }

  if (type === "array") {
    const items = node["items"];
    if (items === undefined) {
      out.push(`${path}.items: array nodes must declare simple items`);
    } else if (Array.isArray(items)) {
      out.push(`${path}.items: tuple form is not in the strict subset (single schema only)`);
    } else {
      walk(items, `${path}.items`, out);
    }
  }
}

/** Collects every strict-subset violation in `schema` (empty array = valid). */
export function strictSubsetViolations(schema: unknown): string[] {
  const violations: string[] = [];
  walk(schema, "$", violations);
  return violations;
}

/** Asserts `schema` uses only the CALL-E strict subset; throws listing all violations. */
export function validateStrictSubset(schema: unknown): void {
  const violations = strictSubsetViolations(schema);
  if (violations.length > 0) {
    throw new Error(
      `schema violates CALL-E strict subset (${violations.length} problem${violations.length === 1 ? "" : "s"}):\n` +
        violations.map((v) => `  - ${v}`).join("\n"),
    );
  }
}

// ---------------------------------------------------------------------------
// Schema builders
// ---------------------------------------------------------------------------

/** Result schema for a consent call: was explicit consent given to participate? */
export function consentSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["consent", "concerns"],
    properties: {
      consent: {
        type: "string",
        enum: ["yes", "no", "unknown"],
        description:
          'Whether the callee gave explicit, unambiguous verbal consent to participate in ' +
          'mediation phone calls about this dispute. Use "yes" ONLY if the callee clearly and ' +
          'affirmatively agreed in their own words (for example "yes, I agree to take these calls"). ' +
          'Use "no" if the callee refused or asked not to be called. Use "unknown" whenever the ' +
          "response was unclear, conditional, merely implied, or the callee never directly answered. " +
          "Never infer consent from politeness or from the callee simply staying on the line.",
      },
      concerns: {
        type: "string",
        description:
          "Any concerns, questions, or conditions the callee raised about the mediation process, " +
          "as close to their own words as possible. Empty string if they raised none.",
      },
    },
  };
}

/**
 * Result schema for a shuttle (offer relay) call.
 * `maxDollars` bounds the plausible amount and is surfaced to the extraction
 * model in the field description.
 */
export function offerRelaySchema(maxDollars: number): Record<string, unknown> {
  if (!Number.isFinite(maxDollars) || maxDollars < 0) {
    throw new TypeError(`offerRelaySchema: maxDollars must be a finite non-negative number, got ${maxDollars}`);
  }
  return {
    type: "object",
    additionalProperties: false,
    required: ["offer_kind", "amount_dollars", "conditions", "public_rationale", "verbatim_quote"],
    properties: {
      offer_kind: {
        type: "string",
        enum: ["open", "counter", "accept", "reject", "unknown"],
        description:
          'The negotiation move THIS callee made on THIS call. "open" = they proposed a settlement ' +
          'amount unprompted by any relayed proposal. "counter" = they proposed a different amount in ' +
          'response to the relayed proposal. "accept" = they explicitly agreed to the relayed proposal ' +
          'as stated. "reject" = they refused the relayed proposal without naming a new amount. ' +
          '"unknown" = the callee was ambiguous, off-topic, or made no clear negotiation move. ' +
          'When in doubt, use "unknown" — never guess a move the callee did not clearly make.',
      },
      amount_dollars: {
        type: "number",
        description:
          "The settlement amount in US dollars that THIS callee themselves proposed or explicitly " +
          `accepted on this call, between 0 and ${maxDollars}. This is never an amount that was merely ` +
          "relayed, read out, or mentioned to them — count it only if the callee proposed it or " +
          "explicitly accepted it in their own words. Use 0 when the callee stated no amount.",
      },
      conditions: {
        type: "array",
        description:
          "Non-monetary conditions the callee attached to their offer or acceptance, one condition " +
          'per array item, as close to verbatim as possible (for example "tenant returns the garage ' +
          'remote"). Empty array if they attached none.',
        items: {
          type: "string",
          description: "One non-monetary condition, in the callee's own words.",
        },
      },
      public_rationale: {
        type: "string",
        description:
          "Reasoning the callee explicitly agreed may be shared with the other party (for example " +
          '"the carpet was damaged"). Empty string if the callee gave no rationale or asked for it ' +
          "to stay private. Never include anything the callee marked as private.",
      },
      verbatim_quote: {
        type: "string",
        description:
          "The exact sentence the callee spoke that contains the dollar amount, word for word from " +
          "the call — no paraphrasing, no cleanup. Empty string if the callee stated no amount.",
      },
    },
  };
}

/** Result schema for an attestation call: read-back of settlement terms plus a spoken phrase. */
export function attestationSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["phrase_spoken", "agrees_to_terms"],
    properties: {
      phrase_spoken: {
        type: "string",
        description:
          "The attestation code the callee read back, captured exactly as they said it — digits, " +
          'number words, or a mix (for example "739241", "7 3 9 2 4 1", or "seven three nine two ' +
          'four one"). If the callee made SEVERAL attempts, record only their FINAL COMPLETE ' +
          "attempt — the last one where they read the whole code through — not a fragment they " +
          "were cut off in the middle of, and not an earlier attempt they then corrected. Ignore " +
          "anything code-like the callee said BEFORE you first read the code aloud; they could not " +
          "have known it yet. Do not paraphrase, correct, reorder, complete, or reformat what they " +
          "said, and never substitute the code you read to them: a mismatched code is meaningful " +
          "and is checked against the settlement terms. Empty string if the callee never attempted " +
          "the code.",
      },
      agrees_to_terms: {
        type: "string",
        enum: ["yes", "no", "unknown"],
        description:
          'Use "yes" ONLY if the callee explicitly confirmed agreement to the settlement terms as ' +
          'read back to them on this call. Use "no" if they refused or disputed any term. Use ' +
          '"unknown" if their answer was unclear or the call ended before they confirmed.',
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Result parsers — model output is untrusted; null on mismatch, never throw
// ---------------------------------------------------------------------------

const yesNoUnknown = z.enum(["yes", "no", "unknown"]);

const consentResult = z.object({
  consent: yesNoUnknown,
  concerns: z.string(),
});

const offerRelayResult = z.object({
  offer_kind: z.enum(["open", "counter", "accept", "reject", "unknown"]),
  amount_dollars: z.number().nonnegative(),
  conditions: z.array(z.string()),
  public_rationale: z.string(),
  verbatim_quote: z.string(),
});

const attestationResult = z.object({
  phrase_spoken: z.string(),
  agrees_to_terms: yesNoUnknown,
});

export type ConsentResult = z.infer<typeof consentResult>;
export type OfferRelayResult = z.infer<typeof offerRelayResult>;
export type AttestationResult = z.infer<typeof attestationResult>;

/** Parses a consent-call structured result; null on any mismatch. */
export function parseConsent(structured: unknown): ConsentResult | null {
  const parsed = consentResult.safeParse(structured);
  return parsed.success ? parsed.data : null;
}

/** Parses an offer-relay structured result; null on any mismatch. */
export function parseOffer(structured: unknown): OfferRelayResult | null {
  const parsed = offerRelayResult.safeParse(structured);
  return parsed.success ? parsed.data : null;
}

/** Parses an attestation structured result; null on any mismatch. */
export function parseAttestation(structured: unknown): AttestationResult | null {
  const parsed = attestationResult.safeParse(structured);
  return parsed.success ? parsed.data : null;
}
