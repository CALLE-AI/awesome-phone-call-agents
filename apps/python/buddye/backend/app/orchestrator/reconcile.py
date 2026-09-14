"""Reconcile step: only runs when a call result is missing, invalid, or has unknowns.

The happy path never touches an LLM. When the result is ambiguous, the reconciler gets the
transcript, the help the caller was able to offer, and the *failing fields only*, and may fill them
in by reading what the person meant.

What "ambiguous" means here is worth stating, because it is the opposite of the workflow this code
was ported from. In a hiring cascade an unresolved field means "move on to the next candidate". On a
welfare call it means the block captain does not know whether a 78-year-old with no air conditioning
is sitting in a hot house. So this step exists to squeeze a real answer out of a transcript CALL-E's
extractor gave up on — and where it cannot, "unknown" is passed on as a finding to escalate, never as
a gap to skip.

Two limits are enforced here rather than trusted to the model:

* **It may only resolve, never overturn.** `failing_fields_for` hands it what is unknown or invalid,
  and `merge_reconciled` refuses to replace a definite answer from the provider with a different
  definite answer. CALL-E heard the audio; the reconciler is reading a text transcript of it.
* **Quotes must be grounded.** A quote it returns has to be traceable to something a human turn
  actually contains. The match is fuzzy on purpose — a transcript is punctuated by a machine and
  people repeat themselves — but a sentence nobody said is discarded. This matters more here than it
  did in ShiftFill: `alarming_quote` is copied verbatim into a HandoffPacket and read out to a
  responder, so an invented sentence would be words put into a frightened person's mouth.
"""
from __future__ import annotations

import copy
import difflib
import re
from typing import Any, Protocol

from app import obs
from app.calls.contract import get_path, iter_schema_fields, set_path


_MISSING = object()


class Reconciler(Protocol):
    name: str

    async def reconcile(
        self,
        *,
        schema: dict[str, Any],
        partial_result: dict[str, Any] | None,
        failing_fields: list[str],
        transcript: list[dict[str, Any]],
        summary: str | None,
        help_offered: list[dict[str, Any]] | None = None,
        **extra: Any,
    ) -> dict[str, Any] | None: ...


class NullReconciler:
    """Used when no LLM key is configured.

    Leaves fields unknown — which is not a silent pass. An unresolved `is_safe_now` or
    `checks.equipment_working` reaches the escalation layer as an unknown, and for a
    power-dependent neighbour during an outage that is exactly the case a human is told about.
    """

    name = "null"

    async def reconcile(self, **_: Any) -> dict[str, Any] | None:
        return None


def failing_fields_for(schema: dict[str, Any], result: dict[str, Any] | None, validation_errors: list[str]) -> list[str]:
    """Fields the reconciler should look at: schema-invalid ones plus any required tri-state left unknown.

    Paths are dotted, so a nested condition check comes back as `checks.has_power`.
    """
    fields = iter_schema_fields(schema)
    if result is None:
        return sorted(path for path, _, _ in fields)
    by_path = {path: (spec, req) for path, spec, req in fields}
    bad: set[str] = set()
    for err in validation_errors:
        # jsonschema paths arrive as "checks/has_power" (see CallContract.validate_result)
        raw = err.split(":", 1)[0].strip()
        path = raw.replace("/", ".")
        if path in by_path:
            bad.add(path)
        elif path == "<root>" or path in {p.split(".")[0] for p in by_path}:
            prefix = "" if path == "<root>" else f"{path}."
            for p, (_, req) in by_path.items():
                if req and p.startswith(prefix) and get_path(result, p) is None:
                    bad.add(p)
    for path, (spec, req) in by_path.items():
        if not req:
            continue
        value = get_path(result, path)
        if spec.get("enum") and (value is None or value == "unknown"):
            bad.add(path)
        elif spec.get("type") == "string" and not spec.get("enum") and not str(value or "").strip():
            # A required string left blank is schema-valid, so it raises no validation error and
            # would otherwise never reach the understanding layer. In ShiftFill that hid a missing
            # acceptance quote. Here it is `alarming_quote`: CALL-E leaving it empty is the common,
            # correct case (most people are fine), but it is also what an extractor does when it
            # heard something bad and could not pin the sentence. Ask a second reader — and see the
            # SYSTEM prompt, which is explicit that "" is usually the right answer, precisely
            # because this rule puts the question in front of the model on every quiet call.
            bad.add(path)
    return sorted(bad)


TRI_DEFINITE = {"yes", "no"}
_WORDS = re.compile(r"[a-z0-9']+")

# A quote is accepted when this much of it lines up with something the person actually said.
GROUNDING_RATIO = 0.6

# Turns that are the automated caller talking. Everything else is treated as the human side of the
# call. CALL-E labels turns "bot" / "user" (confirmed on live calls), but the MCP path passes
# whatever labels it is given straight through, and a third party who picks up may not be labelled
# "user" at all. Listing the machine rather than the human means a relative's turn still counts as
# speech that can ground a quote, instead of the quote being silently dropped.
AGENT_SPEAKERS = frozenset({"bot", "agent", "assistant", "system", "ai", "caller", "operator", "buddye", "calle"})


