import { INTERVIEW_BRANCHES } from "./call-instructions.ts";
export type TranscriptTurn = {
  id: string;
  runId: number;
  recipient: number;
  attempt: number;
  index: number;
  speaker: "respondent" | "assistant" | "unknown";
  text: string;
  offsetSeconds: number | null;
};
export type Citation = {
  status: "matched" | "ambiguous" | "unmatched" | "missing_transcript";
  turnIds: string[];
};
export type EvidenceStatement = {
  fact: string;
  source_type: string;
  certainty: string;
  evidence_quote: string;
};
export type QuotedItem = { text: string; quote: string };
export type EvidenceLead = { name: string; reason: string; quote: string };
export type BranchResult = {
  id: string;
  status: string;
  evidence_quote: string;
};
export type EvidenceRecord = {
  profile: "evidence-v2" | "compact-legacy" | "synthetic-legacy";
  outcome: string;
  knowledge_period: string;
  knowledge_quote: string;
  statements: EvidenceStatement[];
  limitations: string;
  unknowns: string;
  limitation_items: QuotedItem[];
  unknown_items: QuotedItem[];
  leads: EvidenceLead[];
  branches: BranchResult[];
  human_review_required: "yes";
};
const string = { type: "string" };
const quotedItemSchema = {
  type: "object",
  additionalProperties: false,
  required: ["text", "quote"],
  properties: {
    text: string,
    quote: {
      type: "string",
      description:
        "Exact respondent quote establishing this limitation or unknown. Never invent an access restriction.",
    },
  },
};
export const CALL_EVIDENCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "outcome",
    "knowledge_period",
    "statements",
    "limitations",
    "unknowns",
    "new_leads",
    "branch_results",
    "human_review_required",
  ],
  properties: {
    schema_version: { type: "string", enum: ["evidence-v2"] },
    outcome: {
      type: "string",
      enum: [
        "resolved",
        "bounded",
        "unresolved",
        "human_follow_up",
        "declined",
        "unknown",
      ],
      description:
        "Proposed interview contribution only, never a case disposition. Use unknown if classification is unsupported; bounded requires explicit knowledge limits. Unasked applicable questions prevent resolved.",
    },
    knowledge_period: {
      type: "object",
      additionalProperties: false,
      required: ["value", "quote"],
      properties: {
        value: {
          type: "string",
          description:
            "Respondent-stated years, preserving around/I think and excluded periods. Unknown if not established. Do not copy expected years from the brief.",
        },
        quote: {
          type: "string",
          description:
            "One exact quotation from a single respondent turn establishing their knowledge period. Keep the original date wording, including shortened years such as '94. Never combine answers, add separators, expand dates, or paraphrase. Put any combined interpretation in value instead. Return an empty string if no single supporting turn exists.",
        },
      },
    },
    statements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fact", "source_type", "certainty", "evidence_quote"],
        properties: {
          fact: {
            type: "string",
            description:
              "One respondent-attributed factual claim. Keep separate material facts in separate items, at most 15.",
          },
          source_type: {
            type: "string",
            enum: [
              "first_hand",
              "hearsay",
              "record",
              "assumption",
              "knowledge_limitation",
              "unknown",
            ],
          },
          certainty: {
            type: "string",
            enum: ["confirmed", "uncertain", "unknown"],
          },
          evidence_quote: {
            type: "string",
            description:
              "An exact short quote spoken by the respondent supporting this claim. Do not use the interviewer's words or a paraphrase.",
          },
        },
      },
    },
    limitations: { type: "array", items: quotedItemSchema },
    unknowns: { type: "array", items: quotedItemSchema },
    new_leads: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "reason", "quote"],
        properties: {
          name: {
            type: "string",
            description:
              "Person actually identified by the respondent, not a suggested search or inferred contact.",
          },
          reason: string,
          quote: string,
        },
      },
    },
    branch_results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "status", "evidence_quote"],
        properties: {
          id: {
            type: "string",
            description: "One branch ID from the approved brief.",
          },
          status: {
            type: "string",
            enum: [
              "answered",
              "unknown",
              "not_asked",
              "not_applicable",
              "declined",
              "escalated",
            ],
          },
          evidence_quote: {
            type: "string",
            description:
              "Exact respondent quote, or empty for an unasked branch. Do not equate not asked with lack of respondent knowledge.",
          },
        },
      },
    },
    human_review_required: { type: "string", enum: ["yes"] },
  },
} as const;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Evidence must be an object.");
  return value as Record<string, unknown>;
}
function exact(value: unknown, keys: string[]) {
  const result = record(value);
  if (
    Object.keys(result).length !== keys.length ||
    keys.some((key) => !(key in result))
  )
    throw new Error("Evidence fields do not match the requested contract.");
  return result;
}
function text(value: unknown, maximum = 1600): string {
  if (typeof value !== "string" || value.length > maximum)
    throw new Error("Evidence text is missing or exceeds its size limit.");
  return value.trim();
}
function choice(value: unknown, values: readonly string[]) {
  const result = text(value);
  if (!values.includes(result))
    throw new Error("Unsupported evidence classification.");
  return result;
}
function list<T>(
  value: unknown,
  max: number,
  parse: (item: unknown) => T,
): T[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error("Evidence list is invalid or too large.");
  return value.map(parse);
}
const note = (value: unknown) => {
  const item = exact(value, ["text", "quote"]);
  return { text: text(item.text), quote: text(item.quote) };
};
const nonempty = (value: string) =>
  value && !["none", "unknown", "n/a"].includes(value.toLowerCase())
    ? value
    : "";

