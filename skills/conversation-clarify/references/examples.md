# Examples

All numbers below are from ranges reserved for documentation. Nothing here places a call.

## A. Unclear choice — a finding

> **You:** Does Monday or Tuesday work for the kickoff? Stephen can only join Tuesday.
> **Alex:** Yeah, I'll be there.

Options `["Monday", "Tuesday"]` were offered. The reply is affirmative and names neither.

- **Call asks:** "Which one did you mean, Monday or Tuesday?"
- **Resolved:** `chosen_option: "Tuesday"`, quote: *"Tuesday, because Stephen is only
  around then."*
- **Draft:** confirms Tuesday, quotes the sentence, invites correction.

## B. Commitment without specifics — a finding

> **You:** Can you send the signed copy over before the board meeting?
> **Alex:** Will do.

A request, an agreement, and no date anywhere.

- **Call asks:** "What date should we expect it by?"
- **Resolved:** `committed_date: "Thursday"`, quote: *"I'll have it over to you Thursday
  morning."*

Confidence is raised, not lowered, when the reply contains a vague-time word:

> **Alex:** Sure, I'll send it soon.

## Not findings — the cases that matter more

**They answered.**
> **You:** Monday or Tuesday? **Alex:** Tuesday works for me.

**They answered in shorthand.** Weekday abbreviations count.
> **You:** Monday or Tuesday for the review? **Alex:** Tues is better, thanks.

**They did not agree to anything.** A person saying they will get back to you is not a
channel failure.
> **You:** Monday or Tuesday? **Alex:** I'm checking with the team and will revert.

**They asked something back.** The conversation is live; leave it alone.
> **You:** Monday or Tuesday? **Alex:** Sure — is Stephen joining either way?

**They named a date.**
> **You:** Can you send the revised quote? **Alex:** Will do — sending Thursday.

**They named a relative day.**
> **You:** Can you review the contract? **Alex:** On it, will have it back tonight.

**Nothing was asked.**
> **You:** Just FYI, the deck is attached. **Alex:** Great, thanks.

**Quoted history is not a new reply.** Text below `On … wrote:` or inside a
`.gmail_quote` block was written earlier and is excluded before any analysis.
> **Alex:** Let me check.
> On Tue, Alex wrote:
> > Yeah sure, sounds good

## Outcomes that draft nothing

| Outcome | What the user sees |
| --- | --- |
| **Voicemail** | "a person did not answer (endpoint: voicemail)" |
| **No answer** | "the call did not complete (status: failed)" |
| **Answered, not settled** — *"I'd have to check with Priya before I say."* | "the question was not settled (resolved: unknown)" |
| **Answer never offered** — extraction returns `"Wednesday"` for a Monday/Tuesday question | "the answer 'Wednesday' is not one of the options that were offered" |
| **No quote** | "the call returned no verbatim quote to stand behind the answer" |

In every case the thread is left exactly as it was.

## Destination handling

| In the thread | Result |
| --- | --- |
| `+1 555 010 0142` in a signature | Usable. Shown as `+15*******42`. |
| `(555) 010-0142` | **Not usable** — "no country code in the email; type the full +number to use it". |
| `Invoice 4455 010 0142` | Ignored. Reference numbers are not phone numbers. |
| A number in one of *your own* messages | Ignored. The call goes to the other party. |
| A name with no number anywhere | No call is possible. Nothing is looked up. |

## Approval

The user is shown the exact question, the masked destination, the complete task text, and
whether this deployment can dial a real phone. The button they press names the destination
and says what it will do:

```
Call +15*******42 now
```

or, when the deployment cannot dial:

```
Place the call (fixture — dials nobody)
```

A stored setting is not intent. Each call is agreed to on its own, on a screen showing what
it would be. The proposal also issues a one-time token that the dial endpoint requires, so
the call cannot be started without first fetching what it would do.
