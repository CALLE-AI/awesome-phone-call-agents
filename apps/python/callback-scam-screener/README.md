# Callback Scam Screener

CALL-E screens a suspicious "call this number" phone claim before a human ever dials it.

A callback / TOAD (telephone-oriented attack delivery) scam puts a phone number in an email that falsely claims a payment failed or an account has a problem, and relies on fear to get the recipient to call. Once on the phone, the "support agent" walks the victim into handing over credentials, a payment, or a remote-access tool. These scams route around email filters entirely — the payload is a phone number, not a link or attachment, so nothing is monitoring the channel where the actual attack happens.

This app makes CALL-E dial that number first. It has a short, transparent conversation, and the transcript is scored against a fixed checklist of scam behaviors — remote-access requests, gift-card/crypto/wire payment asks, urgency escalation, evasiveness about identity. No human is exposed to the call, and the agent has no capability to hand over anything real: it has no account data, can't authorize a payment, and can't install anything, by construction rather than by prompting.

## The value is triage, not clearance

A `likely_scam` verdict — especially one forced by a critical signal like a remote-access-software ask — is high-precision enough to fast-track in a SOC queue. A `likely_legitimate` verdict is not the mirror image of that: every verdict still goes to a human, and a text-based test harness found a real false-negative case (a patient scammer who asks for nothing on the first call). See [`docs/CONCEPT.md`](docs/CONCEPT.md#limitations) for the full writeup. This tool reduces workload on the obvious cases; it does not clear anything as safe.

## How this differs from `apps/typescript/verify-contact-claim`

`verify-contact-claim` verifies a suspicious voicemail/text/missed call by dialing the number **printed on the customer's own card** and asking that institution "did you contact this customer recently" — a standing-fact check that legally can't always get answered (it treats `refused_to_confirm` as an expected outcome under Reg P / HIPAA).

Callback Scam Screener dials the **suspicious number from the message itself** and observes how it behaves. It can't tell you whether contact happened, but it can catch a scammer in the act of asking for a remote-access tool or a gift card — evidence a legitimate institution's own line will never produce, because it will never ask for those things. The two are complementary checks on different questions, not competing solutions to the same one.

## Signal checklist

Detection is an LLM pass over the transcript (tag present/absent + supporting quote); scoring is a deterministic function over those tags — every verdict is explainable and auditable, not a black-box judgment. The full config is [`signals.json`](signals.json); this is the human-readable version.

**Critical** — any single occurrence is enough on its own. Legitimate companies never do these on an inbound "you owe us" call, so no context offsets them:

| ID | Signal |
|----|--------|
| C1 | Requests installation of remote-access software (AnyDesk, TeamViewer, UltraViewer, LogMeIn, Chrome Remote Desktop, "let me take control of your screen") |
| C2 | Requests payment via gift card, crypto, or wire transfer |
| C3 | Requests a one-time passcode, MFA code, or full card PIN/CVV read aloud |

**High** — strong indicators, weighted heavily but not decisive alone (3 points each):

| ID | Signal |
|----|--------|
| H1 | Discourages independent verification ("don't call the number on your card," "you have to resolve this with me right now") |
| H2 | Urgency/threat escalation, especially when questioned |
| H3 | Refuses or hedges on stating company name/department clearly |
| H4 | Cannot provide a callback number matching the company's published support line |

**Medium** — corroborating signals only (1 point each): no real hold music/IVR routing (M1 — the weakest signal alone, since small legitimate businesses do this too), inconsistent details vs. the claimed company's known practices (M2), heavy reliance on a fixed script (M3), generic rehearsed phrasing (M4).

**Scoring**: any Critical signal → `likely_scam` outright. Otherwise: score ≥ 6 → `likely_scam`; 3–5 → `inconclusive` (escalate to a human); 0–2 → `likely_legitimate`.

Signals are deliberately behavior-based — what the caller asks you to do — rather than voice/accent/nationality-based, to avoid discriminatory or unreliable heuristics.

## Setup

Python 3.11+ and [`uv`](https://docs.astral.sh/uv/) are recommended:

```bash
cd apps/python/callback-scam-screener
uv sync --dev --extra gemini
```

Only Gemini is currently registered as a selectable `--llm-provider` (see [`pipeline/llm_providers.py`](pipeline/llm_providers.py)) — an Anthropic implementation exists in the same file but isn't wired in yet, since it hasn't been exercised against a real API call the way the Gemini path has. Adding another provider, or re-enabling Anthropic once it's verified, is one function plus one registry entry.

## Try it without any credentials

`screen.py --demo` runs the full pipeline against four canned sample transcripts with a mock CALL-E client — no account, no API key, nothing is dialed:

```bash
uv run python screen.py --demo remote_access   # a caller asks to install AnyDesk -> likely_scam, with a distinct warning
uv run python screen.py --demo giftcard        # a caller asks for a gift card -> likely_scam
uv run python screen.py --demo subtle          # a patient, evasive caller -> inconclusive
uv run python screen.py --demo legit           # a cooperative, verifiable caller -> likely_legitimate
```

## Preview a real email (still no calls placed)

`screen.py` is the real entry point. Preview is the default — it parses an email, runs prechecks, and prints the number it would dial and the exact task CALL-E would receive:

```bash
uv run python screen.py --email samples/suspicious_email.txt --sender-domain secure-alerts-billing.com
```

## Placing one real call

### One-time CALL-E sign-in

`screen.py --live` shells out to the `calle` CLI, so it needs to be installed and authenticated first (Node.js required):

```bash
npm install -g @call-e/cli
calle auth login    # opens a browser to complete sign-in
calle auth status    # confirm it says "usable": true
```

### One-time Gemini key

Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey), then set it as `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) in your environment — see the command below.

### Running it

Live mode needs `--live`, `--confirm`, and `--to-phone` matching the number extracted from the email exactly — this app never guesses which number to dial. The example below points at `samples/suspicious_email.txt`, so `+18005550187` is the same fictional reserved number that email already contains, not a real one — replace both the email and the phone number with your own before running this for real, and never dial a number you don't own or aren't authorized to call:

```bash
export GEMINI_API_KEY="<your key>"
uv run python screen.py \
  --email samples/suspicious_email.txt \
  --sender-domain secure-alerts-billing.com \
  --live --confirm \
  --to-phone "+18005550187" \
  --allow-number "+18005550187" \
  --llm-provider gemini
```

`--allow-number` builds an explicit dev/test allowlist enforced in code before dialing (see [`pipeline/guardrails.py`](pipeline/guardrails.py)) — omit it entirely only once you're intentionally running unrestricted.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success — a verdict was returned, or the email correctly didn't meet the suspicious-alert bar |
| 50 | Usage error or explicit refusal: missing `--confirm`, missing `--to-phone`, or `--to-phone` doesn't match the number extracted from the email |
| 51 | CALL-E's own platform guardrails rejected the call plan (e.g. a goal that isn't transparent about being an AI) |
| 52 | Blocked by this app's own guardrails: dev/test allowlist, repeat-dial protection, call cap, or the daily LLM budget cap |

## Side effects, credentials, data

- One CALL-E call per `screen.py --live` run. No recurring schedule, nothing to clean up.
- `--to-phone` is cross-checked against the number extracted from `--email` and refused on mismatch — this app never guesses a phone number to dial (see `docs/design-principles.md` Principle 3 in the parent repo).
- No API key is bundled or shared. CALL-E auth lives in your own local `~/.calle-mcp` token cache from `calle auth login`; your LLM provider's key (`GEMINI_API_KEY`/`GOOGLE_API_KEY` — see `--llm-provider`) is read from your own environment, and the app fails with a clear message rather than falling back to anything shared.
- This app tries to cap LLM spend in code, checking a running total (tracked from the API's own reported token usage, not a pre-call estimate) before every call — see `pipeline/guardrails.LLMBudgetGuard`. It's an application-level guard, not a platform-enforced hard limit: it won't catch concurrent runs sharing one key, and its pricing table can drift out of date. Defaults to **$1.00/day**, a conservative starting point, not a statement about what CALL-E itself should cost you — override with `screen.py --daily-budget-usd <amount>`.
- Call placement gets the same best-effort treatment (`pipeline/guardrails.CallGuardrails`), defaulting to 20/day to match CALL-E's free tier — override with `screen.py --max-calls-per-day <n>` if you're on a paid plan. Regardless of the cap, it refuses to re-dial a number already screened.
- The Screener agent has no real account numbers, passwords, codes, or payment methods to disclose, and no tools to install software or move money — this is structural, not a prompt instruction a determined scammer could talk it out of.
- The call opens by disclosing it may be recorded and reviewed, and asks the other party not to share sensitive personal, account, or payment details — see `docs/AGENT_PROMPTS.md` for the full prompt.
- Transcripts and verdicts are returned to stdout as JSON; this app does not persist a record file or write anywhere outside the guardrail state files listed below.
- The screened phone number is redacted from the transcript before it's sent to the LLM provider for tagging (`pipeline/guardrails.redact_phone_number`) — best-effort, not a mathematical guarantee: it catches the number rendered as digits with common separators (which is how transcripts render a spoken number), but not, say, digits spelled out as words. The full, unredacted transcript is still what's scored and printed locally; only the LLM-bound copy is scrubbed.

## Cancellation and rollback

`screen.py`'s preview mode and `--demo` mode have no side effects — nothing to cancel. Once a live call is placed, this app cannot cancel it mid-call; use the CALL-E dashboard if it exposes a cancel action. There is no recurring schedule anywhere in this app to disable. The two local state files (`.call_guardrail_state.json`, `.llm_budget_state.json`) can be deleted at any time to reset the daily caps early — they hold nothing but counters and a date, no call content.

## Validation

Tests run with an injected mock CALL-E client and never place a phone call or use an LLM:

```bash
uv run pytest -q
python3 ../../../scripts/validate_repository.py
```

## Reading further

- [`docs/CONCEPT.md`](docs/CONCEPT.md) — full design writeup, including the Limitations section with real test-harness results
- [`docs/AGENT_PROMPTS.md`](docs/AGENT_PROMPTS.md) — the Screener Agent's aim, persona, and hard constraints, plus the actual production prompt it's built from

This is a demo app for a workflow pattern, not a CALL-E SDK and not a supported product API.
