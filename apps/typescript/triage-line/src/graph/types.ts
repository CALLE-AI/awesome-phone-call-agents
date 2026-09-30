/**
 * Core abstractions for Switchboard.
 *
 * Both demo topologies (fan-out and chain) are expressed as a CallGraph fed to
 * the same executor. A CallNode is a single phone call with a goal and an
 * expected result schema; edges (dependsOn) express ordering for chains.
 */

export type CallNodeStatus =
  | "pending" // not yet eligible to run
  | "blocked" // waiting on dependencies
  | "awaiting_approval" // consequential call proposed; a human must authorize it before it dials
  | "running" // call in flight
  | "done" // completed and verified ok
  | "failed" // call failed / unrecoverable
  | "needs_user" // completed but flagged for human review (policy/verification)
  | "needs_review"; // completed but result could not be fully trusted

/** A single turn in a call transcript. */
export interface TranscriptTurn {
  speaker: "agent" | "callee" | "system";
  text: string;
  /** Optional timestamp offset in seconds from call start. */
  at?: number;
}

/**
 * Structured result returned by CALL-E, shaped by the node's resultSchema.
 * Values are open because each scenario defines its own schema.
 */
export type StructuredResult = Record<string, unknown>;

/**
 * The raw outcome the CALL-E SDK (or our mock) returns for one call, before
 * Switchboard's verification layer inspects it.
 */
export interface CalleCallOutcome {
  status: "completed" | "failed" | "no_answer" | "voicemail";
  taskCompleted: boolean;
  /** CALL-E's own confidence that the task was completed. */
  completionConfidence: { score: number; reason?: string };
  structuredResult?: StructuredResult;
  /** Evidence spans (usually transcript excerpts) supporting the result. */
  evidence?: string[];
  transcript?: TranscriptTurn[];
}

/** A JSON-schema-like object describing the expected structuredResult. */
export type ResultSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
};

/** Outcome of running verification over a call. */
export interface VerificationReport {
  trusted: boolean;
  /** Resulting status Switchboard should assign to the node. */
  status: CallNodeStatus;
  /** Human-readable notes about why (for the UI and judges). */
  notes: string[];
  /** Policy violations detected, if any. */
  policyFlags: string[];
}

export interface CallNode {
  id: string;
  phone: string; // E.164, e.g. "+14155550123"
  region: string; // "US", "MX", ...
  locale: string; // "en-US", "es-MX", ...
  goal: string; // becomes part of the CALL-E task string
  resultSchema: ResultSchema; // shape of structuredResult
  dependsOn: string[]; // node ids that must be "done" before this runs

  /** Policy constraints encoded into the task and asserted after the call. */
  policy?: PolicyConstraints;

  /**
   * Consequential call (e.g. a medical/referral follow-up or a call to a third
   * party like an emergency contact) that MUST be authorized by a human before
   * it is placed. Such nodes start as "awaiting_approval" and are only dialed
   * after approveNode() marks them approved. A presence-only field in a prior
   * result is never treated as authorization to place these.
   */
  requiresApproval?: boolean;
  /** Set true once a human has authorized a requiresApproval node to dial. */
  approved?: boolean;
  /** Human-readable reason this call was proposed (shown at the approval gate). */
  proposedReason?: string;
  /** Internal: this node has already been passed to expand() (never re-expand). */
  expanded?: boolean;

  /** Locales already attempted, for language auto-retry bookkeeping. */
  attemptedLocales?: string[];

  // --- filled in after execution ---
  status: CallNodeStatus;
  outcome?: CalleCallOutcome;
  result?: StructuredResult;
  confidence?: number;
  evidence?: string[];
  transcript?: TranscriptTurn[];
  verification?: VerificationReport;
  /** Set when this node was spawned by expand() from another node. */
  spawnedBy?: string;
}

/** Consent / boundary constraints for a call. */
export interface PolicyConstraints {
  /** Never agree to a fee. Verification asserts none was agreed. */
  noFees?: boolean;
  /** Do not share these sensitive fields aloud. */
  doNotDisclose?: string[];
  /** Free-form additional instructions injected into the task string. */
  extraInstructions?: string[];
}

export type CallGraphMode = "fan_out" | "chain";

export interface CallGraph {
  id: string;
  mode: CallGraphMode;
  nodes: CallNode[];
  /**
   * Chain-only. Given a node that just completed, derive the next node(s) to
   * add to the graph. The next number/goal comes from node.result, which is
   * what makes the chain autonomous.
   */
  expand?: (node: CallNode, graph: CallGraph) => CallNode[];
}

/** Convenience factory that fills required runtime fields with defaults. */
export function makeNode(
  init: Omit<CallNode, "status" | "dependsOn" | "attemptedLocales"> &
    Partial<Pick<CallNode, "status" | "dependsOn" | "attemptedLocales">>
): CallNode {
  return {
    ...init,
    status: init.status ?? "pending",
    dependsOn: init.dependsOn ?? [],
    attemptedLocales: init.attemptedLocales ?? [],
  };
}
