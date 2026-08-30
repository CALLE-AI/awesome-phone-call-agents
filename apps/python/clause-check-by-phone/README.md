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

## Usage, the call actually placed

`place_call.py` is the runtime path. It posts to `POST /v1/calls` on
`api.heycall-e.com` with a Bearer key read from the environment, and reads the
finished call back from `GET /v1/calls/{id}`.

```bash
export CALLE_API_KEY=...
python place_call.py "students only" "Students only" --to +33XXXXXXXXX
```

```python
from place_call import place, collect

prepared, queued = place("+33XXXXXXXXX", "students only",
                         "Students only", "https://example.com/offer")
payload, verdict = collect(queued["id"], prepared)     # None, or one sentence
```

Three refusals happen before anything rings, and none of them costs a call. A
clause outside the six families never becomes a request. A schema the provider
would accept and then fail to fill is refused here. A missing key stops the run
with a sentence rather than with a `401` that reads like a permissions problem.

The transport is a parameter of `place` and `collect`, which is why the
witnesses can exercise every path through this file without a key and without
dialling anyone.

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

## The schema is checked before the phone rings

`validate_result_schema` compares the schema this module emits against the
provider's own OpenAPI contract, not against JSON Schema in general. The
contract names what it supports, `type`, `properties`, `required`, `enum`,
nested objects, simple `array.items`, `description` and
`additionalProperties: false`, and what it refuses, `$ref`, `oneOf`, `anyOf`,
`allOf`, recursion, complex format validation and open objects.

The reason to check early is that a malformed schema is **not** refused when
the call is created. The call is placed, someone's phone rings, someone
answers, and the structured result comes back `null` once the call reaches a
terminal state. You have spent a call and a stranger's minute to learn
nothing. The check moves that penalty to before the call, where it is free.

One rule in the validator is not in the contract's refusal list, and it is the
one worth arguing about. **An enum with no way to say the call settled nothing
is rejected.** A yes/no schema is perfectly valid for the provider, it simply
leaves the extraction model no choice but to pick a side when the call
produced neither. Nothing flags it, and the invented answer looks exactly like
an answer. The provider's own contract recommends including such a value; this
module makes it mandatory.

## A question that cannot be evaluated is not asked

One family used to send an open question, *which countries of residence are
accepted*, while expecting a yes or no field back. The extraction model
received prose and a binary field, and was never told which country was at
stake. It would have returned a value, and that value would have been
invented.

Families listed in `CONTEXT_REQUIRED` now refuse to produce a call task unless
the missing piece is supplied.

```bash
python dry_run.py "country restricted" "Open to selected countries" --country France
```

Without `--country`, no call goes out and the reason is printed. This is the
same principle as the rest of the module. A call is worth placing only when its
answer can change something, and an answer nobody can interpret changes nothing.

## Tests

```bash
python tests_bridge.py       # 23 witnesses, no call, no network, no key
python tests_place_call.py   # 10 more, on the file that dials, same rule
```

Three of them are refusals, an unknown family, a clause with no quotation, and
a malformed number. Two guard the quotation itself, because it will be SPOKEN,
and text meant for the eye tolerates a broken character that a speech engine
pronounces. One guards the answer `unknown`, which must never be read as a
contradiction, since an absence of answer is not a denial.

Six more guard the schema validator, and every one of them is a schema built
to be **refused**. A validator that rejects nothing proves nothing, so each
conforming case is paired with a hostile one, an unsupported composition, an
open object, an enum with no way out, a reserved field name, and a required
field that was never declared.

## Phone numbers in this contribution

Every sample uses `+33000000000`, which is fictional and never dialled. The one
test that needs a badly formed number uses `00 00 00 00 00`, all zeros, so that
nothing in this contribution reads like a real number to a person scanning the
file or to a tool scanning the repository for leaked data.
