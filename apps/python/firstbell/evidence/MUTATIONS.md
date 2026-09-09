# Every gate, broken on purpose

A test that has never been observed to fail has not been shown to test anything. Each row
below is a change made to working code to check that a specific test notices. Every one
was reverted and the suite returned to green.

Reproduce any of them by making the change and running `python -m pytest tests/ -q`, except
the thirty-four marked **needs the built page**. Those thirty-four are held by gates
that read `out/index.html`, which is built from records of real calls kept outside this
repository, so on a clean checkout they skip and measure zero. Rows 86 to 88 break the same builder and are
caught by a gate that builds the page from an authored fixture, which does run on a clean
checkout.

Three of the gates watch what the program prints rather than any one rule:
`test_the_readme_sample_is_what_the_program_actually_prints`,
`test_the_prose_numbers_match_the_program_too` and
`test_the_demo_run_shows_all_three_outcomes`. Any change that alters the demonstration's
output fails those as well as the test belonging to the rule, so a count here can be larger
than the number of tests written about the rule itself. That is the honest number and it is
what this column reports. Row 2 says eight. A sentence used to stand here breaking that
eight down as two consent tests plus the three output gates, which is five, and the
arithmetic stopped reaching the row when the suite grew. The row is the measured number and
the breakdown was not, so the breakdown is gone rather than corrected: a total nobody re-ran
is the same defect a second time.

A count also grows as the suite does. Row 2 read three until it was re-measured, having
been written when fewer of the output gates existed, which is the same drift that put stale
line numbers in the proof images. Reproducing a row and getting a larger number is that,
not a disagreement about the rule.

**24 rows were added on 8 September 2026**, for the six gates written that day: the
counts the take-away card prints beside its two commands, the directories those commands and
act 08's need before they will run, any sentence placing a receipt on the evidence page, the
escalation queue's row count against the committed record, the channel gate being demonstrated
by a shipped export rather than only by fixtures, and the stat card no longer stating a
collected count as though every test ran. Each was measured against the whole suite when it
was written, and each is applied by a script.

One of them is worth reading twice. The receipts gate let row 243 through on its first
measurement: that sentence names the evidence page before it names the receipts, and the gate
needed the thing before the location. Nothing had shipped in that shape, so it was a blind
spot rather than a hole under a live defect, and the gate now reads the claim in both
directions. The count published for that row is the re-measurement, because the zero was a
fact about a gate that no longer exists.

**9 rows were added later on 8 September 2026**, for three gates written after three
changes, two of which a reviewer asked for.

Rows 253 to 255 are the language ceiling. The sentence saying CALL-E offers one language per
country, and English in the United States, came off the masthead and moved into act 01, one
screen from the run that demonstrates it. That buys the first screen back for the escalation,
which is the half of this product a school would be paying for, and it creates two ways to be
wrong that the welded version did not have: the ceiling can be lost in a reword, and the
masthead can reacquire the language promise the ceiling was written to answer.

Rows 256 to 259 are one class. Five tools cannot do anything without the recordings, which
are held outside this repository on purpose, so the ordinary experience of cloning this is a
tool that cannot measure. Two of them answered that with an argparse usage error and exit code
2, which is the code for using a tool wrongly, addressed to somebody who followed the
documentation. A third raised `SystemExit` and exited 1, which reads as a check that failed.
All five now print a line beginning COULD-NOT-MEASURE and exit 3.

Rows 260 and 261 are the one worth reading. The caption moved into act 01 was written by the
reviewer who asked for the move, word for word, and it said act 07 shows the platform refusing
Spanish **on a real run**, which it does not. The refusal comes from `calle_double`, which raises
`unsupported_language` out of a region table transcribed from CALL-E's own published list, so a
reader reproduces it offline with no account, and no call has ever been placed in Spanish. That
sentence was accepted, written into the page and the README, and only then checked, and nothing
in this suite would have caught it. It is this entry's own failure mode arriving in the words of
somebody grading the entry, which is the most persuasive form it takes. Both surfaces now say
what the run does, and both rows put the overclaim back.

Rows 253 to 255 were measured twice. The first pass ran while the README's own test count was
one revision behind, so each came back a point high: the mutation's catch plus a failure with
nothing to do with it. The counts published here are the second pass, against a green suite.

**Rows 262 to 265 were added on 8 September 2026**, for the denominator gate. An audit of
the tree found two of the four defects. This suite found none of them, and it is worth saying
so plainly: 261 rows above this one and 636 tests did not stop a sentence quoting the wrong
number out of this entry's own committed record.

`evidence/recorded-calls.json` is the one numerator here nobody chose. It records twelve calls
placed, eleven of them answered, and it keeps two versions of the net-new escalation count on
purpose: what every call comes to re-filed under today's code, and what the receipts said
before one case was corrected from resolved to undetermined. Keeping both is the honest thing.
Quoting the wrong one is not.

`evidence/README.md` listed the file's own integers and ended on the stale one, two paragraphs
above the section narrating the correction that made it zero. `docs/the-money-in-full.md` put
"12 real calls" against three rows of a table headed "Net-new per 100 answered calls" and
called the sample twelve in the prose under it, while its own prose two paragraphs earlier said
eleven and README's copy of the same table had always said eleven. Looking for what those two
had in common found the fourth: the money card on the page read "What 12 calls cannot rule out"
over a bound computed from `answered`, eleven lines above a paragraph that reads it correctly
out of the same record. An escalation cannot happen on a call nobody answered.

The gate took two attempts, and the first one is the more useful thing to record. It allowed a
nearby sentence explaining the gap between placed and answered to excuse a match, over a window
of 180 characters. In a table that window reaches the next row, so a wrong cell was excused by
the correct cell beside it and row 263 survived its first measurement. On the built page the
whole money card flattens into one run with no full stop in it, so the footnote under the card
excused the label above it and row 265 survived too. Every check is now scoped to one sentence,
one table cell, or one block element, which is the unit a reader actually reads. Both counts
published here are from after that.

**Rows 266 to 271 were added on 8 September 2026**, for the bound gate, and a reader in the
buyer's seat asked for them by asking the obvious next question.

This entry had argued since the start that a count of zero is not a rate of zero, and it
published one bound to prove it: 24 net-new escalations per 100 answered calls, which is what
eleven calls cannot rule out. What it never published was the same treatment of the other rate
on the same eleven calls. The escalation rate those calls measured is 45 per 100. Its own
one-sided upper limit is 73. Both sit above the 34.3 per 100 where the saving becomes a loss.

The label was the part that misled. `What 11 answered calls cannot rule out: 24 per 100` names
the sample and never names the quantity, so the one figure a reader could carry away was
ambiguous in the direction that flattered this entry. It now reads `24 net-new per 100`, with
the escalation rate's own bound on the row under it, and the money document publishes both in
a second table under its own header.

The second header is not decoration. `docs/the-money-in-full.md` already records making this
mistake once, when it put a bound measured on real calls directly above a crossover derived
from an authored outcome mix and concluded there was half the rate to spare. Both figures were
right and the comparison between them was not one. Escalations per 100 and net-new per 100 are
rates of different things, so row 269 is that defect planted again, in the other direction, and
the gate walks each table separately rather than carrying one header down a document.

Row 271 is the arithmetic rather than the wording: computing the escalation bound off the
net-new count makes the two bounds the same number while the card goes on calling one of them
the widest reading. Three tests noticed it and two of them were the gate written for it.

Every count in these six rows was measured against a green baseline, in a worktree built from
a staged snapshot so no new test file was missing, and each was measured twice: once across the
whole suite and once with `tests/test_every_rate_carries_its_bound.py` run alone, so no count
here rests on an unrelated test failing. All six collected 645.

**Rows 272 to 276 were added on 8 September 2026**, for the absence-volume gate, and a reader in the
buyer's seat asked for the figure they protect: an annual total a finance director could put
in a budget line, where this entry had only ever published a figure per call.

The pilot document was candid about why it had none, which is that how many unexplained
absences a district handles in a morning is a number a school office has and this project does
not. Candour is not an answer to a board paper. California publishes enough to reconstruct one:
`docs/what-a-pilot-would-look-like.md` now derives about 28 unexplained absences per 1,000
enrolled students a school day from CDE's certified 2023-24 figures, and prices a
10,000-student district's year at both ends of the same bound.

It is the only externally sourced quantity in this entry that is derived rather than quoted,
which is why the gate recomputes the arithmetic from the register instead of matching the
strings. Four inputs and the statutory school year are in `evidence/statistics.json` with the
sentence each came from; the arithmetic is in `tests/test_absence_volume.py`; the document is
checked against the result. Change an input at source and the suite fails rather than
publishing a rate that no longer follows from it. Rows 272 to 274 are that, planted three ways.

Rows 275 and 276 are the two sentences that make the figure safe to publish, and both are
easier to lose than the arithmetic. Row 275 removes the publisher's definition of unexcused,
which is what makes 28 per 1,000 a ceiling rather than a measure: California counts a
telephoned-in family holiday as unexcused, so the number of families this software would
actually ring is smaller. Row 276 publishes the annual saving and drops the annual cost the
widest reading of the same calls produces. That one is the vendor move this entry exists to
argue against, and nothing in the suite had been able to catch it before.

A figure in the source is deliberately unused and the document says so: Los Angeles Unified's
own row works out at 41 per 1,000 a school day, and it reports 0.0% of absence days as
out-of-school suspension where the state reports 0.9%. For a district of 396,000 students that
is a coding difference rather than a fact about children.

One research trap is worth recording next to this. The same `Statewide` row means two
different populations depending on the report level it is read at: the page's own footnote says
charter school data are removed by default from district-level reports “including the
associated state and county Report Totals”, so a Statewide total read off a district-level
page gives 5,236,744 rather than 5,958,444. Both land near 28 per 1,000, and only one of them
is the state.

All five rows were measured against a green baseline in worktrees built from a staged snapshot,
each twice: once across the whole suite and once with the gate file alone. All five collected
650.

**Rows 277 to 282 were added on 8 September 2026**, for `tools/adopt_call_records.py`, and one of the
six survived its first measurement.

That tool is the recommendation this entry received and declined earlier the same day. A reader
in the buyer's seat wanted the first screen to lead with the three outcomes, the consent gate
and the structured reason, over whichever dialler a district already owns. It was declined
because the sentence existed in act 07 as a scoping statement with nothing behind it, and
promoting an unbuilt capability to the first screen is the kind of claim this entry cannot
survive being asked about. So it was built: the tool reads call records another dialler
produced, files them into the same three outcomes with the sentence that explains each one, and
audits all of them against the district's consent register after the fact.

Row 277 is the mutation that matters. It closes a record by finding a reassuring phrase in the
transcript, which is the improvement somebody will eventually make to this tool in good faith
and is the exact defect the rest of this entry exists to catch: a record closed while nothing
was learned, wearing a better vocabulary. Row 278 decides the outcome inside the tool instead of
calling the function the live path calls, which is the other way this goes wrong, because a
copy of a rule agrees with the original only until one of them changes.

**Row 282 was noticed by nothing.** It changed `answered is False` to `answered is None`, and the
example file has a row for every outcome and no row where `answered` is simply absent, so the
case that tells the two spellings apart was never exercised. It is not a cosmetic difference. A
record whose export omits the field but carries a full answer would have been filed
undetermined and told an attendance officer that nobody picked up, which is a sentence about a
call that did not happen; and a record that really was not answered would have been judged on
whatever result was attached to it, which is how a voicemail becomes a guardian's confirmation.
`test_answered_has_three_states_and_absent_is_not_no` closes it, holding the same three states
`answered_by_the_guardian` holds and for the same reason, and the row above is the count after
that test existed.

Two of these rows were measured twice for a duller reason, and it is the same trap as the note
above about a green baseline. The first three came back uniformly at 3 noticed, which is the
tell, and the cause was two standing failures in the clean tree: the example call records used
+1 415 555 01xx, where 415 is a real area code and only 555 as the area code is reserved for
fiction, so `test_no_number_in_a_committed_fixture_could_ring_a_real_person` refused them. The
main tree had not caught it because that gate walks the tracked tree and the new example files
were still untracked there. Every count published in these six rows is from a baseline measured
green at 630 passed and 28 skipped.

**Every machine-applicable row was re-measured again on 6 September 2026.** Thirty-seven
rows can be applied by a script. Twenty-nine came
back exactly as published. Eight had moved, all upward: row 2 (five to eight), row 4 (one to
two), row 7 (three to seven), row 8 (twenty to twenty-two), row 20 (three to four), row 32
(two to four), row 39 (one to three) and row 40 (one to two). Every one of the eight is the
suite growing, not a rule changing. Five of the thirty-seven had to be re-anchored first,
because the exact line each one mutates had been rewritten since the row was written; the
rules themselves are all still present and still gated.

