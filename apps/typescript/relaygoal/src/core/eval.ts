// Zero-cost evaluation harness for the verified-phone-outcome engine.
//
// It places no calls. It takes every fixture call in the demo set, runs the verifier,
// and checks two things a judge can hold us to:
//   soundness  — a field is marked VERIFIED only if at least one of its proof quotes is,
//                verbatim, a turn spoken by the OTHER party in that call's transcript;
//   recall     — on the untouched fixtures, every answer the other party actually stated
//                is marked verified (we do not fail closed for no reason).
// Then it mutates each fixture in six adversarial ways that a real deployment will meet
// (fabricated value, transcript dropped, task not completed, confidence collapsed, the
// supporting sentence moved into the agent's own mouth, call failed) and counts how
// many of the mutated fields the verifier wrongly marks verified. That count is the
// number we publish. It must be zero.

import { verifyOutcome, type VerifyOptions } from "./verify";
import type { CalleCallResult, TranscriptTurn } from "./types";

export interface EvalCase {
  id: string;
  requestedKeys: string[];
  result: CalleCallResult;
}

export type MutationKind =
  | "fabricated_value"
  | "transcript_dropped"
  | "task_not_completed"
  | "confidence_collapsed"
  | "self_grounded"
  | "call_failed";

export const MUTATIONS: MutationKind[] = [
  "fabricated_value",
  "transcript_dropped",
  "task_not_completed",
  "confidence_collapsed",
  "self_grounded",
  "call_failed",
];

export interface EvalReport {
  fixtures: number;
  fixtureFields: number;
  /** Fields verified on untouched fixtures. */
  verifiedOnFixtures: number;
  /** Fields whose value the other party literally stated on the fixture transcript. */
  groundedInFixtures: number;
  /** Of those grounded fields, how many the verifier marked verified (recall). */
  groundedRecalled: number;
  /** Verified fields (fixtures + mutations) lacking a verbatim callee quote. Must be 0. */
  unsoundVerifications: number;
  mutations: number;
  mutationFields: number;
  /** Mutated fields the verifier wrongly marked verified. Must be 0. */
  falseVerifications: number;
  /** Per-mutation breakdown: fields checked / wrongly verified. */
  byMutation: Record<MutationKind, { fields: number; falseVerifications: number }>;
  /**
   * Diagnostic, reported separately because it is a KNOWN LIMIT of quote grounding:
   * when two answers were stated in the same sentence (e.g. "pick up before 5, we
   * close at 9"), swapping their values still finds each value inside that sentence.
   * The UI mitigates this by highlighting the matched span inside the quote, so a
   * swapped answer highlights the wrong words; the engine alone cannot tell them apart.
   */
  swapDiagnostic: { fixturesWithSwappableFields: number; swappedFields: number; swapsCaught: number };
}

function calleeSaid(value: unknown, transcript: TranscriptTurn[]): boolean {
  const needle = String(value ?? "").trim().toLowerCase();
  if (needle.length < 2) return false;
  return transcript.some((t) => t.speaker !== "bot" && t.text.toLowerCase().includes(needle));
}

function quotesAreVerbatimCallee(quotes: { text: string }[], transcript: TranscriptTurn[]): boolean {
  return quotes.length > 0 && quotes.every((q) => transcript.some((t) => t.speaker !== "bot" && t.text === q.text));
}

/** Apply one adversarial mutation to a fixture. Pure; never touches the input. */
export function mutate(result: CalleCallResult, kind: MutationKind): CalleCallResult {
  const clone: CalleCallResult = JSON.parse(JSON.stringify(result));
  switch (kind) {
    case "fabricated_value": {
      // Replace every extracted answer with a value the other party never said.
      // The fake value shares no token with any field name or transcript word, so the
      // only way it can verify is a genuine engine defect.
      const fake: Record<string, unknown> = {};
      Object.keys(clone.structuredResult ?? {}).forEach((k, i) => { fake[k] = `qzx fabricated qvw ${i + 1}`; });
      clone.structuredResult = fake;
      clone.evidence = [];
      return clone;
    }
    case "transcript_dropped":
      clone.transcriptTurns = [];
      return clone;
    case "task_not_completed":
      clone.taskCompleted = false;
      return clone;
    case "confidence_collapsed":
      clone.completionConfidence = { score: 0.2, label: "low" };
      return clone;
    case "self_grounded":
      // The supporting sentences are now spoken by the agent, not the other party.
      clone.transcriptTurns = (clone.transcriptTurns ?? []).map((t) => ({ ...t, speaker: "bot" as const }));
      clone.evidence = [];
      return clone;
    case "call_failed":
      clone.status = "failed";
      clone.taskCompleted = false;
      return clone;
  }
}

