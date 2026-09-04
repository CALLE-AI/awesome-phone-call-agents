# Every gate, broken on purpose

A test that has never been observed to fail has not been shown to test anything. Each row
below is a change made to working code to check that a specific test notices. Every one
was reverted and the suite returned to green.

Reproduce any of them by making the change and running `python -m pytest tests/ -q`.

| # | The change | Tests that failed |
|---|---|---|
| 1 | `max_workers=self._concurrency` becomes `max_workers=None`, removing the concurrency cap | 4 |
| 2 | `if not item.consented:` becomes `if False:`, disabling the consent gate | 3 |
| 3 | Drop `insufficient_balance` from the double's `API_ERROR_CODES` | 3 |
| 4 | Match the production host by substring instead of hostname, so `api.heycall-e.com.example.net` passes | 1 |
| 5 | Write the transcript into every receipt instead of only when `--include-transcript` is given | 1 |
| 6 | Prefer the attempt's raw SIP code over the task's symbolic one, putting `603` in front of an administrator | 1 |
| 7 | Delete the SIP translation table, so a queue row reads `the call failed with 603` | 1 |
| 8 | Stop falling back to the task-level `structured_result`, which is the defect a real call exposed | 1 |
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
| 19 | Credit every attempt to the machine instead of only the attempts behind records it closed, so calls that left a family unreached still count as staff time saved | 3 |
| 20 | Report a break-even of `0.00` rather than nothing when a run billed no attempts, turning could-not-compute into a free-looking number | 1 |
| 21 | Wrap the citation like prose, so the source URL breaks mid-path and the reader cannot open the thing the number came from | 3 |
| 22 | Drop `source` from the wage validation, so a staff cost can be asserted with no provenance at all | 1 |
| 23 | Shift one cited line number by one, the way any edit above it would | 1 |
| 24 | Keep a cited line number and change the symbol the sentence claims is on it | 1 |
| 25 | Point the ten-minute reading order at a file that does not exist | 1 |
| 26 | Delete the runtime anchors entirely, which a check written as "every anchor resolves" passes on an empty list | 2 |
| 27 | Put the extracted result back on the recipient when no per-recipient schema was asked for | 1 |
| 28 | Drop two task-level fields the production API returns on every response | 3 |
| 29 | Give an attempt our symbolic name for the outcome instead of the wire code the API sends | 6 |

## Why these twenty-nine

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

## What is not covered

Mutation testing shows a test notices a change. It does not show the test is testing the
right thing, and it says nothing about the rules nobody thought to write. The two defects
found in this project during live calls were both of that kind: not a rule that failed, but
a case the design had not imagined. Both were found by placing a call, not by reasoning
about the API.
