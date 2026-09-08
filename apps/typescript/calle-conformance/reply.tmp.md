Item two is done, all of it, in `0d4d952` and `0f0d1ea`.

`scripts/compliance.ts` printed the destination raw while every other probe
masked it. That is a plain gap in a project whose stated reason for masking is
that terminal output gets pasted into issues, and it is closed.

`live-connected` printed the whole transcript and the structured result by
default. It now prints speakers, offsets and turn lengths, and the result's
keys; `--print-transcript` prints the words. `fabrication-ab` and
`no-escape-hatch` print the result's keys too, behind `--print-result`. I had
thought those two were different because the returned value is the finding
there, and on reflection that is a reason to describe the value carefully rather
than a reason to print it by default.

Both gaps were found by you rather than by my suite, which is the wrong way
round, so two source-level tests now fail if any script prints a destination
without `maskPhone` or prints `turn.text` outside the gate. I checked they fail
by reverting the fix.

On the hotline value: `+1 276-322-9632` appears unmasked in merged code at
`skills/pharmacy-stock-check/SKILL.md:275` and `references/examples.md:218`,
described there as the inbound number CALL-E publishes for testing. I read that
as approved for publication. If that is wrong it is a repo-wide call rather than
a PR-specific one, and I will mask it here either way if you want me to.

Item one I want to get right, and I think I have been answering the wrong
question.

My last comment defended the corpus against the privacy clause in CONTRIBUTING:
reserved documentation numbers, no identifier overlap with the private captures,
absolute times rebased, a test that fails if a turn carries an email, a link or a
dialable number, and a machine counterpart in every transcript. You did not say
privacy. You said "real production call/response corpus", and if the word doing
the work there is **production** rather than **personal**, then none of what I
listed is responsive, because the objection would be to publishing another
company's API output at all, however well masked. Every other project here ships
synthetic fixtures, which is consistent with that reading, and I am the only
outlier.

So two doors, and I will take either.

If the objection is a specific field or file, name one and it is gone today.

If the objection is that the responses are real regardless of masking, say so
plainly and I will replace `fixtures/` with payloads generated from the same
schema and keep the checker, the predicates and the tests. That is roughly a
day's work and it costs the project its evidence, so I would rather be told than
guess, but it is not a fight I want to have.

One practical note before anything irreversible, and it cuts both ways: #374
links directly to a file in `fixtures/` as evidence for an open API bug, so
rewriting this branch's history breaks that link. If the corpus goes I will
rewrite the history too, I would just rather do it once, after we know which of
the two doors this is.
