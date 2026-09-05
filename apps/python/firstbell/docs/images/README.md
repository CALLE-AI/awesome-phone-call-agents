# Judge-facing images

The rules for this event say a judge "may choose to judge based solely on the text
description, images, and video." This directory is what exists for the images half of that
sentence. Everything here was generated from the repository, not typed by hand, for the
same reason `tools/judge_page.py` reads `evidence/` instead of describing it: a caption that
was not produced from the thing it describes goes stale the moment either one changes.

| File | Shows | Produced by |
|---|---|---|
| `proof-call-site.png` | The exact line that calls CALL-E, boxed, with file and line number | `node tools/gates/capture-stills.mjs` |
| `proof-terminal-outcomes.png` | A real offline run producing all three outcomes: resolved, undetermined, failed | `node tools/gates/capture-stills.mjs` |
| `proof-classification.png` | `_classify()`, the one function that turns an API response into an outcome | `node tools/gates/capture-stills.mjs` |

## Regenerating everything

```bash
python tools/judge_page.py out                     # builds out/, no audio
cd tools/gates && npm install                      # once
node run.mjs                                        # writes tools/gates/shots/*.png
node capture-stills.mjs                             # writes the three proof-*.png
```

`run.mjs` serves `out/` over gzip and drives system Chrome through `puppeteer-core`; its
screenshot gate writes one PNG per section of the evidence page to `tools/gates/shots/`,
none of which is committed. Nothing in this directory comes from it.

`capture-stills.mjs` is a separate script; it does not modify `run.mjs`. The two code stills
read the exact bytes of `dispatch/scheduler.py` at the line ranges they show, and the
terminal still runs `python -m firstbell --work-file examples/absences.csv` itself and
captures its real stdout. Nothing in any of the three is retyped from memory.

## What is not here, and why

`tools/gates/shots/` holds one screenshot per section of the evidence page, in two
viewports, 18 files total. None of them are committed, for two reasons found while building
this set:

1. The evidence page is built from the call recordings, so every screenshot of it is a
   real-call artifact in a format no text check can read. That is not a judgement call: one
   of them, showing twelve real API call ids and twelve real thirty-two-character billing
   ids in a table, was committed to this repository and passed every privacy check in
   `tests/test_privacy.py`, because a PNG is not text. It has been removed, and
   `test_no_committed_image_was_rendered_from_the_call_recordings` now byte-compares every
   committed image against the renders made from the recordings. Mutation 30 is that gate.
2. The screenshot for a given section is taken by scrolling that section's element into
   view and screenshotting its bounding box. On this page, sections pin and transform during
   scroll (the whole point of the scrollytelling build), and at least one such screenshot,
   named for one section, was measured showing the content of the two sections after it
   instead. That is a real property of the current build, not a one-off, and it means a
   filename in that directory cannot be trusted to describe its own content without opening
   the file.

An image is committable here because of where its content came from, not because someone
looked at it and thought it seemed fine. `capture-stills.mjs` reads source files and runs
the offline CLI, and `test_the_tool_that_makes_the_stills_cannot_see_a_recording` fails if
it ever reaches for the receipts directory, the deployed page, or the built page under
`out/`. Reviewing a picture is the only way to check its content, and the three checks in
`tests/test_privacy.py` exist because that review is the step which failed once already.

## Verification

Every image in this directory was opened and checked, individually, for:

- no API key or credential of any kind
- no phone number
- no real person's name (the pupil names visible anywhere on the built page are fictional,
  stated as such in the page footer and in `README.md`)
- no call transcript text

No line number in a caption is typed. `capture-stills.mjs` finds each landmark in
`dispatch/scheduler.py` when it renders, and throws with the landmark named if it cannot,
because a still that quietly draws the wrong lines cannot be told from a correct one. The
figures below are the current answers, and they are checked by
`test_every_cited_line_number_still_says_what_the_readme_claims`, which reads this file as
well as the entry README.

- `proof-call-site.png`: the only occurrence of `calls.create` in this codebase is
  `self._client.calls.create(` at
  `dispatch/scheduler.py:313`, inside `def _create_with_retries` at
  `dispatch/scheduler.py:304`.
- `proof-classification.png`: `def _classify` at
  `dispatch/scheduler.py:400` returns exactly six times and the still labels every one of them,
  including `resolution=Resolution.FAILED` at
  `dispatch/scheduler.py:431` and `resolution=Resolution.RESOLVED` at
  `dispatch/scheduler.py:453`.