That run is worth reading twice, because the first attempt at it was wrong in a way this
table exists to catch. An earlier interrupted run had left one mutation applied in the working
tree, so the suite was already two tests red before anything was changed. The harness captured
that file as its own baseline, reported that all thirty-one measurable rows had moved and
every one upward, and printed "all files restored: True". All of it was the leftover mutation.
A restore check that compares against your own capture cannot see a defect that was already
there when you captured it. Re-run against a green baseline, twenty-nine of the thirty-seven
rows reproduced their published values exactly. The table had been right, and publishing that
first result would have replaced twenty-nine correct numbers with wrong ones.

**Rows 1 to 44 were all re-measured on 5 September 2026** by applying each change,
running the suite and restoring. Thirty-four matched what was published. Ten did not and are
corrected above: row 2 (three to five), row 3 (three to four), row 7 (one to three), row 8
(one to twenty, because removing the task-level fallback stops the demonstration answering
at all), row 19 (three to four), row 20 (one to three), row 26 (two to one), row 27 (one to
two), row 28 (three to two) and row 29 (six to seven).

Rows 16, 17, 26, 30 and 33 went last because each changes a file rather than a line, which
takes a different kind of edit and not a different kind of check. Four of the five agreed
with what was published. Only row 26 moved.

Ten wrong numbers in forty-four is worth stating plainly rather than burying: this table was
published before it was verified, and verifying it is what found them. None of those ten
corrections changed whether a gate fires, which is what the table is for. All ten changed how
loudly it fires, which is what a reader would have checked us on.

Every row from 45 onwards came later and is not part of that count. Each was measured as it
was written, applied and run before the row describing it existed, so none was ever a
published number sitting unchecked. That is the safer order and it is not a guarantee: four
rows in the 49 to 52 block were later found one too high each, having been measured against a
tree that already had one test red.

Rows 49 to 52 were re-measured on 6 September after a verification pass reported all four one
too high, and all four were. The published values were 14, 5, 7 and 4; the measured values are
13, 4, 6 and 3. The cause is the one this file already describes happening once: they were
measured against a tree that had a test red for an unrelated reason, so every count carried
that failure. Four rows, one cause, one direction. The correction was itself measured three
times per row with the failing test names captured each time, because a single pass is what
produced the wrong numbers in the first place. One reading during that work disagreed with
four repeats of the same mutation, and the repeated value is what is published.

Rows 91 to 94 close two findings that had been sitting open since an earlier review, and both
are worth naming because of how they escaped. The credential guard refused a key it recognised
as a production one and sent everything else, which is the only rule in this app that failed
open; the reviewer who found it also noted that rows 45 to 48 all mutate the origin comparison
and none of them touched the prefix test, so the mutation testing itself had a blind spot in the
same shape as the code. The backoff is a bare arithmetic return rather than a branch, so a
sweep that walked conditionals and assertions could not see it, and `return 0.0` passed the
whole suite. Both are the same lesson from two directions: a mutation set written by the person
who wrote the code inherits that person's idea of where the rules are.

Row 32 is worth a sentence on how to read a mismatch in the other direction. Measured with
the poll's retry budget set to zero it produced one failure against a published two, and
the published number was right: the row says the poll is left *unprotected*, and catching
nothing at all is the faithful reading. A count below what is published usually means the
change made was narrower than the words describing it, not that the row is wrong.

Row 28 is the case where a lower number was the right one. Dropping `task_completed` and
`completion_confidence` fails two tests, not the three published, and both of them belong to
the rule: one asks whether the double emits every field the real API returns, the other
whether the authored fixtures match what the generator produces. Those two fields are the
ones the row names because both appear in all three recorded production responses under
`tests/data`. The published three had been written when the suite was shaped differently.

A measured zero is a different thing again, and it means the change was not made where the
row says. Two of the rows above returned zero on a first attempt at reproducing them. Row 7
had been written as an expression that still evaluated to the original table, so the table
was never deleted. Row 22 had been applied to `FundingRate`, which validates its provenance
fields with the same idiom the wage class uses; the row says wage, and the wage is
`StaffCost`. Both measure as published once the change matches the sentence.

