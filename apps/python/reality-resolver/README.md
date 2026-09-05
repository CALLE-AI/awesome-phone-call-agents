# reality-resolver

An evidence-driven decision engine for CALL-E: before ever placing an
outbound call, it asks whether the call is actually needed. A
structured record (a calendar entry, a database field) can be qualified
or contradicted by a human account (an email, a note) that never gets
reconciled - a state nobody has actually confirmed. Reality Resolver
detects exactly that situation, and only then escalates to a real,
compliance-gated CALL-E call to resolve it - never for evidence that
already speaks for itself, and never treating an unresolved outcome as
if it were a cancellation.

This app evolved from an earlier, independent submission on this same
repository and PR (`compliance-gated-callback`; see "Reused compliance
layer" below): the legal/compliance gate and the CALL-E task-hardening
it built are reused here unmodified, as one gate among several in this
larger decision engine.

## Decision engine

```
Evidence sources (fixtures JSON)
  -> Evidence Matrix
  -> 4 generic rules (R1-R4)
  -> decision-critical uncertainty?
       NO  -> NO_CALL_NEEDED
       YES -> call justified -> call permitted? (compliance gate, reused as-is)
                NO  -> UNRESOLVED_CALL_BLOCKED, RETRY_WHEN_PERMITTED
                YES -> CALL-E (client.py, reused as-is)
                       -> structured_result -> reconciliation
                       -> RESOLVED / RESOLVED_ALT / UNRESOLVED_AMBIGUOUS
```

Two branches never reach the compliance gate or CALL-E at all:
`NO_CALL_NEEDED` (the evidence is not actually in decision-critical
contradiction - see "The four rules" below) and
`UNRESOLVED_CALL_BLOCKED` (the call would be justified, but the
compliance gate - reused unmodified from `compliance-gated-callback` -
blocks it; see `next_window.py` for the honest limits of the "next
legal window" projection this shows).

**`UNRESOLVED_CALL_BLOCKED` vs. `UNRESOLVED_AMBIGUOUS` - not the same
thing.** `UNRESOLVED_CALL_BLOCKED` means no call was placed at all: the
uncertainty was decision-critical, but the compliance gate refused
(missing consent, wrong hour, and so on) - the recipient never heard
the phone ring. `UNRESOLVED_AMBIGUOUS` means a call *was* placed and
answered, but CALL-E's own result did not cleanly confirm or cancel
(voicemail, an IVR, or a genuinely uncertain answer) - see
"Reconciliation and verdicts" below.

## The Ghost Appointment scenario

`cases/ghost-appointment.json` is the shipped example: a dental
practice's calendar says a patient's appointment is confirmed for
14:00 tomorrow (`type: structured`, low ambiguity). A separate email
from the patient says "I may need to cancel" (`type: human`, high
ambiguity). A scheduled follow-up never got a reply (`type: absence`).
Nobody has actually reconciled these two accounts - the slot might be
kept, or it might be sitting on the calendar unused while another
patient could have taken it. That is a decision-critical contradiction
by construction (see "The four rules" below: R1 and R2 both come from
this same tension, R3 confirms nothing since resolved it, and R4
depends on how close the appointment deadline is) - not because the
scenario is contrived to make the rules fire, but because a ghost
appointment like this is exactly the kind of ambiguity a business would
actually want a callback to resolve before deciding `KEEP_SLOT` or
`RELEASE_SLOT`.

## Evidence model

`evidence/model.py` defines:

- `Evidence(source, type, freshness, claim, ambiguity)` - one fact or
  account. `type` is `structured` (a system of record), `human` (a
  free-text account), or `absence` (the fact that something expected
  never arrived). `freshness` is how long ago it was captured.
  `ambiguity` (`low`/`medium`/`high`) is the evidence author's own
  confidence, not used by every rule (see R2 below).
- `EvidenceMatrix` - all the evidence for one case.
- `Case` - one decision-critical question: its `EvidenceMatrix`, an
  absolute UTC `deadline`, a `decision_deadline_threshold` (how close
  counts as "close" - case data, not an engine default; see R4 below),
  `decision_options` (the two domain-specific action labels,
  `if_confirmed`/`if_cancelled`), `call_phone`, and `call_task_hint`
  (seeds the operator-task text handed to `build_hardened_task`,
  unmodified).

Cases are loaded from JSON - see `cases/ghost-appointment.json`. Fields
map directly: `freshness_hours`, `decision_deadline_threshold_hours`,
and `deadline` (ISO 8601 UTC) are plain numbers/strings, not relative
phrases - "tomorrow 14:00" is not machine-meaningful without a fixed
reference point, so a real case should pin a concrete date. The shipped
fixture's deadline will need bumping as time passes; use `--now-utc` to
pin a consistent "now" close to it for a reliable demo run (see
"Running the demo" below). `--now-utc` is a single value shared by R4's
deadline check *and* the compliance gate's calling-window check further
down the pipeline (`resolver.py` passes the same `now` to both) - there
is no separate "pretend it's daytime" flag; picking a realistic instant
covers both at once.

## The four rules

`evidence/rules.py` defines four independent, generic rules, each
returning a boolean plus a plain-text explanation - the same shape as
`compliance/models.py`'s `CheckResult`. All four true means the
uncertainty is decision-critical (`evidence/engine.py`).

| Rule | Question | Heuristic |
|---|---|---|
| R1 `StructuredStateRule` | Does a structured source assert a state? | Any `Evidence` with `type == structured` |
| R2 `HumanQualificationRule` | Does a human source diverge from it? | A small polarity lexicon classifies each claim as `confirming` or `diverging`; true when a human claim's polarity is classified and differs from the structured claim's |
| R3 `UnresolvedEvidenceRule` | Has nothing since resolved the divergence? | True when no evidence is both fresher than the diverging human evidence and itself low-ambiguity |
| R4 `DecisionDeadlineRule` | Is the deadline close? | `deadline - now <= Case.decision_deadline_threshold` - case data, never an engine constant |

**Honest limits.** None of this is real natural-language understanding.
R2/R3's polarity lexicon (`_CONFIRMING_MARKERS`/`_DIVERGING_MARKERS` in
`evidence/rules.py`) is a small, literal, auditable set of markers - the
same kind of honest, documented heuristic as
`compliance/jurisdictions/eu_common.py`'s literal `"artificial
intelligence"` substring check. It compares claim *content* (not just
the evidence author's own `ambiguity` label) specifically so that a
confidently-stated contradiction ("I already cancelled") is still
caught, and a claim with no recognized marker is deliberately left
unclassified rather than guessed - which means R2 fails toward *not*
escalating to a call, the safe direction given the absolute rule below.
It can still be misled by an irrelevant claim that happens to contain a
lexicon marker; real subject-matching would need real language
understanding, which this rule does not have. "Same state/subject" is
otherwise assumed structurally: every `Evidence` inside one `Case` is,
by that case's own construction, evidence about the one state it is
resolving.

## Reconciliation and verdicts

Once a call is justified and permitted, `verdict.py` reconciles CALL-E's
`structured_result` (using `patient_intent_result_schema()`, adapted
from `client.py`'s own `default_intent_result_schema()`, which is
untouched) into a final verdict:

| `patient_intent` | `answered_by` | Status | Action |
|---|---|---|---|
| `confirmed` | `human` | `RESOLVED` | `Case.decision_options["if_confirmed"]` |
| `cancelled` | `human` | `RESOLVED_ALT` | `Case.decision_options["if_cancelled"]` |
| anything else (`uncertain`, `unknown`, `voicemail`, `ivr`, or no result) | - | `UNRESOLVED_AMBIGUOUS` | `HUMAN_REVIEW` |

**Absolute rule: unresolved evidence is never treated as cancelled.**
Every combination other than the exact `(confirmed, human)` and
`(cancelled, human)` matches falls back to `HUMAN_REVIEW` - checked as
an invariant over all 25 `(patient_intent, answered_by)` combinations in
`tests/test_verdict.py`, not left as a convention.

The two paths before CALL-E is ever reached use their own fixed,
generic actions, not case data, since any case of any domain resolves
to one of these when it never reaches a call or the call doesn't
resolve anything: `NO_CALL_NEEDED` -> `NO_ACTION_REQUIRED`;
`UNRESOLVED_CALL_BLOCKED` -> `RETRY_WHEN_PERMITTED`.

## CLI output

`resolver.py case.json` prints a mode banner (see "Demo mode vs. live
mode" below) followed by five sections, in order:

- `EVIDENCE STATE` - every evidence item (source, type, freshness,
  ambiguity, claim).
- `REASONING` - R1-R4, each `YES`/`NO` with its explanation.
- `CALL JUSTIFICATION` - whether the uncertainty is decision-critical.
- `CALL PERMISSION` - only if a call is justified; the compliance
  gate's own output (`client.py`'s `print_compliance_decision`, reused
  unmodified), a `would_block_in_live` line, and the next legal window
  if blocked (`next_window.py` - only computed when every blocking
  reason is a calling-window check; consent/DNC/disclosure/revocation/
  solicitation-cap blocks say plainly that there is no next window to
  wait for).
- `CALL-E` - only if the call proceeds past the permission check
  (always in demo mode; only when permitted in live mode); the request
  body preview, and (with `--execute`) the created call and final
  result.
- `VERDICT` - status, action, and the evidence cited (the original case
  evidence, `mode`/`would_block_in_live`, and, when a call was placed,
  CALL-E's own result).

## Demo mode vs. live mode

`--mode {demo,live}`, default `demo`. The compliance gate itself
(`compliance/dispatcher.run_precall_checks`) is evaluated **identically
in both modes**, against the real recipient timezone and the real or
overridden `now` - nothing about the check logic changes, and
`compliance/` is never touched by this flag. What changes is only what
`resolver.py` does with a failing result:

- **`demo` (default)** - a failing compliance gate is displayed in
  full, in `would_block_in_live: True`, and in a `*** DEMO MODE: this
  call would be BLOCKED in live mode ***` banner, but the call still
  proceeds to CALL-E - **including a real CALL-E call** if `--execute
  --allow-live` are also passed. A live-policy violation becomes a
  warning, never a block, in this mode. Meant for local testing and for
  judges cloning this repo at any hour, without needing to fake the
  legal calling window to see the full pipeline.
- **`live`** - a failing compliance gate stops the call:
  `UNRESOLVED_CALL_BLOCKED`, `RETRY_WHEN_PERMITTED`, exactly the
  original, fully enforced, fail-closed `compliance-gated-callback`
  behavior.

**`--allow-live` means one thing only: a real call to CALL-E is
explicitly authorized** (in addition to `--execute`, the separate,
second confirmation needed before anything is ever sent, in either
mode) - it is independent of `--mode`. This is a deliberate choice:
`--mode demo` is meant to let an operator demonstrate the whole
pipeline, including against the real API, without an inconvenient
real-world hour hiding it - the honest cost is that **demo mode does
not stop a real call on a live-policy violation**; the banner and
`would_block_in_live: True` are the only safeguard once
`--execute --allow-live` are both present, and they name the
consequence plainly:

```
*** DEMO MODE: this call would be BLOCKED in live mode ***
    reasons: (...)
    Proceeding anyway because --mode demo. A REAL CALL-E call is about
    to be placed despite this. Live policy violations are warnings
    only in this mode, not blocks. Use --mode live for enforced,
    fail-closed behavior.
```

Read that banner before ever adding `--allow-live` to a demo-mode
command. Two things remain true regardless of `--mode`:
`--now-utc` is refused together with `--allow-live` - a real call
always sees the real current time, never an overridden one - and
`--execute`/`--allow-live` are still each individually required before
anything is ever sent (`--allow-live` alone stays a dry-run;
`--execute` alone against the real API is refused by `client.py`'s own
`CallEClient`, untouched, exactly as before this flag existed).

This is a distinct concern from R4/`--now-utc` (which govern whether
the *evidence* is decision-critical) - `--mode` only governs whether a
failing *compliance* result is enforced once a call is already
justified. A demo run can combine both: `--now-utc` near the case's
deadline to satisfy R4, and `--mode demo` (default) so an inconvenient
real-world hour never hides the rest of the pipeline.

## Running the demo

Against the fake server, three reserved phone numbers select which of
the three CALL-E branches to simulate (see `fake_server.py`):

| Phone | `patient_intent` | `answered_by` | Verdict |
|---|---|---|---|
| any other phone (default) | `confirmed` | `human` | `RESOLVED` |
| `+10000000004` | `cancelled` | `human` | `RESOLVED_ALT` |
| `+10000000005` | `unknown` | `voicemail` | `UNRESOLVED_AMBIGUOUS` |

Start a fake server in one terminal (it prints `{"base_url": "..."}`
and then blocks, serving requests until Ctrl+C):

```bash
uv run python fake_server.py
```

then, against that `base_url`, in another terminal:

```bash
uv run python resolver.py cases/ghost-appointment.json \
  --base-url http://127.0.0.1:PORT --execute \
  --now-utc 2026-09-10T20:00:00Z --recipient-timezone America/New_York \
  --consent-obtained --consent-timestamp 2026-08-20T12:00:00Z --dnc-checked
```

Add `--phone +10000000004` or `--phone +10000000005` to see the
`RESOLVED_ALT`/`UNRESOLVED_AMBIGUOUS` branches instead. Drop
`--now-utc` far from the case's deadline (or omit the compliance flags)
to see `NO_CALL_NEEDED`/`UNRESOLVED_CALL_BLOCKED` instead - neither
needs a fake server at all, since neither ever reaches CALL-E.

The shipped `cases/ghost-appointment.json` uses a reserved, non-routable
NANP placeholder number (`+12025550123`) - never a real one. Pass
`--phone` to override it for a real call; do not edit or commit a real
number into a case file.

## Reused compliance layer

> The compliance and disclosure logic below (`compliance/`, and the
> disclosure-script, injection-resistance, voicemail,
> no-repeat-opening, proactive-next-step, and call-closing instruction
> blocks in `client.py`) originated as an earlier, independent
> submission on this same repository and PR (originally
> `compliance-gated-callback`). It is reused here unmodified, as one
> gate among several in this larger decision engine - not rewritten,
> not re-claimed as new work for this round.

## The problem

Speed-to-lead is the single biggest predictor of whether an online lead
converts into a customer: whoever calls back first usually wins the
deal. But a business running online ads gets leads from every country,
at every hour of the day, with no way to know which calling-hour law or
consent rule applies to the number that just came in. Calling a French
prospect back at 3am is illegal. The EU AI Act has required disclosing
that the caller is an AI system since August 2026. No off-the-shelf
calling tool checks any of this automatically before dialing.

## What this app does

- Takes in a prospect: a phone number plus a compliance context
- Resolves the applicable jurisdiction chain from the phone number
- Runs that jurisdiction's rules before the call, fail-closed
- Calls CALL-E's `POST /v1/calls` with the locale and region derived
  from the resolved jurisdiction, never hardcoded
- Returns a structured result: `intent` and `next_action`
- Extensible by design: one file per jurisdiction, no shared logic to
  untangle to add a new one

## Jurisdictions supported at launch

| Jurisdiction | Key rules |
|---|---|
| US federal | 8am-9pm local recipient time, documented prior express written consent, National DNC Registry scrub, FCC-required artificial-voice disclosure, revocation honored by any means |
| Oregon (stacks on US federal) | Narrower 8am-8pm local recipient time, solicitation cap of 3 calls+texts combined per rolling 24h (HB 3865), revocation honored |
| EU common (27 member states) | AI Act Art. 50 disclosure of the AI interaction, ePrivacy Art. 13(1) opt-in consent, GDPR Art. 6 lawful basis documented |
| France (stacks on EU common) | Opt-in consent required since 2026-08-11, calls only Mon-Fri 10h-13h and 14h-20h, Bloctel/opposition-list scrub |

Oregon is this app's first US state-level variation, stacked on top of
`us_federal` the same way `fr` stacks on `eu_common` - proof the
per-jurisdiction architecture extends below country level, not just
across countries. It is matched by area code (`503`, `541`, `971`,
`458` - `compliance/dispatcher.py`'s `_US_STATE_AREA_CODE_OVERLAY`)
since the shared `+1` country code cannot identify a state on its own.
The solicitation cap has no call-history database to check against, so
`--solicitations-in-last-24h` is an operator-attested count from their
own records; omitting it fails closed, same as an unsupplied
`--recipient-timezone`. Adding a second state means adding its area
codes to that overlay, not changing the resolution logic. Every other
US number still falls through to the federal baseline alone.

Also note: `+1` is the shared NANP calling code for the United States,
Canada, and over twenty Caribbean territories, not the United States
alone. This app has no full area-code-to-country lookup table, so every
`+1` number not matched by the Oregon overlay above is routed to the US
federal jurisdiction alone; a Canadian or Caribbean number would
currently be evaluated against the wrong rules. `+33` (France) has no
such ambiguity: EU country calling codes are one-to-one with a single
country.

## AI disclosure

**This was a real defect found by testing, not a cosmetic addition.**
Every jurisdiction module defines a `DISCLOSURE_SCRIPT` constant (AI Act
Art. 50 / FCC rule 24-17 wording), and the compliance gate printed
`[PASS] ..._ai_disclosure: disclosure_script discloses the AI
interaction`. But that check only ever inspected the constant against
*itself* - a tautology, since the constant is our own hardcoded text and
the check just looks for the word "artificial" inside it. Nothing in
`client.py` or `web_server.py` ever read `RULES.disclosure_script` or
passed it into the task sent to CALL-E. A call could pass the
compliance gate's AI-disclosure check while the real call disclosed
nothing at all, unless the operator happened to write a disclosure into
their own `--task` by hand.

The fix: `compliance.dispatcher.resolve_locale_and_region` now also
resolves the effective `disclosure_script` for the jurisdiction chain
(same "narrowest jurisdiction that actually defines one wins" rule
already used for `region_code` - a state-level entry like `us_oregon`
with no script of its own inherits `us_federal`'s). `build_hardened_task`
sends it as a real, separately delimited block - and puts it **first**,
before business context or the operator's own task, because disclosure
has to happen at the very start of the call, not after other content.

**Second real defect, also found by testing**: the script correctly said
"this is an AI," but never said *why* it was calling - it asked the
recipient to explain instead, which is backwards. The disclosure
scripts now follow one structure in every jurisdiction: identity and
entity, **then the reason for the call**, then the closing
rights/callback statement - for example (France):
`"Bonjour, je suis [agent], l'assistant vocal IA de [entite], et je vous
appelle [raison]. Vous pouvez demander a parler a une personne ou
raccrocher a tout moment."`

The scripts contain placeholders (`[ENTITY]`/`[ENTITE]`,
`[AGENT_NAME]`/`[NOM_AGENT]`, `[REASON_FOR_CALLING]`/`[RAISON_APPEL]`,
`[CALLBACK_NUMBER]`) that must never reach CALL-E as literal bracket
text - a voice agent would say the brackets out loud. `--entity-name`
(CLI and web form) lets an operator supply their real business name to
fill `[ENTITY]`/`[ENTITE]`; `--agent-name` does the same for the AI
agent's first name. Omitting either uses an honest, generic fallback
(`"this organization"` / `"cette organisation"`,
`"an automated calling agent"` / `"un agent d'appel automatise"`)
rather than a fabricated name. `[CALLBACK_NUMBER]` always becomes `"the
number that just called you"` - this app has no distinct
callback-number concept (CALL-E's outbound caller ID is not guaranteed
to accept inbound calls), so inventing a specific number would be
actively misleading; this phrasing identifies the number without
asserting it is reachable.

The reason for calling is the one placeholder this app deliberately
does *not* try to fill with real text. `--task` is free-form text with
no fixed shape ("Call the recipient and find out why they are calling
in.", "Answer the recipient's questions about our practice.", ...) -
there is no reliable string operation that turns arbitrary text like
that into a short spoken reason, and guessing at one would be exactly
the kind of fragile heuristic this app avoids everywhere else.
`[REASON_FOR_CALLING]`/`[RAISON_APPEL]` is instead replaced with a
bracketed instruction telling CALL-E's own model to state the reason
itself, based on the `--task` text that immediately follows in the same
message, and explicitly **not** to ask the recipient for it. This
relies on the model correctly treating bracketed text as an instruction
to fill in rather than something to say verbatim
(`DISCLOSURE_INSTRUCTION_HEADER` says so explicitly) - the same class of
reliability limit already documented under Prompt injection resistance
below, not a hard guarantee.

```bash
uv run python client.py \
  --task "Answer the recipient's questions about our practice." \
  --phone +33639980456 \
  --consent-obtained --dnc-checked --gdpr-basis-documented \
  --recipient-timezone Europe/Paris \
  --entity-name "Bright Smile Dental" \
  --agent-name "Alex"
```

## Legal disclaimer and known gray areas

This app is not legal advice, and passing its compliance gate is not a
guarantee of legal compliance. It encodes a good-faith reading of a
legal research pass done for this project; it has not been reviewed by
a lawyer. Consult one before using this in production. The following
gray areas came out of that research and are not settled law:

1. Whether a live, two-way conversational AI agent counts as an
   "automatic calling machine" under ePrivacy Art. 13(1), which would
   force strict EU-wide opt-in, or falls under the softer per-country
   Art. 13(3) discretion for live calls. This code defaults to the
   stricter 13(1) reading.
2. A US Fifth Circuit ruling (Bradford v. Sovereign Pest Control, Feb.
   2026) held that simply providing a phone number can itself be
   "express consent," conflicting with the FCC's usual written-consent
   standard. This code does not rely on that reading.
3. Cross-border calls (a US number calling into the EU or vice versa)
   can trigger both regimes at once; how enforcement actually
   coordinates between them is untested.
4. The AI Act's Art. 50 disclosure duty says "no later than the first
   interaction," but does not specify exactly when that means for a
   live phone call; this code discloses at the start of the call.
5. Whether real-time transcription of a call counts as "recording" in
   US two-party consent states is not settled.
6. New US state "mini-TCPA" laws keep appearing (Florida, Maryland, New
   Jersey, Oklahoma and others); the jurisdiction table above is a
   snapshot, not a permanently accurate one.
7. California's AB 316 (Cal. Civil Code Sec. 1714.46, effective
   2026-01-01) bars "the AI made the decision" as a defense to certain
   civil claims arising from an AI system's actions - a business cannot
   point at the calling agent to avoid liability for what it did or
   said. This is settled law, not an open question, but this app has no
   California-specific jurisdiction module yet: California numbers
   currently fall through to the US federal baseline only, same as any
   other state without an overlay (see the Oregon note above for how
   that gap gets closed). Given AB 316's liability shift, this is a real
   coverage gap for California calls, not just a documentation footnote.

Two of these are implemented in code today as explicit, short-lived
exceptions rather than silently assumed: a US call outside the calling
window is allowed if consent was obtained within the previous 15
minutes (`compliance/jurisdictions/us_federal.py`), and French public
holidays are not yet excluded from the calling window, only weekends
(`compliance/jurisdictions/fr.py`). Both are marked
`confidence=MEDIUM` on the specific `CheckResult` they produce - that
marker means "this is a product decision pending legal confirmation,"
not "this is sourced law."

**TCPA jurisdiction clarification (2026-08-29 research pass, no code
change needed):** the TCPA and its state-level "mini-TCPA" equivalents
apply based on the recipient's own location, not on how the call is
routed or which infrastructure it passes through. This app already
matches that: `resolve_jurisdiction_chain` resolves purely from
`context.phone_e164`, the recipient's own E.164 number, never from any
routing or carrier-path detail. This is confirmation that the existing
design was already correct, not a fix.

## Consent record retention

Every dry-run and execute that includes `--consent-timestamp` also
prints a `consent_retention_expires_at` line: how long the operator
should keep that consent record. It is computed as
`max(consent_timestamp, now) + 5 years`
(`compute_consent_retention_expiry` in `compliance/models.py`),
calendar-accurate (including leap-day anchors), and re-anchored forward
on every call placed on the strength of that same consent.

This single 5-year rule is deliberately the more conservative reading
of two different regimes at once: the US FTC's Telemarketing Sales Rule
requires keeping consent records for 5 years from when consent was
given (16 CFR 310.5(a)(8)), a flat deadline that does not reset;
Germany's UWG Sec. 7a also requires 5 years, but resets on every use of
that consent. Resetting on every call satisfies both simultaneously
without this app having to know which regime actually governs a given
call.

This value is informational only: it is never sent to CALL-E and never
gates whether a call is allowed - there is nothing to block pre-call
about a retention deadline that lies in the future. It only appears
when `--consent-timestamp` was supplied; a run without one prints no
retention line.

## Setup

```bash
uv sync
```

`zoneinfo` (used for every calling-window check) has no timezone
database bundled on Windows; `uv sync` installs the `tzdata` package
automatically there via a platform marker in `pyproject.toml`. Nothing
extra to do on Linux or macOS, which already ship system tzdata.

Copy `.env.example` to `.env` and fill in your real `CALLE_API_KEY` to
avoid exporting it in every terminal session:

```bash
cp .env.example .env
# then edit .env and set CALLE_API_KEY=your_real_key
```

`.env` is only ever read from this app's own directory, never
committed (already covered by the repo's root `.gitignore`: `.env`,
`.env.*`, with `.env.example` explicitly excepted), and a real
`CALLE_API_KEY` already set in your shell environment always takes
priority over whatever is in `.env`.

## Usage

**If you run this with `--execute` and get blocked**, this is working
as designed, not a bug: the compliance gate checks the *real* current
day/time against the recipient jurisdiction's legal calling window (for
example, weekdays only for France, 8am-9pm local time for the US
federal baseline). If you are testing outside that window, use
`--now-utc` to simulate a valid moment instead of waiting for one:

    --now-utc 2026-08-26T14:00:00Z   # a Wednesday, 10am Paris time - inside the FR window

`--now-utc` only overrides the clock the calling-window check reads -
it has no effect on consent, DNC/opposition-list checks, GDPR basis, or
any other rule; those still need their own real flags
(`--consent-obtained`, `--dnc-checked`, etc.) to pass.

Windows/PowerShell users: replace `export VAR=value` below with
`$env:VAR = "value"`.

Dry-run for a US number, fully compliant. No `CALLE_API_KEY` needed or
read - dry-run never touches it:

```bash
uv run python client.py \
  --task "Call the recipient and find out why they are calling in." \
  --phone +12025550123 \
  --consent-obtained --consent-timestamp 2026-08-20T12:00:00Z \
  --dnc-checked \
  --recipient-timezone America/New_York
```

Because `--consent-timestamp` is set, this also prints a
`consent_retention_expires_at`-derived line telling the operator how
long to keep that consent record (see Consent record retention above).

Dry-run for an Oregon number (area code `503`), fully compliant. Note
the extra `--solicitations-in-last-24h` flag, required for any Oregon
number, and the `us_federal -> us_oregon` jurisdiction chain in the
printed decision:

```bash
uv run python client.py \
  --task "Call the recipient and find out why they are calling in." \
  --phone +15035550100 \
  --consent-obtained --consent-timestamp 2026-08-20T12:00:00Z \
  --dnc-checked \
  --recipient-timezone America/Los_Angeles \
  --solicitations-in-last-24h 0
```

Dry-run for a France number, fully compliant. Note the extra
`--gdpr-basis-documented` flag (an EU-wide requirement the US flow does
not have), and that the resolved `locale`/`region` in the printed body
come out as `fr-FR`/`FR` instead of `en-US`/`US`:

```bash
uv run python client.py \
  --task "Call the recipient and find out why they are calling in." \
  --phone +33639980456 \
  --consent-obtained --dnc-checked --gdpr-basis-documented \
  --recipient-timezone Europe/Paris
```

Dry-run, blocked because it is outside the calling window
(`--now-utc` pinned to 22:00 Paris time on a Tuesday, outside both the
10h-13h and 14h-20h windows):

```bash
uv run python client.py \
  --task "Call the recipient and find out why they are calling in." \
  --phone +33639980456 \
  --consent-obtained --dnc-checked --gdpr-basis-documented \
  --recipient-timezone Europe/Paris \
  --now-utc 2026-08-25T20:00:00Z
```

Execute against the local fake server (no real call, no cost, and still
no `CALLE_API_KEY` needed - a hardcoded non-secret key is used whenever
`--base-url` is not the real API):

```bash
uv run python fake_server.py &
uv run python client.py --base-url http://127.0.0.1:PORT \
  --task "Call the recipient and find out why they are calling in." \
  --phone +33639980456 \
  --consent-obtained --dnc-checked --gdpr-basis-documented \
  --recipient-timezone Europe/Paris \
  --execute
```

Execute for real, only after explicit go-ahead. This is the *only* case
that reads `CALLE_API_KEY`:

```bash
export CALLE_API_KEY=iams_live_your_real_key
uv run python client.py \
  --task "Call the recipient and find out why they are calling in." \
  --phone +33639980456 \
  --consent-obtained --dnc-checked --gdpr-basis-documented \
  --recipient-timezone Europe/Paris \
  --execute --allow-live
```

## Business context injection

CALL-E can answer several different kinds of questions in one call
(pricing, hours, appointment availability, general questions about the
business) using a single agent, instead of a separate specialized agent
per topic - as long as it has the business's own facts to draw on.
`--business-context` / `--business-context-file` (CLI) and the
"Business context" field (web form) give it that: free text describing
services, prices, hours, and FAQs, injected into the `task` sent to
CALL-E. This is a simple text injection, not a retrieval/vector-search
system - the whole text goes into the task on every call.

The final task sent to CALL-E is always three distinct, delimited
blocks, in this fixed order, never merged into one paragraph:

```
[Business context, if provided] + [Operator's own --task] + [Injection-resistance safety block]
```

`build_hardened_task(operator_task, business_context)` in `client.py`
builds this. The business context block is still additive, never a
rewrite of anything else in the task - the same principle already used
for the injection-resistance block (see Prompt injection resistance
below) - but its own wording (`BUSINESS_CONTEXT_HEADER`) directly
instructs the model to answer from these facts, not just keep them as
passive background.

That wording was hardened after a real test call: the business context
contained the exact answer to a question the caller asked, but the
model said it did not have that information and offered a human
callback instead of using what was right there in front of it. The
header now explicitly tells the model to answer directly from the
facts listed, and not to fall back to "I don't have that" or a
callback offer when the answer is present in the business context.

Rules:
- Providing business context is optional and never a compliance
  concern: an empty or absent context does not block the call, and
  behavior is unchanged from before this feature existed.
- Text is capped at 4000 characters (`MAX_BUSINESS_CONTEXT_CHARS` in
  `client.py`). Going over the limit is a clear error
  (`validate_business_context` raises `ValueError`), never a silent
  truncation - CALL-E should never receive a business description that
  was quietly cut off mid-sentence.
- `--business-context` (inline text) and `--business-context-file` (a
  UTF-8 text file path) are mutually exclusive on the CLI. The web form
  only offers a text field to paste into directly - no file upload.

`business_context_example.txt` is a filled-in example for a fictional
dental practice, Bright Smile Dental, with fictional prices, hours, and
FAQs - use it as a template, or to demonstrate one agent handling
several topics (pricing, scheduling, general info) in the same call:

```bash
uv run python client.py \
  --task "Answer the recipient's questions about our practice." \
  --phone +12025550123 \
  --consent-obtained --consent-timestamp 2026-08-20T12:00:00Z \
  --dnc-checked \
  --recipient-timezone America/New_York \
  --business-context-file business_context_example.txt
```

`result_schema`'s optional `topic_handled` field
(`pricing | scheduling | general_info | service_details | out_of_scope | unknown`)
records after the fact which kind of question the call actually
covered - useful for showing the same agent handled more than one topic
type across calls.

## Voicemail handling

A real call (`call_H40fqmT3Thwz0GhSI2m7xg`) reached an answering machine
and, with no instruction telling it otherwise, repeated its full opening
pitch three times over about 35 seconds instead of leaving one message
and hanging up. `build_hardened_task` now appends a fourth fixed block,
`VOICEMAIL_HANDLING_INSTRUCTIONS`, after the injection-resistance block:
it tells the agent that if it reaches an automated greeting with no
interactive back-and-forth, it should deliver one brief message stating
who is calling and why, then end the call - not repeat itself.

**Honest limit, confirmed by CALL-E itself**: this app cannot make
CALL-E behave differently *during* a call beyond what the task text
asks. CALL-E's own PM confirmed directly on Discord (2026-08-27) that
there is no real-time answering-machine detection or behavior control -
the only official mechanism is post-call classification through a
developer-defined `result_schema` field. That is exactly what the new
optional `answered_by` field
(`human | voicemail | ivr | unknown`) is: it lets an operator see, after
the fact, whether a given call reached a person, a machine, or an IVR -
it does not and cannot change what happened live on that call.

This is not a problem unique to this app.
[Issue #89](https://github.com/CALLE-AI/awesome-phone-call-agents/issues/89)
in this repo independently documents the same failure mode: a call
reached a machine, its message was spoken twice, and no distinct
voicemail status ever surfaced anywhere in the response. Two other apps
in this repo hit the identical gap and solved it the same way, at the
task/app layer rather than relying on a platform feature that does not
exist: `ringedingeding` ([PR #146](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/146))
and `researchcall-survey` ([PR #145](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/145)).

## Call closing

A real call (`call_oUjPdPH-752n7uPzxDYZhg`) showed the agent end the
call immediately after a bare "oui," with no recap of what was decided
- cutting the recipient off mid-reply ("okay au..."). `build_hardened_task`
appends a fixed block, `CALL_CLOSING_INSTRUCTIONS`, LAST (after every
other block described below): it tells the agent to give a clear,
brief recap of what was decided and what happens next before ending
the call, and to never be the one to hang up first - it should wait
for an explicit signal from the recipient ("goodbye," "that's all,"
"thank you") and keep the conversation open until then, rather than
assume a short reply means the call is over.

**Honest limit, same as voicemail handling**: this is a prompt-level
instruction, not a control this app executes or can verify. CALL-E
offers no real-time hook for managing call flow - there is no way for
this app to detect that the agent is about to hang up, or to hold the
line open itself. If the model doesn't follow the instruction, nothing
here catches it; the only feedback available is reviewing the
transcript afterward, exactly how this issue was found in the first
place.

**Don't add an arbitrary time limit to `--task`.** An operator-written
phrase like "keep it under 90 seconds" directly conflicts with the
instructions above: it pressures the model to cut the mandatory recap
short, or hang up early, specifically to stay under a limit that has
no real basis. Let the conversation run as long as it naturally needs
to reach a proper close - none of this app's own fixed instructions
impose a time limit, and `--task` examples in this README don't either.

## Conversation flow

Two more fixed blocks address behavior observed mid-call, in real
calls, not just at the open or close:

- `NO_REPEAT_OPENING_INSTRUCTIONS` - two real calls now
  (`call_ErzDUKAIYUaBdnoRNhdNkw`, and the very first live call in this
  project) showed the agent treat a short, unclear, or interrupting
  reply as a cue to restart its opening (disclosure + reason for
  calling) from scratch, instead of continuing the conversation.
  `VOICEMAIL_HANDLING_INSTRUCTIONS` only ever addressed this for the
  voicemail case specifically ("don't repeat the message multiple times
  on a machine"); this generalizes the same rule to any live reply -
  say the opening once, then never repeat it in full again, no matter
  how brief or unclear the recipient's response is.
- `PROACTIVE_NEXT_STEP_INSTRUCTIONS` - after answering a question, the
  agent should actively suggest a concrete next step (an appointment, a
  transfer, more information) instead of waiting passively for the next
  question.

Same honest limit as every other block here: these are instructions to
the model, not controls this app enforces or can verify from outside.

**A note on task size, since this keeps growing.** `build_hardened_task`
is now up to eight distinct blocks. Measured directly: the six fixed
instruction/label blocks alone are already roughly 3200 characters
(~800 tokens) before any operator task, business context, or
disclosure text is added - a realistic full task (disclosure +
`business_context_example.txt`) runs close to 5000 characters (~1240
tokens) of instructions the model has to track simultaneously during a
live, real-time conversation. More competing instructions in one
prompt is a known way to make a model less reliable at following any
one of them precisely - and there's a real possibility this isn't just
a risk in the abstract: a long, dense instruction block is exactly the
kind of thing that could push a model to "replay the script from the
top" as a recovery heuristic when it loses its place, which is the
leading hypothesis for why the repetition bug above happens at all. Each
block so far has been added in response to a concretely observed real
call defect, and that bar should stay high: if instruction-following
problems keep showing up as this list grows, the next fix should be
consolidating or shortening these blocks, not appending another one.

## Web UI

`web_server.py` is a single-page HTML form over the exact same
`client.py`/`compliance/` logic the CLI uses - same compliance gate,
same masking, same result shape. Reuses no new business logic; it is
purely an HTTP layer.

```bash
uv run python web_server.py
```

Then open `http://127.0.0.1:8000/`. `--allow-live` and the API key are
both **server-startup** concerns, never a browser control: there is no
`--allow-live` checkbox and no API-key field in the form.
`CALLE_API_KEY` is read from the server process's own environment,
exactly like the CLI, and only when the server was started with
`--allow-live` against the real API base URL.

No authentication, no accounts, no database: this is a local,
single-operator tool. It binds to `127.0.0.1` by default - do not expose
it beyond localhost without adding auth first. `--execute` mode blocks
the HTTP response for the whole poll duration (up to 120s) since there
is no background job or websocket layer - an accepted trade-off for
"facade, not a platform."

## Public demo deployment

`public_demo_server.py` is a separate, deliberately non-configurable
entry point for hosting a public read-only-ish demo (for example on
Render): it starts its own internal fake CALL-E backend
(`fake_server.FakeCalleServer`, bound to `127.0.0.1` only - never
reachable from outside the process) and points the same `web_server.py`
UI at it.

**Safety, stated plainly**: the public demo link is dry-run and
fake-server-execute only. `public_demo_server.py` hardcodes
`allow_live=False` in code - there is no flag, environment variable, or
hosting-dashboard setting that turns it on - and it always targets the
internal fake backend, never `https://api.heycall-e.com`. Do not set
`CALLE_API_KEY` in this service's environment; it would sit unused given
the above, but there is no reason for a real credential to exist in a
public demo's configuration at all.

To deploy on Render: create a new Web Service from your fork, set
**Root Directory** to `apps/python/reality-resolver`, and Render picks
up `render.yaml` automatically (free plan, Python runtime).

Two free-tier trade-offs worth knowing: there is no rate limiting on the
form (acceptable here since nothing reachable has a real-world cost or a
real credential behind it), and Render's free tier spins down on
inactivity, so the first request after idle can be slow.

## Adding a jurisdiction

1. Create `compliance/jurisdictions/<id>.py` with a `RULES` object
   (including a `region_code`) and a `check(context)` function that
   returns one `CheckResult` per rule.
2. Register the module in `compliance/dispatcher.py`'s `_MODULES` dict,
   and add its country-code prefix - or append it to an existing chain,
   for a member-state variation - in `_COUNTRY_CODE_CHAINS`. For a US
   state-level variation instead, add its area codes to
   `_US_STATE_AREA_CODE_OVERLAY` (see `us_oregon.py` for the pattern).
3. Add tests in `test_compliance.py`: one fully-compliant context that
   is allowed, and one test per rule that blocks on its own.

This is additive, not a refactor: `compliance/dispatcher.py`'s
resolution logic and `client.py`'s CLI do not change. In this repo
today, the four jurisdiction files run from 94 lines (`eu_common.py`,
the simplest, with no calling-window logic) to 154 lines
(`us_federal.py`, the most involved one, with the recent-consent gray
area included); `us_oregon.py` (124 lines) is the first one stacked on
another US jurisdiction rather than a country code.

## Safety

- A real call requires explicit intent at two independent points:
  `--execute` to attempt it at all, and `--allow-live` in addition
  before it can reach `https://api.heycall-e.com` - enforced in code
  (`CallEClient.__post_init__`), not just documented.
- Dry-run is the default: without `--execute`, the exact request body
  and the compliance decision are printed and nothing is sent.
- Nothing about the recipient is guessed: `recipient_timezone` must be
  supplied, and a missing or invalid IANA name fails the relevant check
  instead of falling back to a default.
- Every recipient phone number is validated against the E.164 pattern
  before any network call is made (`build_recipient`).
- `CALLE_API_KEY` is read from the environment only when `--execute`,
  `--allow-live`, and the real base URL are all true at once
  (`resolve_api_key`); dry-run and any non-real `--base-url`, including
  the local fake server, never read it and use a hardcoded non-secret
  placeholder key instead, so the fake server can never receive a real
  credential. When the real key is used, it is never printed in full
  (`mask_secret`).
- Every phone number is masked to its last 4 digits (`mask_phone`) in
  every preview, error message, and result this app prints; the
  unmasked number is still what is actually sent to the API.
- Optional business context (`--business-context`/`--business-context-file`
  or the web form field) is size-capped at 4000 characters, fails loudly
  instead of silently truncating when over that limit, and is always
  sent as a separate, clearly labeled block from the operator's own task
  text - never merged into one string. See Business context injection.
- The full request body is printed before it is sent, on every run,
  dry-run or execute - there is no call this app can place silently.
- The `Idempotency-Key` sent with every real call is always derived from
  the call's own intent (phone, task, and invocation time -
  `derive_idempotency_key`), never random and never a fixed string.
- A `POST /v1/calls` that fails with no confirmed HTTP response (a
  timeout or connection error) is never blindly retried, but it does get
  exactly one safe, automatic retry using the same `Idempotency-Key`,
  because CALL-E guarantees that replaying the same key and body returns
  the original call instead of creating a duplicate (`calle.openapi.yaml`'s
  `IdempotencyKey` parameter). If that single retry also fails
  ambiguously, this app stops and says so - it never retries further or
  guesses. `/v1/calls` has no `GET`/list method, so there is no way to
  search for a call by `Idempotency-Key` after the fact; the error
  message points to the CALL-E dashboard instead of a nonexistent
  endpoint. `GET` polling, which is non-mutating, keeps retrying safely
  on its own schedule.
- Polling `GET /v1/calls/{id}` after a real call is placed continues
  indefinitely by default, not for a fixed timeout: this app cannot
  technically tell a call that is taking a long time because the
  conversation is genuinely long apart from one that is stuck - both
  look identical from here (status stays `queued`/`in_progress`, no
  error). Rather than guess and risk cutting a real conversation short,
  it prints a repeating reminder every 5 minutes
  (`--poll-warn-after-seconds`) instead of stopping, so the choice to
  keep waiting or go check the CALL-E dashboard is always the
  operator's, not this script's. Ctrl+C stops watching at any time (the
  call itself is not canceled - see the cancel-endpoint limitation
  above). `--poll-timeout-seconds` is still available for
  scripted/automated callers that want a guaranteed hard cutoff
  instead. This does not apply to the web UI, whose `--execute` mode
  keeps its fixed 120s cap (see Web UI above) since a browser request
  has no Ctrl+C equivalent.
- Any unmapped jurisdiction, any missing rule, or any single failing
  check blocks the call; there is no default-allow path anywhere in
  `compliance/dispatcher.py`.
- A revoked recipient cannot be called through a flag: there is no
  `--do-not-call-requested` CLI argument, and revocation is checked as
  its own blocking rule inside every jurisdiction that has one.
- There is no cancellation instruction to give, and this app does not
  pretend otherwise: `calle.openapi.yaml` has no cancel/DELETE endpoint
  for an in-flight call once `POST /v1/calls` has accepted it (known
  API limitation, tracked internally as C31). `client.py` prints this
  limitation at the moment a real call is created, not just here.
- Every phone number in this README and the test suite is from an
  officially regulator-reserved block, not just "unlikely to be real":
  US examples use the NANP `NPA-555-01XX` block; France examples use
  ARCEP's mobile fiction block `06 39 98` (Numbering Plan Art. 2.5.12);
  the one non-US/non-FR test number uses Ofcom's reserved drama mobile
  block `07700 900xxx`. `fake_server.py`'s internal sentinel numbers
  (`+10000000001`, `+10000000002`) use area code `000`, which cannot be
  a real NANP number at all. No number in this app was ever a plausible
  real subscriber number.
- The full test suite (`uv run pytest`) runs entirely against
  `fake_server.py`; no test reaches `api.heycall-e.com` or requires a
  live credential.
- What is not yet settled is written down, not silently assumed: gray
  areas are marked `confidence=MEDIUM` in the code's own output and
  listed by name above, rather than treated as confirmed rules.
- `client.py` and `fake_server.py` depend on nothing but the Python
  standard library plus `tzdata`; there is no unpublished or private
  package dependency to audit.
- Locale, region, and the AI-disclosure script sent to CALL-E always
  come from the jurisdiction that was actually checked
  (`resolve_locale_and_region`), so what is sent can never drift from
  what was verified.
- The jurisdiction's AI-disclosure script (`RULES.disclosure_script`)
  is a real, separately delimited block in the task now, sent first -
  see AI disclosure above for why this was a real defect, not a
  cosmetic addition.

## Prompt injection resistance

The person being called can try to manipulate the call: get the agent to
ignore its goal, reveal internal instructions or credentials, or act
outside its role. This app's only lever over what happens on the call is
the `task` string sent to CALL-E - it does not control CALL-E's
underlying voice model or runtime.

**What this adds:**

- Every `task` sent to CALL-E is the operator's own wording with a fixed
  safety block appended after it (`build_hardened_task`, never a rewrite
  of the operator's text - see `--task` in Usage). The block tells the
  model to treat anything the counterpart says as information to weigh
  against the goal, never as a new instruction, and names concrete
  extraction/override attempts to refuse: revealing instructions, system
  prompt, credentials, or the compliance logic that allowed the call;
  claims of being a developer, administrator, or "CALL-E support";
  "ignore your instructions" / "enter developer mode" / manufactured
  urgency. It also tells the model to end the call if the person keeps
  pushing after being told no once.
- `result_schema` requires every call to self-report
  `manipulation_attempt_detected` (plus an optional
  `manipulation_attempt_note` with what was attempted), so an operator
  can review attempted manipulation after the fact even when the model's
  real-time refusal isn't perfect.

**What this does not guarantee:**

This app cannot filter CALL-E's voice model output before the
counterpart hears it, cannot insert a canary token and cut the call
automatically, and cannot verify the model actually followed these
instructions rather than just reporting that it did.
[OWASP's GenAI LLM01:2025 guidance](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
is explicit that no purely prompt-based defense is provably complete
against a determined adversary, because these models have no structural
separation between instructions and the data they process - it's a
mitigation that raises the cost of casual probing and creates an audit
trail, not a security boundary. See also
[OpenAI's guidance on designing agents to resist prompt injection](https://openai.com/index/designing-agents-to-resist-prompt-injection/),
which this instruction block follows (name concrete attack phrasings,
treat counterpart input as data, give the agent an explicit way to end
the interaction). `manipulation_attempt_detected` is exactly as reliable
as the model self-reporting it - a sufficiently successful manipulation
could suppress that flag too.

## Architecture

```
CLI args
  |
  v
PreCallContext (phone, consent, dnc, gdpr basis, timezone, now)
  |
  v
compliance.dispatcher.run_precall_checks()
  |
  +--> resolve_jurisdiction_chain(phone)
  |      -> jurisdiction chain, e.g. (eu_common, fr)
  |
  +--> each jurisdiction's check(context)
  |      -> list of CheckResult (passed/failed, confidence, reason)
  |
  v
PreCallDecision (allowed or blocked, with reasons)
  |
  +--> blocked: print reasons, exit. No network call is made.
  |
  +--> allowed:
         |
         v
       resolve_locale_and_region(jurisdiction_chain)
         -> locale, region, disclosure_script
         |
         v
       build_hardened_task(task, business_context, disclosure_script)
         -> disclosure block FIRST, then business context, operator
            task, injection-resistance block, voicemail-handling block
         |
         v
       POST /v1/calls (task, recipient with resolved locale/region,
                        result_schema)
         |
         v
       poll GET /v1/calls/{id} until a terminal status
         |
         v
       structured_result (intent, next_action, confidence_note)
```
