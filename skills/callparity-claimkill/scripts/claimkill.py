#!/usr/bin/env python3
"""ClaimKill leak-drop planner, claim graph, and merger for CallParity.

preview() compiles a plan from committed fixtures and places zero calls.
The module has no network imports and does not contact CALL-E.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from copy import deepcopy
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping, Sequence


SKILL_ROOT = Path(__file__).resolve().parent.parent
FIXTURES_DIR = SKILL_ROOT / "fixtures"

SUPPORTED = "SUPPORTED"
UNTESTED = "UNTESTED"
CONTRADICTED = "CONTRADICTED"
UNREACHABLE = "UNREACHABLE"
ABSTAIN = "ABSTAIN"
STATUSES = frozenset({SUPPORTED, UNTESTED, CONTRADICTED, UNREACHABLE, ABSTAIN})
STATUS_ALIASES = {"CONFIRMED": SUPPORTED}
ABSTAIN_THRESHOLD = 0.45
WORDS_PER_SECOND = 2.5
DEFAULT_SPOKEN_BUDGET_S = 90.0
LEAK_DROP_THRESHOLD = 0.5
E164_RE = re.compile(r"^\+[1-9][0-9]{7,14}$")
UNREACHABLE_DISPOSITIONS = frozenset(
    {"voicemail", "no-transcript", "no_transcript", "unreachable", "no-answer", "no_answer"}
)
SUPPORT_POLARITY = frozenset({"supports", "support", "confirm", "confirmed", "supported"})
CONTRADICT_POLARITY = frozenset(
    {"contradicts", "contradict", "falsify", "falsified", "contradicted"}
)
ATTRIBUTION_MARKERS = (
    "warehouse said",
    "warehouse told",
    "warehouse claimed",
    "warehouse claims",
    "the warehouse said",
    "party a said",
    "party a claimed",
    "they claimed",
    "according to the warehouse",
    "warehouse reported",
)


class FixtureError(ValueError):
    """Fixture JSON failed boundary validation."""


def normalize_status(value: str) -> str:
    raw = (value or "").strip()
    mapped = STATUS_ALIASES.get(raw.upper(), raw.upper())
    if mapped not in STATUSES:
        raise FixtureError(f"unknown claim status: {value!r}")
    return mapped


def spoken_seconds(text: str) -> float:
    words = [part for part in text.split() if part]
    return len(words) / WORDS_PER_SECOND


def mask_phone(phone: str) -> str:
    if len(phone) < 8:
        return "***"
    return f"{phone[:4]}{'*' * (len(phone) - 8)}{phone[-4:]}"


@dataclass(frozen=True)
class EvidenceSpan:
    quote: str

    def to_dict(self) -> dict[str, Any]:
        return {"quote": self.quote}


@dataclass
class ClaimNode:
    id: str
    text: str
    evidence: EvidenceSpan
    observable_of: str
    status: str
    confidence: float = 1.0
    party: str = "A"

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "text": self.text,
            "evidence": {"span": self.evidence.to_dict()},
            "observable_of": self.observable_of,
            "status": self.status,
            "confidence": self.confidence,
            "party": self.party,
        }


@dataclass(frozen=True)
class GraphEdge:
    claim_id: str
    tested_by: str

    def to_dict(self) -> dict[str, Any]:
        return {"claim_id": self.claim_id, "tested_by": self.tested_by}


@dataclass
class ClaimGraph:
    ticket_id: str
    sku: str
    nodes: dict[str, ClaimNode]
    edges: list[GraphEdge] = field(default_factory=list)
    spoken_time_budget_s: float = DEFAULT_SPOKEN_BUDGET_S

    def node(self, claim_id: str) -> ClaimNode:
        return self.nodes[claim_id]

    def to_dict(self) -> dict[str, Any]:
        return {
            "ticket_id": self.ticket_id,
            "sku": self.sku,
            "nodes": [node.to_dict() for node in self.nodes.values()],
            "edges": [edge.to_dict() for edge in self.edges],
            "spoken_time_budget_s": self.spoken_time_budget_s,
            "overall": overall_result(self),
        }


@dataclass(frozen=True)
class RefutationQuestion:
    id: str
    text: str
    targets: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "text": self.text, "targets": list(self.targets)}


@dataclass
class ScoredQuestion:
    question: RefutationQuestion
    leak_score: float
    discarded: bool
    discard_reason: str | None
    spoken_seconds: float
    remaining_budget_s: float

    def to_dict(self) -> dict[str, Any]:
        payload = self.question.to_dict()
        payload.update(
            {
                "leak_score": self.leak_score,
                "discarded": self.discarded,
                "discard_reason": self.discard_reason,
                "spoken_seconds": self.spoken_seconds,
                "remaining_budget_s": self.remaining_budget_s,
            }
        )
        return payload


@dataclass(frozen=True)
class TranscriptQuote:
    claim_id: str
    quote: str
    polarity: str | None = None
    tested_by: str | None = None


@dataclass(frozen=True)
class MergeEvent:
    call_id: str
    disposition: str
    quotes: tuple[TranscriptQuote, ...]


@dataclass
class LoadedFixture:
    graph: ClaimGraph
    questions: list[RefutationQuestion]
    parties: list[dict[str, Any]]
    event: MergeEvent | None


@dataclass
class PreviewPlan:
    ticket_id: str
    sku: str
    next_question: RefutationQuestion | None
    kept: list[ScoredQuestion]
    dropped: list[ScoredQuestion]
    spoken_time_budget_s: float
    remaining_budget_s: float
    masked_parties: list[dict[str, str]]
    graph: ClaimGraph
    calls_placed: int = 0
    side_effect: str = "None. Preview only. Zero live CALL-E calls."
    blocked_reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "ticket_id": self.ticket_id,
            "sku": self.sku,
            "next_question": None
            if self.next_question is None
            else self.next_question.to_dict(),
            "kept": [item.to_dict() for item in self.kept],
            "dropped": [item.to_dict() for item in self.dropped],
            "spoken_time_budget_s": self.spoken_time_budget_s,
            "remaining_budget_s": self.remaining_budget_s,
            "masked_parties": self.masked_parties,
            "graph": self.graph.to_dict(),
            "calls_placed": self.calls_placed,
            "side_effect": self.side_effect,
            "blocked_reason": self.blocked_reason,
        }


def leak_score(
    question: RefutationQuestion,
    nodes: Sequence[ClaimNode] | Mapping[str, ClaimNode],
) -> float:
    """Return 1.0 when the question discloses Party A's answer, else 0.0 to 0.9."""
    text = question.text.lower()
    if "warehouse said dock 3" in text:
        return 1.0
    score = 0.0
    for marker in ATTRIBUTION_MARKERS:
        if marker in text:
            score = max(score, 1.0)
    node_list = nodes.values() if isinstance(nodes, Mapping) else nodes
    for node in node_list:
        quote = node.evidence.quote.strip().lower()
        if len(quote.split()) >= 3 and quote in text:
            score = max(score, 0.9)
    return score