def _normalize(text: str) -> str:
    # Both sides of the comparison are redacted first, because the reconciler only ever *saw* the
    # redacted transcript (see GlmReconciler.build_prompt). Grounding a masked quote against the raw
    # text would compare "call me on ****0142" with "call me on +15550142" and quietly drop a
    # sentence the person really said.
    return " ".join(_WORDS.findall(str(obs.redact(text)).lower()))


def is_human_turn(turn: dict[str, Any]) -> bool:
    return str(turn.get("speaker", "") or "").strip().lower() not in AGENT_SPEAKERS


def quote_is_grounded(quote: str, transcript: list[dict[str, Any]]) -> bool:
    """Did someone on the call actually say something close enough to this for it to stand as evidence?

    Exact containment passes immediately. Otherwise the longest run the quote shares with the human
    speech must cover most of the quote, which tolerates the punctuation, filler, and stutter a
    speech-to-text transcript carries, while still rejecting a sentence that was invented or that
    belongs to the automated caller rather than the person.
    """
    needle = _normalize(quote)
    if not needle:
        return False
    spoken = _normalize(" ".join(t.get("text", "") for t in transcript if is_human_turn(t)))
    if not spoken:
        return False
    if needle in spoken:
        return True
    match = difflib.SequenceMatcher(None, needle, spoken, autojunk=False).find_longest_match(0, len(needle), 0, len(spoken))
    return match.size >= GROUNDING_RATIO * len(needle)


# Lists of help identifiers. An entry in one of these is a claim that the caller said that offer out
# loud and the person answered it, so an identifier that was never on the call has no business here.
HELP_LIST_FIELDS = ("help_accepted", "help_declined")


def merge_reconciled(
    original: dict[str, Any] | None,
    patch: dict[str, Any] | None,
    transcript: list[dict[str, Any]],
    failing_fields: list[str],
    offer_keys: list[str] | None = None,
) -> dict[str, Any] | None:
    """Apply only the failing fields from the patch, and only where the reconciler is allowed to speak.

    Refuses three things: a quote the person cannot be shown to have said, any attempt to replace a
    definite provider answer with a contradicting one, and — when `offer_keys` is supplied — help
    identifiers that were never available on this call. The last one is the welfare analogue of
    ShiftFill's "a term nobody stated cannot be acknowledged": "declined the cooling centre" and "the
    cooling centre was never mentioned" are different facts, and only one of them is about the person.
    """
    if patch is None:
        return original
    allowed_offers = set(offer_keys) if offer_keys is not None else None
    merged = copy.deepcopy(dict(original or {}))
    for path in failing_fields:
        # the reconciler answers with the same dotted keys it was asked about
        if path in patch:
            val = patch[path]
        else:
            val = get_path(patch, path, _MISSING)
            if val is _MISSING:
                continue
        if path.endswith("_quote") and isinstance(val, str) and val.strip():
            if not quote_is_grounded(val, transcript):
                continue  # nobody said this; keep whatever the provider had
        if allowed_offers is not None and path in HELP_LIST_FIELDS and isinstance(val, list):
            val = [k for k in val if k in allowed_offers]
        prior = get_path(merged, path)
        if isinstance(prior, str) and prior in TRI_DEFINITE and isinstance(val, str) and val in TRI_DEFINITE and val != prior:
            continue  # the provider heard the call; a transcript reader does not get to overrule it
        set_path(merged, path, val)
    return merged


def reconciler_name(settings) -> str:  # noqa: ANN001
    """Which reconciler `get_reconciler` would build, without building it. Used by the preflight."""
    choice = getattr(settings, "RECONCILER", "auto")
    if choice == "none":
        return "null"
    if choice == "glm":
        return "glm" if settings.TOKENROUTER_API_KEY else "null"
    if choice == "anthropic":
        return "anthropic" if settings.ANTHROPIC_API_KEY else "null"
    if settings.TOKENROUTER_API_KEY:
        return "glm"
    if settings.ANTHROPIC_API_KEY:
        return "anthropic"
    return "null"


def get_reconciler(settings) -> Reconciler:  # noqa: ANN001
    name = reconciler_name(settings)
    if name == "glm":
        from app.orchestrator.reconcile_glm import GlmReconciler

        return GlmReconciler(
            api_key=settings.TOKENROUTER_API_KEY, model=settings.RECONCILE_MODEL,
            base_url=settings.TOKENROUTER_BASE_URL, timeout_s=settings.RECONCILE_TIMEOUT_S,
        )
    if name == "anthropic":
        from app.orchestrator.reconcile_anthropic import AnthropicReconciler

        return AnthropicReconciler(api_key=settings.ANTHROPIC_API_KEY, model=settings.ANTHROPIC_RECONCILE_MODEL)
    return NullReconciler()
