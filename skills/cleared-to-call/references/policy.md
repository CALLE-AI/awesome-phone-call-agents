# Policy Reference

The policy is a data file, not code: `assets/policy.json`. It holds the call
window, the required disclosure elements, the five rules, and the revocation
phrases. The helper scripts read it at runtime. Changing the file changes the
gate, and nothing in the scripts hard-codes a legal threshold.

This is a single-jurisdiction policy: **United States federal**. It encodes the
TCPA, the FDCPA, and Regulation F. It is not valid anywhere else. Another
jurisdiction needs another policy file, reviewed by someone qualified to write
it.

None of this is legal advice. The rules below are an engineering encoding of
widely documented requirements, and an operator remains responsible for their
own compliance position.

## Rule 1 - Call window

**Requirement.** Dial only between 08:00 and 21:00 in the recipient's local
time.

**Authority.** FDCPA 15 U.S.C. 1692c(a)(1); Regulation F, 12 CFR
1006.6(b)(1)(i).

**Runtime check.** Convert the current instant into the IANA timezone stored on
the account and compare the wall-clock time against the window.

**Property.** `G(dial -> local_time_within(08:00, 21:00))`

**Block reason.** `OUTSIDE_CALL_WINDOW`

The timezone comes from the account record and nowhere else. Not the area code,
not the country code, not the operator's locale, not the server clock. An area
code says where a number was issued, not where the person is. A missing or
unrecognized timezone fails the rule, because a guessed timezone is a guessed
legal position.

The window is evaluated against real local time, so daylight saving is handled
by the timezone database rather than by an offset stored somewhere.

## Rule 2 - Consent on file

**Requirement.** Dial only when prior express consent is recorded, with a
timestamp.

**Authority.** TCPA 47 U.S.C. 227(b)(1)(A).

**Runtime check.** `consent_on_file` is true and `consent_timestamp` parses as a
timestamp with a UTC offset.

**Property.** `G(dial -> consent_on_file & consent_timestamp_present)`

**Block reason.** `NO_CONSENT`

A consent flag with no timestamp fails. An unparseable timestamp fails. Consent
that cannot be evidenced is not consent, and the timestamp is the evidence.

## Rule 3 - Not suppressed

**Requirement.** Never dial a number on the opt-out or do-not-call suppression
list.

**Authority.** TCPA 47 CFR 64.1200(d); FDCPA 15 U.S.C. 1692c(c).

**Runtime check.** The normalized number is not present in the suppression list.

**Property.** `G(suppressed(number) -> G(!dial(number)))`

**Block reason.** `ON_SUPPRESSION_LIST`

Numbers are normalized to digits before comparison, so `+1 (555) 010-1234` and
`+15550101234` are the same number. The list is append-only: rule 5 writes to
it, and nothing in the calling path removes from it.

Note the shape of the property. Suppression is not a condition on the next call,
it is a condition on every call after it, forever.

## Rule 4 - Disclosure ready

**Requirement.** The rendered call script must contain every required disclosure
element before the call is placed.

**Authority.** FDCPA 15 U.S.C. 1692e(11); TCPA 47 U.S.C. 227(d)(3)(A).

**Runtime check.** Each element in `disclosure_elements` matches the rendered
script text.

**Property.** `G(dial -> script_contains(all disclosure_elements))`

**Block reason.** `MISSING_DISCLOSURE`

The four elements:

| Element | What it requires |
| --- | --- |
| `caller_identity` | The call names the calling entity and who it acts for |
| `automated_voice_identity` | The call states the caller is automated |
| `debt_collection_purpose` | The call states it is an attempt to collect a debt |
| `opt_out_instruction` | The call tells the recipient how to stop future calls |

This is a pre-dial property of the script, which is why the script has to be
rendered before the gate runs rather than after it. It is checked again after
the call against what the agent actually said, and that second reading is what
sets `disclosure_given` on the result.

## Rule 5 - Live revocation

**Requirement.** If the recipient revokes consent during the call, end the call,
record the opt-out, and suppress the number.

**Authority.** TCPA 47 CFR 64.1200(a)(10); Regulation F, 12 CFR 1006.6(c).

**Runtime check.** Recipient turns are normalized and matched against the
revocation phrase list.

**Property.** `G(revocation_detected -> F(end_call & suppressed(number)))`

**Outcome.** `opt_out`

This is the only rule that cannot be settled before dialing, and it is enforced
in two places:

1. The call task instructs the agent to acknowledge once and hang up.
2. The transcript is re-read afterwards, and that check writes the suppression
   entry.

The second step is the one that must not be skipped. An agent that talks past
an opt-out is a compliance failure, but it becomes a much larger one if the
number is then dialed again next week. The post-call check makes the
suppression independent of the agent's behavior during the call.

Matching is deliberately literal: normalize away punctuation, apostrophes and
case, then look for a phrase from the list. It is easy to read, easy to audit,
and easy to extend by editing the policy file. It will not catch every possible
phrasing - see `references/safety.md` for what that means in practice.

Only recipient turns are considered. The agent's own opt-out disclosure contains
the phrase "stop calling" by design, and must not be read as the recipient
opting out.

## On the temporal properties

Each rule carries a `temporal_form`. That is the property the rule is meant to
enforce, written the way a temporal-logic specification would state it: `G` for
"always", `F` for "eventually".

These strings are specification, not implementation. This skill evaluates the
runtime checks described above; it does not model-check the formulas. They are
in the policy file because a rule stated as a property is reviewable in a way
that a rule stated as code is not, and because agent behavior of exactly this
shape is what a formal verification pass would check against.

## Changing the policy

Editing `assets/policy.json` changes what the gate allows. Treat it as a
controlled change:

- keep the rule ids stable, since audit entries reference them
- bump `policy_version` on any change to a rule or the window
- never widen the call window or drop a disclosure element to make a batch pass
- a new jurisdiction is a new policy file, not an extra branch in an existing
  rule
