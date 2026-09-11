"""
Semantic validation of a Workflow graph, on top of the structural validation Pydantic
already does. A workflow can be perfectly valid JSON and still be a nonsense graph
(dangling edge, two start nodes, an unreachable branch) — this is where those get
caught before the workflow reaches the visual editor or the compiler.

Errors are blocking (the workflow should not be saved/compiled as-is). Warnings are
surfaced to the user but do not block — a hackathon demo would rather show a slightly
odd graph than refuse to render one.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.models.workflow import Workflow


@dataclass
class ValidationResult:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def valid(self) -> bool:
        return not self.errors


def validate_graph(workflow: Workflow) -> ValidationResult:
    result = ValidationResult()
    node_ids = [n.id for n in workflow.nodes]
    node_by_id = {n.id: n for n in workflow.nodes}

    _check_duplicate_ids(node_ids, result)
    _check_start_nodes(workflow, result)
    _check_terminal_nodes(workflow, result)
    _check_dangling_edges(workflow, node_by_id, result)
    _check_reachability(workflow, node_by_id, result)
    _check_dead_ends(workflow, result)
    _check_qualification_fields(workflow, result)
    _check_outcome_schema(workflow, result)

    return result


def _check_duplicate_ids(node_ids: list[str], result: ValidationResult) -> None:
    seen: set[str] = set()
    for node_id in node_ids:
        if node_id in seen:
            result.errors.append(f'Duplicate node id "{node_id}"')
        seen.add(node_id)


def _check_start_nodes(workflow: Workflow, result: ValidationResult) -> None:
    starts = [n for n in workflow.nodes if n.type == "start"]
    if len(starts) == 0:
        result.errors.append("Workflow has no start node")
    elif len(starts) > 1:
        result.errors.append(
            f"Workflow has {len(starts)} start nodes, expected exactly 1: "
            f"{', '.join(n.id for n in starts)}"
        )


def _check_terminal_nodes(workflow: Workflow, result: ValidationResult) -> None:
    terminals = [n for n in workflow.nodes if n.type == "terminal"]
    if len(terminals) == 0:
        result.errors.append("Workflow has no terminal node")


def _check_dangling_edges(workflow: Workflow, node_by_id: dict, result: ValidationResult) -> None:
    for edge in workflow.edges:
        if edge.from_ not in node_by_id:
            result.errors.append(f'Edge "{edge.id}" references unknown from-node "{edge.from_}"')
        if edge.to not in node_by_id:
            result.errors.append(f'Edge "{edge.id}" references unknown to-node "{edge.to}"')


def _check_reachability(workflow: Workflow, node_by_id: dict, result: ValidationResult) -> None:
    starts = [n.id for n in workflow.nodes if n.type == "start"]
    if not starts:
        return  # already reported by _check_start_nodes

    adjacency: dict[str, list[str]] = {}
    for edge in workflow.edges:
        adjacency.setdefault(edge.from_, []).append(edge.to)

    visited: set[str] = set()
    stack = list(starts)
    while stack:
        current = stack.pop()
        if current in visited or current not in node_by_id:
            continue
        visited.add(current)
        stack.extend(adjacency.get(current, []))

    unreachable = [n.id for n in workflow.nodes if n.id not in visited]
    if unreachable:
        result.errors.append(f"Unreachable from start: {', '.join(unreachable)}")


def _check_dead_ends(workflow: Workflow, result: ValidationResult) -> None:
    outgoing: dict[str, int] = {}
    for edge in workflow.edges:
        outgoing[edge.from_] = outgoing.get(edge.from_, 0) + 1

    for node in workflow.nodes:
        has_outgoing = outgoing.get(node.id, 0) > 0
        if node.type == "terminal" and has_outgoing:
            result.warnings.append(
                f'Terminal node "{node.id}" has outgoing edges; terminal nodes should end the call'
            )
        elif node.type != "terminal" and not has_outgoing:
            result.errors.append(
                f'Non-terminal node "{node.id}" has no outgoing edge — the call has nowhere to go'
            )


def _check_qualification_fields(workflow: Workflow, result: ValidationResult) -> None:
    captured_fields = {field for n in workflow.nodes for field in n.captures}
    for rule in workflow.qualification.rules:
        if rule.field not in captured_fields:
            result.warnings.append(
                f'Qualification rule references field "{rule.field}", which no node captures'
            )


def _check_outcome_schema(workflow: Workflow, result: ValidationResult) -> None:
    names = [f.name for f in workflow.outcome_schema.fields]
    seen: set[str] = set()
    for name in names:
        if name in seen:
            result.errors.append(f'Duplicate outcomeSchema field name "{name}"')
        seen.add(name)

    if not workflow.outcome_schema.next_step:
        result.warnings.append("outcomeSchema.nextStep is empty — no disposition values to report")

    for field_ in workflow.outcome_schema.fields:
        if field_.type == "object" and not field_.properties:
            result.errors.append(
                f'outcomeSchema field "{field_.name}" is type object but has no properties'
            )
        if field_.type == "array" and field_.items is None:
            result.errors.append(
                f'outcomeSchema field "{field_.name}" is type array but has no items'
            )
