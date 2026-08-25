# FieldClose Testing and Evaluation

## Purpose

This document defines how FieldClose will prove functional correctness, workflow safety, CALL-E runtime use, and product usefulness without making unsupported claims.

## Testing principles

1. Automated tests must never place a live phone call.
2. The fake provider must exercise the same application boundary as the CALL-E adapter.
3. Safety gates are server-side and tested as product behavior.
4. Unknown external outcomes stop automatic progression.
5. Fixtures use fictional or masked data.
6. Live tests use authorized participants and explicit operator approval.
7. A demo fixture is never presented as evidence of a live CALL-E call.
8. Results must be reproducible from recorded test inputs and a normalizer version.

## Test layers

### Static validation

Will include the selected stack's:

- formatting check;
- lint check;
- type check;
- dependency and configuration validation;
- build command.

### Unit tests

Primary targets:

- E.164 validation;
- IANA timezone validation;
- calling-window calculation, including daylight-saving transitions;
- approval-version and brief-hash validation;
- idempotency-key reuse;
- case state transitions;
- result normalization;
- route selection;
- masking and redaction;
- refusal and do-not-call blocking;
- configuration parsing and live-mode defaults.

### Integration tests

Primary boundaries:

- application server and persistence;
- application server and fake provider;
- authenticated bounded polling ingestion;
- duplicate provider events;
- ambiguous provider creation and reconciliation;
- authentication and operator authorization;
- audit event creation;
- protected versus masked contact views.

### End-to-end tests

Browser-driven scenarios using the fake provider:

- create a case;
- review the exact call brief;
- approve a dry-run or fake attempt;
- observe provider and business states;
- inspect a normalized result;
- record a route-appropriate human disposition and resolve or cancel its task;
- inspect the final FieldClose case state and redacted audit event;
- confirm that duplicate submission creates no second attempt;
- confirm that live mode is visibly disabled by default.

The current Playwright suite covers the fake workflow through persisted human
disposition, resolved task, final case state, and visible audit evidence. Unit
and PostgreSQL integration tests cover the authorization boundary, every
permitted outcome, stale and conflicting writes, atomicity, redaction, and
repeat-submission behavior.

### Authorized live verification

A small, separately invoked test proves that the application calls CALL-E at runtime and handles a real provider result. It must never run as part of the default test suite.

## Canonical fake scenarios

The fake provider should return deterministic fixtures keyed by scenario ID.

| ID | Conversation outcome | Expected route | Important assertion |
| --- | --- | --- | --- |
| `resolved_clear` | Authorized contact reports normal operation and no issue | `ready_for_closeout_review` | Still requires human disposition |
| `issue_return_requested` | Authorized contact reports an issue and requests review of a return visit | `return_visit_review` | No appointment is promised |
| `ambiguous_after_clarification` | Answer remains unclear | `human_follow_up` | Unknown is preserved |
| `wrong_person` | Recipient is not the intended or authorized contact | `human_follow_up` | No case detail is disclosed |
| `refused` | Recipient refuses the call | `human_follow_up` | Automated retry is blocked |
| `do_not_call` | Recipient requests no further automated calls | `human_follow_up` | Durable contact block is created |
| `no_answer` | No authorized conversation occurs | `unreachable` | No result is treated as confirmation |
| `voicemail` | Voicemail is reached | `unreachable` | No voicemail by default |
| `technical_advice_requested` | Contact asks for diagnosis or safety advice | `human_follow_up` | Agent does not advise |
| `commercial_commitment_requested` | Contact asks for price, approval, or guaranteed timing | `human_follow_up` | Agent does not commit |
| `malformed_provider_result` | Provider payload fails runtime validation | `human_follow_up` | Raw input is quarantined or safely recorded |
| `creation_timeout_unknown` | Call creation outcome is ambiguous | `human_follow_up` | Reconciliation freezes retries |
| `duplicate_submit` | Same approval is submitted twice | existing route/state | Exactly one attempt exists |

## Unit test matrix

### Approval and call creation

- Valid approval and all gates pass.
- Approval references an older case version.
- Brief hash differs from the approved hash.
- Approval references another attempt.
- Live mode is disabled.
- Operator lacks permission.
- Contact authorization attestation is absent.
- Contact has a do-not-call timestamp.
- Number is not E.164.
- Timezone is absent or invalid.
- Local time is outside the permitted window.
- Existing attempt already has a provider identifier.
- Existing attempt has ambiguous creation state.

### Time behavior

- Normal permitted local time.
- Time before and after the window.
- Daylight-saving spring-forward gap.
- Daylight-saving fall-back repeated time.
- UTC date differs from the contact's local date.
- Attempt is approved before a window but created after it closes.

### Result normalization

