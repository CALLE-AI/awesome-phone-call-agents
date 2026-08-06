# CareCall SG Phase 6 Verification Record

Date: 6 August 2026

Scope: repository and local browser verification only

Live calls placed: none

## Completed evidence

| Area | Evidence | Result |
| --- | --- | --- |
| Queue concurrency | Two due jobs share one active lease; the second remains queued until terminal release. | Pass |
| Duplicate delivery | Repeated dispatch of the same job produces one provider run. | Pass |
| Cancellation | Queued cancellation clears encrypted phone data and creates no provider run. | Pass |
| Authorization expiry | A manual job waiting beyond 30 minutes moves to human review. | Pass |
| Lost lease | An ongoing job with a lost lease moves to human review without redialing. | Pass |
| Worker boundary | Unsigned and malformed queue messages are rejected. | Pass |
| Readiness privacy | Unauthorized reads reveal no configuration detail; authorized output contains no job, senior, operator, phone, or instruction identifiers. | Pass |
| Future schedules | Future recurring occurrences are excluded from current queue-backlog alerts. | Pass |
| Operational list access | An unauthenticated job-list request is rejected, and authenticated results are limited to the operator's authorized senior scope. | Pass |
| Operational list privacy | List records exclude phone ciphertext, phone numbers, access codes, caregiver instructions, and transcripts. | Pass |
| Operational list controls | State, source, senior, limit, and cursor inputs are validated; matching results are bounded and paginated. | Pass |
| Call timing | Provider start, end, and duration fields are persisted; an observed duration is used only when the provider omits one. | Pass |
| Console state semantics | Scheduled and due queue labels, live elapsed duration, and terminal duration formatting are covered by offline tests. | Pass |
| Modal keyboard behavior | Focus enters each dialog, wraps from the last control to the first, Escape follows the safe close rule, and focus returns to the invoking button. | Pass |
| Skip navigation | The skip link moves focus to `#main-content`. | Pass |
| Mobile layout | 390-by-844 viewport has no horizontal page overflow; call preview remains scrollable with all actions available. | Pass |
| Enlarged layout | 640 CSS-pixel viewport, representing a 1280-pixel layout at 200% effective width, reflows to mobile navigation with no horizontal page overflow. | Pass |
| Touch targets | Visible buttons in the tested mobile path are at least 44 pixels in both dimensions. | Pass |
| Light-mode contrast | Label/page 16.02:1; secondary/page 5.33:1; accent/soft 4.53:1; success/soft 5.14:1; attention/soft 5.06:1. | Pass |
| Browser diagnostics | No console warnings or errors during the audited paths. | Pass |

The semantic styles also contain explicit dark-mode, increased-contrast, reduced-motion, and reduced-transparency branches. Those branches still require verification under actual operating-system preferences before pilot sign-off.

## Remaining credentialed evidence

Phase 6 is not complete until the following occur in the intended staging deployment:

- Vercel environment variables are configured from the approved secret stores.
- `npm run preflight` returns `ready: true` and no unexplained operational alerts.
- The full queue acceptance matrix is repeated against deployed Redis and signed QStash delivery.
- Queue, active, history, and needs-review transitions are confirmed in the deployed Calls console using only authorized senior records.
- Provider-reported start, completion, and duration values are compared with the deployed console; the fallback is visibly identified as CareCall-observed.
- The deployed console is checked to ensure full phone numbers, caregiver instructions, and transcripts never appear in list responses or rendered details.
- A real screen reader is used for the primary navigation, Needs Attention flow, and all three dialogs.
- Dark mode, increased contrast, reduced motion, and reduced transparency are activated at operating-system level and visually checked.
- One consenting team member receives a harmless English meal check-in.
- A fictional-instruction medication reminder is attempted only after the meal scenario passes.
- Daily reconciliation is observed without a duplicate or late call.

Keep the pull request in draft until this evidence is recorded and reviewed.
