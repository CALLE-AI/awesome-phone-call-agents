"""The understanding layer: read the transcript and work out how the person actually is.

Backed by an OpenAI-compatible endpoint (TokenRouter, model `z-ai/glm-5.3-free`), used when
TOKENROUTER_API_KEY is set. It sees only the fields still unresolved, the help the caller was able
to offer, and the transcript, and returns those fields with a piece of evidence each.

The design problem this solves is not phrasing, it is under-reporting. People do not answer in the
words a schema expects, and old people in particular do not answer in words that match how they are:
"oh I'm fine, don't make a fuss" is said by someone whose swamp cooler died yesterday, and the fact
that decides the field arrives afterwards, as an aside, in the same breath as an apology for taking
up your time. Extraction that scores the self-assessment gets that call wrong in the direction that
gets somebody hurt. So this step judges by what the person DESCRIBES, weighs concrete detail over
self-rating, and shows its work: every value comes back with the words that produced it, which land
in the trace and in the captain's review panel.

The mirror-image error is taken just as seriously. A quiet voice, an apology, or a short call is not
a finding; a volunteer sent to the wrong door twice stops reading the third alert. Manufacturing
alarm and missing distress are both failures of the same job.

Two properties bound it, and neither is about phrasing:

* **It cannot manufacture what was never said.** Whether the caller actually offered a given kind of
  help is not inferred at all — an option that was never said out loud is neither accepted nor
  declined, however grateful the person was — and `merge_reconciled` grounds every quote it returns
  in what a human turn actually contains. `alarming_quote` ends up verbatim in a HandoffPacket that
  a responder may be read; a sentence nobody said must never get that far.
* **It cannot break a sweep.** The free tier is best-effort, so every failure path returns None,
  degrading to exactly the NullReconciler behaviour: unknowns stay unknown, and unknown about a
  power-dependent neighbour is itself escalated. A flaky model can cost a resolved field; it can
  never cost a missed neighbour.
"""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

from app import obs

log = logging.getLogger("buddye.reconcile")

