# Submission checklist — evidence

Every line of the checklist at the end of [`../SPEC.md`](../SPEC.md), reproduced and
answered. Lines marked **`owner → #9`** are outward-facing or irreversible acts that no
goal may perform; they are the human's, tracked on issue #9.

Checklist text is verbatim from the CALL-E rules at <https://call-e.devpost.com/>, read
8 September 2026.

Legend: **[x]** done here, with the evidence beside it · **[ ] owner → #9** prepared here,
performed by the human.

---

## Required Submissions

### [ ] owner → #9 — Open a pull request to the awesome-phone-call-agents repository following the directory and file naming conventions in `docs/git-naming-conventions.md`

Opening a PR into a third-party repository is human-only. **Prepared:**
[`pr-body.md`](pr-body.md) holds the complete PR body against that repo's real
`.github/pull_request_template.md`, plus the branch, title and commit name.

The naming half *is* verified, using their own script rather than by eye:

```
$ python3 scripts/check_branch_name.py --branch feat/supplier-quote-agent
Branch name follows docs/git-naming-conventions.md: feat/supplier-quote-agent
```

This also caught a real defect: `SPEC.md` originally specified
`feature/supplier-quote-agent`, which their script **rejects** (allowed types are
`feat|fix|docs|chore|refactor|test|ci|build|release|hotfix|spike`). Corrected in
`SPEC.md`.

### [ ] owner → #9 — Provide the pull request URL on the Devpost submission form

Exists only after the PR is open. Devpost submission is human-only.

### [ ] owner → #9 — Submit a demonstration video approximately 3 minutes in length, uploaded to YouTube or Vimeo and made publicly visible

