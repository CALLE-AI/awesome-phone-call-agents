/**
 * Settlement memorandum generator.
 *
 * Renders a deterministic, human-readable markdown memo and a matching
 * machine-readable JSON artifact from a case record plus its ledger.
 *
 * Privacy invariants enforced here:
 *  - Phone numbers are ALWAYS masked to their last four digits.
 *  - Party-private data (`reservationCents`, intake `notes`) never appears
 *    in either artifact.
 *
 * Determinism: no clock or randomness inside — callers pass `nowIso`.
 */

import type {
  Attestation,
  CaseRecord,
  LedgerEntry,
  PartyId,
  Round,
} from "./types.js";

/** Legal posture of every memo this system produces. Rendered verbatim. */
export const MEMO_NOTICE =
  "NON-BINDING DOCUMENT — NOT LEGAL ADVICE. This memorandum is an automated, " +
  "neutral summary of communications relayed between the parties by the Caucus " +
  "mediation system. It records what was said and agreed; it does not " +
  "constitute a contract, a legal determination, or legal advice. Either party " +
  "should consult a licensed attorney before relying on these terms.";

/** Mask an E.164 phone number to its last four digits (e.g. "***0001"). */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `***${digits.slice(-4)}`;
}

/** Fixed-locale USD formatting so output never varies with ICU configuration. */
export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const remainder = (abs % 100).toString().padStart(2, "0");
  return `${sign}$${dollars}.${remainder}`;
}

// ---------- Machine-readable artifact ----------

export interface MemoParty {
  id: PartyId;
  label: string;
  phoneMasked: string;
}

export interface MemoRound {
  round: number;
  partyId: PartyId;
  partyLabel: string;
  kind: string;
  amountCents: number | null;
  conditions: string[];
  evidence: string[];
  outcome: string;
}

export interface MemoAttestation {
  party: PartyId;
  callId: string;
  spokenPhrase: string;
  verified: boolean;
  at: string;
}

export interface MemoSettlement {
  amountCents: number;
  conditions: string[];
  termsDigest: string;
  attestationPhrase: string;
  attestations: MemoAttestation[];
}

export interface MemoJson {
  kind: "caucus_settlement_memo";
  caseId: string;
  state: string;
  generatedAt: string;
  dispute: {
    vertical: string;
    summary: string;
    amountCents: number;
    currency: string;
  };
  parties: MemoParty[];
  rounds: MemoRound[];
  settlement: MemoSettlement | null;
  ledger: { entries: number; headHash: string | null };
  notice: string;
}

function partyLabel(rec: CaseRecord, id: PartyId): string {
  return rec.parties.find((p) => p.id === id)?.label ?? id;
}

function toMemoRound(rec: CaseRecord, round: Round): MemoRound {
  return {
    round: round.n,
    partyId: round.callee,
    partyLabel: partyLabel(rec, round.callee),
    kind: round.offer?.kind ?? "—",
    amountCents: round.offer?.amountCents ?? null,
    conditions: round.offer?.conditions ?? [],
    evidence: round.offer?.evidence ?? [],
    outcome: round.outcome,
  };
}

function toMemoAttestations(
  attestations: Partial<Record<PartyId, Attestation>>,
): MemoAttestation[] {
  const out: MemoAttestation[] = [];
  for (const party of ["A", "B"] as const) {
    const att = attestations[party];
    if (att === undefined) continue;
    out.push({
      party,
      callId: att.callId,
      spokenPhrase: att.spokenPhrase,
      verified: att.verified,
      at: att.at,
    });
  }
  return out;
}

/**
 * Build the machine-readable memo artifact. Same content as the markdown
 * memo; deterministic for identical inputs.
 */
export function writeMemoJson(
  rec: CaseRecord,
  ledger: readonly LedgerEntry[],
  nowIso: string,
): MemoJson {
  const rounds = [...rec.rounds].sort((a, b) => a.n - b.n);
  const head = ledger.length > 0 ? ledger[ledger.length - 1] : undefined;
  return {
    kind: "caucus_settlement_memo",
    caseId: rec.caseId,
    state: rec.state,
    generatedAt: nowIso,
    dispute: {
      vertical: rec.dispute.vertical,
      summary: rec.dispute.summary,
      amountCents: rec.dispute.amountCents,
      currency: rec.dispute.currency,
    },
    parties: rec.parties.map((p) => ({
      id: p.id,
      label: p.label,
      phoneMasked: maskPhone(p.phone),
    })),
    rounds: rounds.map((r) => toMemoRound(rec, r)),
    settlement:
      rec.settlement === undefined
        ? null
        : {
            amountCents: rec.settlement.amountCents,
            conditions: [...rec.settlement.conditions],
            termsDigest: rec.settlement.termsDigest,
            attestationPhrase: rec.settlement.attestationPhrase,
            attestations: toMemoAttestations(rec.settlement.attestations),
          },
    ledger: { entries: ledger.length, headHash: head?.hash ?? null },
    notice: MEMO_NOTICE,
  };
}

