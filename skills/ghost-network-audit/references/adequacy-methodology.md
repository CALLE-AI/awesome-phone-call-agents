# Adequacy methodology

How `scripts/adequacy.mjs` turns call outcomes into numbers, and which numbers are
honest to quote.

## The denominator problem

The tempting metric is "what fraction of listings are ghosts," computed over every row
in the file. That number is always wrong, because a directory audit never reaches every
office. Unreached rows are not accurate and are not ghosts — they are unknown, and
folding them into either bucket manufactures a finding.

So every rate here uses **confirmed rows** as its denominator, and the confirmation
coverage is reported next to it. A rate without its coverage is not a result.

```text
confirmed   = confirmed_active + confirmed_ghost + confirmed_closed_panel
coverage    = confirmed / (total - skipped)
ghost_rate  = confirmed_ghost / confirmed
```

Listings that were *skipped* — a bad number, a crisis line, a suppressed number — leave
the denominator entirely, because nothing was ever going to be learned about them by
dialing. Listings that were *deferred* by the calling window stay in it: those are
listings the audit intended to reach and did not, and hiding them would flatter the
coverage figure. Coverage and `unverified_rate` therefore do not sum to 1 whenever a run
leaves work deferred, and the gap is exactly the deferred share.

A ghost rate of 34% at 61% coverage is a real finding about the 61%. Presented without
the coverage, it silently claims to be a finding about the whole directory.

## Metrics produced

| Metric | Definition | Denominator |
| --- | --- | --- |
| `coverage` | Share of dialable listings that produced a confirmed answer. | total minus skipped |
| `ghost_rate` | Provider not at location, or plan not accepted. | confirmed |
| `active_rate` | Provider present, plan accepted, panel open. | confirmed |
| `closed_panel_rate` | Provider present and plan accepted, but not taking new patients. | confirmed |
| `effective_availability` | `active_rate` — the share of confirmed listings a patient could actually use. | confirmed |
| `median_wait_weeks` | Median `next_appointment_weeks` among active listings. | active listings with a stated wait |
| `unverified_rate` | Share of dialable listings with no clear answer. | total minus skipped |

`effective_availability` is the number that matters to a patient. A directory can be
100% "accurate" — every clinician really does practice there and really does take the
plan — and still be useless if every panel is closed. Accuracy and availability are
different failures, and the report keeps them separate.

## Wait times

`median_wait_weeks` uses the median rather than the mean because the distribution has a
long right tail: a few offices quoting "sometime next year" would drag a mean far past
anything a patient experiences.

Only listings in `confirmed_active` with a non-null `next_appointment_weeks` are
included. An active listing whose office would not estimate a wait is counted in
`active_rate` but excluded from the wait median, and the count of such listings is
reported so the exclusion is visible.

## What the report will not do

- **No extrapolation.** The auditor reports what the calls found. It does not project a
  ghost rate onto the unaudited remainder of a directory, and it does not compute
  confidence intervals for a sample it did not design.
- **No per-clinician scorecards.** Findings attach to a listing — a clinician-at-a-
  location-under-a-plan — not to a person. "Dr. X is a ghost" is not a claim the data
  supports; "this listing for Dr. X at this location under this plan is inaccurate" is.
- **No automatic directory edits.** The output is evidence for a human decision. A
  `confirmed_ghost` row is a strong signal, and it is still one phone call to one front
  desk on one day.

## Reading a run

A healthy audit looks like high coverage and whatever ghost rate is true. A run with
coverage below about half is not a finding about the directory — it is a finding about
the audit, and usually means the calling window was wrong, the numbers were stale in a
way the gates caught, or the offices route to answering services during the chosen
hours. Fix the run before quoting the rate.

The report prints coverage first, above the ghost rate, for exactly this reason.
