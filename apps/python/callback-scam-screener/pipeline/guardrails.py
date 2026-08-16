"""Runtime guardrails around real-world side effects — placing a CALL-E call
and spending LLM tokens — enforced in code, not just documented as policy,
so they hold regardless of how much we trust the CALL-E CLI/SDK or a caller
of this pipeline. Independent of CALL-E's own plan/confirm safety flow;
this is our layer on top of it."""

import datetime
import json
import re
from pathlib import Path

DEFAULT_STATE_PATH = Path(__file__).resolve().parent.parent / ".call_guardrail_state.json"
DEFAULT_LLM_BUDGET_STATE_PATH = Path(__file__).resolve().parent.parent / ".llm_budget_state.json"

# List pricing, USD per million tokens. Update if pricing changes; used only
# to estimate spend for the budget cap below — keep in step with whichever
# provider/model pipeline.llm_providers actually calls.
# Anthropic: https://www.anthropic.com/pricing
# Gemini: https://ai.google.dev/gemini-api/docs/pricing
MODEL_PRICING_PER_MTOK = {
    "claude-sonnet-5": {"input": 3.00, "output": 15.00},
    "claude-opus-5": {"input": 15.00, "output": 75.00},
    "claude-haiku-4-5-20251001": {"input": 0.80, "output": 4.00},
    "gemini-3.6-flash": {"input": 0.75, "output": 3.75},  # rate through 2026-12-31; rises to 1.50/7.50 in 2027
}
DEFAULT_MODEL_PRICING = MODEL_PRICING_PER_MTOK["claude-sonnet-5"]


class GuardrailViolation(Exception):
    pass


class CallGuardrails:
    def __init__(
        self,
        allowed_numbers: set[str] | None,
        max_calls: int = 20,  # matches the free-tier call allotment
        state_path: Path = DEFAULT_STATE_PATH,
    ):
        """allowed_numbers=None means unrestricted (production mode) — pass an
        explicit set of dev/test numbers during development so the pipeline
        physically cannot dial a real, unreviewed number by accident."""
        self.allowed_numbers = {normalize_phone(n) for n in allowed_numbers} if allowed_numbers is not None else None
        self.max_calls = max_calls
        self.state_path = state_path
        self._state = self._load_state()

    def _load_state(self) -> dict:
        if self.state_path.exists():
            return json.loads(self.state_path.read_text(encoding="utf-8"))
        return {"calls_placed": 0, "called_numbers": []}

    def _save_state(self) -> None:
        self.state_path.write_text(json.dumps(self._state, indent=2), encoding="utf-8")

    def check(self, phone_number: str) -> None:
        normalized = normalize_phone(phone_number)

        if self.allowed_numbers is not None and normalized not in self.allowed_numbers:
            raise GuardrailViolation(
                f"{phone_number} is not in the dev/test allowlist — refusing to dial."
            )

        if normalized in self._state["called_numbers"]:
            raise GuardrailViolation(
                f"{phone_number} was already screened once — refusing to re-dial the same number."
            )

        if self._state["calls_placed"] >= self.max_calls:
            raise GuardrailViolation(
                f"Call budget of {self.max_calls} reached — refusing to place another call."
            )

    def record_call(self, phone_number: str) -> None:
        self._state["calls_placed"] += 1
        self._state["called_numbers"].append(normalize_phone(phone_number))
        self._save_state()


class BudgetExceeded(Exception):
    pass