- Explicit yes and no values.
- Missing field.
- Null field.
- Unknown provider enum.
- Partial answer.
- Conflicting structured fields and summary text.
- Wrong-person result with leaked closeout fields.
- Refusal plus other populated fields.
- Out-of-scope technical or financial topic.
- Provider `completed` with no usable result.
- Duplicate result delivery.

The normalizer must prefer safe uncertainty over optimistic inference.

## Security and privacy tests

- Browser cannot set `liveCallApproved` without a server approval record.
- Browser cannot override case version, brief hash, contact block, or calling window.
- Provider credentials never appear in browser responses or rendered HTML.
- Logs mask E.164 numbers.
- Errors contain no authorization headers, tokens, or provider credentials.
- Unauthorized or cross-workspace refresh is rejected before provider access.
- Concurrent refreshes are throttled and cannot duplicate terminal results.
- Transcript-like text cannot inject a new application action.
- One operator cannot access another account's cases when multi-tenancy is enabled.
- Public demo route exposes no administrative or private data.

## Inspectable accepted-call recovery evidence

The browser close/reopen boundary can be reviewed without placing a call. The
evidence is intentionally split between client lifecycle code, persisted server
policy, and existing automated coverage:

| Claim | Inspectable evidence |
| --- | --- |
| Opening an accepted nonterminal case schedules a refresh after about five seconds | `FieldCloseWorkbench` first loads the selected case detail, then its accepted-live-attempt effect schedules `POST /api/attempts/<attemptId>/refresh` with `window.setTimeout(..., 5_000)` |
| Leaving or closing the page stops automatic refresh | The same effect cleanup marks the loop inactive and calls `window.clearTimeout`; the repository has no service worker or hosted accepted-call polling worker |
| Reopening resumes the existing call rather than redialing | The selected-case effect reloads persisted case detail; when the stored attempt is eligible, the refresh effect uses `detail.attempt.id`, while `refreshAcceptedLiveAttempt` accepts only an attempt with an existing CALL-E `providerCallId` and never calls provider creation |
| Time away still counts toward the bound | `prepareLiveStatusRefresh` compares the request time with persisted `acceptedAt` using `liveStatusPollTimeoutMs` (`600_000`) |
| A late terminal result can resolve reconciliation without another call | Integration case `times out to one reconciliation task and can recover on a later manual refresh` asserts one provider creation, one resolved reconciliation task, and later completion |
| Five-second throttling and terminal idempotency survive repeated refresh | Integration cases `polls an accepted call without creating a result until the provider is terminal` and `allows only one provider lookup for concurrent refreshes` cover the persisted throttle and one-result boundary |

For a manual browser inspection, use a fake or intercepted provider response:

1. Open a case fixture whose persisted live attempt has a provider call ID and
   no result, and observe the accepted-call status panel.
2. Leave the case before the first five-second request and confirm that no
   refresh request is emitted while the case is closed.
3. Reopen that case and confirm one refresh request appears after about five
   seconds with the same attempt ID.
4. Confirm that no execute or provider-create request occurs during reopen.

This inspection demonstrates lifecycle wiring only. It is not evidence of a
real CALL-E call or unattended background execution.

## Accessibility and product tests

- Approval cannot be triggered accidentally by loading a page.
- Live versus fake mode is understandable without color alone.
- Keyboard users can review and approve the call brief.
- Focus moves to validation errors.
- Status labels are text, not icon-only.
- Masked phone numbers remain distinguishable without revealing the full number.
- Waiting, failed, unknown, and completed states are visually distinct.
- The UI never labels `completed` as automatically closed.

## Live-test protocol

### Preconditions

- Use an authorized test participant and number.
- Tell the participant the purpose, AI nature, likely duration, and whether provider recording or transcription may occur.
- Confirm the participant's timezone and agreed test window.
- Use fictional HVAC case details.
- Confirm no emergency, diagnostic, pricing, payment, or real service decision is involved.
- Start with the default retry count of zero.
- Prepare a human abort and incident contact path.
- Verify that logs and screen capture mask the number.

### Execution

1. Create the fictional case.
2. Capture the reviewed call brief without private data.
3. Approve one live attempt.
4. Record the internal attempt identifier and provider acceptance evidence.
5. Let the participant answer using one canonical scenario.
6. Retrieve or receive the provider result.
7. Verify the normalized result and route.
8. Record human disposition.
9. Confirm that no second call was created.

### Evidence

Retain only what is permitted and necessary:

- redacted case and attempt identifiers;
- timestamp and test scenario ID;
- proof of CALL-E runtime invocation;
- provider status and redacted call identifier;
- normalized structured result;
- resulting FieldClose state transition;
- test outcome and known limitation.

