"""Reporting.

Concord reports on branches, never on people. Two consequences are structural:

1. Findings carry no staff name and no phone number, so there is nothing to
   attribute to an individual even if a caller wanted to.
2. A branch is described by its gap count, not scored, ranked into a league
   table, or given a percentage that could be pasted into a performance review.

A tool that dials your own staff can very easily become a surveillance tool.
The boundary is the product decision, so it lives in code rather than in a
paragraph of the README.
"""

from __future__ import annotations

from dataclasses import dataclass

from concord.models import Audit, Finding, Rubric


@dataclass(frozen=True)
class BranchSummary:
    branch_id: str
    name: str
    deviations: int
    unclear: int
    compliant: int

    @property
    def needs_attention(self) -> bool:
        return self.deviations > 0 or self.unclear > 0


def summarise(audit: Audit, findings: list[Finding]) -> list[BranchSummary]:
    names = {b.id: b.name for b in audit.branches}
    out: list[BranchSummary] = []
    for branch_id in sorted({f.branch_id for f in findings}):
        rows = [f for f in findings if f.branch_id == branch_id]
        out.append(
            BranchSummary(
                branch_id=branch_id,
                name=names.get(branch_id, branch_id),
                deviations=sum(1 for f in rows if f.verdict == "DEVIATION"),
                unclear=sum(1 for f in rows if f.verdict == "UNCLEAR"),
                compliant=sum(1 for f in rows if f.verdict == "COMPLIANT"),
            )
        )
    # Ordered by how much policy work is outstanding, not by branch quality.
    return sorted(out, key=lambda s: (-s.deviations, -s.unclear, s.branch_id))


def gap_register(rubric: Rubric, findings: list[Finding]) -> list[Finding]:
    """Every finding a human still has to act on, deviations first."""
    order = {c.id: i for i, c in enumerate(rubric.criteria)}
    open_rows = [f for f in findings if f.verdict != "COMPLIANT"]
    return sorted(
        open_rows,
        key=lambda f: (f.verdict != "DEVIATION", order.get(f.criterion_id, 99), f.branch_id),
    )


def render(audit: Audit, rubric: Rubric, findings: list[Finding]) -> str:
    lines: list[str] = []
    add = lines.append
    add("CONCORD  /  POLICY CONCORDANCE REPORT")
    add("=" * 86)
    add(f"Audit       {audit.id}")
    add(f"Rubric      {rubric.id}  {rubric.title}")
    add(f"Scope       {len(audit.branches)} branch(es), {len(rubric.criteria)} criterion(a)")
    add("Unit        Branch. Concord does not rate individual staff.")
    add("")

    summaries = summarise(audit, findings)
    add("BRANCH OVERVIEW")
    add(f"{'Branch':<34}{'Deviations':>12}{'Unclear':>10}{'Matches policy':>17}")
    add("-" * 86)
    for s in summaries:
        add(f"{s.name[:33]:<34}{s.deviations:>12}{s.unclear:>10}{s.compliant:>17}")
    add("")

    register = gap_register(rubric, findings)
    questions = {c.id: c.question for c in rubric.criteria}
    names = {b.id: b.name for b in audit.branches}
    add("GAP REGISTER")
    if not register:
        add("  Every answer matched policy. Nothing outstanding.")
    for f in register:
        add(f"  [{f.verdict}] {names.get(f.branch_id, f.branch_id)}  ({f.criterion_id})")
        add(f"      asked     {questions.get(f.criterion_id, '')}")
        if f.quote:
            add(f"      heard     \"{f.quote}\"")
        add(f"      finding   {f.rationale}")
        add("")

    add("HUMAN DECISION REQUIRED")
    add("Concord records what was said and whether it matches written policy.")
    add("It does not evaluate employees, and its output is not a performance record.")
    return "\n".join(lines)
