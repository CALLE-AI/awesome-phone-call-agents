# Proving a phone-call gate fires

Every safety document asserts a rule. Consent is checked. Concurrency is capped. An
ambiguous outcome goes to a human. What almost none of them show is that the rule's test
would notice if the rule were deleted.

A test that has never been observed to fail has not been shown to test anything. In code
that places telephone calls, that gap is not academic: the rule you never proved is the one
standing between a work file and somebody's phone.

This is the procedure firstbell uses. It is not specific to schools, or to Python, or to
this app.

## The procedure

1. **Enumerate the rules that decide something a person would otherwise check by hand.**
   Not every branch. The ones with a consequence: who gets dialled, how many at once, what
   counts as an answer, what the evidence claims.
2. **Break one on purpose.** Make the smallest change that removes the rule while leaving
   the code running. `if consented:` becomes `if True:`. A cap becomes `None`. A
   classification branch becomes unreachable.
3. **Run the whole suite and record the number of tests that fail**, and which ones.
4. **Revert, and confirm the suite is green again.**
5. **Publish the table**, one row per rule, so a reader can reproduce any row.

A rule where step 3 produces zero failures is not protected. That is the finding, and it is
worth more than a coverage percentage, because coverage tells you a line was executed and
this tells you somebody would notice if it were wrong.

## Which rules qualify

Ask what happens to a person if the rule silently stops working.

| Rule class | Why it qualifies |
|---|---|
| Consent | The only thing between a work file and an unsolicited call |
| Concurrency cap | CALL-E has no cancel endpoint. Once a call is placed there is no API route to stop it, so the cap is the only brake that exists |
| Outcome classification | Decides whether a case is closed or reaches a human |
| Evidence provenance | Decides whether a published receipt describes something that happened. See [`receipt-provenance.md`](receipt-provenance.md) |
| Fidelity of a local double | A double that accepts what the real service rejects gives a false pass to everything built on it |

Rules about formatting, logging, or presentation do not qualify. Keep the list short enough
that every entry gets broken.

## What this does not show

Mutation testing shows that a test notices a change. It does not show the test is testing
the right thing, and it says nothing at all about rules nobody thought to write.

Both defects found in firstbell during live calls were of the second kind. Neither was a
rule that failed. Each was a case the design had not imagined, and each was found by
placing a call rather than by reasoning about the API. A green mutation table is a floor,
not a result.

## The bug class this is aimed at

Pull request #69 in this repository fixed `apps/typescript/call-on-behalf`, which treated a
definite 4xx on a retried create as proof that no call had been placed. It is not proof: a
401, 402 or 400 is decided before the idempotency lookup ever runs, so the app could report
"nothing was said on your behalf" while a call was live on a clinic's line giving somebody's
name and date of birth.

That is a rule that was wrong, in code that had tests, in an app good enough to be merged.
No ordinary test would have caught it, because every ordinary test exercises the honest
path. A mutation would: remove the branch that distinguishes a definite failure from an
unknown one, and ask which test notices. If the answer is none, the rule was never
protected, and that is knowable before a call goes out rather than after.

## Worked example

Three hundred and fifty-eight gates broken on purpose, each one reverted, with the number of tests that
caught it, are in [`../evidence/MUTATIONS.md`](../evidence/MUTATIONS.md). Two rows show
the shape:

| The change | Tests that failed |
|---|---|
| `max_workers=self._concurrency` becomes `max_workers=None`, removing the only brake | 4 |
| Match the production host by substring instead of hostname, so `api.heycall-e.com.example.net` passes | 2 |

Reproduce either by making the change and running:

```bash
python -m pytest tests/ -q
```

The second row is the one worth copying. A substring check on a hostname looks correct in
review and passes every ordinary test, because every ordinary test uses the real hostname.
It only fails against a value chosen to defeat it, which is what the mutation supplies.