| # | The change | Tests that failed |
|---|---|---|
| 1 | `max_workers=self._concurrency` becomes `max_workers=None`, removing the concurrency cap | 4 |
| 2 | `if not item.consented:` becomes `if False:`, disabling the consent gate | 8 |
| 3 | Drop `insufficient_balance` from the double's `API_ERROR_CODES` | 4 |
| 4 | Match the production host by substring instead of hostname, so `api.heycall-e.com.example.net` passes | 2 |
| 5 | Write the transcript into every receipt instead of only when `--include-transcript` is given | 1 |
| 6 | Prefer the attempt's raw SIP code over the task's symbolic one, putting `603` in front of an administrator | 1 |
| 7 | Delete the SIP translation table, so a queue row reads `the call failed with 603` | 7 |
| 8 | Stop falling back to the task-level `structured_result`, which is the defect a real call exposed | 22 |
| 9 | Allow that fallback for fan-out too, which would file one family's answer against another family's child | 1 |
| 10 | Remove the check for a result whose required fields are all uninformative | 1 |
| 11 | Flag a result if *any* required field is unknown rather than *all* of them | 1 |
| 12 | Report `placed` when the response carries no usable `created_at`, instead of reporting unknown | 1 |
| 13 | Drop the clock-skew guard, so a service clock hours ahead reads as a freshly placed call | 1 |
| 14 | Read `provider_call_id` off the first attempt instead of the last, so a call that fell back to a second number cites the id of the attempt that did not connect | 1 |
| 15 | Change the test count stated in the README, which is what a reader runs and compares | 1 |
| 16 | Blank `api_base_url` on a receipt that still claims `reached_production_api` | 1 |
| 17 | Commit a receipt that no line of `evidence/README.md` describes | 1 |
| 18 | Compute `reached_production_api` from the configured base URL alone, so a run that exchanged no bytes with CALL-E still reports that it reached production | 1 |
| 19 | Credit every attempt to the machine instead of only the attempts behind records it closed, so calls that left a family unreached still count as staff time saved | 4 |
| 20 | Report a break-even of `0.00` rather than nothing when a run billed no attempts, turning could-not-compute into a free-looking number | 4 |
| 21 | Wrap the citation like prose, so the source URL breaks mid-path and the reader cannot open the thing the number came from | 3 |
| 22 | Drop `source` from the wage validation, so a staff cost can be asserted with no provenance at all | 1 |
| 23 | Shift one cited line number by one, the way any edit above it would | 1 |
| 24 | Keep a cited line number and change the symbol the sentence claims is on it | 1 |
| 25 | Point the ten-minute reading order at a file that does not exist | 1 |
| 26 | Delete the runtime anchors entirely, which a check written as "every anchor resolves" passes on an empty list | 1 |
| 27 | Put the extracted result back on the recipient when no per-recipient schema was asked for | 2 |
| 28 | Drop two task-level fields the production API returns on every response | 2 |
| 29 | Give an attempt our symbolic name for the outcome instead of the wire code the API sends | 7 |
| 30 | Commit an image rendered from the call recordings, which no text check can read | 1 |
| 31 | Store a vendor error message unchanged, when that message quotes the number it rejected | 2 |
| 32 | Leave the completion poll unprotected, so one failed read discards a call that was placed | 4 |
| 33 | Put one backspace byte inside a committed source file, which no editor or diff displays | 1 |
| 34 | Leave a real CALL-E error code in none of the three classification sets | 1 |
| 35 | Let one dispatcher instance run twice, inheriting the first run's cancellation | 1 |
| 36 | Accept two work items sharing an id, so one idempotency key covers both | 2 |
| 37 | Read a service clock an hour behind ours as a definite replay rather than unknown | 1 |
| 38 | Write the structured result to the receipt unmasked, which is how it shipped until this was fixed | 1 |
| 39 | Drop the comma from the separator class, so a number a vendor groups with commas is left whole | 3 |
| 40 | Let a `calls.create` timeout fall through to the catch-all, which is how it shipped until this was fixed: no retry, and a call that may have been placed recorded as FAILED | 2 |
| 41 | Cite in `docs/images/README.md` the line the caption used to name, which is how both stills shipped | 1 |
| 42 | Type a window bound back into the still generator instead of looking it up | 1 |
| 43 | Accept `RetryPolicy(max_attempts=0)`, whose create loop never runs, so every item comes back FAILED with an empty reason about a run that dialled nobody | 1 |
| 44 | Stop escaping `<` in the JSON embedded in the page's `<script>` block, so a transcript turn containing `</script>` ends the data early and the rest of the page is parsed as markup | 1 |
| 45 | Delete the refusal that keeps a production key off every origin but `https://api.heycall-e.com`, so `CALLE_BASE_URL` can send the live bearer token to any host that is listening | 1 |
| 46 | Invert that refusal so it stops every destination, which would leave a tool that can never place a real call | 1 |
| 47 | Compare the base URL by hostname again instead of by origin, so `http://api.heycall-e.com` is filed in the receipt as an ordinary live call | 1 |
| 48 | Drop the scheme when normalising an origin, so a plaintext destination compares equal to the trusted HTTPS one | 1 |
| 49 | Make `safeguarding_escalation` return `NONE` for everything, so a parent who did not know their child was absent is filed automatically | 13 |
| 50 | Ask the rule whether the answer is `no` rather than whether it is `yes`, which closes the missing and the `unknown` case as though either were a confirmation | 4 |
| 51 | Derive `ItemResult.needs_a_human` from the resolution alone again, so an escalated case never reaches the human queue | 6 |
| 52 | Stop sorting the queue, so a safeguarding case can sit below every ordinary callback and be reached last | 3 |
| 53 | Compute funding recovered from `resolved` rather than `closed`, so the money figure rises every time a child cannot be accounted for | 2 |
| 54 | Compute the resolution rate from `resolved` rather than `closed`, so the headline improves when the app finds something serious | 3 |
| 55 | Fail open when a caller's escalation rule raises, dropping the case the rule was written to catch on the one run where the rule was broken | 2 |
| 56 | Drop `escalation=` from the schema-valid branch, so the flag is computed correctly and then not carried | 7 |
| 57 | Plant an assignable Indian mobile in `plugins/firstbell-absence-calls/` with the privacy gate scoped to `apps/python/firstbell`, which is the scope it had when this was found and not the scope that ships. Row 58 is the shipped state | 0 |
| 58 | The same number with the gate scoped to every path this contribution adds | 1 |
| 59 | Point `CONTRIBUTION_PATHS` at a directory that no longer exists, which is what a rename looks like from inside the gate. Reported as 10 errors rather than 10 failures, because the guard sits in the helper every one of them calls | 10 |
| 60 | Have `mask_id` hand back the identifier it was given, so every call id on the page is whole again | 1 |
| 61 | Print the API id straight into the identifier table, shortening only the provider id beside it | 1 |
| 62 | Assign `_call[_key] = _call[_key]` in the loop that shortens the embedded call data, which is a masking loop that masks nothing | 1 |
| 63 | Have the README promise eight results on the page when the page carries eleven **Needs the built page.** | 1 |
| 64 | Change one `unknown` answer in the built page to `yes`, so four of the five countable non-yes answers remain **Needs the built page.** | 1 |
| 65 | Leave one whole provider id in the built page, in a comment the layout never shows, which is what a leak looks like when it is not in a visible column **Needs the built page.** | 1 |
| 66 | Teach another gate to skip and declare it nowhere, which is how a gate stops running without anybody deciding that it should | 1 |
| 67 | Drop a gate that still skips out of the register, so the suite goes quiet about one it already knew about | 1 |
| 68 | Declare a gate as unable to run when it runs perfectly well, because a register nobody prunes becomes a list of excuses | 1 |
| 69 | State a mutation count in the app README that the table does not have | 1 |
| 70 | State a different one in `evidence/README.md`, which is where this drift actually was: the index said forty-four while the table held sixty-eight | 1 |
| 71 | Round the published alert rate down from 45% to 35%, which is the direction somebody would round it if they were rounding on purpose **Needs the built page.** | 1 |
| 72 | Change one `no` answer on the built page to `yes`, so the page no longer supports the rate the README states beside it **Needs the built page.** | 1 |
| 73 | Put the wrong England absence figure back, which is the defect this gate was written after rather than a defect imagined for it | 1 |
| 74 | Add a plausible new percentage to the sourced section with no entry behind it, which is how the first one got in | 1 |
| 75 | Drop the source link and leave the figure bare, so it reads as sourced without being checkable | 1 |
| 76 | Plant a call id inside `tests/test_privacy.py` itself, where the module's own exemption used to hide it | 1 |
| 77 | State a kill count in `README.md` that the mutation table disagrees with | 1 |
| 78 | State a kill count in this file's prose that the row it names disagrees with | 1 |
| 79 | Say nine rows of the browser table record a state the page was really in, when seven carry the marker that says so | 1 |
| 80 | Take the marker off one browser row, so a failure the page really had reads as an invented one | 1 |
| 81 | Point a citation in `call-e-feedback.md` at the wrong lines of `README.md` | 1 |
| 82 | Shift a citation into another app so it names lines that exist and say something else | 1 |
| 83 | Reintroduce a stale gate count into `evidence/README.md`, the second file that states it | 1 |
| 84 | Switch a gate off with `@pytest.mark.skipif` rather than a call to `pytest.skip` | 1 |
| 85 | Switch a whole test file off from module scope with `pytestmark` | 1 |
| 86 | Make the masking loop assign each identifier to itself, checked against a page built from an authored fixture rather than the published one | 2 |
| 87 | Publish an answer in the register that the record behind it does not hold | 1 |
| 88 | Drop every field but the first from the register the page prints | 1 |
| 89 | Take the marker off one of the rows that needs a built page, so the note above the table counts more of them than the table carries | 1 |
| 90 | State a classifier test count in `README.md` that the module in the other language does not have, which is the count that was already wrong once | 1 |
| 91 | Put the credential guard back the way it was, refusing a key that starts with `iams_live_` instead of requiring one that starts with `iams_test_`, so any key shape it does not recognise is sent to whatever host `CALLE_BASE_URL` names | 4 |
| 92 | Replace the retry backoff with `return 0.0`, so a failing upstream is retried at a family's number as fast as the network allows | 7 |
| 93 | Return the base delay for every attempt, so the policy retries at a fixed rate and never backs off | 2 |
| 94 | Remove the ceiling from the backoff, so attempt twelve waits half an hour and the policy becomes a way of never calling back | 2 |
| 95 | Have `is_valid` answer True for everything, which is what it did for every test in this suite before this row existed: it is exported in `dispatch`'s `__all__` and no code inside this app calls it | 1 |
| 96 | Have `is_valid` answer False for everything, so a schema-valid result is rejected | 1 |
| 97 | Drop the negation, so `is_valid` returns true exactly when the value is invalid | 1 |
| 98 | Remove the gate that refuses to dial a family recorded as unreachable by telephone, so a guardian who is deaf or hard of hearing is called, reaches nothing, and is filed under nobody answered | 5 |
| 99 | Keep the gate but stop the row claiming it needs a person, so the family is not dialled, is not a failure, and is also not on anyone's queue, which is the quietest of the three ways to lose them | 2 |
| 100 | Read an explicit `voice=no` as yes, so the column exists, is filled in correctly by the office, and changes nothing | 1 |
| 101 | Read a blank `voice` cell as no, so every family in a file that does not use the column stops being called | 10 |
| 102 | Ask the channel before consent, so a family that refused to be called is recorded as work owed to them on another channel | 1 |
| 103 | Stop excluding `voice` from `context`, which puts a disability record into the sentence the agent reads aloud on the call | 1 |
| 104 | Treat a `voice` value the reader does not recognise as reachable instead of raising, so a typo in that column silently decides that somebody gets telephoned | 1 |
| 105 | Put the skip counting back the way it was, `skipped_no_consent=counts[Resolution.SKIPPED]`, so a run that was cancelled reports its unstarted rows as families who refused to be called | 2 |
| 106 | Stop counting the skips that are neither consent nor channel, so a reason added later disappears from the summary instead of showing up as unattributed | 2 |
| 107 | Put back a contrast pair naming a token `page.css` no longer declares, so the tool reports it unmeasured and the page keeps telling a reader that an unmeasured pair cannot read as a pass | 1 |
| 108 | Remove the pair covering a scoped re-cut of an ink token, so the colour a reader actually looks at inside a panel is measured by nothing | 1 |
| 109 | Put the locale back into `lang="..."` unescaped in the browser-side transcript renderer, the way it shipped, so a locale carrying a double quote closes the attribute and opens whatever follows it | 1 |
| 110 | Narrow `esc` to `&`, `<` and `>`, which leaves the check on the line above passing while the value it escapes can still close a quoted attribute | 1 |
| 111 | Rebuild the same attribute as a template literal with the value interpolated raw, which is how the hole survives a rewrite that touches nothing else | 1 |
| 112 | Retype the count under the browser-gate table rather than leave it to be counted, so the prose says eight rows record a state the page was really in where nine carry the marker | 1 |
| 113 | Drop the flattening from `as_data` and keep the length cap, so a roster field carrying a line break adds a paragraph to the instruction the agent reads on a call to a parent | 3 |
| 114 | Drop the length cap from `as_data` and keep the flattening, so one line is all a roster field needs and the line can be a brief | 1 |
| 115 | Return the roster value from `as_data` untouched, which is how `build_task` read it until this was fixed | 5 |
| 116 | Remove the sentence in `build_task` naming the three values as record fields, leaving a flattened injection to read as an aside the agent was told nothing about | 1 |
| 117 | Stop stepping the internal scroll boxes in the contrast gate, so the transcript's lower turns go back to being declined every run | 1 |
| 118 | Report the contrast census as zero instead of its real size, which is the number that makes an unmeasured count of zero mean anything | 1 |
| 119 | Take no census at all, so a run the probe never reached leaves no trace again | 1 |
| 120 | Identify a text run by its class and the first thirty characters of its text again, which folds two elements that share both into one and measures only one of them | 2 |
| 121 | Type the mutation count into the take-away card instead of counting the rows, which is the defect a reviewer found on the deployed page before this suite did | 2 |
| 122 | Put back `The offline default never reaches it`, the sentence that told a reader the default run does not use CALL-E when it executes three of the four anchored lines | 1 |
| 123 | Move `calle-ai` out of the runtime requirements, which would leave the README's reason the offline default runs CALL-E's own code true and beside the point | 1 |
| 124 | Type the size of the mutation table into the act 06 margin note again, the one of that page's three statements of it that the first version of this gate did not read | 1 |
| 125 | Say five real calls under a register that renders four, which is the shape a fifth receipt arriving would produce on its own | 1 |
| 126 | Change the enumerated field count in the locale fold so its own arithmetic stops reaching the comparison total it claims above | 1 |
| 127 | Stop sending `X-Content-Type-Options`, leaving the browser free to guess a type the deployment declared correctly | 1 |
| 128 | Open `frame-ancestors` from `'none'` to `'self'`, which is the whole difference between a page that cannot be framed and one that can | 1 |
| 129 | Let `style-src` fall back to `'unsafe-inline'`, which grants every inline block and makes the three hashes beside it decorative | 1 |
| 130 | Grant `script-src` an origin the page never names, the shape a third-party allowance takes after the script it was added for is dropped | 1 |
| 131 | Change one character of the inline stylesheet's hash, which is what a policy describing an earlier build looks like | 1 |
| 132 | Narrow the header rule from every path to `/index.html`, so the modules and the eight audio clips are served with no policy at all | 5 |
| 133 | Hang a second inline event handler on the page, so `'unsafe-hashes'` is widening the policy for something nobody decided to allow | 2 |
| 134 | Move the live ceiling from `more than` to `at or more than`, so a run of exactly the size the operator was told is allowed gets refused | 2 |
| 135 | Count rows rather than the calls a run would place, so a file of families who never consented is refused for spend it was never going to cost | 1 |
| 136 | Apply the live ceiling to the offline run, which phones nobody, capping a demonstration instead of a bill | 1 |
| 137 | Accept `--max-calls` and then ignore it, so the one deliberate way past the ceiling silently does nothing | 1 |
| 138 | Drop the number of families from the refusal, leaving an operator who is told the run was too big and not how big | 2 |
| 139 | Ask `safeguarding_escalation` only of rows whose resolution is `resolved`, so the four escalating cases in the run the page draws render as ordinary callbacks in the office queue | 1 |
| 140 | Let the report say the safeguarding window is this project's default whatever window was passed, so a district reads its own agreed clock into a number nobody chose | 1 |
| 141 | Accept `--webhook-url` and stop forwarding it to CALL-E, so a district's endpoint is promised an event that is never asked for | 1 |
| 142 | Let `is_loopback` answer yes to every address, so the double binds to a network on a flag nobody had to type | 1 |
| 143 | Parse `--i-know-this-is-open` and never consult it, leaving a guard that is written down and not run | 1 |
| 144 | Drop the override from the refusal text, so an operator with a real reason to open the port reads a wall instead of a choice | 1 |
| 145 | Put the animation data back behind a URL, so the policy refuses the fetch and the figure never plays | 1 |
| 146 | Hide the replaced still with `element.hidden`, which SVG does not implement, leaving it in the layout beside the animation | 1 |
| 147 | Size the animation to twice the still it replaces, so the page under it moves | 1 |
| 148 | Read a consent value nobody defined as a no, so a district whose export writes `consented` has every family dropped and reported as having refused | 1 |
| 149 | Read a row with fewer cells than its header, so a truncated export line becomes a family with no consent | 2 |
| 150 | Read a row with more cells than its header, so the surplus travels into the spoken instruction under the key `None` | 1 |
| 151 | Accept a column that appears twice, silently discarding one of the two values, which for `phones` or `consent` is the one that decides whether a family is called | 1 |
| 152 | Let a file that is not the promised encoding raise `UnicodeDecodeError` instead of naming the encoding it tried | 1 |
| 153 | Read a file containing a NUL byte, so a half-written export is treated as text and a child's name is spoken with a gap in it | 1 |
| 154 | Let a cell past the CSV field limit raise `_csv.Error`, which names neither the file nor the cause | 1 |
| 155 | Call from an export older than the window, which telephones the families of children who are in school today | 2 |
| 156 | Call from an export already called from, telephoning every family in it twice | 2 |
| 157 | Key the processed ledger on the filename rather than the content, so a job that rewrites the same rows under a new date stamp gets through | 1 |
| 158 | Record an export as called-from before its rows are known to be readable, which strands the operator who fixes it | 1 |
| 159 | Drop the sentence in the ledger header saying what deleting a line permits | 1 |
| 160 | Restore `call["id"]` on a create response that carries no id, so a request CALL-E accepted raises `KeyError` and is reported as a call nobody answered | 1 |
| 161 | Let a response shape the classifier does not model raise out of the handler after the id has left the in-flight set, so a placed, completed, billed call is reported FAILED with its id nowhere | 3 |
| 162 | Stop retrying a 5xx whose body is not JSON, which is the shape a proxy's own bad-gateway page has and the one class of failure a retry exists to absorb | 1 |
| 163 | Stop naming an unaccountable call in the run summary unless the run was cancelled, which is the branch that does not happen by itself | 1 |
| 164 | Stop printing the block that names a call this run placed and cannot account for | 1 |
| 165 | Drop `not_recallable` from `--json`, leaving a machine reader unable to see what the run left behind | 1 |
| 166 | Print the unaccountable call's id with no row beside it, so nobody can say which family it was for | 1 |
| 167 | Put back the n8n recipe's hardcoded `escalation: "none"` on the all-unknown branch, so the same call is a safeguarding case in Python and an ordinary callback in the workflow | 1 |
| 168 | Remove the schema check from the n8n recipe, so a value outside the enum closes a record there and does not here | 1 |
| 169 | Accept a nested object schema at construction, which `problems()` never recurses into, so every rule inside it is ignored and the answer is reported valid | 1 |
| 170 | Accept an array property, which has no `items` support, so a list of anything at all is reported valid | 1 |
| 171 | Accept an empty `--again` label, so a family is called a second time in one morning with no reason on the record | 1 |
| 172 | Stop normalising the label, so `Locale Fix` and `locale-fix` are two keys for one correction and the fix runs twice | 2 |
| 173 | Accept the label and never put it in the idempotency key, so the corrected run is refused exactly as the uncorrected one was | 1 |
| 174 | Stop printing the way out of a reused key, leaving a refusal that reads as a dead end until tomorrow | 1 |
| 175 | Stop recording the correction in the receipt | 1 |
| 176 | Stamp the double's `created_at` off one shared clock that advances 30 seconds a step and is never pulled back, so a run of 150 rows reports 27 of them with an unknown provenance | 1 |
| 177 | Ignore a pinned clock, so a test that asked for determinism stops getting it | 1 |
| 178 | Call `phone.startswith("+")` E.164 again in the double, so `+91 5550 000001` is accepted and dialled offline where production would refuse it | 6 |
| 179 | Hardcode an off-palette accent in the README's path figure, so the drawing keeps a colour the page has moved on from | 1 |
| 180 | Drop the mono fallback chain from the path figure, so a reader without the webfont gets the browser default at a different width | 1 |
| 181 | Gut the path figure's `desc`, leaving a diagram a screen reader cannot report | 1 |
| 182 | Hand-edit the committed path figure, so the README shows something its generator does not write | 1 |
| 183 | Set an ending's second line in the palest ink the palette holds, on its own coloured plate, so a label on the page's own figure drops below WCAG AA | 1 |
| 184 | Put the escalation panel's dark ink on a mid-grey plate, which is the pairing a drawing loses track of because the ink and the ground are set in two different places in the file | 1 |
| 185 | Serve a document page with its markdown link left as written for the tree (`receipt-provenance.md` beside it), which is what all eight of them did on the deployment | 1 |
| 186 | Point an in-page anchor at an id that is not on the page, so the click scrolls nowhere and reports nothing | 1 |
| 187 | Give a published page an href in a scheme the link gate does not classify, to check it is counted unmeasured rather than quietly skipped | 1 |
| 188 | Make a gate raise instead of returning, by pointing a rail link at a deleted element, to check the run still reports the other fifteen | 1 |
| 189 | Stop a withdrawn consent record from refusing the call, which is the one misreading here that telephones a family who asked not to be telephoned | 4 |
| 190 | Make a record expiring today stop covering today, off by one at the boundary an expiry exists to define | 1 |
| 191 | Let one family's consent record cover any row that points at it, which turns a register with one good record into a permission for the roster | 1 |
| 192 | Ignore an unrecognised key on a consent record instead of refusing it, so a misspelled `withdrawn_at` reads as a record nobody withdrew | 1 |
| 193 | Count a row refused on a dated record by exact reason rather than by prefix, which files a family who withdrew consent under the bucket for a cancelled run | 1 |
| 194 | Resolve a header row matching two export formats by order instead of refusing it, so which column is the identifier is decided by the order this file lists formats in | 1 |
| 195 | Let a recognised export with no consent column dial anyway, which is the reading of a missing permission this software exists to refuse | 5 |
| 196 | Take only the first source column for a phone number, so a row carrying a number under `sms` alone has none | 2 |
| 197 | Hold a sibling behind a row nobody was going to dial, which reports a call saved that was never going to be placed | 3 |
| 198 | Drop the id fallback on an unparseable number, which collects every row whose number is punctuation into one household | 1 |
| 199 | Dial the last row of a household instead of the one the export put first, so a receipt cannot be read against the district's own file | 6 |
| 200 | Stop telling the dialled row who else in the house is absent, which asks a parent about one child while two more of hers are held | 1 |
| 201 | Count held rows in no bucket, which reports a household the run grouped as a run somebody cancelled | 1 |
| 202 | Stop checking who answered before reading what they said, so a brother saying the child is ill closes a record only a guardian can close | 4 |
| 203 | Read a call that did not record who answered as a call answered by somebody who is not the guardian, which invents a fact about a call while trying to be careful | 7 |
| 204 | Read everybody who answers as the guardian, which is the state this was written to leave | 7 |
| 205 | Report closures made with nobody recorded as zero, which hides the exposure by publishing a total that looks clean | 3 |
| 206 | Put the attempt count back under the word `calls placed`, six lines under a line saying six rows were attempted | 4 |
| 207 | Count a row this run dialled but made no attempt on as a call | 1 |
| 208 | Multiply an escalation bound that does not exist, which is what killed the whole page build on a run that answered nothing | 1 |
| 209 | Dial a row carrying a number the record does not name | 2 |
| 210 | Compare telephone numbers as text, so a register a person typed covers nothing | 2 |
| 211 | Read a comma-joined string as one telephone number | 1 |
| 212 | Count a refused row as a call that rested on a record naming no number | 1 |
| 213 | Stop printing how many dialled rows nobody can point at a number for | 2 |
| 214 | Record a refused row as exposure, which reports a family nobody rang | 1 |
| 215 | Build a forge URL for a cited file that is not in the tree | 2 |
| 216 | Ignore an unknown key in a scenario file | 1 |
| 217 | Load a scenario that binds nothing | 1 |
| 218 | Export a scenario without its transcripts | 2 |
| 219 | Accept a transcript turn that is not a speaker and a line | 1 |
| 220 | Take `--outcomes` and bind none of it | 1 |
| 221 | Report the exported scenario as current whatever is on disk | 1 |
| 222 | Default a scenario entry to nobody picking up | 1 |
| 223 | Compare a number with no digits in it as equal to another | 1 |
| 224 | Load a consent record whose phone entry is a word | 1 |
| 225 | Keep a work file phone entry that is a word and dial it | 1 |
| 226 | Shorten an identifier too short to have a middle | 1 |
| 227 | Load a scenario that answers on a negative index | 1 |
| 228 | Report every authorised call as one whose number was named | 1 |
| 229 | Label the two-file `node --test` command on the take-away card with the classifier file's own count, so the card offers 27 for a command that runs 35 **Needs the built page.** | 1 |
| 230 | Drop the `cd` from that command, so it names two files that are not under the directory this page puts a reader in and runs nothing at all **Needs the built page.** | 1 |
| 231 | Label `double_conformance.py --check` with a test count, which is what it carried before: that command runs no tests and prints one line **Needs the built page.** | 1 |
| 232 | State the node suite as 32 passing in the plugin's `manifest.json` | 1 |
| 233 | State the classifier's own count as 24 in that manifest | 1 |
| 234 | State the node suite as 32 passing in the plugin README | 1 |
| 235 | Say the receipts are on the evidence page in `evidence/README.md`, with a pronoun carrying the subject across the full stop, which is how the sentence was written | 1 |
| 236 | Say it in the README's money paragraph | 1 |
| 237 | Say it in the README's reading list | 1 |
| 238 | Say it in the README's privacy paragraph, eighty lines below the other one | 1 |
| 239 | Say it of the replay receipt in `docs/receipt-provenance.md`, which is the receipt carrying the claim that no telephone rang | 1 |
| 240 | Say it in the provenance line `make_shape_fixtures.py` stamps inside every generated fixture | 2 |
| 241 | Say it in that file's own docstring | 1 |
| 242 | Say it in the comment over the generated response fixtures in `tests/test_dispatch.py` | 1 |
| 243 | Say it in the footer under the escalation queue, with the page named first and the receipts after it, which is the wording the first version of the gate walked past **Needs the built page.** | 2 |
| 244 | Say it in the caption under act 03, which is the page telling a reader that a file is on the page **Needs the built page.** | 1 |
| 245 | Print one more queue row in the footer than the page drew **Needs the built page.** | 2 |
| 246 | Take the row the telephone cannot reach out of the district export, returning the channel gate to being demonstrated by nothing | 2 |
| 247 | Rename the channel column in that export, so every row reads as reachable | 2 |
| 248 | State the collected test count flat on the stat card, where two of them skip **Needs the built page.** | 2 |
| 249 | Point the transcript provenance at a document that is in no clone of this repository **Needs the built page.** | 2 |
| 250 | Have the transcript provenance call the waveforms the only audio that ships, on a build that ships the recordings and plays them **Needs the built page.** | 2 |
| 251 | State four runtime call sites above a list of five | 2 |
| 252 | Drop the directory from act 08, so neither of the two commands it prints runs from the root of a fresh clone **Needs the built page.** | 2 |
| 253 | Take the language ceiling off the page, which is what a reword of act 01 does to it now that it is no longer welded to the masthead **Needs the built page.** | 1 |
| 254 | Point the language ceiling at an act this page does not have, so the one limit a school trustee can check names no demonstration **Needs the built page.** | 1 |
| 255 | Put the language promise back in the masthead, now that the limit answering it has moved one screen down **Needs the built page.** | 1 |
| 256 | Declare `--receipts` required again in `tools/throughput.py`, so a reviewer running the documented command is told they used the tool wrongly | 1 |
| 257 | Report the missing recordings from `tools/video_facts.py` as a SystemExit, which exits 1 and reads as a check that failed | 1 |
| 258 | Take the shared first word off the page builder's own answer, so four tools report the third outcome in one word and the fifth in its own | 1 |
| 259 | Strip the flag, the environment variable and the committed file out of one COULD-NOT-MEASURE message, leaving a reviewer told what is missing and nowhere to go for it | 1 |
| 260 | Say in the README that the OneRoster run prints the platform refusing Spanish on a real call, when no call has been placed in Spanish and the refusal is the double's | 1 |
| 261 | Say the same in the caption under act 01, in the words the reviewer who asked for that caption wrote it in **Needs the built page.** | 1 |
| 262 | State the escalation count the receipts recorded before the correction as the current one, in the file that narrates the correction two paragraphs below it | 1 |
| 263 | Offer the calls placed as the sample in all three rows of a table whose column is a rate per answered call | 1 |
| 264 | Call the sample twelve calls in the sentence a district is told to take from that table, where the figures are over the eleven that answered | 1 |
| 265 | Label the bound on the money card with the calls placed rather than the calls answered, eleven lines above a paragraph that reads it correctly out of the same record **Needs the built page.** | 1 |
| 266 | Label the bound on the money card with the sample it was measured on and not the quantity it bounds, so 24 per 100 reads as what eleven calls cannot rule out about escalations, when the escalation rate they measured is about twice it **Needs the built page.** | 1 |
| 267 | Drop the escalation rate's own bound from the money card while the sentence under it still counts three rates, leaving the wider of the two readings unpublished **Needs the built page.** | 2 |
| 268 | State the wrong number of rates in the sentence generated beside them, so the card's own summary of itself is off by one **Needs the built page.** | 1 |
| 269 | Put the escalation bound in the column headed net-new per 100 answered calls, which is the mistake this document records making once with 24 against 50.4: two right figures and a comparison that is not one | 1 |
| 270 | Drift the cost the pessimistic reading prices out to by a cent in the money document, away from what the tool computes | 1 |
| 271 | Compute the escalation rate's bound off the net-new count, so the two bounds are the same number and the card publishes the narrow reading twice while calling one of them the widest **Needs the built page.** | 3 |
| 272 | Drift the derived absence rate by one per thousand in the line that shows the arithmetic, so the document publishes a rate its own registered inputs do not produce | 1 |
| 273 | Round the headline volume up to a number the derivation does not reach, which is the figure a reader carries away and the only one most will remember | 1 |
| 274 | State the wrong rate for a 175-day school year, hiding how much the largest lever on this figure actually moves it | 1 |
| 275 | Remove the publisher's definition of unexcused, which is the sentence that makes the volume figure a ceiling on what this software would call about rather than a measure of it | 1 |
| 276 | Publish the annual saving and drop the annual cost the widest reading of the same calls produces, which is the vendor move this entry was built to argue against | 1 |
| 277 | Close a record by reading a reassuring phrase out of the transcript, which is the improvement somebody would plausibly make to this tool and is the exact defect the rest of this entry exists to catch | 1 |
| 278 | Decide the outcome here instead of calling the function the live path calls, so a district adopting this over its own dialler gets a second rule that agrees with the first only until one of them changes | 1 |
| 279 | Silently ignore a result field the schema does not define, so a district that mistypes one field in its mapping gets records filed undetermined for a reason nothing on the output names | 1 |
| 280 | Abort instead of reporting could-not-measure when there is nothing to read, folding a third outcome back into a failure | 1 |
| 281 | Audit another dialler's calls without passing the numbers they were placed to, so a consent record covering a different number than the one dialled passes. Consent attaches to the number called | 1 |
| 282 | Judge a call nobody answered on the result attached to it, and treat a record that does not say whether it was answered as though nobody was there | 1 |
| 283 | Escape the limits list in act 07 with the escaper that escapes everything, so the two commands that section tells a reader to run reach the page as literal backticks instead of code **Needs the built page.** | 1 |
| 284 | Write the markup into the limits data as well, which is the shape act 07 really shipped: the command a reader is told to run arrives with its code tags visible as text around it, and an apostrophe arrives as a numeric character reference **Needs the built page.** | 4 |
| 285 | Promote the backticks in a mutation row and stop, which is what the page did for as long as the table has existed: twenty-six rows show the marker under this table with its asterisks **Needs the built page.** | 1 |
| 286 | Promote bold and stop, so the one row drawing a distinction between any required field and all of them shows the emphasis as punctuation instead **Needs the built page.** | 1 |
| 287 | Label the ceiling on the money card as what a call can save, eighty lines from a README that calls the same figure a ceiling and not a saving **Needs the built page.** | 1 |
| 288 | Drop the sentence naming which of the four money figures to quote and which to plan against, leaving a reader to pick **Needs the built page.** | 1 |
| 289 | Mark a drop directory's export as one calls have been placed from at the moment it is read, which is before the confirmation flag, before the key check, before the credential origin, before the call ceiling, and on every offline run | 2 |
| 290 | Mark the export whatever the run did, so a rehearsal against the bundled double, which rings no house, burns the file the morning's real calls come from | 2 |
| 291 | Mark the export on a wave that dialled nobody, where every row was held for a person on consent, a shared household number or a language this cannot speak, and those rows are tomorrow's work out of the same file | 1 |
| 292 | Record that the run stopped without setting the flag every worker reads before it dials again, so an operator's Ctrl-C is written on the receipt and the wave carries on out of the queue and out of the backoffs | 3 |
| 293 | Exit zero from a run that was stopped part way, which is what a cron job wrapping this reads as a morning where every family was called | 1 |
| 294 | Count the spend ceiling on consent and reachability alone, which is two of the four things that stop a row being dialled, so a file placing two calls is refused as four families and the refusal names the wrong number to raise it to | 1 |
| 295 | Read a record's `answered` as yes on any word, so a call nobody picked up is closed on the result sitting beside it, which is this entry's founding defect arriving through the adoption path | 3 |
| 296 | Iterate a single telephone number written as a string, so a consent refusal tells an attendance officer the record covers one number and the row carries twelve | 1 |
| 297 | Accept a CSV naming one column twice, where the reader keeps the last value silently, so column order decides whether a child's absence is closed | 1 |
| 298 | Crash on a records file that is not UTF-8, taking the exit code this tool reserves for a consent finding, which a district exporting from a Windows codepage hits on the first accented surname | 1 |
| 299 | Crash on a consent register that does not validate, so a script cannot tell one of these calls resting on nothing from a typo in the register file | 1 |
| 300 | Exit zero from `--fail-on-uncovered` on a call resting on a bare boolean, while the line above the exit reads on a boolean and the flag's help says exit one when a call rests on no consent record | 1 |
| 301 | Print the closed rows inside the queue, under a heading about what needs a person, each carrying the sentence that nothing here needs one | 1 |
| 302 | Publish the absence volume and the escalation rate and never multiply them, which is what a district buyer said was worth more than any figure already on the page | 1 |
| 303 | Understate the escalations a morning's volume produces, so a pilot is sized on the calls rather than on the callbacks and the queue it creates is blamed on the software | 1 |
| 304 | State the commit-provenance disclosure as an exact pair, which both halves of change on every push and which nothing recounts, making the entry's one honesty disclosure the one claim it does not check | 1 |
| 305 | Read the pair on the page's first screen out of a sentence in the README instead of the measurement sitting beside it, so a stale sentence and a stale card agree with each other and disagree with the suite | 1 |
| 306 | Name records in a fixture's own comment that the fixture does not contain, so a reader following the comment finds neither | 1 |
| 307 | Print `the other N` where N is all of them, so a sentence says the rule marked five calls and the other five gave nothing usable | 1 |
| 308 | Annualise the ceiling without subtracting what the calls cost, against a loss on the same line that is already stated net, which runs in this entry's favour on the one page a board reads | 1 |
| 309 | Read the cancel flag before the first attempt only, so an item whose first attempt timed out waits out its backoff and telephones the family after the operator has pressed Ctrl-C, holding a request that may already have started that same telephone ringing | 2 |
| 310 | Take the pair on the page's first screen off the recorded pass count rather than the tests the tree can run, which is a number the gate holding the file against the page lowers by failing, so a stale card has no value it can correct itself to | 1 |
| 311 | Read a placed call's id out of the poll response rather than out of the create that returned it, so a body answering a poll without one produces a queue row carrying no id beside a receipt naming the call, and the row a clerk reads says nobody was telephoned | 1 |
| 312 | Put one of two records for the same pupil in the closed pile while the other says a person has to ring back, so the pile a clerk stops reading at holds a child whose absence nobody has explained | 1 |
| 313 | Answer a spreadsheet that exported its header and no rows with a sentence about blank and commented lines, which a spreadsheet has neither of, leaving the district the right exit code and no idea what to fix | 1 |
| 314 | Set the count in the sentence under the money card next to the row that makes it true, so the two cannot disagree, and the gate written to catch them disagreeing cannot fail | 1 |
| 315 | State twenty-eight unexplained absences per 1,000 as the figure to use rather than a ceiling on it, which is the sentence that stops a reader multiplying the per-call money by every absence a district records | 1 |
| 316 | Call a string method on the path argparse hands back, so a records file with nothing in it raises rather than printing could-not-measure, which turns the one outcome this tool reserves for what it cannot judge into a traceback | 1 |
| 317 | Blank the English on one Tamil turn in the gloss file, so a line a reader is promised a translation of gets an empty one, which renders as the Tamil alone with a gap under it | 1 |
| 318 | Leave a Tamil word inside an English gloss, so the translation a reader was given to read is partly the thing they could not read | 1 |
| 319 | Add a gloss row for a line that holds no Tamil, so the file that exists to say which lines were translated starts claiming a line nobody needed translated | 1 |
| 320 | Empty the gloss file's statement of what wrote the English, so a reader deciding how much to trust a translation has nothing to decide from | 1 |
| 321 | Stop the builder refusing a Tamil line the gloss file has no English for, so the page publishes one untranslated line in the middle of a scroller and nothing says so | 2 |
| 322 | Stop the builder refusing a call in another language that the gloss file does not name, so a call added later reaches the page with none of its turns translated | 1 |
| 323 | Look each gloss up by its position in the list rather than by what the line says, so a transcript the transcriber split differently puts every English sentence under the wrong Tamil one, with a gloss present on every line | 1 |
| 324 | Decide which turns need English from the call's locale rather than from each line's own text, so a call labelled `ta-IN` that opens with an English announcement demands a translation of English, and the authored fixture the suite builds a page from stops building at all | 1 |
| 325 | Drop the English span from a rendered turn while leaving it in the published data, so the transcript a reader with no JavaScript meets is the one version of it with no translation | 2 |
| 326 | Drop the note under a translated transcript saying the English was written afterwards, so a page presenting a translation stops saying it is one, which is a claim about what was on the recording | 1 |
| 327 | Retype one consonant of the Tamil quoted in `docs/the-legal-surface.md`, which is the defect that was actually in the tree: the fourth word of the opening announcement carried the wrong one of two similar letters, inside the paragraph whose whole argument is that the disclosure a parent hears is the disclosure on the recording | 1 |
| 328 | Remove the English under a Tamil line in a document, so one file in the submitted tree prints two sentences of Tamil with no translation anywhere near them, which is where this started | 1 |
| 329 | Delete the `attrs` row from the runtime table, which is the defect that was actually in the tree: a direct requirement of the CALL-E SDK with no licence recorded, under a sentence saying nothing else was needed at runtime | 1 |
| 330 | State a version for `httpx` that is not the version installed, so the file describes a dependency tree that a reader checking it would not find | 1 |
| 331 | Call `certifi` MIT. It is MPL-2.0, and it is the only weak-copyleft row in the runtime table, so this is the mistake an author makes by assuming a licence rather than reading one | 1 |
| 332 | Say the browser-gate lock file resolves forty packages when it resolves eighty-three, so a count nobody could check sits next to a claim that all of them are permissive | 1 |
| 333 | Let one browser-gate dependency arrive under GPL while the file still says none is copyleft, which is how a licence claim goes stale: not by being written wrongly, but by a lock file moving under it | 1 |
| 334 | Remove the note explaining the AGPL dependency while `requirements-dev.txt` still pins it, so a reviewer of an MIT repository meets an AGPL import with nothing written about it anywhere | 1 |
| 335 | Put a kill count of 1 back beside the substring row in `docs/proving-a-gate-fires.md`, which is the defect that was actually in the tree: the document a reader is told to reproduce the mutations from copied a row whole and disagreed with the table it copied from, and the gate that checks these counts read only the README | 1 |
| 336 | State a kill count in the README that the table does not measure for the substring row. The sentence used to name a test instead of a number, which is why nothing checked it while its three neighbours were checked | 1 |
| 337 | State a call count on the first-screen dateline that `evidence/recorded-calls.json` does not measure, so the one number a reviewer meets before the fold is the one nothing checks **Needs the built page.** | 1 |
| 338 | State a price on the dateline that the account was never billed, against the figure read off the usage panel on 2026-09-07 **Needs the built page.** | 1 |
| 339 | Write the dateline's four numbers into the builder as literals instead of computing them. This is the failure the gate exists for: four values that are right the day they are typed and silently stop being right | 1 |
| 340 | Render the dateline when no receipts are on the machine, so the first screen carries four numbers no reader of that build can check | 1 |
| 341 | Guard the sibling sentence on the raw roster value while rendering the sanitised one. This is the defect that was in the tree: `str.strip()` leaves a zero-width space where `as_data` removes it, so a name made only of format characters passed the guard and the instruction that would have reached a real call asked why nobody was absent | 1 |
| 342 | Take the sanitiser off the sibling names, so a format character in a roster cell reaches the words CALL-E speaks | 2 |
| 343 | Use the singular verb however many siblings there are, so a call about two children asks why they is absent | 1 |
| 344 | Drop the sibling sentence entirely, so a guardian with three absent children is asked about one and the other two records are held on an answer nobody gave | 3 |
| 345 | Match committed transcript text by the key name `transcript_turns` instead of by the shape of a turn. This is the defect that was in the tree, and it is the worst kind: `tools/glosses.json` holds 53 turns of four real calls under `turns`, so the one committed file carrying real conversation was the single file this gate could not see, and the suite was green because the gate was looking in the wrong place | 1 |
| 346 | Count a turn only when it carries both `text` and `speaker`, so the Tamil and English pairs the gloss file is made of stop reading as dialogue | 1 |
| 347 | Empty the declared exception list while the file it names is still tracked, so real conversation sits in the tree with nothing recording that anybody decided it could | 2 |
| 348 | Stop the gate walking into nested objects, so a conversation one level below the root of a committed document passes | 1 |
| 349 | Render the documents with commonmark alone, which has no tables, so six documents publish their table rows as paragraphs of pipe characters. This is the defect that was in the tree: `what-a-pilot-would-look-like` opened its Shape section with eleven rows of `| Scale | Two schools in one district. |` set as running prose, on the page the money card sends a reader to | 3 |
| 350 | Skip the table pass entirely, so no cell carries the name of its column and an empty header row stays on the page as a rule above a band of nothing | 2 |
| 351 | Treat a column with no name in the header as an ordinary value rather than the term the row is about, so the money document's first column loses the mark that stacks it first and sets it in the label face | 2 |
| 352 | Take the header row off every table rather than only off one whose cells are all empty, so a table that names its columns loses the names | 2 |
| 353 | Return to what this module did for as long as it existed: keep the set of allowed tags as a comment and check nothing against it, so any tag the renderer emits reaches a public page with no style written for it | 1 |
| 354 | Take one document off the published list while it is still cited by name from another page, which is how `docs/district-ingest.md` and `docs/consent-record.md` came to be unreachable | 1 |
| 355 | Accept a name in the withheld register with no reason written beside it, so a document can be kept off the site by an empty string | 1 |
| 356 | Leave a document table with only the roles a stylesheet leaves it, so the stacked form under 38rem is a run of blocks to a screen reader: no row, no column, and no header attached to any cell | 2 |
| 357 | Take `scope` off the header cells of the page's five tables, so a header stops saying whether it runs down a column or across a row at the width where the stylesheet has already taken the implicit answer away **Needs the built page.** | 1 |
| 358 | Take the caption off one table, so it is announced by its size and nothing else **Needs the built page.** | 1 |