def score_question(
    question: RefutationQuestion,
    nodes: Sequence[ClaimNode] | Mapping[str, ClaimNode],
    budget_s: float,
) -> ScoredQuestion:
    score = leak_score(question, nodes)
    spoken = spoken_seconds(question.text)
    discarded = score >= LEAK_DROP_THRESHOLD
    remaining = budget_s if discarded else max(0.0, budget_s - spoken)
    return ScoredQuestion(
        question=question,
        leak_score=score,
        discarded=discarded,
        discard_reason="discloses party A answer" if discarded else None,
        spoken_seconds=spoken,
        remaining_budget_s=remaining,
    )


def drop_leaks(
    questions: Sequence[RefutationQuestion],
    nodes: Sequence[ClaimNode] | Mapping[str, ClaimNode],
    budget_s: float,
) -> tuple[list[ScoredQuestion], list[ScoredQuestion]]:
    scored = [score_question(question, nodes, budget_s) for question in questions]
    kept = [item for item in scored if not item.discarded]
    dropped = [item for item in scored if item.discarded]
    return kept, dropped


def _falsifiable(node: ClaimNode) -> bool:
    return node.status in {UNTESTED, SUPPORTED}


def pick_next_question(
    kept: Sequence[ScoredQuestion], graph: ClaimGraph
) -> RefutationQuestion | None:
    candidates: list[ScoredQuestion] = []
    for item in kept:
        if item.spoken_seconds > graph.spoken_time_budget_s:
            continue
        targets = [
            graph.nodes[target_id]
            for target_id in item.question.targets
            if target_id in graph.nodes
        ]
        if any(_falsifiable(node) for node in targets):
            candidates.append(item)
    if not candidates:
        return None
    candidates.sort(key=lambda item: (item.spoken_seconds, item.question.id))
    return candidates[0].question