SYSTEM = (
    "You are the understanding layer of an automated neighbourhood check-in system. A hazard — "
    "extreme heat, a power cut, a flood — is affecting a neighbourhood, and an automated caller has just "
    "phoned one person on a block captain's list to find out whether they are all right. You are reading "
    "the transcript of that call. A volunteer neighbour acts on what you write, and the person on the "
    "phone may be old, ill, frightened, or on their own.\n\n"
    "Each field's description says what it means and what \"yes\" and \"no\" are for that field. Follow it. "
    "These principles decide everything the description cannot.\n\n"
    "WHAT THEY DESCRIBE OUTWEIGHS HOW THEY RATE THEMSELVES. This is the most important rule you have. "
    "Older people systematically play things down. \"Oh, I'm fine\", \"I'm alright\", \"I don't want to be "
    "any trouble\", \"don't make a fuss\", \"mustn't grumble\" are said by people who are not fine. When "
    "somebody calls themselves alright and then mentions something concrete — the cooler stopped "
    "yesterday, the fan quit, they have not been able to get out of the chair since yesterday, they ran "
    "out of water, the pills ran out on Friday, they have not eaten today, the house is boiling — the "
    "concrete detail decides the field and the reassurance does not. Read the whole transcript before you "
    "answer: the detail almost always comes after the reassurance, in passing, often as an apology.\n\n"
    "DO NOT MANUFACTURE ALARM. The opposite mistake is just as bad: it sends a volunteer to the wrong "
    "door and teaches her to ignore the next alert. Politeness, cheerfulness, an apology, a frail or "
    "quiet voice, a slow answer, a short call, or living alone are NOT findings. Never write down a "
    "symptom, a fall, a shortage, or a worry that nobody described. If the transcript does not establish "
    "a field, the answer is \"unknown\" (or an empty string, or an empty list) — and \"unknown\" is a "
    "genuinely useful answer here, because the people reading this act on it.\n\n"
    "SILENCE IS A FINDING, NOT AN ERROR. Nobody answering, an answering machine, or a call that ended "
    "after two words does not mean the person is fine and does not mean anything is wrong: it means "
    "nothing was established. Every field is \"unknown\", the lists are empty, the quotes are \"\". Never "
    "answer \"yes, safe\" because an empty transcript contains nothing alarming.\n\n"
    "CONFUSION IS A FINDING IN ITS OWN RIGHT. Not knowing what day it is, not knowing where they are, "
    "losing the thread, repeating the same sentence, answering a question that was not asked, or speech "
    "that is slurred or rambling: record it — the distress field is \"yes\" and it belongs in concerns in "
    "their own words. In heat, confusion can be heat illness rather than ordinary forgetfulness. You are "
    "not diagnosing anyone; you are reporting what you heard, and this is worth reporting.\n\n"
    "SOMEONE WHO CANNOT HEAR THE QUESTIONS is not confused. \"What?\", \"you'll have to speak up\", "
    "\"I can't hear you, love\", or answers that do not line up with what was asked mean the questions "
    "never got through: those fields are \"unknown\", never \"no\". That someone on the list cannot be "
    "reached by telephone is itself worth putting in concerns, because it is how they will be missed.\n\n"
    "SOMEONE ELSE ANSWERED. If a daughter, a carer, a neighbour, or a housemate is on the line, the "
    "person themselves was not reached — say so — even if the call went well. What that third party "
    "reports about them is still real information: \"mum's air conditioning has been out since Tuesday\" "
    "is a finding, so use it for the condition checks and make clear in the evidence that somebody else "
    "said it. But secondhand reassurance is the weakest evidence there is: do not accept \"she's fine\" "
    "from a person who did not describe her day.\n\n"
    "BACKGROUND SOUNDS. A transcript may note things that are not speech: [alarm sounding], [smoke "
    "detector], [dog barking], [laboured breathing], [no answer], [line noise]. Treat those as something "
    "observed about the situation, not as words the person said — a medical-equipment alarm or a smoke "
    "alarm audible behind them belongs in concerns. Never put a bracketed note, or the automated "
    "caller's own words, into a quote field. Quotes are the person's own speech, copied as they said it.\n\n"
    "HELP. You are told which help options the caller could offer and the exact words it was given to "
    "say. An option counts as accepted or declined only if the caller actually said it out loud on this "
    "call AND the person answered it. Whether it was said at all is the one thing you may never infer, "
    "however agreeable the person was; an option that never came up goes in neither list. Any clear "
    "assent is acceptance (\"yes please\", \"that would be lovely\", \"if it's no trouble\"). And note "
    "which way round refusal runs: \"I don't want to be a bother\" turns down the offer, it does not "
    "establish that they are fine.\n\n"
    "QUESTIONS ARE NOT ANSWERS. \"Sorry, what was that?\", \"who is this?\", \"hold on\" — these are "
    "requests, not positions. Keep reading; the answer, if there is one, comes after the caller replied.\n\n"
    "EMPTY IS USUALLY THE RIGHT ANSWER for a field like alarming_quote, because on most calls the person "
    "is all right and said nothing alarming. Never write a sentence into one of those fields to fill it "
    "in. \"\" means nothing alarming was said, which is good news; inventing an alarming sentence is the "
    "worst thing you can do in this system.\n\n"
    "THE SAME GOES FOR A NUMBER. A field asking how long something will last, or how much of something "
    "they have, is \"\" unless they actually said a figure or a rough time (\"about four hours\", \"the "
    "battery's nearly gone\", \"half a case left\"). Never work one out from the fact that they own the "
    "equipment, from what such a thing usually lasts, or from anything you were told about them before "
    "the call. Somebody decides how urgently to reach that person from this number, and an invented one "
    "reads as reassurance.\n\n"
    "For every field return an object {\"value\": <the value the schema asks for>, \"evidence\": <the "
    "words from a human turn that decided it, copied as closely as you can, or \"\" if nothing in the "
    "transcript supports it>}. Use \"unknown\" for a tri-state, \"\" for free text, and [] for a list "
    "when the transcript does not establish a value. Do not add fields.\n\n"
    "Reply with a single JSON object mapping each requested field name to that object, and nothing else: "
    "no prose, no markdown fences. Every field gets the object form, like this:\n"
    '{"is_safe_now": {"value": "no", "evidence": "I\'m fine really, the cooler packed up yesterday is all"}, '
    '"checks.has_water": {"value": "unknown", "evidence": ""}}'
)

_JSON_BLOCK = re.compile(r"\{.*\}", re.S)
_TRANSPORT = ("timeout", "connection", "apiconnection")