Row 284 fails four tests and is the one row whose marker is only partly true. Three of the
four read the built page, and the fourth reads the builder, so a clean checkout measures
one rather than nothing. That fourth gate is there because the first three cannot run for
most readers, and the mistake being caught is markup written into data that an escaper is
going to see, which is a property of the source.

Rows 283 and 284 were found by a reviewer reading the page rather than by anyone reading
the code. The defect had shipped for days under a suite that was green at the 662 tests it
had, because the file about escaping was about the other direction: it proves a hostile
value cannot escape its attribute, and says nothing about an honest value being escaped
twice. Rows 285 to 288 came from sweeping the rest of the page for the same class
afterwards, and two of them are the same helper knowing one markdown syntax and stopping.
Row 285 also went in with a gate that measured zero against it: the first version matched
a pair of asterisks, and removing the bold pass while the italic pass stayed produced a
stray asterisk either side of a real emphasis tag, which is neither of the two shapes it
looked for. A correct page carries no asterisk in its prose at all, so that is what the
gate asks now.

Rows 289 to 310 answer three reports read on 9 September 2026: a bug hunt over the calling
path, a second over the tool that reads another dialler's records, and a district buyer's
blind review of the whole entry. Every one was reproduced with a command before it was
fixed and every fix went in with its gate written first. Three of them are worth reading
on their own.

