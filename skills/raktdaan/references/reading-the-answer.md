# Reading the answer

This is the file that decides whether a call counted, and it is the reason the
skill exists.

## The number

A tele-recruitment programme in Dehradun placed 62,762 calls. 43% were answered.
Of answered calls, **75.8% said yes**. Of those yeses, **9.18% donated**.

That is not dishonesty. It is politeness, and it is culturally specific. "Haan,
koshish karunga" — yes, I'll try — is a courteous way of declining. A caller
working a yes/no register records it as a yes. The register then shows ninety
confirmed donors and nine people turn up, and the blood bank plans staffing
around the ninety.

## The bar

**A confirmation requires a specific arrival window.**

Not agreement. Not enthusiasm. A clock time.

| Reply | Grade | Why |
| --- | --- | --- |
| "Yes, I can come 10 to 12 tomorrow" | confirmed | agreement + window |
| "Haan, 4 baje aa jaunga" | confirmed | agreement + window |
| "Yes of course, I'll come this week" | **unclear** | no window |
| "Sure sure, koshish karunga" | **unclear** | hedge |
| "Okay maybe tomorrow" | **unclear** | hedge outranks the okay |
| "Yes, I think so" | **unclear** | hedge |
| "It's 4 pm here" | **unclear** | a time, but no agreement |
| "No, I'm travelling" | declined | |
| "Please remove me" | declined + opt-out written back | |
| (no pickup) | no_answer | |

## Precedence

Checked in this order, and the order is the safety argument:

1. **Opt-out** — a standing instruction, outranks the run
2. **Decline**
3. **Hedge**
4. **Agreement**

Agreement is checked last so it can never override a hedge in the same sentence.
"Yes, I'll try" contains both; it grades unclear.

## Unclear is not a no

An unclear answer leaves the donor in the register, uncounted, unmarked. The
cascade moves to the next person. The donor is not recorded as having refused,
because they did not, and marking them so would remove a willing person from
future shortages.

This is why `unclear` is reported as its own bucket rather than folded into
`declined`. A run with eight unclears and one confirmation is telling the blood
bank something specific about its register.

## Hedge markers

English: maybe, may be, I'll try, will try, try to, let's see, we'll see,
probably, might, if possible, if I can, hopefully, I think so, should be able,
not sure, see how, call me later, let you know, I'll check, have to check.

Hindi (romanised, as it arrives in a transcript): koshish, dekhenge, dekhta,
dekhti, ho sakta, shayad, agar.

Tamil (romanised): paarkalam, paarpom, try pannuren, theriyala.

The list is not exhaustive and cannot be. It is a floor, not a ceiling.

## Who does the grading

`scripts/raktdaan/commitment.py` is the deterministic reference grader. It drives
the fixture harness and serves as a fallback.

On a live call the authoritative reading is the agent applying this file to the
transcript, because a hedge can be carried entirely by tone, hesitation or word
order — none of which survive into a keyword list. CALL-E's
`completion_confidence` is also available, but it scores whether the *task*
completed, not how strong the donor's commitment was; the two are different
questions and it should not be used as a commitment signal.

**When the grader and the agent disagree, take the stricter of the two.**

## What the call does after an unclear answer

Asks once more, for a window specifically. If it is still unclear, thanks them
warmly and ends.

It does not press a third time. A donor pressed into a commitment is a no-show
with extra steps, and the pressing is what costs the blood bank the relationship.