def merge(graph: ClaimGraph, event: MergeEvent) -> ClaimGraph:
    """Update statuses from one Party B call event.

    No falsifying quote leaves a live node UNTESTED.
    Voicemail and missing transcripts become UNREACHABLE.
    Confidence below 0.45 becomes ABSTAIN and stays there.
    """
    result = deepcopy(graph)
    disposition = event.disposition.strip().lower()
    quotes_by_claim = {quote.claim_id: quote for quote in event.quotes}
    new_edges: list[GraphEdge] = []

    for node in result.nodes.values():
        if node.confidence < ABSTAIN_THRESHOLD:
            node.status = ABSTAIN
            continue
        if disposition in UNREACHABLE_DISPOSITIONS:
            node.status = UNREACHABLE
            if event.call_id:
                new_edges.append(GraphEdge(claim_id=node.id, tested_by=event.call_id))
            continue
        quote = quotes_by_claim.get(node.id)
        if quote is None or not quote.quote.strip():
            if node.status not in {CONTRADICTED, SUPPORTED, UNREACHABLE, ABSTAIN}:
                node.status = UNTESTED
            continue
        polarity = (quote.polarity or "").strip().lower()
        if polarity in CONTRADICT_POLARITY:
            node.status = CONTRADICTED
        elif polarity in SUPPORT_POLARITY:
            node.status = SUPPORTED
        else:
            node.status = UNTESTED
        tested_by = quote.tested_by or event.call_id
        if tested_by:
            new_edges.append(GraphEdge(claim_id=node.id, tested_by=tested_by))

    result.edges = new_edges
    return result


def overall_result(graph: ClaimGraph) -> str:
    statuses = [node.status for node in graph.nodes.values()]
    if CONTRADICTED in statuses:
        return CONTRADICTED
    if SUPPORTED in statuses:
        return SUPPORTED
    return "could-not-verify"