Row 289 is the worst thing found in this repository. A drop directory keeps a ledger of
exports calls have gone out from, so no family is telephoned twice about one absence, and
the digest was written at the moment the file was read. Reading places no calls. Every
refusal in the program happens after the read, so a district that typed --live without the
confirmation, or ran the file once to look at it, was told on the next attempt that every
family in it had already been telephoned. The day's work was unreachable and the message
explaining why was false.

Row 294 is a gate that was checking its own assumption. The spend ceiling counted rows on
consent and reachability, the dispatcher refuses rows on four things, and the test written
to catch exactly that drift said in its own docstring that it would fail if the dispatcher
grew a third reason. It had four the whole time, and the test's fixture only contained
rows for the two the ceiling knew about. Both now read one function.

Eight of these twenty killed nothing on the first attempt and not one of them was written
down on that count. One was the harness: an interrupt escaping the wave makes pytest
abandon the session and print no failure line at all, so a counter reading failure lines
saw zero on a mutation that had stopped the suite dead. Two were mutations that did not do
what they said, renaming a heading while leaving the numbers under it, and changing one
line of a derivation while three paragraphs went on stating the old figure. One could not
run yet. The other four were holes: nothing checked the queue against the rows in it,
nothing checked a fixture's comment against the fixture, nothing checked a remainder
against the subtraction above it, and nothing recomputed the annual figure after the calls
were paid for. Four gates were written and one was widened, and every row below is a count
observed after that.

