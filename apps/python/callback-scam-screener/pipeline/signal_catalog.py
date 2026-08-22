import json
from pathlib import Path

from .guardrails import LLMBudgetGuard
from .llm_providers import PROVIDERS, call_llm
from .models import SignalTag

DEFAULT_CATALOG_PATH = Path(__file__).resolve().parent.parent / "signals.json"


def load_catalog(path: Path | None = None) -> dict:
    with open(path or DEFAULT_CATALOG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def tag_transcript(transcript: str, catalog: dict) -> list[SignalTag]:
    """Cheap, offline tagger used by default for local/mock testing (see
    screen.py --demo) — no API key required. Matches literal example phrases from
    signals.json against the transcript, which only works on synthetic
    transcripts written to contain those exact phrases. Confirmed against a
    real CALL-E test call (real, ad-libbed speech) that this scores 0
    signals despite real red flags being present in the conversation — do
    not use this for real calls, use tag_transcript_llm instead.
    """
    text_lower = transcript.lower()
    tags: list[SignalTag] = []
    for category, block in catalog["categories"].items():
        for sig in block["signals"]:
            quote = None
            present = False
            for phrase in sig.get("examples", []):
                idx = text_lower.find(phrase.lower())
                if idx != -1:
                    present = True
                    quote = transcript[idx : idx + len(phrase)]
                    break
            tags.append(
                SignalTag(id=sig["id"], name=sig["name"], category=category, present=present, quote=quote)
            )
    return tags


def tag_transcript_llm(
    transcript: str,
    catalog: dict,
    provider: str = "gemini",
    model: str | None = None,
    budget: LLMBudgetGuard | None = None,
) -> list[SignalTag]:
    """Real tagger for live calls: an LLM reads the transcript and tags each
    signal present/absent with a supporting quote, per the signal checklist's
    original design (see README.md). This exists because tag_transcript's
    keyword matching does not generalize to real, ad-libbed speech —
    confirmed against a real CALL-E test call, which it scored 0/0 despite
    real red flags being present (evasive on company name, refused a
    verifiable callback number).

    Provider-agnostic (see llm_providers.py) — "bring your own key" applies
    to whichever provider you already use. Defaults to "gemini" (reads
    GEMINI_API_KEY/GOOGLE_API_KEY), the only provider currently registered
    in PROVIDERS; add another provider there rather than defaulting to one
    that isn't registered. Requires that provider's own API key in the
    environment — deliberately not bundled or shared: every user of this
    project brings their own. Pass a guardrails.LLMBudgetGuard as `budget`
    to cap daily spend (see run_pipeline's tagger parameter for how to wire
    this via functools.partial)."""
    if budget is not None:
        budget.check()

    signal_list = [
        {"id": sig["id"], "name": sig["name"], "category": category}
        for category, block in catalog["categories"].items()
        for sig in block["signals"]
    ]

    prompt = f"""You are a security analyst reviewing a phone call transcript for callback-scam red flags.

For each signal below, determine whether it is present in the transcript. Judge based on what the caller \
actually said or did — infer intent from natural phrasing, not just exact keyword matches.

Signals:
{json.dumps(signal_list, indent=2)}

Transcript:
{transcript}

Respond with ONLY a JSON array, no other text, in this exact form:
[{{"id": "<signal id>", "present": true or false, "quote": "<short supporting quote from the transcript, or null if not present>"}}, ...]
Include exactly one entry for every signal id listed above."""

    response = call_llm(prompt, provider=provider, model=model)
    used_model = model or PROVIDERS[provider]["default_model"]

    if budget is not None:
        budget.record_usage(used_model, response.input_tokens, response.output_tokens)

    raw = response.text.strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.startswith("json"):
            raw = raw[4:]
    parsed = {entry["id"]: entry for entry in json.loads(raw)}

    tags: list[SignalTag] = []
    for category, block in catalog["categories"].items():
        for sig in block["signals"]:
            entry = parsed.get(sig["id"], {})
            tags.append(
                SignalTag(
                    id=sig["id"],
                    name=sig["name"],
                    category=category,
                    present=bool(entry.get("present", False)),
                    quote=entry.get("quote"),
                )
            )
    return tags


def tag_from_structured_result(structured_result: dict, catalog: dict) -> list[SignalTag]:
    """Unused by default — kept for reference only. The design assumed
    CALL-E would populate custom fields in `extracted` from instructions in
    the goal text (see build_result_schema), but a real test call proved
    this false: `extracted` only came back with platform-internal bookkeeping
    (goal echo, region, calling metadata), none of the requested fields.
    Retained in case a future formal resultSchema mechanism (e.g. the REST
    /v1/calls endpoint, untested here) actually enforces this."""
    tags: list[SignalTag] = []
    for category, block in catalog["categories"].items():
        for sig in block["signals"]:
            field = sig.get("result_field")
            present = False
            quote = None
            if field and field in structured_result and structured_result[field] is not None:
                value = structured_result[field]
                field_type = sig["field_type"]
                if field_type == "boolean":
                    present = bool(value)
                elif field_type == "boolean_negated":
                    present = value is False
                elif field_type == "enum":
                    present = value in sig.get("present_values", [])
                if present:
                    quote = f"{field}={value!r}"
            tags.append(
                SignalTag(id=sig["id"], name=sig["name"], category=category, present=present, quote=quote)
            )
    return tags


def build_result_schema(catalog: dict) -> dict:
    """Unused by default — see tag_from_structured_result docstring. Kept in
    case a future formal resultSchema mechanism actually enforces this."""
    properties: dict = {}
    required: list[str] = []

    for context_field in catalog.get("context_fields", []):
        properties[context_field["name"]] = {"type": context_field["type"]}

    for category, block in catalog["categories"].items():
        for sig in block["signals"]:
            field = sig.get("result_field")
            if not field:
                continue
            if sig["field_type"] == "enum":
                # present_values lists the values that count as the signal firing;
                # "none" is always a valid non-firing value for the schema itself.
                properties[field] = {"type": "string", "enum": ["none"] + sig["present_values"]}
            else:
                properties[field] = {"type": "boolean"}
            if category in ("critical", "high"):
                required.append(field)

    return {"type": "object", "properties": properties, "required": required}
