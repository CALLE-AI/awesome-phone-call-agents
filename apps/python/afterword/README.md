# Afterword

Death notification to the institutions that have to be told.

When somebody dies, the family has to tell the bank, the second bank, the
pension, the insurer, the utility, the mobile provider and the council. Each
has a different department, a different document requirement, a different view
on whether a certified copy will do, and a different answer to what happens to
the direct debits meanwhile. Each one puts a recently bereaved person in a hold
queue and asks them to say it again.

Afterword makes those calls and returns one consolidated pack of what each
institution actually requires -- quoted, dated, and marked non-binding.

**Hosted console:** https://afterword-95953931159.us-central1.run.app
(fictional estate and institutions, places no calls)

**No call is placed unless you ask for one.** Every command defaults to a
preview or a scripted demo, and the whole test suite runs with no credentials.

## The commitment boundary

The agent may **ask**. It may never **do**.

- It never asserts the death as established fact. It says an executor has
  reported a death and asks what the institution requires.
- It cannot close an account, cancel a service, move money, or redirect post.
- It cannot accept terms, waive anything, or agree a settlement.
- Anything an institution offers stops at the family for a decision.

`CaptureResult.closes_account` and `CaptureResult.accepts_terms` are hard-wired
to `False` and swept by property tests. They are rules in code, not lines in a
prompt.

## What makes this worth building

**Verbal answers from institutions are unreliable, and nobody records them.**
Two agents at the same bank give different document requirements. Afterword
keeps what was said, with the quoted span and the date, so a later
contradiction is answerable.

**The conflict is the signal, not the noise.** When a stated requirement
contradicts the institution's own recorded policy, or contradicts an earlier
call to the same institution, Afterword marks it `DISPUTED` and records **both
sides**. It never picks a winner. Quietly choosing one is how a family posts an
original death certificate that then goes missing.

Document requirements are compared as sets in both directions, because
under-sending and over-sending are both dangerous.

## The disclosure budget

The agent speaks the minimum: the deceased's name, the family's reference, and
the executor's name. Nothing else about the estate.

`disclosure.py` enforces this in code. A cause of death, a date of birth, an
account balance and a telephone number are forbidden categories, and a script
that would name any of them cannot be built. The number travels in the
request's `recipients` field, never in the spoken text, so a plan preview can
show the whole script without disclosing the line.

This is enforced as two checks that can actually be proved: no withheld value
appears verbatim, and no forbidden category matches by pattern. It is not a
proof of completeness over free text, and the docstring says so.

## Grades

| Grade | Meaning |
| --- | --- |
| `REQUIREMENTS_CAPTURED` | department, documents, certified-copy answer and direct-debit answer all quoted |
| `PARTIAL` | reached a person, some fields unanswered |
| `DISPUTED` | a stated requirement contradicts a prior call or the recorded policy |
| `REFERRED` | the institution will only speak to the executor directly |
| `UNREACHED` | IVR dead end, no answer, voicemail, or queue abandoned |

`REFERRED` is a normal outcome, not a failure. Many institutions are right to
refuse to discuss an account with anybody but the named executor, and Afterword
reports that plainly rather than working around it.

`DISPUTED` outranks `REFERRED`: an institution can contradict itself on the way
to refusing to talk to us, and dropping the contradiction is the failure this
exists to prevent.

## Install and run

Python 3.10 or newer. No runtime dependencies.

```bash
cd apps/python/afterword
python3 -m afterword.cli estate
python3 -m afterword.cli demo
```

One estate, six fictional institutions, all five grades.

### Preview a call without placing it

```bash
python3 -m afterword.cli plan inst-01
```

Prints the spoken script and the request body. The number is masked, and never
appears in the script at all.

### The consolidated pack

```bash
python3 -m afterword.cli demo
```

### Check credentials without spending a call

```bash
export CALLE_API_KEY=...
python3 -m afterword.cli verify
```

Read-only. Places no call.

### Place a real call

```bash
python3 -m afterword.cli run inst-01 --i-have-authorisation
```

Refuses without the flag. Only call numbers you are authorised to call.

## Side effects, credentials, cancellation

- **Side effects.** `run` places a real outbound call and spends CALL-E credit.
  Nothing else dials.
- **Credentials.** Read from `CALLE_API_KEY` only. Never written to disk or logged.
- **Idempotency.** Derived from estate plus institution, not from the attempt,
  so a retry cannot call the same institution twice.
- **Cancellation.** The Calls API exposes no client cancellation, so a call in
  flight runs to completion. This app schedules nothing and creates no
  recurring job.
- **Retention.** Only the quoted spans that justify a captured requirement.
- **Phone numbers.** Every number here is fictional, from the Ofcom
  `+44 7700 900xxx` drama range and the North American `555-01xx` block.

## Tests

```bash
python3 -m pytest tests/ -q
```

No network, no credentials, no calls.

## Licence

MIT. See `LICENSE`.