Rows 311 to 315 came from two bug hunts whose reports arrived in halves. Two of the five
are gates rather than code: 314 is a count spelled beside the row that made it true, so
the sentence and the card could not disagree and the gate written to catch a disagreement
had no reachable failure, and 315 is a hedge the gate looked for anywhere in a document
rather than in the sentence that states the number. Both had passed every run since they
were written. A gate with no reachable failure is worse than no gate, because the row it
occupies in this table says something was checked.

Rows 148 to 159 are the only ones in this table that were not found by reading. A probe
fed the input path twenty-four hostile files and recorded what each one did: two crashed
with an exception that was not a `SourceError`, and five were accepted when accepting them
ends with the wrong thing happening to a family. The suite was green throughout, 329 tests
at that point, so none of this was a rule that failed. It was a set of cases nobody had
written down.

Rows 160 to 182 answer a bug hunt run against the whole tree on 7 September 2026, with the
suite green at 380 tests. Fourteen defects were reported and all fourteen are closed; the
twenty-three rows here are the ones a script can apply. Three of them are worth reading on
their own.

Row 161 is the shape the others are variations of. A response CALL-E is free to send and
the double never produces (recipients as an object keyed by id, or as a bare string, or
attempts as a list of strings) raised out of the handler after the call id had already been
discarded from the in-flight set, so the dispatcher's own catch-all recorded a placed,
completed, billed call as FAILED, with no id in any line of output. The call happened. Only
the shape was a surprise, and a surprise is the third outcome.

Rows 167 and 168 are the only two in this table that are about a second implementation
rather than this one. There are two shipped classifiers: `dispatch/scheduler._classify` and
the n8n recipe's `classify.mjs`. The recipe's own tests checked the JavaScript against
itself, and this repository's no-drift promise is about the workflow JSON against the module
beside it, which held. Nothing held the module against the Python it is a port of, and they
disagreed on the branch the whole entry is built around. `tests/test_classifier_parity.py`
runs the JavaScript through node over ten fixtures and compares the resolution, the
escalation and whether a person owns it.

Row 176 is a measurement rather than a rule. The double advanced one shared clock by 30
simulated seconds on every step and never pulled it back, so `created_at` ran ahead of the
caller's real clock in proportion to how many calls had been placed and eventually crossed
the one-hour skew guard the dispatcher uses to tell a call it just placed from one an
idempotency key replayed. Zero unknown at 60 rows, 59 at 120, 138 at 200. Seven rows is the
demonstration, so nothing showed it, and `--max-calls` exists to invite the larger run. Each
call now carries its own clock. Measured after: zero unknown at 60, 120, 200 and 400.

Two of the probe's own expectations were wrong, which is worth recording because a probe
that is never wrong is a probe that only asks what it already knows. A phone number that is
not E.164 and a locale nobody supports are both read by the source and both place zero
calls, because refusing to dial is the dispatcher's job. Running the whole pipeline settled
it; arguing about it would not have.

Row 149 is the worst of them. `csv.DictReader` fills a short row's missing columns with
None, the old consent reader treated anything it did not recognise as a no, and the two
together turned a truncated export line into a family reported as having refused. A
truncated line is exactly what a killed overnight job leaves behind, and `DropSource` reads
whatever that job left without a person in the way. Row 154's mutation had to be redone: the
first attempt removed the guard in a way that would not parse, so the suite failed to
collect rather than failing a test, and a collection error is not evidence that anything is
being checked.

Rows 142 to 144 test a rule that test a rule which did not exist before the
mutation was written. A security pass found the double authorises any bearer token, which
is correct and is what lets the whole entry run without a CALL-E account, and that it
would bind wherever `--host` pointed. Nothing had gone wrong. The three rows are the three
ways the new refusal could be present and useless: a check that always passes, a flag
nothing reads, and a message that refuses without saying how to proceed. Row 143 is the
slow one, because the only honest way to prove the parser reaches the guard is to run the
command an operator runs.

Row 140 arrived as a concession and it arrived as a concession. A reviewer reading the code
asked for `SAFEGUARDING_CALLBACK_MINUTES` to be configurable, because thirty minutes is one
district's mandate and not every district's, and they were right. The risk in granting it
is the opposite of the one it fixes: a report that prints a window with no provenance lets
a reader take a default for a policy. So the flag moves the window, cannot remove it, and
the report names which of the two it used. Row 140 breaks the naming rather than the
window, because the number was never the part that could quietly become a lie.

Rows 60 to 65 were measured on 6 September 2026 and are the first ones written against a
gate rather than against the app. Rows 62 and 65 are why they exist. The first version of that gate
allowed any line naming the masking loop's own variable, so a loop rewritten to mask nothing
passed it while every embedded identifier went out whole. The gate was checking that code
mentioning the fields existed, not that it did anything. Row 62 survived, the gate was
changed to name the assignment exactly and to read the built page rather than only the
source that builds it, and row 62 then failed as it should. It is recorded here as a killed
row because that is what it is now, and the paragraph is the honest part.

Rows 73 to 75 are the last class of number in this repository that nothing could reach. Every
other figure here is computed by the program or counted out of a file, so drift fails the
suite. A figure from a government release is neither. One of them was simply wrong: the README
said England recorded 18.7% persistent absence in 2024/25, which appears nowhere in the DfE
release, where the published rate is 17.63%. It was found by reading the primary source, which
is luck and not a process. `evidence/statistics.json` now records each figure with its
publisher, its URL, the sentence it came from and the date it was read, and the gate refuses a
percentage in that section with nothing behind it. Row 73 is the original error, put back on
purpose to watch it fail.

Worth saying plainly: the correction had been made once already, in a working tree that was
lost before it was committed, and it came back. A fix that is not committed did not happen.

Rows 69 and 70 are a count gate that had been reading one file while two stated the number.
The app README's count has been checked since a first-time reader found it stale. The index file
next to the table was never covered, so it sat at "Forty-four test gates and eleven browser
gates" while the table grew to sixty-eight, and it stayed wrong through every run of the gate
written to catch exactly that. A checked number beside an unchecked one is the failure this
project is named for, and it happened twice in the same repository. Rows 71 and 72 hold the
alert rate, which is published as a percentage and is therefore two numbers divided: the gate
recomputes it from the page rather than reading it back.

Rows 66 to 68 cover the register of gates that cannot always run. A skipped test prints the
same dot a passing one does under `-q`, so a run where everything passed and a run where
two of them never executed look alike to anyone not reading `-rs`. The register names every gate that can skip and why, and
fails if a new one appears or a declared one stops skipping. It found three more than the run
did on its first execution, because those three skip only when no image is committed and this
tree has images. It also caught a name in its own declaration that belongs to no function in
the suite: I had copied it out of a skip message rather than out of the code.

Row 65 is the same lesson from the other side. The half of that gate which reads the built
page rather than the source had a `\b` in its pattern that a shell heredoc turned into byte
0x08, so it searched the page for a backspace character, found none, and passed. Rows 60 to
64 all passed while it was dead, because every one of them is caught by the source half.
Only a mutation that plants a whole identifier in the built artifact could tell the two
halves apart, and row 65 is that mutation. A gate with two halves needs a row per half.

Rows 127 to 132 are about the headers the page is served with, and they exist because a
browser cannot check the thing they check. The gate in `run.mjs` loads the page under its
own policy and counts what was refused, which catches a policy that is too narrow, and a
reader would see that as a broken page. A policy that is too wide refuses nothing. Granting
an origin the page stopped using, or falling back to `'unsafe-inline'` so that every hash
beside it becomes decorative, passes a browser check in silence. Row 132 is the largest
number in the table's recent rows and the least interesting: narrowing the header rule from
every path to `/index.html` breaks the shape every one of these gates reads the policy
through, so five fail at once rather than one failing usefully.

One mutation in that set is not in the table, because it was never measured. The change was
to put a second inline event handler on the page and see whether the gate that says there is
exactly one notices. It was written against `<body`, and this page emits no `<body` tag,
since HTML permits omitting it and the builder omits it. The replacement matched nothing,
the suite ran against an unchanged page, and the harness reported that the gate had missed a
defect which was never planted. A mutation that does not apply reads exactly like a gate
that failed. The harness now compares the file before and after and reports a third outcome
rather than counting a no-op as a miss, which is the same rule the gates themselves follow.
The row will be written when there is a measurement to put in it.

Row 57 is the only row in this table whose measured value is **zero on purpose**. Two other
kinds of zero exist and neither is this one. A zero can mean the change was made in the wrong
place, which is what every earlier zero in this project turned out to be. A zero can also mean
the gate did not run, which was true of rows 63, 64, 65, 71 and 72 on any checkout but this
author's: all five were held by a single test that reads `out/index.html`, a file built from
records of real calls and kept out of this repository on purpose. Rows 86, 87 and 88 are the
answer to that. They break the same builder and are caught by a gate that builds the page from
`tests/fixture_page.py`, which is authored, so a reviewer with no receipts can watch them fail.
The claim that the *published* page carries eleven real calls still needs the receipts, and it
is still declared as a gate that cannot always run. This one is
the finding: the privacy gate resolved its file set with `git ls-files` under
`apps/python/firstbell`, so `plugins/` had been outside it since the day that directory was
added, while `README.md` and `THIRD-PARTY-NOTICES.md` both stated that every number in this
repository is checked. Row 58 is the same planted number after the scope was widened. The
pair is the proof, and neither row means anything without the other.

## Why these rules and not others

They are not a sample. They are every rule in this app that decides something a person
would otherwise have to check by hand:

- **1 and 2** are the two safety limits. CALL-E has no cancel endpoint, so the concurrency
  cap is the only brake that exists, and consent is the only thing standing between a work
  file and somebody's phone.
- **3** protects the double's fidelity. A double that accepts what the real service rejects
  gives a false pass to everything built on it.
- **4, 12 and 13** protect claims this project makes about *itself*: which host it dialled,
  and whether it placed a call or replayed one. Getting those wrong would mean publishing
  evidence of something that did not happen.
- **5** protects a parent's words from ending up in a git history.
- **6 and 7** are about what an office reads at eight in the morning. `603` is a lookup
  task, not a reason.
- **8, 9, 10 and 11** are the classification rules, and three of the four exist because a
  real call proved the original version wrong. See `evidence/README.md`.
- **23 to 26** protect the first screen, which is the only part of this directory most
  readers will see. 26 is the one worth explaining: the first version of that mutation
  deleted the anchors badly and left them in place, so the suite stayed green and the gate
  looked weak when the mutation was at fault. Deleting the section properly fails two
  tests. The check asserts a minimum number of anchors as well as their correctness,
  because a rule that says "every citation resolves" is satisfied by having none.
- **33 to 37** came from a review and from one self-inflicted wound. 33 is the strange
  one: a backspace byte written into a regex by a shell heredoc, which left the file
  parsing, the pattern compiling, and the match silently never happening, while every tool
  that could have shown it rendered the byte as nothing. 34 to 37 are the classification,
  reuse, duplicate-id and clock-skew defects, and the common shape is a wrong answer given
  confidently: an unclassified error code failing silently, a second run inheriting the
  first one's cancellation, two items sharing an idempotency key so one answer is filed
  against both, and clock skew read as proof that no phone rang.
- **30 to 32** are the three this project got wrong in public and had to be told about.
  30 is the one worth reading twice: a screenshot of the evidence page was committed here,
  displaying twelve real call ids and twelve real billing ids, and every privacy check
  passed it, because a text scanner cannot read a picture. The gate that replaced it
  compares committed images byte for byte against the renders made from the recordings,
  which is the way it actually happened rather than the way it might. 31 and 32 came from
  a review that reproduced both: a number arriving from the vendor's own error text, and a
  call that was placed being reported as a call that never happened.
