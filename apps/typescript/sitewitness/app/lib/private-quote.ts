import { citeQuote, type TranscriptTurn } from "./evidence.ts";
import { redactText } from "./output-privacy.ts";

// Resolve only a complete displayed source (or a previously verified excerpt).
// Redacted equality itself never establishes a citation. Ambiguous originals
// require the reviewer to select a specific original respondent turn.
export function resolvePrivateQuote(
  displayed: string,
  turns: TranscriptTurn[],
  sourceTurnId = "",
  verifiedCandidates: string[] = [],
  secrets: readonly string[] = [],
): string | null {
  if (!/\[(?:phone|credential) redacted\]/.test(displayed)) return displayed;
  const sources = turns.filter(
    (turn) =>
      turn.speaker === "respondent" &&
      (!sourceTurnId || turn.id === sourceTurnId),
  );
  const candidates = [
    ...sources.map((turn) => turn.text),
    ...verifiedCandidates.filter(
      (quote) => citeQuote(quote, sources).status === "matched",
    ),
  ];
  const originals = [
    ...new Set(
      candidates.filter((quote) => redactText(quote, secrets) === displayed),
    ),
  ];
  return originals.length === 1 ? originals[0] : null;
}
