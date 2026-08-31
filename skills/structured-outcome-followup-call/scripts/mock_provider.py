"""
structured_call — a tiny, standalone, stdlib-only implementation of the
"structured outcome follow-up call" pattern.

Deliberately dependency-free (no Flask, no requests, no database) so this
is trivially runnable and readable on its own, independent of any specific
application. A real CALL-E adapter would implement the same
`VoiceProvider` interface used here by `MockVoiceProvider` — nothing else
in this file or in orchestrate_example.py would need to change.
"""
from __future__ import annotations

import random
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# Core data shapes
# ---------------------------------------------------------------------------


@dataclass
class CallQuestion:
    """One structured question the agent should get an answer to during the call."""

    key: str
    prompt: str


@dataclass
class CallTask:
    """Everything needed to describe the call to a goal-driven voice provider."""

    subject_name: str
    phone_number: str
    context: str  # short natural-language context, e.g. "a recent delivery exception"
    questions: List[CallQuestion]
    reference_id: str


@dataclass
class CallOutcome:
    """Normalized result of a call, regardless of which provider ran it."""

    reference_id: str
    event_type: str  # "completed" | "failed" | "no_answer"
    structured_answers: Optional[Dict[str, Any]] = None
    transcript: Optional[str] = None
    failure_reason: Optional[str] = None


# ---------------------------------------------------------------------------
# Provider interface
# ---------------------------------------------------------------------------


class VoiceProvider(ABC):
    """Abstract interface any voice provider (mock or real) implements."""

    @abstractmethod
    def run_call(self, task: CallTask) -> CallOutcome:
        """
        Run a call to completion and return its outcome.

        A real, asynchronous provider would split this into "initiate" and
        "handle webhook" — this simplified synchronous interface is enough
        for a runnable, dependency-free example. See SKILL.md for how a
        real adapter would extend this pattern for async webhook delivery.
        """
        raise NotImplementedError


class MockVoiceProvider(VoiceProvider):
    """
    Simulates a call without any network access. `forced_scenario` lets a
    caller (like orchestrate_example.py) request a deterministic outcome by
    name instead of getting random answers, which is what makes this
    pattern's example runnable and predictable in a demo or a test.
    """

    def __init__(self, scenario_generators: Dict[str, Callable[[CallTask], Dict[str, Any]]]):
        # scenario_generators maps a scenario name -> a function that builds
        # a structured-answers dict for that scenario, given the task. Kept
        # injectable (rather than hardcoded here) so this file stays
        # domain-agnostic — the *example* supplies delivery-specific
        # scenarios; this file just runs whichever one it's given.
        self.scenario_generators = scenario_generators

    def run_call(self, task: CallTask, forced_scenario: Optional[str] = None) -> CallOutcome:
        if forced_scenario == "failed":
            return CallOutcome(
                reference_id=task.reference_id,
                event_type="failed",
                failure_reason="Simulated provider error: call could not be connected.",
            )
        if forced_scenario == "no_answer":
            return CallOutcome(
                reference_id=task.reference_id,
                event_type="no_answer",
                failure_reason="Simulated: recipient did not answer.",
            )

        generator = self.scenario_generators.get(forced_scenario) if forced_scenario else None
        if generator is None:
            # Fall back to the first registered scenario so this never
            # crashes on an unrecognized name — predictability over
            # strictness for a demo/example utility.
            generator = next(iter(self.scenario_generators.values()))

        answers = generator(task)
        transcript = "\n\n".join(f"Agent: {q.prompt}\nRecipient: {answers.get(q.key)}" for q in task.questions)

        return CallOutcome(
            reference_id=task.reference_id,
            event_type="completed",
            structured_answers=answers,
            transcript=transcript,
        )


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

Rubric = Callable[[Dict[str, Any]], Tuple[str, int, List[str]]]
FollowUpAction = Callable[[str, int, List[str], CallTask], None]


def run_structured_call(
    provider: VoiceProvider,
    task: CallTask,
    rubric: Rubric,
    on_result: FollowUpAction,
    forced_scenario: Optional[str] = None,
) -> CallOutcome:
    """
    The whole pattern in one function: run the call, and — only if it
    completed — score the answers with `rubric` and hand the result to
    `on_result` for whatever follow-up action the caller wants to take.

    `rubric` and `on_result` are both plain callables supplied by the
    adopter, not classes to subclass — keeping the extension points as
    small as possible is deliberate, per this skill's "bring your own
    rubric and action" design.
    """
    if isinstance(provider, MockVoiceProvider):
        outcome = provider.run_call(task, forced_scenario=forced_scenario)
    else:
        outcome = provider.run_call(task)

    if outcome.event_type != "completed":
        return outcome

    level, score, reasons = rubric(outcome.structured_answers or {})
    on_result(level, score, reasons, task)

    return outcome


def new_reference_id() -> str:
    return uuid.uuid4().hex[:12]
