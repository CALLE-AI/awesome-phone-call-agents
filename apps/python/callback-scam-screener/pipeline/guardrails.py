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
    """Application-level guard on which numbers get dialed, not a
    platform-enforced lock: check() and record_attempt()/record_call() do a
    plain read-check-write on a local JSON file with no cross-process
    locking, so two concurrent `screen.py --live` runs (same machine, same
    state file) can both pass check() before either records its attempt,
    and both dial. Same class of limitation LLMBudgetGuard already documents
    for concurrent runs sharing one key. Narrow in practice — it requires
    --unrestricted (the dev/test allowlist path is meant for one contributor
    at a time anyway) and genuinely concurrent invocations, not just back-
    to-back ones."""

    def __init__(
        self,
        allowed_numbers: set[str] | None,
        unrestricted: bool = False,
        max_calls: int = 20,  # matches the free-tier call allotment
        state_path: Path = DEFAULT_STATE_PATH,
    ):
        """Fails closed: pass an explicit set of dev/test numbers in
        allowed_numbers, or pass unrestricted=True to affirmatively
        acknowledge this run may dial any number extracted from an email,
        without a pre-verified recipient. There is no silent "None means
        unrestricted" default — a caller has to say which one it wants.

        allowed_numbers is matched by exact, full E.164 string — not by
        normalize_phone's last-10-digits form. Truncating to 10 digits
        drops the country code, so two genuinely different numbers in
        different countries can share the same last-10-digit suffix once
        each one's own country-code prefix is discarded — an allowlist
        built on that comparison could let an unauthorized destination
        alias its way past it. Every entry must itself be valid E.164,
        checked up front rather than failing silently later."""
        if allowed_numbers is None and not unrestricted:
            raise GuardrailViolation(
                "No dev/test allowlist was given and unrestricted mode was not explicitly "
                "requested — refusing to dial. Pass allowed_numbers=<set of numbers>, or "
                "unrestricted=True if you intend to screen an arbitrary, unverified number."
            )
        if allowed_numbers is not None:
            for n in allowed_numbers:
                if not is_valid_e164(n):
                    raise GuardrailViolation(
                        f"{mask_phone_number(n, n)!r} in allowed_numbers is not a strict E.164 number "
                        "(e.g. +18005550187) — refusing to build an ambiguous allowlist."
                    )
        # Canonicalized (stripped) here and in check()/record_attempt()/
        # record_call() below, since is_valid_e164() itself strips before
        # matching — without stripping here too, "+18005550187" and
        # "+18005550187 " would both individually pass validation yet compare
        # as different keys, letting the exact-match scheme above be defeated
        # by incidental whitespace instead of a real different destination.
        self.allowed_numbers = {n.strip() for n in allowed_numbers} if allowed_numbers is not None else None
        self.max_calls = max_calls
        self.state_path = state_path
        self._state = self._load_state()

    def _load_state(self) -> dict:
        if self.state_path.exists():
            state = json.loads(self.state_path.read_text(encoding="utf-8"))
            state.setdefault("attempted_numbers", [])
            return state
        return {"calls_placed": 0, "called_numbers": [], "attempted_numbers": []}

    def _save_state(self) -> None:
        self.state_path.write_text(json.dumps(self._state, indent=2), encoding="utf-8")

    def check(self, phone_number: str) -> None:
        phone_number = phone_number.strip()  # see __init__'s canonicalization note
        # Masked in every message below (not just the final JSON output) —
        # these GuardrailViolation messages get printed to stderr on a
        # refusal, which is exactly the kind of output that ends up pasted
        # into a bug report or shared log.
        masked = mask_phone_number(phone_number, phone_number)
        if not is_valid_e164(phone_number):
            raise GuardrailViolation(
                f"{masked!r} is not a strict E.164 number (e.g. +18005550187) — "
                "refusing to dial an ambiguously-formatted number."
            )

        # Exact string identity from here on — not normalize_phone's
        # last-10-digits form, which can alias two different countries'
        # numbers together (see __init__'s docstring). phone_number is
        # already confirmed valid E.164 above, so exact comparison is both
        # correct and unambiguous.
        if self.allowed_numbers is not None and phone_number not in self.allowed_numbers:
            raise GuardrailViolation(
                f"{masked} is not in the dev/test allowlist — refusing to dial."
            )

        if phone_number in self._state["called_numbers"]:
            raise GuardrailViolation(
                f"{masked} was already screened once — refusing to re-dial the same number."
            )

        if phone_number in self._state["attempted_numbers"]:
            raise GuardrailViolation(
                f"{masked} has a prior call attempt of unknown outcome — refusing to "
                "dial again until this is resolved manually (check `calle call status`)."
            )

        if self._state["calls_placed"] >= self.max_calls:
            raise GuardrailViolation(
                f"Call budget of {self.max_calls} reached — refusing to place another call."
            )

    def record_attempt(self, phone_number: str) -> None:
        """Marks a number as having a dial attempt in progress, *before* the
        call is actually placed. Recorded this early — rather than only on
        success — so a crash, or a human re-running the same command after an
        ambiguous outcome, can't slip a duplicate real dial past check()."""
        phone_number = phone_number.strip()
        if phone_number not in self._state["attempted_numbers"]:
            self._state["attempted_numbers"].append(phone_number)
            self._save_state()

    def record_call(self, phone_number: str) -> None:
        phone_number = phone_number.strip()
        self._state["calls_placed"] += 1
        self._state["called_numbers"].append(phone_number)
        if phone_number in self._state["attempted_numbers"]:
            self._state["attempted_numbers"].remove(phone_number)
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


