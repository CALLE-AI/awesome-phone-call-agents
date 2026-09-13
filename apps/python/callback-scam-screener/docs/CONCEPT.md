# Callback Scam Screener

*A CALL-E agent that verifies suspicious "call this number" emails before a human ever dials them.*

## The problem

Callback / TOAD (telephone-oriented attack delivery) scams put a phone number in an email that falsely claims a payment was made or an account has a problem, and rely on fear to get the victim to call. Once on the phone, the "support agent" walks the victim into handing over credentials, sensitive data, a payment, or installing a remote-access tool (AnyDesk, TeamViewer, etc.). These scams are effective precisely because they route around email filters — the payload isn't a malicious link or attachment, it's a phone number, and the actual attack happens over a channel nobody's monitoring.

## The idea

When an email security system flags a message as a suspected callback scam, CALL-E dials the number *itself*, runs a short scripted conversation, and screens the response for scam signals — before any employee is exposed to the call. The output is a risk verdict and a transcript handed to a human/SOC queue. The agent never acts on the outcome.

**The value is triage, not clearance.** A `likely_scam` verdict — especially one forced by a critical signal like a remote-access-software ask — is high-precision: our test harness didn't produce a false positive on either scam tier it caught (see Limitations), so SOC can trust it to fast-track those cases without re-listening to the call first. A `likely_legitimate` verdict is not the mirror image of that. Every verdict still goes to a human queue; what changes is priority, not whether review happens — the tool reduces workload by helping analysts get to the obvious malicious cases faster, not by letting anything skip review.

## Non-negotiable design constraint: observe-only

The agent must have **no capability to take any action** a scam would try to extract:

- Cannot provide any real credentials, account data, or PII — it has none to give, by construction, not by prompting.
- Cannot confirm or authorize a payment.
- Cannot install anything or follow remote-access instructions (it's a phone call — there's no session for a "technician" to remote into).
- Cannot make a final block/report/reply decision — it only produces a screening verdict for a human.

This isn't a nice-to-have — it's the thing that makes the agent safe to point at an unknown number at all, and it directly answers "real world impact" without introducing a new attack surface.

## Pipeline

1. **Trigger** — An email security alert (SIEM rule, phishing detector, or a simple heuristic for the demo: urgency/threat language + payment or account claim + a phone number + sender domain that doesn't match the claimed company) flags a message and extracts the phone number and the claimed reason for contact.
2. **Pre-call checks** (cheap, no dialing required) — cross-reference the number against known-scam-number lists; check SPF/DKIM/DMARC on the sender; compare against the claimed company's published support number if available. This alone may be enough to raise or lower suspicion before a call is even placed.
3. **The call** — CALL-E dials the number using a fixed, hardcoded script: state the reason for calling and ask clarifying questions ("what is this regarding," "can you confirm the company name and the reason for this notice"). The script is a closed set of prompts with no ability to branch into providing information — engagement, not negotiation.
4. **Signal scoring** — during/after the call, score the transcript against known red flags:
   - asks for remote-access software
   - asks for payment via gift card / crypto / wire
   - refuses or hedges on naming the company
   - urgency/threat escalation when questioned
   - no real hold music / IVR / call routing — goes straight to a "closer"
   - generic, script-like phrasing inconsistent with a real company's tone
5. **Output** — a verdict (likely-scam / likely-legitimate / inconclusive), the triggered signals, and the full transcript, routed to a human/SOC queue for the actual decision. No auto-block, auto-report, or auto-reply. `likely_scam` can raise a case's priority in the queue; `likely_legitimate` and `inconclusive` still require the same human verification as an unscreened case (see Limitations).

## Guardrails

- Dialing fails closed: a live run needs either an explicit dev/test allowlist or an explicit acknowledgment that it may call an arbitrary, unverified number — there's no default that dials without one or the other. The number dialed is validated as strict E.164 first.
- One screening call per flagged number — no repeat dialing, and a number with an unresolved (timed-out) attempt is blocked from a retry until checked manually rather than silently redialed.
- A call that fails, is canceled, or produces no real transcript is never treated as equivalent to a clean call — it's reported as inconclusive, not `likely_legitimate`, since no screening evidence was actually gathered.
- Full call logging for audit (transcript + signals + verdict retained), with the dialed number masked by default in what's printed or returned.
- Clear disclosure framing in the script so the call doesn't itself read as impersonation or harassment if the number turns out to belong to a real business.
- Aware that recording/analyzing calls has jurisdiction-specific consent requirements — script accounts for this rather than assuming one-party consent everywhere.

## Credentials and cost — bring your own keys

This project ships no API keys and never will. Users authenticate with their own CALL-E account (`calle auth login`) and their own key for whichever LLM provider they choose (`pipeline/llm_providers.py` — currently just Gemini is registered; an Anthropic implementation exists in the same file but isn't wired in yet, since "bring your own key" was never meant to mean "bring your own Anthropic key specifically" and it hasn't had its own real-call test the way the Gemini path has); there is no shared or bundled credential anywhere in the repo, enforced by `.gitignore` and by the code paths themselves (see `pipeline/caller.py` and `pipeline/llm_providers.py`), which fail with a clear message rather than silently falling back to something shared.

LLM spend (the transcript-tagging pass in `tag_transcript_llm`) is additionally capped in code, checked against a running total tracked from the API's own reported token usage via `pipeline/guardrails.LLMBudgetGuard`, not a pre-call estimate — an application-level guard meant to help stop a bug or runaway loop from spending past pocket change, not a platform-enforced hard limit (it can't catch concurrent runs sharing one key, and its pricing table can go stale). This defaults to $1.00/day per user, a conservative starting point rather than a judgment about what anyone else's usage should cost — `screen.py --daily-budget-usd` overrides it. Call placement gets the same best-effort treatment (`pipeline/guardrails.CallGuardrails`, default 20/day matching CALL-E's free tier, overridable via `screen.py --max-calls-per-day`).

## Limitations

Validated with a text-based test harness before any real-call budget was spent: the Screener Agent (see [AGENT_PROMPTS.md](AGENT_PROMPTS.md)) against simulated scammer personas at three difficulty tiers plus a legitimate-business control, each conversation scored by the actual `pipeline/scoring.py` code (not estimated):

| Scenario | Verdict | Notes |
|---|---|---|
| Obvious scammer (remote-access + gift-card ask) | `likely_scam` (score 6, critical hit) | Correct |
| Moderate scammer (evasive, mild urgency, no critical ask) | `likely_scam` (score 9) | Correct — High-tier signals alone cleared the threshold |
| Subtle scammer (patient, names a company, invites verification, asks only for last-4 card digits) | `likely_legitimate` (score 0) | **False negative** |
| Legitimate business (control) | `likely_legitimate` (score 0) | Correct — no false positive |