**Prepared:** [`video-script.md`](video-script.md) (from issue #8) carries the narration,
shot list, timings and the exact seeded state to record from — scripted ~2:15 against a
2:42 ceiling. Recording and publishing is the owner's.

### [ ] owner → #9 — Include your CALL-E account email address

The owner's own account detail. Listed in `submission.md` §6.

## Optional Components

### [ ] owner → #9 — Provide a URL to a functional demo application (if applicable)

Likely **not applicable**: the app runs locally (`npm start` → `localhost:3000`) and is
not deployed. Deploying is human-only and out of scope for this entry. The owner may
leave it blank or link the repository.

### [ ] owner → #9 — Complete the feedback survey (eligible for Most Valuable Feedback prizes)

A survey submission by the entrant. Flagged in `submission.md` §6 — it is a separate
prize category ($200 + 10,000 credits, five winners), so worth the owner's time.

## Additional Requirements

### [x] All project code and documentation must be in English

No CJK characters anywhere in the entry:

```
$ grep -rlP '[\x{3400}-\x{4dbf}\x{4e00}-\x{9fff}\x{f900}-\x{faff}]' \
    --include='*.js' --include='*.jsx' --include='*.json' --include='*.md' \
    --include='*.html' . --exclude-dir=node_modules
  (no output)
```

Independently confirmed by the target repo's own `validate_english_only()`, which scans
everything under `apps/` — see the validator run at the bottom of this file.

### [x] Use only fictional or masked phone numbers in samples and tests (no real contact information)

Every sample phone number in the entry sits in a range regulators reserve for fiction —
never allocated to a real line. Those ranges are one table, `src/fictional-numbers.js`:
NANP `555-0100`–`555-0199` (in geographic area codes — not toll-free 8XX, where 555 is
not reserved — plus the short `+1-555-01xx` form the seed data uses) and Ofcom's drama
ranges (e.g. London `020 7946 0000`–`0999`, mobile `07700 900000`–`900999`, Tyneside
`0191 498 0000`–`0999`).

`tests/fictional-numbers.test.js` enforces it on every `npm test` (and so on every
`verify.sh`). It reads every internationally written number of 7–15 digits from every
text file in the app: `+`, `00` or `011` prefix, any common separators, with fullwidth,
Arabic-Indic and Devanagari digits and unicode dashes folded first. It fails on any that
isn't in that table, and reports the offender masked, so the failure message cannot
itself republish a real number. A second test, `tests/non-phone-digit-runs.test.js`, covers national spellings without
a prefix (`020 7946 0958`). It reads every digit run the masker would hide as a phone
number and requires each to read as a fictional number, or to be listed with a reason in
`tests/fixtures/non-phone-digit-runs.json`. There are seven such entries: sequential-digit
PO/SKU fixtures, a quote reference, two quantities, the account part of the standard
documentation IBAN, and a GitHub issue-comment id from a linked review URL. The guard's
own "not reserved" test inputs are built at run time by
moving one digit of a reserved number out of its block, so no number that could belong to
a real line is ever written into the repository. The same table, and the first scan, feed
the provider test that refuses every one of these numbers as a live destination, so
"fictional in the repo" and "refused live" cannot drift apart.

Every distinct number the scan finds, normalized (a trunk `0` kept where the source kept
it):

```
+12025550147   +12025550199   +15550100      +15550101      +15550102
+15550103      +15550104      +15550123      +15550199      +19115550123
+4402079460958 +442079460958  +442079460959  +447700900123  +447700900456
+447700900789
```

This replaced a `verify.sh` grep that only recognised the `+1-ddd-dddd` spelling.

### [x] Include setup and installation instructions

[`../README.md`](../README.md) → **Setup** (`npm install`, with real output), **Run**
(`npm start`), **Test**, **Lint**, **Verify everything**, plus a **Stack** table pinning
runtime, package manager, test runner and linter. No credentials or external service are
needed to run it.

### [x] Document safety notes for real-world side effects (e.g., actual outbound calls)

Three places, deliberately:

- `../README.md` → **Safety model** table, at the top of the file before anything else.
- `../README.md` → **Credentials and real calls** — the three environment variables that
  together make a real call possible (`CALL_PROVIDER`, `CALLE_API_KEY`, and the
  `CALLE_ALLOWED_DESTINATIONS` allowlist), and the explicit statement that running one
  places a real phone call billed to the CALL-E account behind the key.
- [`architecture.md`](architecture.md) → **Where a real call could happen** — exactly one
  function, `CallEProvider.placeCall()`, reachable only with `CALL_PROVIDER=calle`,
  `CALLE_API_KEY` set, **and** the destination on the allowlist — and even then the key
  goes only to the pinned origin `https://api.heycall-e.com`, never through a redirect.

The no-call default is enforced, not just documented: `tests/call-flow.test.js` asserts
`process.env.CALLE_API_KEY` is undefined and that `place_call` still succeeds on the fake
provider.

### [x] Provide cancellation or rollback procedures for recurring workflows (if applicable)

`../README.md` → **Cancelling and rolling back**.

There are no recurring or scheduled workflows — no cron, queue or retry daemon — and the
README says so rather than leaving it to inference. A call happens only on an explicit
`place_call` against a task a human approved.

For a call already in flight: `cancel_call` aborts it, and does so genuinely — the fake
provider races its pacing delay against the abort signal, so a call left ringing forever
is still interrupted rather than cancelled at the next checkpoint
(`src/providers/fake-call-provider.js`, `raceAgainstAbort`). Asserted by
`tests/approval-gate.test.js` → *"cancels a genuinely in-flight fake call and narrates it
in the activity log"*, whose stand-in `wait` never resolves on its own.

Rollback: `retry_with_plan` clears the outcome, call record and approval metadata and
returns the task to `planned` — requiring a fresh human approval. State is in memory, so
restarting the process is a complete rollback to seeded state.

### [x] No secrets, API keys, or personal data in the repository

Only environment-variable **names** appear — `CALL_PROVIDER`, `CALLE_API_KEY`,
`CALLE_BASE_URL`, `CALLE_ALLOWED_DESTINATIONS`, `DEMO_SUPPLIER_PHONE` — never values. `src/providers/calle-provider.js` reads them as
constructor defaults, evaluated at construction rather than at import.

The credential-shaped literals in the entry are `'test-key'` (`tests/providers.test.js`),
passed to an injected `fetchImpl` that never leaves the process, and
`'test-key-not-real'` (`tests/server-http.test.js`), set only while global `fetch` is
stubbed to fail the test if it is ever reached.

No credential file is tracked:

```
$ git ls-files entries/call-e | grep -iE '\.env|secret|credential|\.pem|\.key'
  (no output)
```

No personal data: the only names in the fixtures are invented suppliers (Acme Corp,
TechVend Inc, Global Parts Ltd).

### [x] Run validation: `python3 scripts/validate_repository.py` in the awesome-phone-call-agents repo (passes without warnings)

Run for real, in a fresh shallow clone of `CALLE-AI/awesome-phone-call-agents`, with this
entry copied into `apps/web/supplier-quote-agent/` (excluding `node_modules/`):

```
$ python3 scripts/validate_repository.py        # baseline, untouched clone
Repository validation passed.

$ git archive HEAD entries/call-e | tar -x --strip-components=2 -C apps/web/supplier-quote-agent/
$ python3 scripts/validate_repository.py        # with this app in place
Repository validation passed.
```

Exit code 0, no warnings, both before and after — so adding this app introduces no
validation failure.

What the validator actually checks that could have bitten us, all clear: `validate_apps()`
forbids dependencies that point at the source repository's own internals — local `file:`
specs, workspace protocol specs, and relative paths up into their packages directory —
anywhere under `apps/` (this app has none; every dependency is a plain registry version
range), and `validate_english_only()` scans every `.md/.js/.json/.ts/.yml` under `apps/`
for CJK. It does **not** require a per-app entry in any manifest, so adding a directory
cannot on its own fail it.

Note that those forbidden strings are matched as plain substrings across *all* text files
under `apps/`, documentation included — so prose must describe them rather than quote
them. This paragraph originally spelled one out and failed the validator for it.

**The owner should still re-run this in their own clone immediately before opening the
PR** — the upstream validator changes, and this run reflects the clone taken
8 September 2026.

---

## Also required by the umbrella repo (`CLAUDE.md`)

### [x] The LICENSE is visible at the entry root and named in the README

`entries/call-e/LICENSE` — MIT, 21 lines. Named in `../README.md` twice: in the header
links and in the closing **Licence** section, both linking `LICENSE` directly.
`package.json` declares `"license": "MIT"`, matching.

### [x] A fresh clone runs the README commands successfully

Run in a clean worktree with no `node_modules/` present. Full output in the pull request
description and reproduced in `../README.md`:

```
$ npm install
added 746 packages, and audited 747 packages in 1s

$ npm test
Test Suites: 6 passed, 6 total
Tests:       57 passed, 57 total

$ npm run lint
✖ 2 problems (0 errors, 2 warnings)

$ npm start
CALL-E dashboard server listening on http://localhost:3000
```

The demo script was then driven against the running server over `POST /api/invoke` and
the approval gate exercised by hand in Chrome — walkthrough and captured output in
`../README.md`.

### [x] An architecture diagram exists (Mermaid source + exported SVG)

[`architecture.md`](architecture.md) carries both diagrams as Mermaid source;
[`architecture.svg`](architecture.svg) and [`task-lifecycle.svg`](task-lifecycle.svg) are
the exported images, rendered from that same source with `@mermaid-js/mermaid-cli`
11.17.0 for submission forms that want a picture.

---

## Two things the owner must decide (not defects, but not ours to choose)

1. **`LICENSE` has no copyright holder.** It reads `Copyright (c) 2026` with no name. The
   MIT text is otherwise intact and the licence is visible, so no rule is broken, but a
   named holder is conventional and this is the owner's identity to supply.
2. **`package.json` `"author"` is `"Claude Code"`.** The Devpost entrant is the owner;
   they may want their own name or handle there before the PR.

Both are listed in [`submission.md` §6](submission.md#6-before-the-owner-submits).
