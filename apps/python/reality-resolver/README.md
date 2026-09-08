# reality-resolver

Reality Resolver is a decision engine: given a set of evidence about the
world, it determines whether a decision can already be made, or whether
a genuine, decision-critical uncertainty remains that only a real
conversation can resolve. When it can't decide from evidence alone, it
escalates to a real, compliance-gated CALL-E phone call to resolve the
uncertainty, then reconciles what CALL-E learned back against the
original evidence to reach a final verdict - never treating an
unresolved outcome as if it were a negative answer.

The demonstrated use case is **Ghost Appointment Resolution**: a
scheduled appointment where contradictory or incomplete information
about whether it will happen makes a decision impossible from the
records alone (see "The Ghost Appointment scenario" below). The engine
itself is generic - any domain with the same shape (a structured record,
a conflicting human account, a decision deadline) fits the same four
rules - but only this one use case is implemented today. Extending to
other use cases is future work, not a reason to import logic from an
unrelated use case now (see "Compliance by use case" below).

The legal/compliance gate and the CALL-E task-hardening this uses were
originally built for a different, commercial-outbound product on this
same repository and PR (`compliance-gated-callback`). Reality Resolver
is **not an evolution of that product** - it is a separate decision
engine that reuses that gate as one component, unmodified, the same way
it would reuse any other well-tested library. See "The compliance gate
(reused infrastructure)" below for exactly what is reused and what is
not part of Reality Resolver's own scope.

## Decision engine

```
Evidence sources (fixtures JSON)
  -> Evidence Matrix
  -> 4 generic rules (R1-R4)
  -> decision-critical uncertainty?
       NO  -> NO_CALL_NEEDED
       YES -> call justified -> compliance rules applicable to this use case
                NO  -> UNRESOLVED_CALL_BLOCKED, RETRY_WHEN_PERMITTED
                YES -> CALL-E (client.py, reused as-is)
                       -> structured_result -> reconciliation
                       -> RESOLVED / RESOLVED_ALT / UNRESOLVED_AMBIGUOUS
```