def is_response_format_rejection(exc: Exception) -> bool:
    """Is this the gateway saying it does not support `response_format`, rather than the network?

    A 4xx is the gateway refusing the request, which the no-json retry can fix. A timeout or a
    dropped connection is not: retrying without json_mode just spends the timeout twice.
    """
    status = getattr(exc, "status_code", None) or getattr(getattr(exc, "response", None), "status_code", None)
    if status is not None:
        return 400 <= int(status) < 500
    if any(word in type(exc).__name__.lower() for word in _TRANSPORT):
        return False
    text = str(exc).lower()
    return "response_format" in text or "json" in text or "400" in text


def extract_json_object(text: str) -> dict[str, Any] | None:
    """Parse the model's reply. Tolerates markdown fences and leading prose, which a free-tier
    model may emit even when asked not to."""
    if not text:
        return None
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    match = _JSON_BLOCK.search(cleaned)
    for candidate in (cleaned, match.group(0) if match else None):
        if not candidate:
            continue
        try:
            data = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict):
            return data
    return None


def unwrap(data: dict[str, Any], wanted: set[str]) -> tuple[dict[str, Any], dict[str, str]]:
    """Split {"field": {"value": v, "evidence": q}} into a patch and its evidence.

    A bare value is accepted too: a free model asked for a wrapper will sometimes send the value
    alone, and that is still a usable answer — it just arrives without its justification.
    """
    patch: dict[str, Any] = {}
    evidence: dict[str, str] = {}
    for key, raw in data.items():
        if key not in wanted:
            continue  # a free model may volunteer fields nobody asked about
        if isinstance(raw, dict) and "value" in raw:
            patch[key] = raw["value"]
            quote = raw.get("evidence")
            if isinstance(quote, str) and quote.strip():
                evidence[key] = quote.strip()
        else:
            patch[key] = raw
    return patch, evidence


