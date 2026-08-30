# clause-check-by-phone

Turn a clause a page states quietly into one question asked out loud, and
report only when the voice CONTRADICTS the page.

**Host and provider.** Any agent host that can run Python 3.9 or later. The
call itself is placed against the CALL-E API, `POST /v1/calls`, with a Bearer
key. This contribution contains no key, no client, and no call.

## Why it exists

A page auditor reads an offer and reports where it takes its own headline back,
and what it quietly requires of you. It stops at the edge of the real world.
The clause that costs you is often the one nobody will put in writing twice.

So the next step is to take the single most costly clause found on the page,
call, ask that one thing, and put the two versions side by side, the exact
quotation from the page and the structured answer from the call.

## The rule that governs this contribution

**Never make someone repeat on the phone what the page already says.** A call
is worth placing only if its answer can contradict the page. A question whose
two possible answers both leave the matter where it stood is a question you do
not ask, because it costs a stranger their time.

Six clause families are considered worth a call. A finding outside that list
raises `NothingToAsk`, which is a result and not an error.

## Install

```bash
python -V            # 3.9 or later
# no dependencies, the standard library is enough
```

## Usage, no call

```bash
python dry_run.py "advancement costs money" \
  "the remaining 90 selected teams will be responsible for a registration fee"
```

It prints the exact task text and the result schema, with a fictional number,
and exits non zero when the clause does not justify a call. **This is the
no-call path.** Everything that can be settled without dialling is settled
here, because a developer holding twenty free calls cannot afford to tune a
task by placing it.

## Usage, with a call

```python
from bridge import call_task, contradiction

prepared = call_task("+33XXXXXXXXX", "students only",
                     "Students only", "https://example.com/offer")
# POST prepared["task"] and prepared["result_schema"] to /v1/calls
# then, once the call reaches a terminal state
verdict = contradiction(prepared, structured_result)   # None, or one sentence
```

## Side effects

**It places a real phone call to a real person.** That is the whole side
effect, and it is not reversible once the phone rings.

- The task always states, in its first sentence, that the call is automated
  and placed by a software agent. A test enforces this. A synthetic call that
  does not say what it is, is a deception, and that would be a strange thing
  to build into a tool whose subject is what people hide from you.
- The task asks one question and only one, and says so twice.
- It never argues and never sells.
- Call the number you are authorised to call. There is no sandbox and no echo
  number, so the dry-run path above is the only safe way to iterate.

## Cancellation and rollback

There is nothing recurring here. One clause produces at most one call task,
and this module creates no schedule, no retry and no follow-up. Cancelling
means not sending the task, or cancelling the call at the provider before it
is dialled. Nothing in this contribution stores state between runs.

## Tests

```bash
python tests_bridge.py       # 14 witnesses, no call, no network, no key
```

Three of them are refusals, an unknown family, a clause with no quotation, and
a malformed number. Two guard the quotation itself, because it will be SPOKEN,
and text meant for the eye tolerates a broken character that a speech engine
pronounces. One guards the answer `unknown`, which must never be read as a
contradiction, since an absence of answer is not a denial.

## Phone numbers in this contribution

Every sample uses `+33000000000`, which is fictional and never dialled. No real
number appears in the code, the tests, or this file.