class LLMBudgetGuard:
    """Tries to cap LLM spend (tag_transcript_llm) at a daily dollar limit,
    checked before each call against a running total tracked from the API's
    own reported token usage — not an estimate made before the call. Resets
    automatically at the next calendar day. This is an application-level
    guard, not a platform-enforced hard limit: it won't catch concurrent
    runs sharing one key, and MODEL_PRICING_PER_MTOK can drift out of date.
    Default of $1.00/day is deliberately small: this pipeline is meant to
    run on each user's own ANTHROPIC_API_KEY, not a shared/bundled one, and
    this cap is meant to help stop a bug or runaway loop from spending past
    pocket change on anyone's key, including a maintainer's."""

    def __init__(self, daily_limit_usd: float = 1.00, state_path: Path = DEFAULT_LLM_BUDGET_STATE_PATH):
        self.daily_limit_usd = daily_limit_usd
        self.state_path = state_path
        self._state = self._load_state()

    def _today(self) -> str:
        return datetime.date.today().isoformat()

    def _load_state(self) -> dict:
        if self.state_path.exists():
            state = json.loads(self.state_path.read_text(encoding="utf-8"))
            if state.get("date") == self._today():
                return state
        return {"date": self._today(), "spent_usd": 0.0}

    def _save_state(self) -> None:
        self.state_path.write_text(json.dumps(self._state, indent=2), encoding="utf-8")

    def _roll_over_if_new_day(self) -> None:
        if self._state["date"] != self._today():
            self._state = {"date": self._today(), "spent_usd": 0.0}

    def check(self) -> None:
        self._roll_over_if_new_day()
        if self._state["spent_usd"] >= self.daily_limit_usd:
            raise BudgetExceeded(
                f"Daily LLM budget of ${self.daily_limit_usd:.2f} reached "
                f"(${self._state['spent_usd']:.4f} spent today) — refusing further LLM calls until tomorrow."
            )

    def record_usage(self, model: str, input_tokens: int, output_tokens: int) -> float:
        pricing = MODEL_PRICING_PER_MTOK.get(model, DEFAULT_MODEL_PRICING)
        cost = (input_tokens / 1_000_000) * pricing["input"] + (output_tokens / 1_000_000) * pricing["output"]
        self._roll_over_if_new_day()
        self._state["spent_usd"] += cost
        self._save_state()
        return cost


def normalize_phone(number: str) -> str:
    return "".join(ch for ch in number if ch.isdigit())[-10:]


def redact_phone_number(text: str, phone_number: str) -> str:
    """Best-effort redaction of a specific phone number from text before
    it's sent to a third-party LLM API. Matches the number's core 10 digits
    with an optional leading 0/country-code prefix and any separators
    (spaces, dashes, parens, dots) between digits, since transcripts render
    a spoken number as a digit sequence, not necessarily formatted the same
    way it was dialed. This is defense-in-depth, not a mathematical
    guarantee — it won't catch digits spelled out as words ("oh seven nine
    five..."), which STT engines rarely do for phone numbers specifically
    but could in principle."""
    digits = normalize_phone(phone_number)
    if not digits:
        return text
    spaced_digits = r"[\s\-.()]*".join(re.escape(d) for d in digits)
    pattern = re.compile(r"(?:\+?\d{1,3}[\s\-.()]*)?" + spaced_digits)
    return pattern.sub("[phone number redacted]", text)


# Officially reserved fictional phone-number ranges — anything else that
# looks like a phone number in this codebase should be treated as suspect.
PHONE_SAFE_CORE_PATTERNS = [
    re.compile(r"^7700900\d{3}$"),    # Ofcom UK reserved mobile drama range
    re.compile(r"^2079460\d{3}$"),    # Ofcom UK reserved London landline drama range
    re.compile(r"^\d{3}5550\d{3}$"),  # NANP reserved 555-0100 to 555-0199, any area code
]

# Exact substrings that trip the phone-number heuristic below without being
# one — e.g. version-like identifiers such as model names. Add to this list
# (with a comment explaining why) rather than complicating the regex, if a
# new false positive turns up.
KNOWN_SAFE_NON_PHONE_SUBSTRINGS = {
    "4-5-20251001",  # from the model name "claude-haiku-4-5-20251001"
}


def find_unsafe_phone_numbers(text: str) -> list[str]:
    """Scans text for phone-number-shaped substrings that aren't from an
    officially reserved fictional range. Best-effort heuristic, not a
    guarantee — exists as a repo-wide safety net (see
    tests/test_no_real_phone_numbers.py) after a real phone number was once
    accidentally used as a test fixture and pushed to a public fork before
    being caught and scrubbed from history. Shared with the local
    .git/hooks/pre-commit safety net used during development (not part of
    this app's own source, since git hooks aren't committed)."""
    flagged = []
    for match in re.finditer(r"\+?\(?\d[\d\-.() ]{7,14}\d", text):
        raw = match.group()
        if raw in KNOWN_SAFE_NON_PHONE_SUBSTRINGS:
            continue
        digits = re.sub(r"\D", "", raw)
        core = digits[-10:] if len(digits) >= 10 else digits
        if len(core) < 9:
            continue
        if len(set(core)) == 1:  # e.g. 1111111111 — obviously synthetic
            continue
        if any(p.match(core) for p in PHONE_SAFE_CORE_PATTERNS):
            continue
        flagged.append(raw)
    return flagged