Two branches never reach CALL-E at all: `NO_CALL_NEEDED` (the evidence
is not actually in decision-critical contradiction - see "The four
rules" below) and `UNRESOLVED_CALL_BLOCKED` (the call would be
justified, but a compliance rule that still applies to this use case
blocks it; see `next_window.py` for the honest limits of the "next
legal window" projection this shows).

**`UNRESOLVED_CALL_BLOCKED` vs. `UNRESOLVED_AMBIGUOUS` - not the same
thing.** `UNRESOLVED_CALL_BLOCKED` means no call was placed at all: the
uncertainty was decision-critical, but a still-applicable compliance
rule refused (disclosure, revocation, and so on) - the recipient never
heard the phone ring. `UNRESOLVED_AMBIGUOUS` means a call *was* placed
and answered, but CALL-E's own result did not cleanly confirm or cancel
(voicemail, an IVR, or a genuinely uncertain answer) - see
"Reconciliation and verdicts" below.

## The Ghost Appointment scenario

`cases/ghost-appointment.json` is the shipped example (`use_case:
"appointment_confirmation"`): a dental practice's calendar says a
patient's appointment is confirmed for 14:00 tomorrow (`type:
structured`, low ambiguity). A separate email from the patient says "I
may need to cancel" (`type: human`, high ambiguity). A scheduled
follow-up never got a reply (`type: absence`). Nobody has actually
reconciled these two accounts - the slot might be kept, or it might be
sitting on the calendar unused while another patient could have taken
it. That is a decision-critical contradiction by construction (see "The
four rules" below: R1 and R2 both come from this same tension, R3
confirms nothing since resolved it, and R4 depends on how close the
appointment deadline is) - not because the scenario is contrived to
make the rules fire, but because a ghost appointment like this is
exactly the kind of ambiguity worth resolving with one phone call before
deciding `KEEP_SLOT` or `RELEASE_SLOT`.

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
  `if_confirmed`/`if_cancelled`), `call_phone`, `call_task_hint` (seeds
  the operator-task text handed to `build_hardened_task`, unmodified),
  and `use_case` (which generic compliance rules apply - see
  "Compliance by use case" below).

Cases are loaded from JSON - see `cases/ghost-appointment.json`. Fields
map directly: `freshness_hours`, `decision_deadline_threshold_hours`,
and `deadline` (ISO 8601 UTC) are plain numbers/strings, not relative
phrases - "tomorrow 14:00" is not machine-meaningful without a fixed
reference point, so a real case should pin a concrete date. The shipped
fixture's deadline will need bumping as time passes; use `--now-utc` to
pin a consistent "now" close to it for a reliable demo run (see
"Running the demo" below).

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
`structured_result` (using `patient_intent_result_schema()`) into a
final verdict:

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

## Compliance by use case

The compliance gate below (`compliance/`) was originally written for
commercial outbound solicitation, so its checks include rules - calling
windows, prior-consent requirements, do-not-call-registry scrubs,
solicitation-frequency caps - that are scoped, in their own source
statutes, specifically to *telephone solicitation* / *telemarketing*.
Reality Resolver's appointment-confirmation calls are not that: they
resolve a genuine uncertainty about an existing appointment, not
prospect a stranger. Applying commercial-solicitation rules to that call
would be wrong in the other direction - not "less safe," just
inapplicable to what the call actually is.

The architecture stays simple on purpose - no jurisdiction x use-case
matrix:

```
Case
  -> use_case
  -> compliance rules applicable to this use_case
  -> hard safety gate
  -> CALL-E
  -> reconciliation
  -> verdict
```

`compliance/dispatcher.py` and `compliance/jurisdictions/*.py` are
untouched and stay purpose-agnostic: they produce the full set of checks
for a phone number regardless of why the call is being made.
`compliance/use_cases.py` is the one new, small piece: it filters that
full set down to what's actually applicable to `case.use_case`, and
recomputes whether the call is allowed from that filtered subset alone.
For `appointment_confirmation`, the checks ending in `_calling_window`,
`_consent`, `_dnc_scrub`, and `_solicitation_cap` are exempted; every
other check - AI-disclosure, revocation, jurisdiction resolution itself,
and (for EU numbers) a documented GDPR Art. 6 basis - stays applicable
and hard-enforced, for every call, real or fake, with no mode or flag
that bypasses or merely warns about a failing one.

For a EU number, `--gdpr-basis-documented` still gates the call exactly
as before - GDPR Art. 6 requires a lawful basis for processing personal
data regardless of whether the call is commercial, so this check is
never exempted for any use case. Only the *meaning* of what's being
attested changes: for `appointment_confirmation`, passing this flag
attests that the operator has identified and documented a basis
applicable to confirming an *existing* appointment - ordinarily Art.
6(1)(b) (necessary to perform that appointment/service) or Art. 6(1)(f)
(legitimate interest in confirming it) - not Art. 6(1)(a) (marketing
consent), which has no place in this use case at all. The flag itself,
and the requirement that an operator explicitly attest it before every
real EU call, are unchanged: this stays a human attestation made at
call time, never a value read from the case file, and never assumed
true just because the use case is `appointment_confirmation` - a
non-commercial purpose narrows *which* basis applies, it does not
remove the need to have and document one.

**Honest limit.** For a US number under `appointment_confirmation`, once
the commercial-specific checks are filtered out, the only checks left
today are AI-disclosure (a static check that always passes) and
revocation (not reachable through any CLI flag - see "Safety" below).
In practice, the hard gate is very permissive for this exact
combination with the current rule corpus - not because it was weakened,
but because there simply is no US-federal rule in this codebase today
that legitimately applies to a non-solicitation call. This is stated
here rather than left to be discovered later; adding a real, sourced,
purpose-agnostic rule (if one is found) is a normal future addition to
`compliance/jurisdictions/us_federal.py`, not a change to this filter.

Adding a second use case means adding one entry to
`compliance/use_cases.py`'s exemption table - not building a matrix.

## CLI output

`resolver.py case.json` prints five sections, in order:

- `EVIDENCE STATE` - every evidence item (source, type, freshness,
  ambiguity, claim).
- `REASONING` - R1-R4, each `YES`/`NO` with its explanation.
- `CALL JUSTIFICATION` - whether the uncertainty is decision-critical.
- `CALL PERMISSION` - only if a call is justified; the compliance
  gate's full, unfiltered output (`client.py`'s
  `print_compliance_decision`, reused unmodified), which checks were
  exempted for this case's `use_case`, the resulting
  use-case-applicable `allowed` value, and the next legal window if
  still blocked (`next_window.py` - only computed when every remaining
  blocking reason is a calling-window check).
- `CALL-E` - only if the call is permitted; the request body preview,
  and (with `--execute`) the created call and final result.
- `VERDICT` - status, action, and the evidence cited (the original case
  evidence, `use_case`, and, when a call was placed, CALL-E's own
  result).

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
  --now-utc 2026-09-10T20:00:00Z
```

No compliance flags are needed for this shipped `appointment_confirmation`
case - calling-window, consent, and DNC are exempted for this use case
(see "Compliance by use case" above). Add `--phone +10000000004` or
`--phone +10000000005` to see the `RESOLVED_ALT`/`UNRESOLVED_AMBIGUOUS`
branches instead. Drop `--now-utc` far from the case's deadline to see
`NO_CALL_NEEDED` instead - it needs no fake server at all, since it
never reaches CALL-E.

The shipped `cases/ghost-appointment.json` uses a reserved, non-routable
NANP placeholder number (`+12025550123`) - never a real one. Pass
`--phone` to override it for a real call; do not edit or commit a real
number into a case file.

A real call additionally requires `--allow-live` and
`--authorize-destination <the same E.164 number>`, on top of
`--execute` - see the Safety section for what each of the three
authorizes. None of the fake-server commands above need them.

## The compliance gate (reused infrastructure)

> `compliance/`, and the disclosure-script, injection-resistance,
> voicemail-handling, no-repeat-opening, proactive-next-step, and
> call-closing instruction blocks in `client.py`, were originally built
> for a different, commercial-outbound product on this same repository
> and PR (`compliance-gated-callback`). Reality Resolver reuses this
> layer unmodified, as one component among several - the same way it
> would reuse any other tested library. It is not an evolution of that
> product, and the sections below describe what that reused layer does
> in general, not what Reality Resolver's own use case needs (see
> "Compliance by use case" above for that).

Resolving a phone number to its applicable jurisdiction(s) and running
each one's own `check(context)` is the generic part of this layer that
Reality Resolver actually depends on:

| Jurisdiction | Key rules |
|---|---|
| US federal | 8am-9pm local recipient time, documented prior express written consent, National DNC Registry scrub, FCC-required artificial-voice disclosure, revocation honored by any means |
| Oregon (stacks on US federal) | Narrower 8am-8pm local recipient time, solicitation cap of 3 calls+texts combined per rolling 24h (HB 3865), revocation honored |
| EU common (27 member states) | AI Act Art. 50 disclosure of the AI interaction, ePrivacy Art. 13(1) opt-in consent, GDPR Art. 6 lawful basis documented |
| France (stacks on EU common) | Opt-in consent required since 2026-08-11, calls only Mon-Fri 10h-13h and 14h-20h, Bloctel/opposition-list scrub |

For `appointment_confirmation`, only the AI-disclosure, revocation, and
(EU) GDPR-basis rows above stay applicable - see "Compliance by use
case" above. The rest is real, generic infrastructure kept intact for
whatever use case needs it next.

Oregon is this layer's first US state-level variation, stacked on top of
`us_federal` the same way `fr` stacks on `eu_common`, matched by area
code (`503`, `541`, `971`, `458` - `compliance/dispatcher.py`'s
`_US_STATE_AREA_CODE_OVERLAY`) since the shared `+1` country code cannot
identify a state on its own. Adding a second state means adding its area
codes to that overlay, not changing the resolution logic. Every other US
number falls through to the federal baseline alone.

Also note: `+1` is the shared NANP calling code for the United States,
Canada, and over twenty Caribbean territories, not the United States
alone. This layer has no full area-code-to-country lookup table, so
every `+1` number not matched by the Oregon overlay above is routed to
the US federal jurisdiction alone; a Canadian or Caribbean number would
currently be evaluated against the wrong rules. `+33` (France) has no
such ambiguity: EU country calling codes are one-to-one with a single
country.

### Adding a jurisdiction

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
4. If any of the new rules are commercial-solicitation-specific, add
   their check-name suffix to `compliance/use_cases.py`'s exemption
   table for the use cases they don't apply to - do not leave a
   solicitation-specific rule silently blocking a non-commercial use
   case, or silently exempted from a commercial one.

## AI disclosure

**This was a real defect found by testing, not a cosmetic addition.**
Every jurisdiction module defines a `DISCLOSURE_SCRIPT` constant (AI Act
Art. 50 / FCC rule 24-17 wording), and the compliance gate printed
`[PASS] ..._ai_disclosure: disclosure_script discloses the AI
interaction`. But that check only ever inspected the constant against
*itself* - a tautology, since the constant is our own hardcoded text and
the check just looks for the word "artificial" inside it. Nothing ever
read `RULES.disclosure_script` or passed it into the task sent to
CALL-E. A call could pass the compliance gate's AI-disclosure check
while the real call disclosed nothing at all.

The fix: `compliance.dispatcher.resolve_locale_and_region` also resolves
the effective `disclosure_script` for the jurisdiction chain (same
"narrowest jurisdiction that actually defines one wins" rule already
used for `region_code`). `build_hardened_task` sends it as a real,
separately delimited block, first - before the operator's own task -
because disclosure has to happen at the very start of the call.

**Second real defect, also found by testing**: the script correctly said
"this is an AI," but never said *why* it was calling - it asked the
recipient to explain instead, which is backwards. The disclosure
scripts now follow one structure in every jurisdiction: identity and
entity, **then the reason for the call**, then the closing
rights/callback statement.

The scripts contain placeholders (`[ENTITY]`/`[ENTITE]`,
`[AGENT_NAME]`/`[NOM_AGENT]`, `[REASON_FOR_CALLING]`/`[RAISON_APPEL]`,
`[CALLBACK_NUMBER]`) that must never reach CALL-E as literal bracket
text - a voice agent would say the brackets out loud. `--entity-name`
and `--agent-name` let an operator supply real values; omitting either
uses an honest, generic fallback rather than a fabricated name.
`[REASON_FOR_CALLING]`/`[RAISON_APPEL]` is instead replaced with a
bracketed instruction telling CALL-E's own model to state the reason
itself, based on the task text that immediately follows in the same
message, and explicitly **not** to ask the recipient for it - there is
no reliable way to turn arbitrary free-form task text into a short
spoken reason, so this app does not try to guess one.

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
   civil claims arising from an AI system's actions. This is settled
   law, not an open question, but this layer has no California-specific
   jurisdiction module yet: California numbers currently fall through
   to the US federal baseline only.
8. Whether "resolving a decision-critical uncertainty about an existing
   appointment" is legally distinct from "telephone solicitation" is a
   good-faith reading of the statutory scope of each rule listed above
   (see "Compliance by use case"), not a court-tested classification.

Two of these are implemented in code today as explicit, short-lived
exceptions rather than silently assumed: a US call outside the calling
window is allowed if consent was obtained within the previous 15
minutes (`compliance/jurisdictions/us_federal.py`), and French public
holidays are not yet excluded from the calling window, only weekends
(`compliance/jurisdictions/fr.py`). Both are marked
`confidence=MEDIUM` on the specific `CheckResult` they produce.

## Voicemail handling

A real call reached an answering machine and, with no instruction
telling it otherwise, repeated its full opening pitch three times over
about 35 seconds instead of leaving one message and hanging up.
`build_hardened_task` appends a fixed block, `VOICEMAIL_HANDLING_INSTRUCTIONS`,
after the injection-resistance block: it tells the agent that if it
reaches an automated greeting with no interactive back-and-forth, it
should deliver one brief message stating who is calling and why, then
end the call - not repeat itself.

**Honest limit, confirmed by CALL-E itself**: this app cannot make
CALL-E behave differently *during* a call beyond what the task text
asks. CALL-E's own PM confirmed directly on Discord (2026-08-27) that
there is no real-time answering-machine detection or behavior control -
the only official mechanism is post-call classification through a
developer-defined `result_schema` field. That is exactly what the
optional `answered_by` field (`human | voicemail | ivr | unknown`) is:
it lets an operator see, after the fact, whether a given call reached a
person, a machine, or an IVR - it does not and cannot change what
happened live on that call.

This is not a problem unique to this app.
[Issue #89](https://github.com/CALLE-AI/awesome-phone-call-agents/issues/89)
in this repo independently documents the same failure mode. Two other
apps in this repo hit the identical gap and solved it the same way, at
the task/app layer rather than relying on a platform feature that does
not exist: `ringedingeding` ([PR #146](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/146))
and `researchcall-survey` ([PR #145](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/145)).

## Call closing

A real call showed the agent end the call immediately after a bare,
brief acknowledgement, with no recap of what was decided, cutting the
recipient off mid-reply. `build_hardened_task` appends a fixed block,
`CALL_CLOSING_INSTRUCTIONS`, LAST (after every other block described
here): it tells the agent to give a clear, brief recap of what was
decided and what happens next before ending the call, and to never be
the one to hang up first - it should wait for an explicit signal from
the recipient ("goodbye," "that's all," "thank you") and keep the
conversation open until then, rather than assume a short reply means
the call is over.

**Honest limit, same as voicemail handling**: this is a prompt-level
instruction, not a control this app executes or can verify. CALL-E
offers no real-time hook for managing call flow. If the model doesn't
follow the instruction, nothing here catches it; the only feedback
available is reviewing the transcript afterward, exactly how this issue
was found in the first place.

**Don't add an arbitrary time limit to `call_task_hint`.** An
operator-written phrase like "keep it under 90 seconds" directly
conflicts with the instructions above: it pressures the model to cut
the mandatory recap short, or hang up early, specifically to stay under
a limit that has no real basis. Let the conversation run as long as it
naturally needs to reach a proper close.

## Conversation flow

Two more fixed blocks address behavior observed mid-call, in real
calls, not just at the open or close:

- `NO_REPEAT_OPENING_INSTRUCTIONS` - real calls showed the agent treat a
  short, unclear, or interrupting reply as a cue to restart its opening
  (disclosure + reason for calling) from scratch, instead of continuing
  the conversation. `VOICEMAIL_HANDLING_INSTRUCTIONS` only ever
  addressed this for the voicemail case specifically; this generalizes
  the same rule to any live reply - say the opening once, then never
  repeat it in full again, no matter how brief or unclear the
  recipient's response is.
- `PROACTIVE_NEXT_STEP_INSTRUCTIONS` - after answering a question, the
  agent should actively suggest a concrete next step (an appointment, a
  transfer, more information) instead of waiting passively for the next
  question.

Same honest limit as every other block here: these are instructions to
the model, not controls this app enforces or can verify from outside.

**A note on task size, since this keeps growing.** `build_hardened_task`
is now up to seven distinct blocks. Measured directly: the six fixed
instruction/label blocks alone are already roughly 3200 characters
(~800 tokens) before any operator task or disclosure text is added.
More competing instructions in one prompt is a known way to make a
model less reliable at following any one of them precisely - and
there's a real possibility this isn't just a risk in the abstract: a
long, dense instruction block is exactly the kind of thing that could
push a model to "replay the script from the top" as a recovery
heuristic when it loses its place, which is the leading hypothesis for
why the repetition bug above happens at all. Each block so far has been
added in response to a concretely observed real call defect, and that
bar should stay high: if instruction-following problems keep showing up
as this list grows, the next fix should be consolidating or shortening
these blocks, not appending another one.

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

## Safety

- A real call requires explicit intent at three independent points:
  `--execute` to attempt it at all, `--allow-live` before it can reach
  `https://api.heycall-e.com` (enforced in code by
  `CallEClient.__post_init__`, not just documented), and
  `--authorize-destination <E.164>` naming the exact number the call may
  reach. The three answer different questions - *send anything at all?*,
  *against the real API?*, *to which number?* - and none of them implies
  the others.
- `--authorize-destination` is compared byte-for-byte against the number
  that will actually be sent to CALL-E: the case file's `call_phone`, or
  `--phone` when it overrides it. No normalization is applied - no
  stripping, no reformatting, no country-code inference - so a number
  that merely looks equivalent can never authorize a different one, and
  authorizing a case file's original number does not authorize a
  `--phone` override of it. A missing or mismatched value is refused
  before the evidence engine runs and long before any HTTP client is
  constructed, so nothing reaches the network.
- The compliance gate (filtered by use case, see above) is always fully
  enforced, fail-closed, for a real call, with no mode or flag that
  bypasses or merely warns about a still-applicable failing check.
- Dry-run is the default: without `--execute`, the exact request body
  and the compliance decision are printed and nothing is sent.
- Nothing about the recipient is guessed: for a still-applicable
  timezone-dependent check, a missing or invalid IANA
  `--recipient-timezone` fails that check instead of falling back to a
  default.
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
- The full request body is printed before it is sent, on every run,
  dry-run or execute - there is no call this app can place silently.
- The `Idempotency-Key` sent with every real call is always derived
  from the call's own intent (phone, task, and invocation time -
  `derive_idempotency_key`), never random and never a fixed string - so
  a deliberate, human-initiated retry (a fresh invocation) is never
  confused with an automatic one.
- `POST /v1/calls` is **never retried automatically, for any reason** -
  not a retryable-looking HTTP status, and not an ambiguous failure
  with no confirmed response at all (a timeout or connection error),
  even though CALL-E's own Idempotency-Key semantics would make such a
  retry safe. Once there is a real risk the provider already created
  the call, this app stops and says so immediately (pointing at the
  CALL-E dashboard, since `/v1/calls` has no `GET`/list method to search
  by `Idempotency-Key`) rather than silently repeating a request that
  might already have taken effect. `GET` polling, which is
  non-mutating and can never create a duplicate, keeps its own bounded
  retry with backoff.
- Polling `GET /v1/calls/{id}` after a real call is placed continues
  indefinitely by default, not for a fixed timeout: this app cannot
  technically tell a call that is taking a long time because the
  conversation is genuinely long apart from one that is stuck. Rather
  than guess and risk cutting a real conversation short, it prints a
  repeating reminder every 5 minutes (`--poll-warn-after-seconds`)
  instead of stopping. Ctrl+C stops watching at any time (the call
  itself is not canceled - see the cancel-endpoint limitation below).
  `--poll-timeout-seconds` is still available for scripted/automated
  callers that want a guaranteed hard cutoff instead.
- Any unmapped jurisdiction, any missing rule, or any single failing
  check still applicable to the case's `use_case` blocks the call;
  there is no default-allow path anywhere in `compliance/dispatcher.py`
  or `compliance/use_cases.py`.
- A revoked recipient cannot be called through a flag: there is no
  `--do-not-call-requested` CLI argument, and revocation is checked as
  its own blocking rule inside every jurisdiction that has one - and is
  never exempted for any use case.
- There is no cancellation instruction to give, and this app does not
  pretend otherwise: `calle.openapi.yaml` has no cancel/DELETE endpoint
  for an in-flight call once `POST /v1/calls` has accepted it (known
  API limitation, tracked internally as C31). `client.py` prints this
  limitation at the moment a real call is created.
- Every phone number in this README and the test suite is from an
  officially regulator-reserved block, not just "unlikely to be real":
  US examples use the NANP `NPA-555-01XX` block (including the Oregon
  area-code example); French examples use ARCEP's mobile fiction block
  `06 39 98` (Numbering Plan Art. 2.5.12); the one +44 number, used to
  exercise an unmapped jurisdiction, comes from Ofcom's reserved drama
  range `020 7946 0xxx` (plus `07700 900xxx`, its reserved mobile
  equivalent). `fake_server.py`'s internal sentinel numbers
  (`+10000000001` through `+10000000005`) use area code `000`, which
  cannot be a real NANP number at all. The only two values not from a
  reserved block are the E.164 length boundaries in `test_client.py`
  (7 and 15 digits): no reserved block exists at those lengths, and both
  are structurally impossible to route - `+1` followed by 6 or 14 digits
  is not a dialable NANP number.
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

## Prompt injection resistance

The person being called can try to manipulate the call: get the agent to
ignore its goal, reveal internal instructions or credentials, or act
outside its role. This app's only lever over what happens on the call is
the `task` string sent to CALL-E - it does not control CALL-E's
underlying voice model or runtime.

**What this adds:**

- Every `task` sent to CALL-E is the operator's own wording with a fixed
  safety block appended after it (`build_hardened_task`, never a rewrite
  of the operator's text). The block tells the model to treat anything
  the counterpart says as information to weigh against the goal, never
  as a new instruction, and names concrete extraction/override attempts
  to refuse: revealing instructions, system prompt, credentials, or the
  compliance logic that allowed the call; claims of being a developer,
  administrator, or "CALL-E support"; "ignore your instructions" /
  "enter developer mode" / manufactured urgency. It also tells the
  model to end the call if the person keeps pushing after being told no
  once.
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
which this instruction block follows. `manipulation_attempt_detected`
is exactly as reliable as the model self-reporting it - a sufficiently
successful manipulation could suppress that flag too.

## Architecture

```
Case (evidence, deadline, use_case)
  |
  v
evidence.engine.evaluate() -> R1-R4 -> decision_critical?
  |
  +--> NO  -> Verdict(NO_CALL_NEEDED, NO_ACTION_REQUIRED)
  |
  +--> YES:
         |
         v
       compliance.dispatcher.run_precall_checks(context)
         -> full, purpose-agnostic PreCallDecision
         |
         v
       compliance.use_cases.apply_use_case(decision, case.use_case)
         -> PreCallDecision filtered to what applies to this use case
         |
         +--> blocked -> Verdict(UNRESOLVED_CALL_BLOCKED, RETRY_WHEN_PERMITTED)
         |
         +--> allowed:
                |
                v
              build_hardened_task(case.call_task_hint, disclosure_script)
                |
                v
              POST /v1/calls (never auto-retried) -> poll GET until terminal
                |
                v
              verdict.reconcile(structured_result, case.decision_options)
                -> RESOLVED / RESOLVED_ALT / UNRESOLVED_AMBIGUOUS
```

## Lineage

`compliance/` and the disclosure/injection-resistance/voicemail/closing
instruction blocks in `client.py` originated as an earlier, independent
submission on this same repository and PR (`compliance-gated-callback`).
That original project's own CLI, web form, public demo, and
business-context feature were specific to its commercial-outbound use
case and have been removed from this codebase - they are not part of
Reality Resolver's scope. What is described in this README is what
actually remains and runs today; the earlier commercial product's full
history stays in this PR's git log, not as a maintained feature here.
