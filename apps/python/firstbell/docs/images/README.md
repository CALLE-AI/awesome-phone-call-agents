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
| `evidence-page-billing-check.png` | The built evidence page, "check us against your billing" section | `node tools/gates/run.mjs` (screenshot gate) |

## Regenerating everything

```bash
python tools/judge_page.py out                     # builds out/, no audio
cd tools/gates && npm install                      # once
node run.mjs                                        # writes tools/gates/shots/*.png
node capture-stills.mjs                             # writes the three proof-*.png
```

`run.mjs` serves `out/` over gzip and drives system Chrome through `puppeteer-core`; its
screenshot gate writes one PNG per section of the evidence page to `tools/gates/shots/`,
which is not committed. `evidence-page-billing-check.png` in this directory is a copy of
`tools/gates/shots/desktop-act-04.png` from that run.

`capture-stills.mjs` is a separate script; it does not modify `run.mjs`. The two code stills
read the exact bytes of `dispatch/scheduler.py` at the line ranges they show, and the
terminal still runs `python -m firstbell --work-file examples/absences.csv` itself and
captures its real stdout. Nothing in any of the three is retyped from memory.

## What is not here, and why

`tools/gates/shots/` holds one screenshot per section of the evidence page, in two
viewports, 18 files total. None of them are committed, for two reasons found while building
this set:

1. Most sections that show the hero call player also show transcript text from the demo
   calls. The two scripted, consented demo calls in this repository are fine to publish on
   the built page itself, but a committed image of call transcript text is a wider
   distribution of that text than this directory should make on its own.
2. The screenshot for a given section is taken by scrolling that section's element into
   view and screenshotting its bounding box. On this page, sections pin and transform during
   scroll (the whole point of the scrollytelling build), and at least one such screenshot,
   named for one section, was measured showing the content of the two sections after it
   instead. That is a real property of the current build, not a one-off, and it means a
   filename in that directory cannot be trusted to describe its own content without opening
   the file.

`evidence-page-billing-check.png` was picked out of that set of 18 only after being opened
and checked against both problems: it shows no transcript text, and its content matches its
filename.

## Verification

Every image in this directory was opened and checked, individually, for:

- no API key or credential of any kind
- no phone number
- no real person's name (the pupil names visible anywhere on the built page are fictional,
  stated as such in the page footer and in `README.md`)
- no call transcript text

Every line number in a caption was checked against `dispatch/scheduler.py` at the time the
caption was written:

- `proof-call-site.png`: `self._client.calls.create(` is the only occurrence of
  `calls.create` in this codebase (checked with a repository-wide search), at line 211.
- `proof-classification.png`: `_classify()` runs from line 252 to line 306 and contains
  exactly six `return` statements, at lines 269, 283, 290, 295, 300 and 305. No other line
  in that range contains the word `return` as a statement.