- **27 to 29** protect the double's likeness to the thing it stands in for, which is the
  load-bearing assumption under every other number here. They were added after a shape
  comparison against recorded production responses found the double wrong in four places
  at once: it omitted four task-level fields the API always returns, it put the extracted
  result where nothing had asked for it, it spoke its own vocabulary on an attempt where
  the API sends a numeric SIP code, and it gave a failed attempt a duration where the one
  recorded failure had none. 29 fails seven tests, two of which are about the
  words an administrator reads, so the divergence reached the product and not just the
  fixtures. None of the twenty-six gates before them noticed any of it, because all
  twenty-six were measured against the same wrong model.
- **19 to 22** protect the one arithmetic claim this app makes about money. 19 is the
  important one: the difference between charging for every call and crediting only the
  records actually closed is the difference between an honest ratio and a brochure. 20
  keeps could-not-compute from collapsing into a number that reads as free. 22 holds the
  wage to the same sourcing rule as the funding rate.

## One thing the count includes that you should discount

A mutation that adds or removes a line moves every line after it, and this README cites
four exact line numbers that a test checks. So such a mutation trips that test as well as
whatever it was aimed at, and the count in the third column is one higher than the number
of tests that noticed the *behaviour*. Row 36 is the only one where this happens: of its
two, one is the duplicate-id rule and one is the line-anchor check.

The counts here were measured by applying each mutation and running the suite, not
estimated. Four of them were written down as ones before being run, and one of those four
was wrong, which is the whole argument for measuring in the first place.

## The fifteen browser gates

`tools/gates/run.mjs` measures the reviewer page in Chrome, and the rule is the same: a
gate nobody has watched fail is a gate nobody has tested. These are not in the table above
because they fail as a gate rather than as a count of tests.

The thirteenth is the only one that does not load the page bare. The deployment sends the
page with headers derived from its own bytes, so that gate serves it the same way and counts
what the browser refused.

The fourteenth is `document pages`, and it exists because five pages went up with nothing
over them. Somebody coming to it as a district operations director found that the two
documents deciding whether they would run a pilot were reachable only by cloning the
repository, so the build began rendering `docs/` into pages. Publishing five unchecked pages
on a site arguing that every claim carries the thing that checks it would have answered one
complaint by earning a worse one. It reads them with the same probe the main page is read
with, and the overflow gate was widened to walk them at the same time.

The fifteenth is `animated figure`, and it is the one that was passing on nothing. The page
carries an animated version of the three-endings drawing, and it had never once played for
anybody: the policy this build derives closes `connect-src`, because the page places no
network call, and the player was reading its data from a URL. The browser refused the only
request it made. Nothing looked wrong, because the still is the fallback and the still is
correct. Fixing the fetch then exposed a second defect underneath it, that
`element.hidden = true` is a property of HTMLElement and the still is an SVGElement, so the
assignment set no attribute and the still stayed in the layout beside the animation.

Neither was visible to the gates that existed. `cls` scores this 0.00000 and attributes no
source node, because the figure mounts two hundred pixels before it enters the viewport and
CLS counts only shifts a reader can see. So the new gate asks the three questions directly:
did the player mount, do two frames eight hundred milliseconds apart differ, and did the
figure, the stage or the key change size. All three were confirmed by breaking them: the
data put back behind a URL, the still hidden by the property SVG does not have, and the
mount sized to twice the still. Rows 145 to 147.

The twelfth is `overflow`, and it is the one that was missing rather than the one that was
added. The document was wider than the window at 1152 and at 390 CSS pixels, which is a
sideways scrollbar on an ordinary laptop, and every other gate passed on that build without
noticing: weight, contrast, the rail and the keyboard all read the same whether the page is
1152px wide or 1545px wide inside a 1152px window.

| The change | What the gate said |
|---|---|
| Append a 120 ms busy loop to the built `app.js` | `long tasks` FAIL, over the ceiling on 10 of 10 loads, worst 144 ms, and it named the phase: `144 ms at 180 ms during load` |
| Ship one shared fallback family for two real faces, which is how the page was built until this was fixed | `cls` FAIL at 0.00961 against a 0.001 ceiling, naming `span.switch` and a node that had been removed |
| Let the rail listen only for acts arriving and not for acts leaving, which is how it worked until this was fixed | `rail` FAIL, `at 0px it marks act-01, expected act-00` |
| Serve the page with the font host reachable but the kit unparsed | `cdn loss` reports what it aborted and how many acts survived |
| Leave the transcript dimmed with nothing to play, which is how it shipped until this was fixed | `contrast` FAIL, 21 of 285 runs under AA, naming the opacity: `1.75 needs 4.5 (12px, painted at 0.42)` |
| Let `.switch` clip the focus ring again, which is how it shipped until this was fixed | `keyboard` FAIL, `button its ring is clipped by span.switch (overflow hidden/hidden)` |
| Put the playhead back to role=img with no tabindex, which is how it shipped until this was fixed | `keyboard` FAIL, `2 pointer target(s) the keyboard cannot reach` |
| Strip the playhead's aria-label | `keyboard` FAIL, `2 control(s) with no accessible name` |
| Read the breakpoint once at parse time instead of asking it live, which is how it shipped until this was fixed | `viewport` FAIL in both directions: `widened, foot: the rail reads 0% at the foot of the page` and `narrowed, past the curtain: the hero is not sticky yet sits at 0.491 opacity, faded for a pin that is not holding it` |
| Stop recomputing the hero's resting position on resize | `viewport` FAIL, `reshaped, top: the hero rests at -332px where -186px reaches its last line` |
| Serve the playhead as `role=slider tabindex=0` before any script can back it, which is how it shipped until this was fixed | `no javascript` FAIL, `2 element(s) claim to be operable with no script to operate them: canvas[data-waveform] in act-00 says role=slider, canvas[data-waveform] in act-03 says role=slider` |
| Take `overflow-x: auto` off the two scrolling boxes, which is how the page shipped until this was fixed | Two gates at once. `overflow` FAIL, `at 390px the document is 582px wide, widest is table.ids reaching 582px. at 1152px the document is 1264px wide`; and `no javascript` FAIL, `2 element(s) claim to be operable with no script to operate them: div.scrollbox in act-04 takes tabindex=0, div.scrollbox in act-05 takes tabindex=0`. The second failure is the point: a box that has stopped scrolling has also stopped being operable without script, so the exemption that lets it carry `tabindex` cannot be claimed by a div that does not scroll |
| Let the one-column `.split` track go back to implicit `auto`, which is how it shipped until this was fixed | `overflow` FAIL, `at 390px the document is 582px wide, widest is div.claim reaching 582px` |
| Drop `https://p.typekit.net` from `style-src`, which is how the build first derived the policy until this was fixed | `the page under its own Content-Security-Policy` FAIL, `style-src-elem refused https://p.typekit.net/p.css` |
| Drop the inline stylesheet's hash, all 39 KB of it | Same gate, FAIL, and it says what a reader would see rather than what the browser said: `the inline stylesheet was refused, so the page renders unstyled` |
| Drop `https://cdn.jsdelivr.net` from `script-src` | Same gate, FAIL, `script-src-elem refused https://cdn.jsdelivr.net/npm/lenis@1.1.18/dist/lenis.min.js` |
| Drop `'self'` from `script-src`, leaving the page's own module unreachable | Same gate, FAIL, `script-src-elem refused http://127.0.0.1:60008/app.js` |
| Drop `'unsafe-hashes'` and the handler's hash, so the one inline handler on the page stops matching | Same gate, FAIL, `script-src-attr refused inline` |
| Point the document pages' back link at `index.html` rather than `../index.html`, so every one of the five is a page a reader cannot leave | `document pages` FAIL, naming all five: `locale-is-not-only-a-hint links back to index.html; proving-a-gate-fires links back to index.html; ...` |
| Set the line explaining why a document is worth opening in an ink nobody measured | `document pages` FAIL, `p.doc-why 1.51 needs 4.5`, on four of the five |
| Put a script on the document pages, which is the one surface here the escaping gate does not read | `document pages` FAIL, `carries 1 script tags and should carry none`, on all five |
| Widen `overflow` from `index.html` to every page the deployment serves, which is how the five document pages shipped an hour before this ran. Nothing was broken to produce it | `overflow` FAIL on its first run: `/docs/receipt-provenance.html at 390px is 397px wide`. A filename set in code inside a paragraph set the paragraph's minimum width. It was already true of five pages that had gone up an hour earlier |

Eleven of those twenty-two are the state this page was actually in, not a change invented
to trip a gate, and each of the eleven says so in its own row. The CLS failure, the rail, the dimmed
transcript, the clipped focus ring, the playhead no keyboard could reach, the frozen
breakpoint, the slider that only existed once a script arrived, the two tables that pushed
the document sideways and the implicit grid track underneath them were all found this way,
and all of them are fixed. The tenth is the refused stylesheet, and it is the newest: the
build derives the page's policy from the page's own bytes, so the two agree by construction,
and the first policy it derived was still wrong. The Typekit sheet imports a second sheet
from an origin the markup never names. Reading the page could not have found it and the
browser found it on the first load, which is the whole argument for measuring a policy
rather than reasoning about one. The long task is not among the ten: that row appends a busy
loop nobody ever shipped, which is the other kind of row and the reason the two are counted
apart. The eleventh is the last row in the table, the one that widened `overflow` to the
document pages and failed immediately: seven pixels of a filename, on a page that had been
public for an hour.

`no javascript` used to count acts and words, which answers whether the page can be *read*
without a script and says nothing about whether it also claims to be *operated* without one.
The waveform was served as `role=slider tabindex=0` with a label recommending the arrow
keys, and with the script off it is 601x72 of canvas with zero opaque pixels that no key can
move. The rule the gate applies now is decidable from the markup alone: a native control
keeps working with no script behind it, so `button`, `a[href]`, `input`, `select`,
`textarea` and `summary` may say what they are, and anything else taking an interactive role
or a tab stop is asking for a script that has not arrived. The page ships the canvas inert
and `CallPlayer.upgrade()` promotes it in the same breath as the key handler.

The `viewport` gate exists because two defects in a row came from geometry decided once and
then relied on for the rest of the session: a resting position computed at wiring, and a
media query read at parse time while the stylesheet went on asking it at every width. The
other ten gates load at one size and stay there, so neither was visible to any of them.

Its oracle is the stylesheet. Whether the hero computes to `position: sticky`, and whether
the rail computes to a display other than `none`, are decided by CSS alone at whatever
width is current; everything the gate asserts is a consequence the script owns. The code
runs the other way round, asking the query and writing the consequence, which is what lets
the two disagree.

The second mutation above is worth the space it takes. The gate passed it at first. Its
three cases all stepped over the breakpoint, and turning the sticky rule on recomputes the
resting position as part of the transition while turning it off deletes it, so no case ever
reached the check that the hero can still scroll to its last line. A fourth case that
resizes from 1440x900 to 1600x1100, staying on the desktop side throughout, was the repair,
and it is the gate that was wrong rather than the page that was right.

The `keyboard` gate is worth one note on how it measures. `:focus-visible` is a heuristic
and a browser can decline it for focus a script assigned, so the gate presses Tab rather
than calling `focus()`; measuring the other way reported two of three controls as having
no indicator when they were fine. And it checks whether the ring's rectangle fits inside
every ancestor that clips, rather than reading `outline-width`. The language switch had
`outline: 2px solid` in the stylesheet and a two-pixel sliver on the screen, because
`.switch` sets `overflow: hidden` so its two buttons share one frame and the ring is drawn
outside a button that fills it.

The `contrast` gate found the two worst things on this list, and they are the same bug
twice. The transcript dims every line that is not the one being spoken; the result panel
stays behind a curtain until the call it belongs to ends. Neither event can happen now the
recordings are out of the repository, so the transcript sat at 0.42 opacity and the
structured result at 0.35, permanently, at 1.07 and 1.74 against their own grounds. Those
are the two artifacts this page exists to show. Both were sent by the server at full
strength and dimmed afterwards by script, so a reader with JavaScript switched off could
read them and a reader with it on could not.

Three things decide whether a contrast checker measures anything. Colours must go through
the browser rather than a parser, because this page is authored in `oklch()` and a checker
that reads `rgb()` skips every one of those and calls the remainder a clean sweep. Opacity
must count as part of the colour, or neither defect above is visible at all. And the
backdrop must come from a hit test rather than from walking parents, because the rail is
fixed and floats over whichever section is under it. Getting the third one wrong produced
a ratio of exactly 1.00 on every affected element, which is what that number means when
you see it: the probe compared a colour with itself.

There is a fourth, and it is the one that reads as a clean result rather than as an error.
The gate has to be able to reach the run, and it has to say so when it cannot. Three separate
things were hiding behind a `PASS` that ended `42 could not be resolved to a colour and a
ground`, and the 42 was the only visible symptom of any of them.

