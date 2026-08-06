# Result contract

Produce exactly one terminal claim for every planned condition.

## Claim states

- `confirmed`: the staff report supports the exact condition and all confirmation gates pass.
- `does_not_match`: the staff report clearly conflicts with the condition or deterministic threshold.
- `unclear`: the answer is ambiguous, hedged, guessed, incomplete, or lacks sufficient aligned evidence.
- `not_asked`: the condition was not asked, including after a decline or invalid structured result.
- `could_not_reach`: the venue could not provide an eligible respondent because of voicemail, no-answer, wrong number, or provider failure.
- `conflicting`: material statements or a stated answer and measurement disagree.

## Confirmation gates

`confirmed` requires:

1. confirmed venue identity;
2. accepted respondent consent;
3. semantic agreement with the exact condition or deterministic evaluation of its threshold;
4. a respondent evidence excerpt aligned by attempt and turn index.

If any gate fails, downgrade the claim. Never infer a positive answer from provider completion, sentiment, summary text, or missing fields.

## Minimum safe output

For each claim return:

- condition identifier and exact question;
- venue identifier and masked number;
- terminal claim state;
- normalized staff-reported detail;
- respondent role when available;
- source class `staff_reported`;
- capture time and freshness;
- evidence reference or an explicit statement that no aligned excerpt is available;
- a limitation stating that the result is not an audit, guarantee, certification, or whole-venue verdict.

Retain prior versions when a follow-up or later observation changes the current view.