export function runEval(cases: EvalCase[], options: VerifyOptions = {}): EvalReport {
  const byMutation = Object.fromEntries(
    MUTATIONS.map((m) => [m, { fields: 0, falseVerifications: 0 }]),
  ) as EvalReport["byMutation"];

  const report: EvalReport = {
    fixtures: cases.length,
    fixtureFields: 0,
    verifiedOnFixtures: 0,
    groundedInFixtures: 0,
    groundedRecalled: 0,
    unsoundVerifications: 0,
    mutations: 0,
    mutationFields: 0,
    falseVerifications: 0,
    byMutation,
    swapDiagnostic: { fixturesWithSwappableFields: 0, swappedFields: 0, swapsCaught: 0 },
  };

  for (const c of cases) {
    const transcript = c.result.transcriptTurns ?? [];
    const out = verifyOutcome(c.result, c.requestedKeys, options);
    for (const f of out.fields) {
      report.fixtureFields++;
      const grounded = c.result.status === "completed" && c.result.taskCompleted && calleeSaid(f.value, transcript);
      if (grounded) report.groundedInFixtures++;
      if (f.status === "verified") {
        report.verifiedOnFixtures++;
        if (grounded) report.groundedRecalled++;
        if (!quotesAreVerbatimCallee(f.quotes, transcript)) report.unsoundVerifications++;
      }
    }

    for (const kind of MUTATIONS) {
      const m = mutate(c.result, kind);
      const mo = verifyOutcome(m, c.requestedKeys, options);
      report.mutations++;
      for (const f of mo.fields) {
        report.mutationFields++;
        byMutation[kind].fields++;
        if (f.status === "verified") {
          // Any verification on a mutated fixture is wrong: the mutation removed or
          // corrupted the grounds for it. For the confidence mutation this holds because
          // 0.2 is below every sane threshold; for the others by construction.
          report.falseVerifications++;
          byMutation[kind].falseVerifications++;
          if (!quotesAreVerbatimCallee(f.quotes, m.transcriptTurns ?? [])) report.unsoundVerifications++;
        }
      }
    }
  }

  // Swap diagnostic (not part of the must-be-zero count; see EvalReport.swapDiagnostic).
  for (const c of cases) {
    const sr = c.result.structuredResult ?? {};
    const keys = c.requestedKeys.filter((k) => sr[k] !== undefined && sr[k] !== null && sr[k] !== "");
    if (keys.length < 2 || c.result.status !== "completed" || !c.result.taskCompleted) continue;
    report.swapDiagnostic.fixturesWithSwappableFields++;
    const swapped: CalleCallResult = JSON.parse(JSON.stringify(c.result));
    const rotated: Record<string, unknown> = {};
    keys.forEach((k, i) => { rotated[k] = sr[keys[(i + 1) % keys.length]!]; });
    swapped.structuredResult = { ...sr, ...rotated };
    swapped.evidence = [];
    const so = verifyOutcome(swapped, keys, options);
    for (const f of so.fields) {
      // Only count fields whose swapped value differs from the original.
      if (String(rotated[f.key]) === String(sr[f.key])) continue;
      report.swapDiagnostic.swappedFields++;
      if (f.status !== "verified") report.swapDiagnostic.swapsCaught++;
    }
  }
  return report;
}

/** One-paragraph, publishable summary of a report. */
export function summarize(r: EvalReport): string {
  return (
    `Precision: ${r.falseVerifications} false verifications and ${r.unsoundVerifications} unsound quotes across ` +
    `${r.fixtures} fixture calls (${r.fixtureFields} answer fields) + ${r.mutations} adversarial mutations (${r.mutationFields} fields). ` +
    `Recall: ${r.groundedRecalled} of ${r.groundedInFixtures} answers the other party actually stated were marked verified. ` +
    `Honest limit: with two answers in one sentence, swapping their values was caught ${r.swapDiagnostic.swapsCaught} of ${r.swapDiagnostic.swappedFields} times — ` +
    `quote grounding cannot separate two facts inside one sentence, so the card shows the quote for the user to check, never a confidence score.`
  );
}