The first is the honest one. Those 42 were transcript turns scrolled out of `ol.turns`, which
scrolls on its own, and a page-level scroll never moves it. The gate now steps every internal
scroll box through its own range. The far end has to be an explicit stop: a loop that runs
while `at <= furthest` stops at the last whole step, so a range that is not a multiple of the
step keeps its final screenful hidden, which is where the last two of the 42 were.

The second is that the count could not have caught anything else anyway. A run whose centre is
off screen was skipped with a bare `continue`, leaving no row, so runs the probe never reached
did not move the number. `unmeasured: 0` meant "none of the ones I looked at". There is now a
census of every text run on the page, taken by the probe's own rules minus the on-screen test,
at every stop the probe is taken at rather than at two fixed positions, because this page
reveals acts on scroll and a run hidden at the top and at the foot is present in between.
Anything in the census the probe never reached is reported, with the reason. Blinding the
probe to the transcript is the check: without the census that mutation prints `all 595 text
runs clear WCAG AA` and nothing unresolved, with 81 runs of real text read by nobody. With it,
the same mutation prints the 81.

The third was found by the census and is the largest. A run was identified by its class and
the first thirty characters of its text, so any two elements sharing both were one run and only
one of them was ever measured. The playback clock exposed it from the other side: `0:25 / 0:59`
and `0:29 / 0:59` are one span whose digits move, and each unseen reading arrived as a run
nobody had measured, which is why that count came back 1 on one run and 3 on the next. A run is
now identified by which element it is, as a path from `body`, and not by what that element
currently says. Keying on the class instead would have been worse: the register's ids differ
only in their digits and those really are separate runs on separate rows.

Together those took the gate from 634 measured runs with 42 unresolved to **928 measured with
none unresolved**, against the same page and the same 4.5 floor, closest 4.62. The 250 runs in
that difference were never wrong. They had never been looked at, and nothing said so.

The `rail` gate is the one to read if you only read one. The page decides which act you
are in by hit-testing what is painted at the middle of the viewport. The gate decides by
measuring each act's document offset once at the top of the page and doing arithmetic. If
the gate asked the page's question it would agree with the page by construction and pass
whatever the page did, which is the failure mode that let this bug live: nothing measured
the rail at all, so it was right on the way down and wrong on the way back for as long as
the rail has existed.

The `screenshots` gate now checks what is in the file rather than counting files. It had
been writing `desktop-act-00.png` as a picture of acts 01 and 02 since the shots began,
under the old pinned hero and under the CSS sticky one, because the capture loop ran from
the bottom of the page and `scrollIntoView` does nothing to an element already on screen.
Eighteen files existed, so the gate passed.

Two gates are worth reading for how they are wrong rather than for what they catch. `cls`
takes five samples and judges the worst, because the same build measured 0.00133 and
0.00961 and 0.00005 on consecutive runs, and one sample of that is a coin toss. `long
tasks` did take one sample: it reported a task of 133 ms and, an hour later on identical
code, none, so it passed and failed the same commit. It takes five now. Its message also
used to say every task it found happened "during a full scroll after load" while it was
collecting buffered entries from the load itself, which is where the one real task was.

## What is not covered

Rows 185 to 188 are about links, and they exist because the site had eight dead ones while
fifteen gates passed. Every gate opened the pages a judge lands on and none of them
followed a link off one, so the documents published to answer a reviewer's complaint were
themselves 404ing on every citation they made. Rows 185 and 186 are the two ways that
happens: a link written for the repository tree, and an anchor into a section that was
renamed. Row 187 is the gate's third outcome, because a link checker that ignores the
schemes it did not anticipate reports on the links it happened to understand.

Row 188 is a different animal and it was found by accident, while planting row 186. The
rail gate reads the destination of every rail link and measures it, so an anchor naming a
deleted element threw a TypeError, the run stopped at gate seven of sixteen, and
`gate-report.json` was never written. The suite went red, which is the part that worked.
Nothing said which gate had found the defect, and the nine gates after it never ran. Each
gate is now called through a wrapper that turns a throw into a recorded
could-not-measure, so the run finishes, the report exists, and the outcome is still not a
pass.

Rows 189 to 193 are the consent record, and 193 is the one worth reading. The refusal
carries the register's own sentence after the reason, so `reason == NO_CONSENT` stopped
matching and a family who had withdrawn consent was counted in neither the consent bucket
nor any other: the row landed in `skipped_not_dialled`, which is the bucket for a run
somebody cancelled. The count was right, every total added up, and one family's withdrawal
was reported as a scheduling artifact. It was found by writing the test rather than by the
suite, because nothing before it had two reasons that both meant the same thing.

Rows 194 to 201 are the district's own export and the household grouping, and 195 is the
one to read. OneRoster and Clever both carry `phone` and `sms`, and neither carries a
column saying a guardian agreed to be telephoned by an automated system about an absence,
because contactability is a fact a system of record holds and permission is not. Turning
off the check that notices that does not produce an error: it produces a run that
telephones every family in a district's export on the strength of a column that says how
to reach them. Five tests fail, and the reason five rather than one is that the refusal is
also the sentence the reader is shown, and three of those tests are about the sentence.

Row 199 is the quiet one. Dialling the last row of a household instead of the first still
places one call per household and still holds two rows, so every total in the run is
identical and the arithmetic checks out. What changes is which child the call is about,
and a district reconciling a receipt against the file it exported finds the run answered
about a row it did not expect. Six tests fail, which is more than any other row here, and
that is only because the ordering was written down as a decision before it was written as
code.

Rows 202 to 205 are about who picked up the telephone, and 203 is the one that says
something about this project rather than about the code. The careful-looking mutation is
the wrong one: reading a call that recorded nothing as a call answered by a non-guardian
holds more records for a person and looks like the safe direction. It is not safe, it is
false, and seven tests fail on it. A call that did not say who answered did not say. The
run counts those separately and prints the count, and that number is the exposure a
district is being asked to accept rather than one this software gets to resolve on its
behalf.

Rows 206 to 208 came from a seat reading the code rather than from this ledger, and 206 is
the one to be uncomfortable about. `calls_placed` sums `attempts_made`, and it printed as
"calls placed 8" six lines under "attempted 6" on a run that dialled six rows. The
arithmetic was right the whole time: the break-even divides attempts removed by attempts
billed, and both sides were attempts. One word was wrong, on the first thing anybody runs,
and the gate that guards the printed block asserts the README matches the program, so the
wrong word was copied into the README and then held there by a passing test. Four tests
fail on it now, and none of them existed before somebody found it by reading.

A fourth mutation was planted and not caught, and it is recorded here rather than fixed:
removing a `None` check from the worst-case ceiling comparison in `tools/judge_page.py`
changed nothing, because that arm is unreachable with `None` once the branch above it
exists. The check was deleted instead of a test being written for it. An unreachable guard
reads as protection and provides none, and the way it announces itself is exactly this: a
mutation nothing notices.

Rows 209 to 214 are the number the permission attaches to. A district's data protection
officer pointed out that the record names a pupil while the row carries two telephone
numbers and the run works down them in order, so a permission covering the first number
used to authorise a call to the second. 209 and 210 are the check and the reason it
compares digits: a register a person maintains writes `+91 555 000 0001` and the export
beside it writes `+915550000001`, and a check strict about punctuation would refuse real
families about real absences.

211 and 214 are the two worth reading. 211 was planted, survived, and was killed by fixing
the test rather than the code. Refusing `phones` given as a string was already covered by
the next line down, which refuses anything that is not a list, so deleting the specific
branch changed the sentence a person reads and nothing a test looked at. The test asserted
the phrase both messages share. It now asserts the part only the specific branch says,
which is why a comma-joined string read as one telephone produces a record covering a
number nobody has.

214 is a guard this ledger would have called decorative a week ago. `summarise` already
drops skipped rows from the exposure count, so recording a refused row as exposure printed
the same number and was still false. The mutation is caught because the test went in at the
source, which is the layer holding the record, rather than at the count where the mistake
happens to cancel. An unreachable guard reads as protection and provides none: row 208's
note above is the same lesson learned the other way round, by deleting one.

Rows 215 to 222 are the second documented way of running this, and the citation check that
was checking the wrong thing. 215 is the one to read first: a link relinker chose between a
`tree` and a `blob` URL by asking whether the target was a directory, and never asked
whether it was there, so a mistyped citation became a well-formed permanently missing page
on a site whose argument is that its citations resolve.

216 to 222 are the double behind real HTTP. That path was documented, was never tested, and
did not work: the server bound no scenario, so every recipient got the double's fallback
answer and the application reported every row as a missing required field. Three of these
eight were planted, survived, and were closed by writing the test rather than by arguing
the mutation was unfair. 220 is the reason: every test bound the scenario by calling
`load_outcomes` in process, which is the one thing a reader following the README will not
do, so taking the flag and binding none of it failed nothing. The test that closes it runs
the documented command as a subprocess. 221 was an unexercised `--check`, which is the shape
of every stale generated artifact in this project's history: the checker was never asked to
check something wrong. 222 was a default nothing exercised, because the exporter always
writes the field.

Two things happened while measuring these that are worth more than the rows. A scenario
refusal first tried to raise the double's own `DoubleError`, whose constructor asserts the
code is one production actually sends; it fired, correctly, because a file with a typo in it
is a configuration problem and not an API response. And the test for 220 hung the first
mutation run: it read the server's banner until the line it hoped for, `readline` has no
timeout, and on the run where nothing was bound that line never came. A test that hangs is
worse than a test that fails, because it takes the measurement down with it. It now reads
until the line the server always prints last.

The counts for 220, 221 and 222 were measured over the four test files that can reach the
code they change (83 tests) rather than over the whole suite, and that scope is stated here
because a count with no scope beside it is the defect this ledger keeps finding elsewhere.

223, 224 and 225 are one hole in three places. The number check compares digits, which is
what makes `+1 555 010 0301` in a register and `+15550100301` in a work file one telephone.
Strip the digits out of `unknown` and nothing is left, and nothing equals nothing, so a
record holding `unknown` covered a row carrying `unknown` and the row was dialled on a
permission that names no telephone. District exports do write `unknown`, `n/a` and `none`
into a phone column, so this arrives rather than being invented. The decision refuses it,
both loaders refuse it before the decision is reached, and 223 is kept as a separate row
because a guard that depends on its callers validating first is one a fourth caller
removes. The three counts were measured over `tests/test_consent_record.py`, the 42 tests
that can reach any of it.

226 is the same shape one layer along. `mask_id` keeps the two ends of an identifier and
destroys the middle, and for a body of four characters the two ends are the whole body: it
published the identifier entire, and for a body of three it printed `ab…bc`, repeating a
character to fill the mask. Nothing in this repository reaches it, because a CALL-E call id
is 26 characters and a provider id is 32. The number masker in `dispatch/models.py` has
always refused this, showing nothing of a value below the length at which the ends hide
something, and the identifier masker refuses it now for the same reason. Counted over the
15 tests in `tests/test_privacy.py`.

227 is the third of the same kind, in the scenario file a consumer of the double writes.
`answers_on` is an index into the recipient's phones, the dialler compares it against 0, 1
and 2 as it works down the chain, and a negative index is equal to none of them, so `-1`
meant nobody picked up on any number. Somebody writing `-1` means the last number, and
what they got back was a run that looks like a product defect rather than a file that
needs one character changed. An index past the end still means nobody picks up, because
how many numbers a recipient has belongs to the request and not to the scenario, so a file
cannot be checked against it when it loads, and the docstring says so. Counted over the 71
tests in the three files that exercise the double.

228 is on the authorisation log, which is the artifact a district reaches for when a parent
rings up and asks why they were telephoned. Each row already named the record that
authorised the call; the mutation makes every row claim the record named the number that
rang, which is true of one row in the shipped example and false of another. Consent
attaches to the number called, so a log that says which record authorised a call and not
whether that record named the telephone answers half of the only question it exists to
answer. Counted over the 43 tests in `tests/test_consent_record.py`.

One change this session was caught by the builder and by no test, and it is left out of the table rather than entered as a zero, because a zero here means a gate that was not guarding what it claimed and this is not that. Retyping one character of a `ta` line inside `tools/glosses.json` makes `tools/judge_page.py` exit 1 and refuse to write the page, saying the transcript changed under the gloss. No test fails, and the reason is worth knowing: the line in question is the opening announcement, `S-4108` opens with the same sentence, so the quotation in `docs/the-legal-surface.md` is still exactly a line of a committed transcript. Two gates were watching and the cheaper one had nothing to say.

Mutation testing shows a test notices a change. It does not show the test is testing the
right thing, and it says nothing about the rules nobody thought to write. The two defects
found in this project during live calls were both of that kind: not a rule that failed, but
a case the design had not imagined. Both were found by placing a call, not by reasoning
about the API.
