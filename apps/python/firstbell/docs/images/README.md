# Images

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
| `the-path-of-one-absence.svg` | The whole path one absence row takes: both gates, what the call may ask, the three endings, and where a safeguarding escalation attaches | `python tools/make_path_figure.py` |

## Regenerating everything

```bash
python tools/make_path_figure.py                   # writes the-path-of-one-absence.svg
python tools/judge_page.py out --receipts ../receipts              # the page
python tools/judge_page.py out --receipts ../receipts --audio-dir ../audio   # and the calls
cd tools/gates && npm install                      # once
node run.mjs                                        # writes tools/gates/shots/*.png
node capture-stills.mjs                             # writes the three proof-*.png
```

`run.mjs` serves `out/` over gzip and drives system Chrome through `puppeteer-core`; its
screenshot gate writes one PNG per section of the evidence page to `tools/gates/shots/`,
none of which is committed. Nothing in this directory comes from it.

`make_path_figure.py` is the odd one out and worth saying so plainly: it is a drawing rather
than a capture. Nothing in it is a photograph of the program running. What keeps it inside
this directory's rule is that every value in it is read from the repository rather than
typed, and that the script is the only way it is written: the colours come out of `page.css`
through `video_facts.palette()`, the safeguarding window out of
`firstbell.domain.SAFEGUARDING_CALLBACK_MINUTES`, and
`test_the_path_figure_is_what_the_generator_writes_today` fails if the committed file is not
what the script produces now. Every box in it is a branch a reader can find in
`dispatch/scheduler.py`. Its 31 text runs are measured against the rectangle each one sits
inside, geometrically rather than by assumption, and the worst clears WCAG AA at 5.96 with
none unresolved.

It carries text, which the evidence page's own figure is forbidden to do, and the reasons
that figure gives are worth answering one at a time rather than waved past. There is no
@font-face inside an SVG served as an image, so every family here is declared with the
widest fallback chain and the layout was checked against it. A README is markdown, so there
is no HTML beside the drawing to hold the labels the way the page holds its own. And the
third reason stands as a real cost: a machine translation tool cannot see a word inside an
image, so a reader who does not read English gets the drawing and not the labels, on a
project whose argument is language access. The whole diagram is therefore also written out
in the `desc` element and in the README's alt text, which is the version a screen reader and
a translation tool both reach. That is a mitigation and not a fix, and the fix would be
inlining the SVG in a surface that can hold HTML.

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

The line numbers printed inside the three stills are the ones the file had when each was
captured, and they are lower than the anchors above because the code has moved down since:
`proof-call-site.png` shows `calls.create` at 320 and it is at 448 today. A gate cannot read
a picture, so nothing in this repository could have noticed that on its own, and saying it
here is cheaper than a still that has to be recaptured every time a method above it grows.
What each still shows is the thing being proved. Where it sits in the file is the anchor
above, which is checked on every run.

- `proof-call-site.png`: the only occurrence of `calls.create` in this codebase is
  `self._client.calls.create(` at
  `dispatch/scheduler.py:504`, inside `def _create_with_retries` at
  `dispatch/scheduler.py:474`.
- `proof-classification.png`: `def _classify` at
  `dispatch/scheduler.py:643` returns exactly seven times and the still labels every one of them,
  including `ItemResult(**base, resolution=Resolution.FAILED` at
  `dispatch/scheduler.py:716` and `resolution=Resolution.RESOLVED, structured_result=result,` at
  `dispatch/scheduler.py:763`.
