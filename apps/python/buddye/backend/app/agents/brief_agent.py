"""The situation brief: three sentences an overseer can act on before they finish reading.

## Why this exists, and why it is the only new model call in the render path

A completed welfare call returns a schema with fifteen-odd fields, a transcript, a risk assessment
and an escalation state. All of that is exact, and none of it is *fast to read*. A coordinator
during a heat emergency has a dozen cases open and about three seconds per one. They do not need a
form; they need to know whether this person is in trouble and what to do about it.

That is a judgement task over evidence — which is what a language model is genuinely good at, and
what a template is not. Rendering the fields themselves is the opposite: a fixed mapping from data
to labels, where a model would add latency, cost and a chance of being wrong about a fact the API
already stated exactly.

So the split this module assumes, and the case page must honour:

* **The structured result renders immediately, deterministically, with no model involved.** Every
  field the call returned is on screen the moment the call completes. That path must never wait on
  an inference endpoint — the free tier answers in 20-100 s, which would make the most important
  screen in the product feel broken.
* **The brief arrives afterwards and is clearly marked as written by a model.** It is an accelerant
  laid on top of complete information, never a substitute for it, and its absence costs nothing:
  the page is fully usable before it lands and if it never lands.

## What it may and may not say

It reads only what is already established: the structured result, the transcript, the risk reasons.
It may weigh and prioritise them. It may not introduce a symptom, a diagnosis, a time or a fact that
is not in its inputs, and it may not contradict the deterministic outcome — the decision table owns
that verdict, and a model that disagreed with it on screen would leave a coordinator unsure which to
believe. Where the evidence is thin it says so; "not established on this call" is a useful sentence
and a guess is not.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Sequence

from app.agents.client import AgentClient, record_action

log = logging.getLogger("buddye.agents.brief")

AGENT = "brief"

SYSTEM = (
    "You write the one-paragraph situation brief that sits at the top of an emergency coordinator's "
    "case page, immediately under the hard data from an automated welfare call.\n\n"
    "Your reader is a volunteer or a duty officer during a heat emergency or a blackout. They have "
    "a dozen people to think about and a few seconds for this one. They can already see every field "
    "the call returned. What they cannot see at a glance is what it ADDS UP TO.\n\n"
    "Return JSON with exactly these keys:\n"
    '  "headline"  — under 90 characters. The single most important true thing about this person '
    "right now. Name them. No hedging, no preamble.\n"
    '  "brief"     — two or three short sentences. What their situation actually is, what in the '
    "call establishes it, and what is unresolved. Plain words a tired person reads correctly the "
    "first time. No jargon, no bullet points, no restating the whole form.\n"
    '  "next_step" — one sentence naming the most useful thing a human could do next, or "" if the '
    "system has already done it.\n"
    '  "watch_for" — one short sentence on what would change the picture, or "".\n'
    '  "confidence" — "high", "medium" or "low": how well the call actually established the '
    "situation. Low is the right answer for a short or confused call, and saying so is useful.\n\n"
    "RULES.\n"
    "Use only what you are given: the structured result, the transcript, and the risk assessment. "
    "Never introduce a symptom, diagnosis, measurement or time that is not in those inputs. Never "
    "contradict the recorded outcome — it was decided by a rules engine and it is the verdict; your "
    "job is to explain the situation behind it, not to re-judge it.\n"
    "Prefer what the person SAID over how they rated themselves. Older people routinely "
    "under-report: \"I'm fine\" followed by \"the cooler stopped and I haven't been up today\" is not "
    "fine, and the concrete detail is the story.\n"
    "If nobody answered, say that plainly and say what it means for THIS person — for someone whose "
    "oxygen runs on wall power during an outage, silence is the most serious thing on the page.\n"
    "Where the call did not establish something that matters, say it was not established. Never fill "
    "a gap with a plausible guess.\n"
    "Reply with the JSON object and nothing else: no prose, no markdown fences."
)


def build_prompt(
    *,
    neighbour: dict[str, Any],
    hazard: dict[str, Any],
    result: dict[str, Any] | None,
    outcome: str,
    outcome_reason: str,
    transcript: Sequence[dict[str, Any]],
    risk_reasons: Sequence[str],
    answered: bool,
) -> str:
    turns = "\n".join(f"{t.get('speaker', '?')}: {t.get('text', '')}" for t in transcript)
    return "\n\n".join(
        [
            "PERSON\n" + json.dumps(neighbour, indent=1, default=str),
            "HAZARD\n" + json.dumps(hazard, indent=1, default=str),
            "WHY THEY WERE CALLED (deterministic triage)\n"
            + ("\n".join(f"- {r}" for r in risk_reasons) or "(none recorded)"),
            f"RECORDED OUTCOME (a rules engine decided this; do not contradict it)\n{outcome} — {outcome_reason}",
            "WHAT THE CALL RETURNED\n"
            + (json.dumps(result, indent=1, default=str) if result else "(no structured result)"),
            "TRANSCRIPT\n" + (turns if answered else "(nobody answered)"),
        ]
    )


def fallback_brief(*, name: str, outcome: str, outcome_reason: str, answered: bool) -> dict[str, Any]:
    """What the page shows when the model is unavailable.

    Deliberately thin and deliberately honest: it restates what is already certain rather than
    imitating the model. A coordinator should be able to tell at a glance that the brief did not
    arrive, because a confident-sounding paragraph assembled by string formatting is worse than none.
    """
    return {
        "headline": f"{name}: {outcome.replace('_', ' ').lower()}",
        "brief": outcome_reason or "",
        "next_step": "",
        "watch_for": "",
        "confidence": "low",
        "source": "fallback",
        "generated": False,
    }


async def write_situation_brief(
    *,
    hazard_id: str,
    incident_id: str | None = None,
    neighbour: dict[str, Any],
    hazard: dict[str, Any],
    result: dict[str, Any] | None,
    outcome: str,
    outcome_reason: str = "",
    transcript: Sequence[dict[str, Any]] = (),
    risk_reasons: Sequence[str] = (),
    client: AgentClient | None = None,
    session: Any = None,
) -> dict[str, Any]:
    """Summarise one finished call. Always returns something renderable; never raises.

    Returns the brief dict with `source` ("model" or "fallback") and `generated` set, so the case
    page can label it accurately rather than presenting a fallback as if a model wrote it.
    """
    name = str(neighbour.get("name") or neighbour.get("first_name") or "This neighbour")
    answered = bool(transcript)
    fallback = fallback_brief(name=name, outcome=outcome, outcome_reason=outcome_reason, answered=answered)

    if client is None:
        # No key configured. Not an error: the page is complete without this.
        return fallback

    user = build_prompt(
        neighbour=neighbour, hazard=hazard, result=result, outcome=outcome,
        outcome_reason=outcome_reason, transcript=transcript, risk_reasons=risk_reasons, answered=answered,
    )
    call = await client.complete_json(agent=AGENT, system=SYSTEM, user=user)

    data = call.data if call.ok else None
    out = dict(fallback)
    if data:
        out = {
            "headline": str(data.get("headline") or fallback["headline"])[:120],
            "brief": str(data.get("brief") or "").strip(),
            "next_step": str(data.get("next_step") or "").strip(),
            "watch_for": str(data.get("watch_for") or "").strip(),
            "confidence": str(data.get("confidence") or "low").lower(),
            "source": "model",
            "generated": True,
        }
        if out["confidence"] not in {"high", "medium", "low"}:
            out["confidence"] = "low"
        if not out["brief"]:  # a headline with no body is not worth showing over the fallback
            out = dict(fallback)

    record_action(
        hazard_id=hazard_id, incident_id=incident_id, kind="situation_brief", agent=AGENT,
        model=call.model, inputs={"outcome": outcome, "answered": answered,
                                  "neighbour": neighbour.get("id"), "turns": len(transcript)},
        output=out, rationale=out.get("brief", ""), latency_ms=call.latency_ms, error=call.error,
        session=session,
    )
    return out