class GlmReconciler:
    """OpenAI-compatible chat completion. `client` is injectable so tests never reach the network."""

    name = "glm"

    def __init__(self, *, api_key: str, model: str = "z-ai/glm-5.3-free",
                 base_url: str = "https://api.tokenrouter.com/v1", timeout_s: float = 90.0, client: Any = None) -> None:
        self.model = model
        self.base_url = base_url
        self.last_meta: dict[str, Any] | None = None  # telemetry for the timeline; see runner._evaluate
        if client is not None:
            self.client = client
        else:
            from openai import AsyncOpenAI

            self.client = AsyncOpenAI(base_url=base_url, api_key=api_key, timeout=timeout_s, max_retries=0)

    async def _complete(self, messages: list[dict[str, str]], *, json_mode: bool) -> Any:
        kwargs: dict[str, Any] = {"model": self.model, "messages": messages, "temperature": 0}
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        return await self.client.chat.completions.create(**kwargs)

    def build_prompt(
        self,
        *,
        sub_schema: dict[str, Any],
        partial_result: dict[str, Any] | None,
        transcript: list[dict[str, Any]],
        summary: str | None,
        help_offered: list[dict[str, Any]] | None,
    ) -> str:
        # This prompt is the one payload that carries a named person's words off this machine, so it
        # goes through the same redaction every other outbound payload does. It only masks numbers
        # and credentials — the health content is the point of the call and cannot be removed — but a
        # phone number has no bearing on how somebody is, so it does not need to be sent.
        lines = [f"{t.get('speaker', 'unknown')}: {obs.redact(t.get('text', ''))}" for t in transcript]
        parts = [
            "Unresolved fields (JSON Schema; reply with exactly these keys):\n" + json.dumps(sub_schema, indent=1),
        ]
        if help_offered:
            # Without these the understanding layer cannot tell "they turned down the cooling centre"
            # from "the cooling centre was never mentioned". The first is a fact about the person and
            # the second is a fact about the call, and only one of them means she is coping.
            stated = "\n".join(
                f"  - {o.get('key') or o.get('field')} ({o.get('label')}): \"{obs.redact(o.get('text', ''))}\""
                for o in help_offered
            )
            parts.append(
                "Help the caller was able to offer on this call, with the identifier each one maps to and the exact "
                "words it was given to say. The caller may have paraphrased, and may never have got to them — check "
                "the transcript for whether each one was actually said out loud:\n" + stated
                + "\nAn option nobody mentioned on the call belongs in neither the accepted nor the declined list."
            )
        else:
            parts.append(
                "There was no help to offer on this call. Nothing can have been accepted or declined; those lists are "
                "empty, whatever the person said they would like."
            )
        parts += [
            "Values already extracted (for context only):\n" + json.dumps(obs.redact(partial_result or {}), indent=1),
            "Provider summary:\n" + (obs.redact(summary) if summary else "(none)"),
            # "(no transcript)" is a real state with a real meaning: nobody picked up. The prompt says
            # so above, so the model reads silence as unknown rather than inventing an answer.
            "Transcript:\n" + ("\n".join(lines) or "(no transcript — nobody spoke on this call)"),
        ]
        return "\n\n".join(parts)

    async def reconcile(
        self,
        *,
        schema: dict[str, Any],
        partial_result: dict[str, Any] | None,
        failing_fields: list[str],
        transcript: list[dict[str, Any]],
        summary: str | None,
        help_offered: list[dict[str, Any]] | None = None,
        # `disclosures` is what the ported ShiftFill runner called this argument and `help_offers` is
        # what CallContract calls the field. A keyword mismatch between two modules ported in
        # parallel would raise a TypeError at the call site, outside the fail-open try below, and
        # take the sweep down with it — which is the one thing this layer is not allowed to do.
        # `help_offered` is canonical; the aliases exist so a wiring mistake cannot cost a call.
        disclosures: list[dict[str, Any]] | None = None,
        help_offers: list[dict[str, Any]] | None = None,
        **unexpected: Any,
    ) -> dict[str, Any] | None:
        from app.calls.contract import iter_schema_fields

        offers = help_offered if help_offered is not None else (help_offers if help_offers is not None else disclosures)
        if unexpected:
            # Swallowing the kwarg keeps the sweep alive, but silently is the wrong kind of quiet:
            # if the offers arrived under a name nobody here knows, the layer is judging "accepted"
            # and "declined" with no idea what was said out loud, which is the exact confusion this
            # argument exists to prevent. Say so where the run log will show it.
            log.warning("reconcile.unexpected_kwargs=%s (offers reaching the prompt: %d)",
                        sorted(unexpected), len(offers or []))

        # Flatten to dotted paths so a nested condition check can be asked for by name.
        wanted = set(failing_fields)
        props = {path: spec for path, spec, _ in iter_schema_fields(schema) if path in wanted}
        if not props:
            return None
        sub_schema = {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}
        user = self.build_prompt(sub_schema=sub_schema, partial_result=partial_result, transcript=transcript,
                                 summary=summary, help_offered=offers)
        messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]

        started = time.monotonic()
        self.last_meta = {"reconciler": self.name, "model": self.model, "fields": sorted(wanted)}
        try:
            try:
                resp = await self._complete(messages, json_mode=True)
                self.last_meta["json_mode"] = True
            except Exception as exc:  # noqa: BLE001
                # Not every OpenAI-compatible gateway supports response_format, so a rejection is
                # worth one retry without it. A timeout is not: retrying doubles the wall clock on a
                # call that was already too slow, and the answer would have been the same.
                if not is_response_format_rejection(exc):
                    raise
                log.info("reconcile.json_mode_unsupported model=%s error=%s", self.model, type(exc).__name__)
                resp = await self._complete(messages, json_mode=False)
                self.last_meta["json_mode"] = False

            text = (resp.choices[0].message.content or "") if getattr(resp, "choices", None) else ""
            usage = getattr(resp, "usage", None)
            if usage is not None:
                self.last_meta["usage"] = {
                    "prompt_tokens": getattr(usage, "prompt_tokens", None),
                    "completion_tokens": getattr(usage, "completion_tokens", None),
                }
            data = extract_json_object(text)
            self.last_meta["latency_ms"] = int((time.monotonic() - started) * 1000)
            if data is None:
                self.last_meta["error"] = "unparseable response"
                log.warning("reconcile.unparseable model=%s chars=%d", self.model, len(text))
                return None
            patch, evidence = unwrap(data, wanted)
            if evidence:
                # Why it decided what it decided, in the person's words. This is shown in the trace,
                # and it is what lets a captain disagree with the machine about her own neighbour.
                self.last_meta["evidence"] = obs.redact(evidence)
            return patch
        except Exception as exc:  # noqa: BLE001
            self.last_meta["latency_ms"] = int((time.monotonic() - started) * 1000)
            self.last_meta["error"] = f"{type(exc).__name__}: {exc}"[:300]
            log.warning("reconcile.failed model=%s error=%s", self.model, type(exc).__name__)
            return None  # degrade to "unknown stays unknown"; never fail the sweep