export function normalizeEvidenceResult(
  input: unknown,
  expected: "evidence-v2" | "legacy" | "synthetic-legacy" = "legacy",
  branchIds: readonly string[] = INTERVIEW_BRANCHES.map((branch) => branch.id),
): EvidenceRecord {
  const value = record(input);
  if (expected === "evidence-v2" && value.schema_version !== "evidence-v2")
    throw new Error(
      "This interview must return the approved evidence-v2 format.",
    );
  if ("schema_version" in value) {
    exact(value, Object.keys(CALL_EVIDENCE_SCHEMA.properties));
    if (
      value.schema_version !== "evidence-v2" ||
      value.human_review_required !== "yes"
    )
      throw new Error(
        "Unsupported evidence schema or missing human review requirement.",
      );
    const period = exact(value.knowledge_period, ["value", "quote"]);
    const statements = list(value.statements, 15, (item) => {
      const s = exact(item, [
        "fact",
        "source_type",
        "certainty",
        "evidence_quote",
      ]);
      return {
        fact: text(s.fact),
        source_type: choice(s.source_type, [
          "first_hand",
          "hearsay",
          "record",
          "assumption",
          "knowledge_limitation",
          "unknown",
        ]),
        certainty: choice(s.certainty, ["confirmed", "uncertain", "unknown"]),
        evidence_quote: text(s.evidence_quote),
      };
    });
    const limits = list(value.limitations, 8, note),
      unknowns = list(value.unknowns, 8, note);
    const leads = list(value.new_leads, 5, (item) => {
      const lead = exact(item, ["name", "reason", "quote"]);
      return {
        name: text(lead.name, 200),
        reason: text(lead.reason),
        quote: text(lead.quote),
      };
    });
    const branches = list(value.branch_results, 12, (item) => {
      const branch = exact(item, ["id", "status", "evidence_quote"]);
      return {
        id: text(branch.id, 100),
        status: choice(branch.status, [
          "answered",
          "unknown",
          "not_asked",
          "not_applicable",
          "declined",
          "escalated",
        ]),
        evidence_quote: text(branch.evidence_quote),
      };
    });
    if (
      branches.length !== branchIds.length ||
      new Set(branches.map((branch) => branch.id)).size !== branches.length ||
      branches.some((branch) => !branchIds.includes(branch.id))
    )
      throw new Error(
        "Evidence must report every approved branch exactly once.",
      );
    if (
      branches.some(
        (branch) =>
          branch.status !== "not_asked" && !nonempty(branch.evidence_quote),
      )
    )
      throw new Error(
        "Reported branch answers and knowledge limits require a respondent quote.",
      );
    if (
      statements.some(
        (statement) => !statement.fact || !nonempty(statement.evidence_quote),
      ) ||
      leads.some(
        (lead) => !lead.name || !lead.reason || !nonempty(lead.quote),
      ) ||
      [...limits, ...unknowns].some(
        (item) => !item.text || !nonempty(item.quote),
      )
    )
      throw new Error(
        "Evidence claims require wording and supporting quotations.",
      );
    const outcome = choice(
      value.outcome,
      CALL_EVIDENCE_SCHEMA.properties.outcome.enum,
    );
    if (outcome === "bounded" && !limits.length && !unknowns.length)
      throw new Error(
        "A bounded outcome requires an explicit reported knowledge limit.",
      );
    if (
      outcome === "resolved" &&
      branches.some((branch) =>
        ["unknown", "not_asked", "declined", "escalated"].includes(
          branch.status,
        ),
      )
    )
      throw new Error(
        "A resolved interview cannot contain unanswered applicable branches.",
      );
    return {
      profile: "evidence-v2",
      outcome,
      knowledge_period: text(period.value),
      knowledge_quote: text(period.quote),
      statements,
      limitations: limits.map((item) => item.text).join(" "),
      unknowns: unknowns.map((item) => item.text).join(" "),
      limitation_items: limits,
      unknown_items: unknowns,
      leads,
      branches,
      human_review_required: "yes",
    };
  }
  if (
    expected === "synthetic-legacy" &&
    Array.isArray(value.statements) &&
    value.human_review_required === "yes"
  ) {
    return {
      profile: "synthetic-legacy",
      outcome: String(value.outcome || "unknown"),
      knowledge_period: String(
        value.knowledge_period || "Not separately extracted",
      ),
      knowledge_quote: "",
      statements: list(value.statements, 15, (item) => {
        const s = record(item);
        return {
          fact: text(s.fact),
          source_type: choice(s.source_type, [
            "first_hand",
            "hearsay",
            "record",
            "assumption",
            "knowledge_limitation",
            "unknown",
          ]),
          certainty: choice(s.certainty, ["confirmed", "uncertain", "unknown"]),
          evidence_quote: text(s.evidence_quote),
        };
      }),
      limitations: String(value.limitations || ""),
      unknowns: String(value.unknowns || ""),
      limitation_items: [],
      unknown_items: [],
      leads: [],
      branches: [],
      human_review_required: "yes",
    };
  }
  if (
    ![
      "factual_statements",
      "source_type",
      "supporting_quotes",
      "uncertainty_notes",
    ].every((key) => typeof value[key] === "string")
  )
    throw new Error(
      "The returned evidence does not match a supported result format.",
    );
  const sources: Record<string, string> = {
    "direct observation": "first_hand",
    hearsay: "hearsay",
    record: "record",
    assumption: "assumption",
    unknown: "unknown",
  };
  const fact = nonempty(text(value.factual_statements)),
    quote = nonempty(text(value.supporting_quotes)),
    uncertainty = nonempty(text(value.uncertainty_notes));
  return {
    profile: "compact-legacy",
    outcome: "unknown",
    knowledge_period: "Not separately extracted in this earlier interview",
    knowledge_quote: "",
    statements:
      fact && quote
        ? [
            {
              fact,
              evidence_quote: quote,
              source_type:
                sources[String(value.source_type).toLowerCase()] || "unknown",
              certainty: uncertainty ? "uncertain" : "unknown",
            },
          ]
        : [],
    limitations: uncertainty,
    unknowns: "Not separately extracted in this earlier interview",
    limitation_items: [],
    unknown_items: [],
    leads: [],
    branches: [],
    human_review_required: "yes",
  };
}