def _require_object(value: Any, where: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise FixtureError(f"{where} must be an object")
    return value


def _require_string(value: Any, where: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise FixtureError(f"{where} must be a non-empty string")
    return value.strip()


def _require_float(value: Any, where: str, default: float) -> float:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise FixtureError(f"{where} must be a number")
    return float(value)


def parse_node(raw: Any) -> ClaimNode:
    data = _require_object(raw, "claim node")
    evidence_raw = _require_object(data.get("evidence") or {"span": {}}, "evidence")
    span_raw = _require_object(evidence_raw.get("span") or {}, "evidence.span")
    quote = span_raw.get("quote") or ""
    if not isinstance(quote, str):
        raise FixtureError("evidence.span.quote must be a string")
    confidence = _require_float(data.get("confidence"), "confidence", 1.0)
    status = normalize_status(str(data.get("status") or UNTESTED))
    if confidence < ABSTAIN_THRESHOLD:
        status = ABSTAIN
    return ClaimNode(
        id=_require_string(data.get("id"), "claim id"),
        text=_require_string(data.get("text"), "claim text"),
        evidence=EvidenceSpan(quote=quote.strip()),
        observable_of=_require_string(data.get("observable_of"), "observable_of"),
        status=status,
        confidence=confidence,
        party=str(data.get("party") or "A"),
    )


def parse_question(raw: Any) -> RefutationQuestion:
    data = _require_object(raw, "refutation question")
    targets_raw = data.get("targets")
    if not isinstance(targets_raw, list) or not targets_raw:
        raise FixtureError("question targets must be a non-empty array")
    targets = tuple(_require_string(item, "question target") for item in targets_raw)
    return RefutationQuestion(
        id=_require_string(data.get("id"), "question id"),
        text=_require_string(data.get("text"), "question text"),
        targets=targets,
    )


def parse_quote(raw: Any) -> TranscriptQuote:
    data = _require_object(raw, "transcript quote")
    polarity = data.get("polarity")
    tested_by = data.get("tested_by")
    return TranscriptQuote(
        claim_id=_require_string(data.get("claim_id"), "quote claim_id"),
        quote=str(data.get("quote") or "").strip(),
        polarity=None if polarity is None else str(polarity),
        tested_by=None if tested_by is None else str(tested_by),
    )


def parse_event(raw: Any) -> MergeEvent | None:
    if raw is None:
        return None
    data = _require_object(raw, "call event")
    quotes_raw = data.get("quotes") or []
    if not isinstance(quotes_raw, list):
        raise FixtureError("call quotes must be an array")
    return MergeEvent(
        call_id=_require_string(data.get("id") or data.get("call_id"), "call id"),
        disposition=_require_string(data.get("disposition"), "call disposition"),
        quotes=tuple(parse_quote(item) for item in quotes_raw),
    )


def parse_party(raw: Any) -> dict[str, Any]:
    data = _require_object(raw, "party")
    phone = _require_string(data.get("phone"), "party phone")
    if not E164_RE.fullmatch(phone):
        raise FixtureError(f"party phone must be E.164: {phone}")
    return {
        "role": _require_string(data.get("role"), "party role"),
        "phone": phone,
        "consent": bool(data.get("consent")),
        "label": str(data.get("label") or ""),
    }


def parse_fixture(raw: Any) -> LoadedFixture:
    data = _require_object(raw, "fixture")
    nodes_raw = data.get("nodes") or data.get("claims")
    if not isinstance(nodes_raw, list) or not nodes_raw:
        raise FixtureError("fixture must include a non-empty nodes array")
    nodes = [parse_node(item) for item in nodes_raw]
    ids = [node.id for node in nodes]
    if len(ids) != len(set(ids)):
        raise FixtureError("claim ids must be unique")
    questions_raw = data.get("candidate_questions") or []
    if not isinstance(questions_raw, list):
        raise FixtureError("candidate_questions must be an array")
    parties_raw = data.get("parties") or []
    if not isinstance(parties_raw, list):
        raise FixtureError("parties must be an array")
    graph = ClaimGraph(
        ticket_id=_require_string(data.get("ticket_id"), "ticket_id"),
        sku=_require_string(data.get("sku"), "sku"),
        nodes={node.id: node for node in nodes},
        spoken_time_budget_s=_require_float(
            data.get("spoken_time_budget_s"),
            "spoken_time_budget_s",
            DEFAULT_SPOKEN_BUDGET_S,
        ),
    )
    return LoadedFixture(
        graph=graph,
        questions=[parse_question(item) for item in questions_raw],
        parties=[parse_party(item) for item in parties_raw],
        event=parse_event(data.get("call")),
    )


def _fixture_path(source: str | Path) -> Path:
    path = Path(source)
    if path.exists():
        return path
    named = FIXTURES_DIR / f"{source}.json"
    if named.exists():
        return named
    nested = FIXTURES_DIR / str(source)
    if nested.exists():
        return nested
    raise FixtureError(f"fixture not found: {source}")


def load_fixture(
    source: str | Path | Mapping[str, Any] | None = None,
) -> LoadedFixture:
    if source is None:
        source = "FR-1842"
    if isinstance(source, Mapping):
        return parse_fixture(dict(source))
    path = _fixture_path(source)
    raw = json.loads(path.read_text(encoding="utf-8"))
    return parse_fixture(raw)


def compile_preview(loaded: LoadedFixture) -> PreviewPlan:
    budget = loaded.graph.spoken_time_budget_s
    kept, dropped = drop_leaks(loaded.questions, loaded.graph.nodes, budget)
    next_question = pick_next_question(kept, loaded.graph)
    blocked_reason = None
    party_b = next(
        (
            party
            for party in loaded.parties
            if str(party.get("label") or "").upper() == "B"
            or party.get("role") == "driver"
        ),
        None,
    )
    if party_b is not None and not party_b.get("consent"):
        blocked_reason = "missing consent"
        next_question = None
    remaining = budget
    if next_question is not None:
        remaining = max(0.0, budget - spoken_seconds(next_question.text))
    masked = []
    for party in loaded.parties:
        masked.append(
            {
                "role": str(party["role"]),
                "phone": mask_phone(str(party["phone"])),
                "consent": "true" if party.get("consent") else "false",
                "label": str(party.get("label") or ""),
            }
        )
    return PreviewPlan(
        ticket_id=loaded.graph.ticket_id,
        sku=loaded.graph.sku,
        next_question=next_question,
        kept=kept,
        dropped=dropped,
        spoken_time_budget_s=budget,
        remaining_budget_s=remaining,
        masked_parties=masked,
        graph=loaded.graph,
        blocked_reason=blocked_reason,
    )


def preview(
    source: str | Path | Mapping[str, Any] | None = None,
) -> PreviewPlan:
    """Compile call N+1 from a fixture. Places zero calls."""
    return compile_preview(load_fixture(source))


def merge_fixture(
    source: str | Path | Mapping[str, Any] | None = None,
) -> ClaimGraph:
    loaded = load_fixture(source)
    if loaded.event is None:
        raise FixtureError(f"{loaded.graph.ticket_id} has no call event to merge")
    return merge(loaded.graph, loaded.event)


def _print_json(payload: Mapping[str, Any]) -> None:
    json.dump(payload, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="ClaimKill fixture preview and merger. Places zero calls."
    )
    parser.add_argument(
        "command",
        choices=("preview", "merge"),
        help="preview compiles call N+1. merge applies fixture quotes.",
    )
    parser.add_argument(
        "--fixture",
        default="FR-1842",
        help="ticket id or path under fixtures/. Default FR-1842.",
    )
    args = parser.parse_args(argv)
    if args.command == "preview":
        plan = preview(args.fixture)
        _print_json(plan.to_dict())
        return 0
    graph = merge_fixture(args.fixture)
    _print_json(graph.to_dict())
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except FixtureError as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)
