"""Conditional task contracts, not an autonomous medical/physical execution engine.

A definition can cover both branches before its future condition is known. A
helper accepting a contingent task is NOT evidence that its trigger occurred.
The assessed-by helper communicates the result; the model never sets a truth value.
Legacy definitions without conditions remain readable, but cannot execute a
conditional goal with a flattened, unconditional task list.
"""
from __future__ import annotations

import re
from pydantic import BaseModel, ConfigDict, Field
from rescue_intent import conditional_goal, conditional_transport, has_else_branch, normal

ID = r"^[a-z][a-z0-9_]{0,49}$"


class PlanGate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    decision_id: str = Field(pattern=ID)
    when: bool = Field(strict=True)


class PlanDecision(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: str = Field(pattern=ID)
    condition: str = Field(min_length=8, max_length=300)
    source_quote: str = Field(min_length=3, max_length=600)
    assessed_by: str = Field(pattern=ID)


def validate_graph(definition: dict) -> None:
    """Reject dangling/contradictory gates and dependency cycles, including gates.

    Logical outcomes may only be determined by a named task. There is deliberately
    no model-writable result, satisfied flag, activation timestamp or confidence.
    """
    needs = {n["id"]: n for n in definition.get("requirements", [])}
    decisions = {d["id"]: d for d in definition.get("decisions", [])}
    if len(decisions) != len(definition.get("decisions", [])):
        raise ValueError("Decision IDs must be unique")
    edges = {ident: set(n.get("after", [])) for ident, n in needs.items()}
    for ident, deps in edges.items():
        if not deps <= needs.keys() or ident in deps:
            raise ValueError("A task has an invalid prerequisite")
    used = set()
    for d in decisions.values():
        if d["assessed_by"] not in needs:
            raise ValueError("A condition needs an assigned assessment task")
    for ident, n in needs.items():
        gates = n.get("gates", [])
        if len({g["decision_id"] for g in gates}) != len(gates):
            raise ValueError("A task cannot repeat or contradict the same condition")
        for gate in gates:
            decision = decisions.get(gate["decision_id"])
            if not decision:
                raise ValueError("A task refers to an unknown condition")
            used.add(gate["decision_id"])
            edges[ident].add(decision["assessed_by"])
    if used != decisions.keys():
        raise ValueError("Every condition must control at least one task")
    visited, visiting = set(), set()
    def visit(ident):
        if ident in visiting:
            raise ValueError("Conditional task dependencies must not contain cycles")
        if ident in visited:
            return
        visiting.add(ident)
        for parent in edges[ident]:
            visit(parent)
        visiting.remove(ident)
        visited.add(ident)
    for ident in needs:
        visit(ident)
    # A task cannot wait for completion of work on an incompatible branch.
    # Propagate gate prerequisites, so indirect contradictions fail as well.
    memo = {}
    def inherited(ident):
        if ident in memo:
            return memo[ident]
        gates = {g["decision_id"]: g["when"] for g in needs[ident].get("gates", [])}
        for parent in edges[ident]:
            for decision_id, value in inherited(parent).items():
                if decision_id in gates and gates[decision_id] != value:
                    raise ValueError("A task depends on an incompatible branch")
                gates[decision_id] = value
        memo[ident] = gates
        return gates
    for ident in needs:
        inherited(ident)


def feeding_requested(goal: str) -> bool:
    return bool(re.search(r"\b(?:feed|feeding|fed|food|water|nourishment|hydration)\b", goal, re.I))


def conditional_scope_issue(goal: str, definition: dict, kind) -> str:
    decisions = definition.get("decisions", [])
    if conditional_goal(goal) and not decisions:
        return "The conditional goal needs its assessment and branch rules preserved. A flat list of tasks cannot authorize both outcomes."
    # Grounded model interpretations may express a condition without an English
    # IF token (or in another language). A regex is not the service definition.
    if not decisions:
        return ""
    try:
        validate_graph(definition)
    except ValueError as exc:
        return str(exc)
    goal_words = normal(goal).casefold()
    if any(normal(d["source_quote"]).casefold() not in goal_words for d in decisions):
        return "A plan condition lacks an exact supporting quote from the confirmed goal."
    needs = definition.get("requirements", [])
    if has_else_branch(goal) and not any(not g["when"] for n in needs for g in n.get("gates", [])):
        return "The proposed plan dropped the goal's ELSE branch."
    if conditional_transport(goal):
        assessors = {d["assessed_by"] for d in decisions}
        if not any(kind(n) == "veterinary_assessment" and n["id"] in assessors for n in needs):
            return "A medical transport condition must be assessed by a qualified veterinary professional, not inferred by the model."
        if any(kind(n) in {"transport", "receiving_care"} and not n.get("gates") for n in needs):
            return "Transport or receiving care lost the medical-necessity condition."
        if not any(kind(n) == "transport" and n.get("gates") for n in needs):
            return "The conditional transport branch was omitted from the plan."
    familiar = fallback_definition(goal)
    if familiar and len(decisions) == 1:
        ident = decisions[0]["id"]
        # Only applies when the model uses the same positive medical predicate.
        # Differently worded/inverted predicates require semantic review instead.
        if normal(decisions[0]["condition"]).casefold() == normal(familiar["decisions"][0]["condition"]).casefold():
            expected = {kind(n): n.get("gates", []) for n in familiar["requirements"]}
            for n in needs:
                gates = expected.get(kind(n))
                if gates and {g["when"] for g in n.get("gates", []) if g["decision_id"] == ident} != {g["when"] for g in gates}:
                    return "The proposed tasks reverse the confirmed goal's THEN and ELSE branches."
    if feeding_requested(goal) and not any(kind(n) == "feeding" for n in needs):
        return "The proposed plan omitted the requested feeding or basic welfare support."
    tail = re.split(r"\b(?:else|otherwise)\b", goal, maxsplit=1, flags=re.I)
    if len(tail) > 1 and feeding_requested(tail[1]):
        if any(kind(n) == "feeding" and not n.get("gates") for n in needs):
            return "Feeding specified only in the ELSE branch cannot become an unconditional task."
    return ""


def fallback_definition(goal: str) -> dict | None:
    """Small supported fallback: medical assessment, contingent transport, feeding.

    Generic/nested conditions need the configured model; never flatten them into
    a full rescue or silently erase an unrecognized alternative.
    """
    if not conditional_transport(goal):
        return None
    # Do not guess how to invert, nest or interpret a non-feeding alternative.
    if re.search(r"\b(?:unless|depending|subject to|before|only when|never)\b|"
                 r"\b(?:no|not|without|don't|do not)\s+(?:feed\w*|food|water|transport|take|bring)\b", goal, re.I):
        return None
    if len(re.findall(r"\bif\b", goal, re.I)) > 1:
        return None
    condition_clauses = re.findall(r"\bif\b([^.;]*?)(?=\b(?:then|else|otherwise)\b|[.;]|$)", goal, re.I)
    if any(re.search(r"\b(?:not|no|never)\b|n't\b", clause, re.I) for clause in condition_clauses):
        return None  # Negated predicates need semantic interpretation, not inversion guesses.
    tail = re.split(r"\b(?:else|otherwise)\b", goal, maxsplit=1, flags=re.I)
    else_feeding = len(tail) > 1
    if else_feeding and (not feeding_requested(tail[1]) or re.search(
            r"\b(?:no|not|don't|do not|foster|shelter|owner|transport|take|bring|euthan\w*|treat\w*|medicat\w*)\b", tail[1], re.I)):
        return None
    # Multiple independent requests outside this narrow fallback need the model.
    if re.search(r"\b(?:foster|reunite|owner|medicat\w*|surgery|euthan\w*|vaccinat\w*|burger|adopt)\b", goal, re.I):
        return None
    def need(ident, label, reason, when=None, after=None):
        return {"id": ident, "label": label, "reason": reason, "after": after or [],
                "gates": [] if when is None else [{"decision_id": "clinic_needed", "when": when}]}
    needs = [need("veterinary_assessment", "On-site veterinary assessment",
                  "A qualified veterinary professional assesses whether clinic care is necessary; the result is not assumed."),
             need("safe_containment", "Safe handling for the clinic trip",
                  "Qualified help with safe handling for the conditional trip, not an instruction to handle the animal now.", True),
             need("transport", "Transport to appropriate care",
                  "Only the medically necessary branch includes transport to an agreed receiving location.", True),
             need("receiving_care", "A provider ready to receive the animal",
                  "Verify suitable receiving care for the transport branch, without authorizing treatment.", True)]
    if feeding_requested(goal):
        needs.append(need("feeding", "Appropriate feeding and basic welfare support",
            "Preserve the requested feeding; the qualified responder decides what is appropriate, not the model.",
            False if else_feeding else None, ["veterinary_assessment"]))
    return {"goal": goal, "requirements": needs,
            "decisions": [{"id": "clinic_needed",
                "condition": "the veterinary assessment finds clinic care medically necessary",
                "source_quote": goal, "assessed_by": "veterinary_assessment"}],
            "uncertainties": ["The assessment result is not yet known. Unknown does not activate either branch.",
                "The exact receiving location and any branch-specific prices must be verified with the selected helpers."]}


def start_rule(need: dict, definition: dict) -> str:
    decisions = {d["id"]: d for d in definition.get("decisions", [])}
    needs = {n["id"]: n for n in definition.get("requirements", [])}
    clauses = []
    for gate in need.get("gates", []):
        d = decisions[gate["decision_id"]]
        assessor = needs[d["assessed_by"]]["label"]
        clauses.append(f'{assessor} must communicate {"YES" if gate["when"] else "NO"} for: {d["condition"]}')
    for ident in need.get("after", []):
        if ident not in {decisions[g["decision_id"]]["assessed_by"] for g in need.get("gates", [])}:
            clauses.append(f'After: {needs[ident]["label"]}')
    return "; ".join(clauses)


def bind_rules(definition: dict) -> dict:
    """Add read-only display/verbalization metadata to coverage, not model results."""
    decisions = {d["id"]: d for d in definition.get("decisions", [])}
    inherited = effective_gates(definition)
    result = []
    for n in definition.get("requirements", []):
        gates = [{"decision_id": ident, "when": value} for ident, value in inherited[n["id"]].items()]
        result.append({**n, "effective_gates": gates,
            "start_rule": start_rule({**n, "gates": gates}, definition),
            "plan_condition_phrases": [("if " if g["when"] else "unless ") +
                decisions[g["decision_id"]]["condition"] for g in gates]})
    return {**definition, "requirements": result}


def without_plan_conditions(text: str, needs: list[dict]) -> str:
    """Exact, scoped language only; additional provider IFs remain unresolved.

    This does not treat any condition as satisfied. It distinguishes willingness
    to perform an already-conditional task from a new operational prerequisite.
    Paraphrases that cannot be verified remain conservatively unresolved.
    """
    result = text
    phrases = {p for n in needs for p in n.get("plan_condition_phrases", [])}
    phrases |= {n["start_rule"] for n in needs if n.get("start_rule")}
    for phrase in sorted(phrases, key=len, reverse=True):
        result = re.sub(r"(?<!\w)(?:only\s+)?" + re.escape(phrase) + r"(?!\w)", "[agreed task condition]", result, flags=re.I)
    return result


CONDITIONAL_PLANNING_INSTRUCTION = """
Conditional goals are ONE plan, not an assessment-versus-transport choice.
Represent every IF/THEN/ELSE decision explicitly. Unknown is not false. Preserve
both requested branches, feeding, exclusions and prerequisites. Never mark a
condition satisfied, infer a medical result, or authorize both branches at once.
Use decisions: [{"id":"clinic_needed","condition":"the veterinary assessment finds clinic care medically necessary",
"source_quote":"exact words from the CONFIRMED outcome","assessed_by":"veterinary_assessment"}].
Each requirement may include gates: [{"decision_id":"clinic_needed","when":true}],
and after: ["prerequisite_task_id"]. A false gate is the ELSE branch. No gates means
unconditional within the approved plan. All gates on a task must be satisfied.
The assessed_by task must exist. A medical decision requires veterinary_assessment,
not a neighbor or a model diagnosis. No dependency cycles or incompatible branches.
For 'if clinic is necessary transport, else feed': assessment is unconditional;
handling/transport/receiving belong to the true branch; feeding belongs to false.
For 'assess and feed, with transport only if needed', feeding is not ELSE-only.
The list includes capabilities for the whole conditional plan, so the user may
approve its full scope and price limits in advance. Contingent helpers agree to
wait for the qualified assessor's result before their task begins. This is not
proof that the result is known or work has happened. Do not demand a new rescue
goal merely to take a branch already within the approved plan. Extra work, new
prices or medical treatment still need separate approval. Free-form conditions
and task IDs are allowed; these examples are not an exhaustive service menu.
"""


def effective_gates(definition: dict) -> dict[str, dict[str, bool]]:
    """Include ancestor task/assessment gates for nested decisions."""
    validate_graph(definition)
    needs = {n['id']: n for n in definition.get('requirements', [])}
    decisions = {d['id']: d for d in definition.get('decisions', [])}
    memo = {}
    def collect(ident):
        if ident in memo:
            return memo[ident]
        n = needs[ident]
        result = {g['decision_id']: g['when'] for g in n.get('gates', [])}
        parents = set(n.get('after', [])) | {decisions[g['decision_id']]['assessed_by'] for g in n.get('gates', [])}
        for parent in parents:
            result.update(collect(parent))
        memo[ident] = result
        return result
    return {ident: collect(ident) for ident in needs}


def gate_states(definition: dict, results: dict | None = None) -> dict[str, str]:
    """Pure evaluation of recorded human results; never truth by model inference.

    Values outside an exact bool are unknown (not false). A false AND operand
    rules out the task, even if another operand has not yet been determined.
    """
    results = results or {}
    states = {}
    for ident, gates in effective_gates(definition).items():
        if not gates:
            states[ident] = 'initial'
            continue
        values = [(results.get(decision_id) or {}).get('value') for decision_id in gates]
        if any(type(value) is bool and value != expected for value, expected in zip(values, gates.values())):
            states[ident] = 'not_needed'
        elif all(type(value) is bool for value in values):
            states[ident] = 'eligible'
        else:
            states[ident] = 'pending'
    return states