export function extractTranscript(
  payload: unknown,
  runId: number,
): TranscriptTurn[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const recipients = Array.isArray(root.recipients) ? root.recipients : [];
  const result: TranscriptTurn[] = [];
  recipients.forEach((r, ri) => {
    const attempts = r && Array.isArray(r.attempts) ? r.attempts : [];
    attempts.forEach(
      (a: { transcript_turns?: unknown[] } | null, ai: number) => {
        (Array.isArray(a?.transcript_turns) ? a.transcript_turns : []).forEach(
          (value, ti) => {
            if (!value || typeof value !== "object") return;
            const turn = value as Record<string, unknown>;
            if (typeof turn.text !== "string") return;
            result.push({
              id: `run-${runId}-r${ri}-a${ai}-t${ti}`,
              runId,
              recipient: ri,
              attempt: ai,
              index: ti + 1,
              speaker:
                turn.speaker === "user"
                  ? "respondent"
                  : turn.speaker === "bot"
                    ? "assistant"
                    : "unknown",
              text: turn.text,
              offsetSeconds:
                typeof turn.offset_seconds === "number"
                  ? turn.offset_seconds
                  : null,
            });
          },
        );
      },
    );
  });
  return result;
}
export function citeQuote(quote: string, turns: TranscriptTurn[]): Citation {
  if (!turns.length) return { status: "missing_transcript", turnIds: [] };
  const normalize = (value: string) =>
    value
      .normalize("NFKC")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  const needle = normalize(quote)
    .replace(/^"([\s\S]*)"$/, "$1")
    .trim();
  const matches =
    needle.length > 2 && !["unknown", "none"].includes(needle.toLowerCase())
      ? turns.filter(
          (turn) =>
            turn.speaker === "respondent" &&
            normalize(turn.text).includes(needle),
        )
      : [];
  return {
    status:
      matches.length === 1
        ? "matched"
        : matches.length > 1
          ? "ambiguous"
          : "unmatched",
    turnIds: matches.map((turn) => turn.id),
  };
}