Do not commit participant identity, full number, credential, recording, or private transcript.

## Product evaluation

### Primary metric

$$
\text{Actionable Closeout Rate}
=
\frac{\text{Approved attempts producing a usable human next step}}
{\text{Total approved attempts}}
$$

### Supporting metrics

| Metric | Meaning | Guardrail |
| --- | --- | --- |
| Time to human disposition | Time from case creation to operator decision | Do not optimize by skipping review |
| Dispatcher active minutes | Human effort per case | Measure, do not invent savings |
| Human-escalation rate | Share requiring human follow-up | High may be safe during early testing |
| Unreachable rate | Share without an authorized conversation | Do not count as resolved |
| Duplicate-call count | More than one provider call for one approved attempt | Target zero |
| False-ready count | Human determines a ready recommendation was unsupported | Target zero in evaluated fixtures |
| Audit completeness | Material transitions with required evidence | Target 100% in test fixtures |

Performance targets will be set only after baseline measurement.

## Hackathon demonstration acceptance

The final demonstration must complete the fixed golden path in about three
minutes. The canonical timing is maintained in
[Hackathon Submission Plan](hackathon-submission-plan.md).

The recording is acceptable when it:

1. states the specific HVAC closeout problem;
2. starts from a preset fictional work order instead of typing every field;
3. shows only the decision-critical case facts, exact brief, safety boundary,
   and human approval;
4. labels fake execution as `No phone call` and identifies authorized live
   evidence accurately;
5. shortens CALL-E waiting only through transparent editing, without implying
   that completion was instantaneous;
6. centers one normal result or one strong exception rather than touring every
   scenario;
7. separates provider status, normalized result, and the human next action;
8. uses the final 10 seconds for audit and duplicate protection instead of a
   page-by-page feature tour.

The recording must not claim diagnosis, appointment confirmation, automatic
closure, or live behavior that the captured evidence does not prove.

## Validation commands

The repository currently defines these verified commands:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm db:check
pnpm test:integration
pnpm build
pnpm test:e2e
pnpm validate
```

`pnpm test` runs deterministic unit tests without Docker. `pnpm test:integration`
starts isolated PostgreSQL 17 containers. The current `pnpm test:e2e` exercises
unauthenticated desktop and mobile entry states plus the mocked HTTP-boundary
fake-provider workflow through recorded human disposition and the final audit
state. `pnpm validate` runs the complete default validation chain and provides
the automated evidence for the P0A closure; live-provider verification remains
a separate opt-in activity. On 2026-08-06, one separately authorized local
CALL-E attempt produced redacted evidence of provider acceptance, terminal
result retrieval, uncertainty-preserving normalization, human routing, final
operator disposition, and duplicate protection. A correction recorded on
2026-08-10 confirms that the intended participant was reached and a conversation
occurred after the Sonetel forwarding announcement. The retained structured
result incorrectly classified the announcement as terminal and stored all three
HVAC questions as `not_asked`. The original machine artifacts remain unchanged;
the dated correction is separate human-observation evidence. Without a retained
transcript, recording, or participant answer attestation, the exact live answers
are not reconstructed. The deterministic fictional fixture supplies the public
demo values and is not live-call evidence.

Markdown documentation is checked separately with `markdownlint-cli2`. Formatting is enforced through the lint and production-build toolchain; a dedicated formatter has not been added.

An opt-in live verification command does not exist yet. It must require an explicit opt-in flag and must not be included in `test` or `validate` when the CALL-E adapter is implemented.

## Evidence log template

For each significant verification run, record:

```markdown
### Verification YYYY-MM-DD

- Commit:
- Environment:
- Commands:
- Fake scenarios exercised:
- Authorized live scenario, if any:
- CALL-E runtime evidence:
- Result and state transition:
- Failures or limitations:
- Private evidence storage location, if applicable:
```

Do not commit private evidence locations or credentials to a public repository.

## Exit criteria before submission

- [x] All default validation commands pass or baseline exceptions are documented.
- [x] Fake provider covers every canonical scenario.
- [x] Duplicate prevention is demonstrated.
- [x] Ambiguous call creation freezes retries and supports reconciliation.
- [x] An owner or operator can record each permitted human disposition and an
  auditor cannot mutate it.
- [x] Disposition persistence, task resolution, final case state, and audit
  creation are atomic, idempotent, and covered end to end.
- [ ] Logs, fixtures, screenshots, and video contain no private data.
- [x] At least one authorized live CALL-E invocation is verified.
- [x] A real result drives a visible FieldClose state transition.
- [x] Known limitations are stated in README and Devpost materials.
- [x] Public setup works without live credentials in fake mode.
- [x] Live mode remains explicit and opt-in.