// ---------- Markdown rendering ----------

/** Escape a value for use inside a markdown table cell. */
function cell(text: string): string {
  const s = text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
  return s.length > 0 ? s : "—";
}

function roundRow(r: MemoRound): string {
  const amount = r.amountCents === null ? "—" : formatUsd(r.amountCents);
  const evidence =
    r.evidence.length > 0
      ? r.evidence.map((q) => `"${q}"`).join("; ")
      : "—";
  return `| ${r.round} | ${cell(`${r.partyId} (${r.partyLabel})`)} | ${cell(
    r.kind,
  )} | ${amount} | ${cell(r.conditions.join("; "))} | ${cell(evidence)} |`;
}

/**
 * Render the settlement memorandum as markdown. Deterministic for identical
 * inputs — `nowIso` is the only timestamp source.
 */
export function renderMemo(
  rec: CaseRecord,
  ledger: readonly LedgerEntry[],
  nowIso: string,
): string {
  const memo = writeMemoJson(rec, ledger, nowIso);
  const lines: string[] = [];

  lines.push(`# Settlement Memorandum — Case ${memo.caseId}`);
  lines.push("");
  lines.push(`> **${MEMO_NOTICE}**`);
  lines.push("");
  lines.push(`- Generated at: ${memo.generatedAt}`);
  lines.push(`- Case state: \`${memo.state}\``);
  lines.push("");

  lines.push("## Parties");
  lines.push("");
  lines.push("| Party | Label | Phone |");
  lines.push("| --- | --- | --- |");
  for (const p of memo.parties) {
    lines.push(`| ${p.id} | ${cell(p.label)} | ${p.phoneMasked} |`);
  }
  lines.push("");

  lines.push("## Dispute");
  lines.push("");
  lines.push(`- Vertical: \`${memo.dispute.vertical}\``);
  lines.push(`- Summary: ${memo.dispute.summary}`);
  lines.push(
    `- Amount in dispute: ${formatUsd(memo.dispute.amountCents)} ${memo.dispute.currency}`,
  );
  lines.push("");

  lines.push("## Rounds");
  lines.push("");
  if (memo.rounds.length === 0) {
    lines.push("_No shuttle rounds were completed._");
  } else {
    lines.push("| Round | Party | Kind | Amount | Conditions | Evidence |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const r of memo.rounds) lines.push(roundRow(r));
  }
  lines.push("");

  lines.push("## Settlement Terms");
  lines.push("");
  if (memo.settlement === null) {
    lines.push("_No settlement was reached on this case._");
    lines.push("");
  } else {
    lines.push(`- Amount: ${formatUsd(memo.settlement.amountCents)}`);
    if (memo.settlement.conditions.length === 0) {
      lines.push("- Conditions: none");
    } else {
      lines.push("- Conditions:");
      for (const c of memo.settlement.conditions) lines.push(`  - ${c}`);
    }
    lines.push(`- Terms digest (SHA-256): \`${memo.settlement.termsDigest}\``);
    lines.push(
      `- Attestation phrase: "${memo.settlement.attestationPhrase}"`,
    );
    lines.push("");

    lines.push("### Attestations");
    lines.push("");
    if (memo.settlement.attestations.length === 0) {
      lines.push("_No attestations recorded._");
    } else {
      lines.push("| Party | Call | Spoken phrase | Verified | At |");
      lines.push("| --- | --- | --- | --- | --- |");
      for (const a of memo.settlement.attestations) {
        lines.push(
          `| ${a.party} | \`${a.callId}\` | ${cell(`"${a.spokenPhrase}"`)} | ${
            a.verified ? "yes" : "NO"
          } | ${a.at} |`,
        );
      }
    }
    lines.push("");
  }

  lines.push("## Ledger");
  lines.push("");
  lines.push(`- Entries: ${memo.ledger.entries}`);
  lines.push(
    `- Chain head hash: ${
      memo.ledger.headHash === null ? "—" : `\`${memo.ledger.headHash}\``
    }`,
  );
  lines.push("");

  return lines.join("\n");
}