export type IngestedStatement = {
  id: string;
  origin: string;
  fact: string;
  source: string;
  certainty: string;
  evidence: string;
  limitations: string;
  created_at: string;
};
export type ReviewAction = {
  id: number;
  statement_id: string;
  action: string;
  payload: string;
  expected_revision: number;
};
export function applyReviews(
  statements: IngestedStatement[],
  reviews: ReviewAction[],
) {
  return statements.map((statement) => {
    let fact = statement.fact,
      evidence = statement.evidence,
      source = statement.source,
      certainty = statement.certainty,
      limitations = statement.limitations;
    let status = "pending",
      revision = 1;
    const edits: Array<{ fact: string; note: string }> = [];
    for (const review of reviews
      .filter((action) => action.statement_id === statement.id)
      .sort((a, b) => a.id - b.id)) {
      if (review.action === "edit") {
        const payload = JSON.parse(review.payload);
        fact = payload.fact || fact;
        evidence = payload.evidence || evidence;
        source = payload.source || source;
        certainty = payload.certainty || certainty;
        limitations = Array.isArray(payload.limitations)
          ? payload.limitations.join(" ")
          : limitations;
        edits.push({ fact, note: payload.note || "" });
        revision++;
        status = "pending";
      } else if (["accepted", "rejected", "follow_up"].includes(review.action))
        status = review.action;
    }
    return {
      ...statement,
      originalFact: statement.fact,
      originalEvidence: statement.evidence,
      evidence,
      fact,
      source,
      certainty,
      limitations,
      status,
      revision,
      edits,
    };
  });
}
export function evidenceIsVisible(origin: string, mode: string) {
  if (mode === "archive") return true;
  return mode === "fake"
    ? !["calle_goal", "calle_calls"].includes(origin)
    : origin !== "fake";
}
