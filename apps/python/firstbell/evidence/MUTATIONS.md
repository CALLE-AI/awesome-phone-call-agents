# Every gate, broken on purpose

A test that has never been observed to fail has not been shown to test anything. Each row
below is a change made to working code to check that a specific test notices. Every one
was reverted and the suite returned to green.

Reproduce any of them by making the change and running `python -m pytest tests/ -q`.

Three of the gates watch what the program prints rather than any one rule:
`test_the_readme_sample_is_what_the_program_actually_prints`,
`test_the_prose_numbers_match_the_program_too` and
`test_the_demo_run_shows_all_three_outcomes`. Any change that alters the demonstration's
output fails those as well as the test belonging to the rule, so a count here can be larger
than the number of tests written about the rule itself. That is the honest number and it is
what this column reports: row 2 says five because disabling consent breaks two consent
tests and all three of those.

A count also grows as the suite does. Row 2 read three until it was re-measured, having
been written when fewer of the output gates existed, which is the same drift that put stale
line numbers in the proof images. Reproducing a row and getting a larger number is that,
not a disagreement about the rule.

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
published before it was verified, and verifying it is what found them.

Rows 45 to 59 came later and are not part of that count. They were measured on 6 September
2026 as they were written, each applied and run before the row describing it existed, so none
of them was ever a published number waiting to be checked. None of the ten
changed whether a gate fires, which is what the table is for. All ten changed how loudly it
fires, which is what a reader would have checked us on.

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
| 2 | `if not item.consented:` becomes `if False:`, disabling the consent gate | 5 |
| 3 | Drop `insufficient_balance` from the double's `API_ERROR_CODES` | 4 |
| 4 | Match the production host by substring instead of hostname, so `api.heycall-e.com.example.net` passes | 1 |
| 5 | Write the transcript into every receipt instead of only when `--include-transcript` is given | 1 |
| 6 | Prefer the attempt's raw SIP code over the task's symbolic one, putting `603` in front of an administrator | 1 |
| 7 | Delete the SIP translation table, so a queue row reads `the call failed with 603` | 3 |
| 8 | Stop falling back to the task-level `structured_result`, which is the defect a real call exposed | 20 |
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
| 20 | Report a break-even of `0.00` rather than nothing when a run billed no attempts, turning could-not-compute into a free-looking number | 3 |
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
| 32 | Leave the completion poll unprotected, so one failed read discards a call that was placed | 2 |
| 33 | Put one backspace byte inside a committed source file, which no editor or diff displays | 1 |
| 34 | Leave a real CALL-E error code in none of the three classification sets | 1 |
| 35 | Let one dispatcher instance run twice, inheriting the first run's cancellation | 1 |
| 36 | Accept two work items sharing an id, so one idempotency key covers both | 2 |
| 37 | Read a service clock an hour behind ours as a definite replay rather than unknown | 1 |
| 38 | Write the structured result to the receipt unmasked, which is how it shipped until this was fixed | 1 |
| 39 | Drop the comma from the separator class, so a number a vendor groups with commas is left whole | 1 |
| 40 | Let a `calls.create` timeout fall through to the catch-all, which is how it shipped until this was fixed: no retry, and a call that may have been placed recorded as FAILED | 1 |
| 41 | Cite in `docs/images/README.md` the line the caption used to name, which is how both stills shipped | 1 |
| 42 | Type a window bound back into the still generator instead of looking it up | 1 |
| 43 | Accept `RetryPolicy(max_attempts=0)`, whose create loop never runs, so every item comes back FAILED with an empty reason about a run that dialled nobody | 1 |
| 44 | Stop escaping `<` in the JSON embedded in the page's `<script>` block, so a transcript turn containing `</script>` ends the data early and the rest of the page is parsed as markup | 1 |
| 45 | Delete the refusal that keeps a production key off every origin but `https://api.heycall-e.com`, so `CALLE_BASE_URL` can send the live bearer token to any host that is listening | 1 |
| 46 | Invert that refusal so it stops every destination, which would leave a tool that can never place a real call | 1 |
| 47 | Compare the base URL by hostname again instead of by origin, so `http://api.heycall-e.com` is filed in the receipt as an ordinary live call | 1 |
| 48 | Drop the scheme when normalising an origin, so a plaintext destination compares equal to the trusted HTTPS one | 1 |
| 49 | Make `safeguarding_escalation` return `NONE` for everything, so a parent who did not know their child was absent is filed automatically | 14 |
| 50 | Ask the rule whether the answer is `no` rather than whether it is `yes`, which closes the missing and the `unknown` case as though either were a confirmation | 5 |
| 51 | Derive `ItemResult.needs_a_human` from the resolution alone again, so an escalated case never reaches the human queue | 7 |
| 52 | Stop sorting the queue, so a safeguarding case can sit below every ordinary callback and be reached last | 4 |
| 53 | Compute funding recovered from `resolved` rather than `closed`, so the money figure rises every time a child cannot be accounted for | 2 |
| 54 | Compute the resolution rate from `resolved` rather than `closed`, so the headline improves when the app finds something serious | 3 |
| 55 | Fail open when a caller's escalation rule raises, dropping the case the rule was written to catch on the one run where the rule was broken | 2 |
| 56 | Drop `escalation=` from the schema-valid branch, so the flag is computed correctly and then not carried | 7 |
| 57 | Plant an assignable Indian mobile in `plugins/firstbell-absence-calls/` with the privacy gate scoped to `apps/python/firstbell` as it was, which is the state this contribution shipped in | 0 |
| 58 | The same number with the gate scoped to every path this contribution adds | 1 |
| 59 | Point `CONTRIBUTION_PATHS` at a directory that no longer exists, which is what a rename looks like from inside the gate. Reported as 10 errors rather than 10 failures, because the guard sits in the helper every one of them calls | 10 |

Row 57 is the only row in this table whose measured value is **zero on purpose**. Every other
zero in this project's history meant the change had been made in the wrong place. This one is
the finding: the privacy gate resolved its file set with `git ls-files` under
`apps/python/firstbell`, so `plugins/` had been outside it since the day that directory was
added, while `README.md` and `THIRD-PARTY-NOTICES.md` both stated that every number in this
repository is checked. Row 58 is the same planted number after the scope was widened. The
pair is the proof, and neither row means anything without the other.

## Why these fifty-nine

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
  comparison against recorded production responses found the double wrong in three places
  at once: it omitted four task-level fields the API always returns, it put the extracted
  result where nothing had asked for it, and it spoke its own vocabulary on an attempt
  where the API sends a numeric SIP code. 29 fails six tests, two of which are about the
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

## The eleven browser gates

`tools/gates/run.mjs` measures the reviewer page in Chrome, and the rule is the same: a
gate nobody has watched fail is a gate nobody has tested. These are not in the table above
because they fail as a gate rather than as a count of tests.

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

Nine of those eleven are the state this page was actually in, not a change invented to trip
a gate. The CLS failure, the long task, the rail, the dimmed transcript, the clipped focus
ring, the playhead no keyboard could reach, the frozen breakpoint and the slider that only
existed once a script arrived were all found this way, and all of them are fixed.

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

Mutation testing shows a test notices a change. It does not show the test is testing the
right thing, and it says nothing about the rules nobody thought to write. The two defects
found in this project during live calls were both of that kind: not a rule that failed, but
a case the design had not imagined. Both were found by placing a call, not by reasoning
about the API.