def full_digits_match(a: str, b: str) -> bool:
    """Compares two E.164-ish strings by their complete digit sequence, with
    no truncation — unlike normalize_phone's last-10-digits form, this never
    discards a country code, so it stays safe against the same cross-country
    aliasing exact-string matching was introduced to prevent. Use this
    instead of `==` wherever one side of a comparison might be a real
    provider's own rendering of a number rather than our own validated
    E.164 string — e.g. "+18005550187" vs "18005550187" vs "+1 800 555
    0187" vs "(800) 555-0187" (with the country code) all compare equal;
    "(800) 555-0187" (missing the country code, ambiguous) does not."""
    a_digits = "".join(ch for ch in a if ch.isdigit())
    b_digits = "".join(ch for ch in b if ch.isdigit())
    # Two digit-free strings ("", "unknown", "---") would otherwise compare
    # equal to each other — currently unreachable (both call sites only ever
    # pass an already-validated E.164 value or a regex-extracted string with
    # 9+ digits), but a comparison helper shouldn't rely on its callers never
    # handing it a degenerate input to stay correct.
    return bool(a_digits) and a_digits == b_digits


# ITU-T E.164: a leading '+', then a country code that doesn't start with 0,
# then up to 14 more digits (15 total). Deliberately strict — a caller must
# supply an already-unambiguous, fully-qualified number (with country code)
# rather than have this guess one from a bare national number.
E164_RE = re.compile(r"^\+[1-9]\d{7,14}$")


def is_valid_e164(number: str) -> bool:
    return bool(E164_RE.match(number.strip()))


def mask_phone_number(text: str, phone_number: str) -> str:
    """Partially masks occurrences of phone_number within text, keeping only
    the last 2 digits visible (e.g. "+*********87") — enough for an analyst
    to cross-check against a case reference without the full number ending
    up verbatim in a screenshot, log line, or pasted bug report. Uses the
    same separator-tolerant matching as redact_phone_number; unlike that
    function this doesn't remove the number outright, since callers of this
    one (printed/returned output) still want a masked-but-recognizable form,
    not full redaction."""
    pattern = _phone_number_pattern(phone_number)
    if pattern is None:
        return text

    def _mask(match: re.Match) -> str:
        raw_digits = re.sub(r"\D", "", match.group())
        if len(raw_digits) <= 2:
            return "*" * len(raw_digits)
        return "+" + "*" * (len(raw_digits) - 2) + raw_digits[-2:]

    return pattern.sub(_mask, text)


def _phone_number_pattern(phone_number: str) -> re.Pattern | None:
    """Shared by redact_phone_number and mask_phone_number: matches the
    number's core 10 digits with an optional leading '(', an optional
    leading +/country-code prefix, and any separators (spaces, dashes,
    parens, dots) between digits — since transcripts render a spoken number
    as a digit sequence, not necessarily formatted the same way it was
    dialed. The leading optional open-paren match matters for loosely
    formatted numbers like "(800) 555-0187": without it, the unmatched "("
    was left behind in the output rather than consumed as part of the match."""
    digits = normalize_phone(phone_number)
    if not digits:
        return None
    spaced_digits = r"[\s\-.()]*".join(re.escape(d) for d in digits)
    return re.compile(r"\(?(?:\+?\d{1,3}[\s\-.()]*)?" + spaced_digits)


def redact_phone_number(text: str, phone_number: str) -> str:
    """Best-effort redaction of a specific phone number from text before
    it's sent to a third-party LLM API. This is defense-in-depth, not a
    mathematical guarantee — it won't catch digits spelled out as words
    ("oh seven nine five..."), which STT engines rarely do for phone
    numbers specifically but could in principle."""
    pattern = _phone_number_pattern(phone_number)
    if pattern is None:
        return text
    return pattern.sub("[phone number redacted]", text)


# Officially reserved fictional phone-number ranges — anything else that
# looks like a phone number in this codebase should be treated as suspect.
PHONE_SAFE_CORE_PATTERNS = [
    re.compile(r"^7700900\d{3}$"),   # Ofcom UK reserved mobile drama range
    re.compile(r"^2079460\d{3}$"),   # Ofcom UK reserved London landline drama range
    re.compile(r"^\d{3}55501\d{2}$"),  # NANP reserved 555-0100 to 555-0199 exactly, any area code —
    # previously ^\d{3}5550\d{3}$, which matched the whole 555-0000 to
    # 555-0999 block; only 555-01XX is actually NANP-reserved, so that let
    # e.g. 555-0500 (a real, assignable exchange number) through as "safe".
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
