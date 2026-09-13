# Verification record

September 13, 2026. Release checks used application source **02d0ffb** plus documentation, screenshots, CI and Render packaging changes. The latest live test used **86d46b4**, policy **1.2.0**; the current locally verified policy is **1.3.0**, with evidence schema/evaluator **1.2.0**. This record describes observed checks, not general AI accuracy. Earlier development logs are retained in Git history.

## Automated checks

| Check                                | Result                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------- |
| TypeScript, unit/API and fault tests | 175 tests across 19 suites passed                                          |
| Synthetic evaluator corpus           | 45/45 expectations matched                                                 |
| Production build                     | Passed                                                                     |
| Browser workflows                    | 17 passed, including mobile metadata correction and exact-request recovery |
| Formatting                           | Passed                                                                     |
| Browser inspection                   | Desktop/mobile progress and main app loaded without recorded page errors   |

Coverage includes ownership, persistent revisions, call recovery, budget reservations, stale approvals, source validation, correction feedback, rejected-method suppression, transactional review, mobile layout and user-recorded outcomes. Regular automated tests use isolated stores and fake provider transports; they make no telephone calls.

The corpus contains 30 development and 15 designated held-out examples, all self-authored. These are regression expectations, not an independent accuracy benchmark. Five fictional conversation rehearsals cover private-budget handling, negotiation, uncertainty and scope changes.

## Observed live behavior

Four app-originated inquiries and a separate CLI test completed during development. Three app operations needed an operator recovery using their exact persisted request bodies and original idempotency keys after lost create responses. No replacement key was used.

### Latest negotiation test: failed conversation acceptance

One consenting participant answered the policy **1.2.0** inquiry. The saved transcript contains **45 transcript segments** (33 assistant, 12 recipient) and about **137 seconds** of conversation. Observations:

- The caller kept the $40 budget private.
- It did **not** request flexibility after a $60 quote. It asked about fees; the participant then volunteered $30. This does not establish successful agent negotiation.
- It read the checklist to phone screening, inserted unrequested holding phrases and reversed the roles when asking about drop-off.
- It confirmed the revised total, asked about the deadline and ended after the participant declined the drop-off window. It did not book or accept a transaction.
- The provider returned six facts, four using unknown requirement IDs. The app retained only service and deadline, each with a proposed source-index correction. These remain unreviewed; price and drop-off remain unresolved. The service transcript itself contains ambiguous wording, so source presence is not semantic verification.

Policy **1.3.0** retains strict approved field IDs, shortens the caller contract and unifies preview/spoken questions. It adds explicit screening/hold behavior, customer/shop roles and negotiation-before-fees ordering. Local fixes recognize punctuated dollar quotes, preserve contextual source segments, distinguish unavailable/unknown answers, support audited metadata corrections, and save results atomically. Post-call pattern checks flag the observed negotiation and role problems. In-app recovery is verified with a fake transport, including unchanged request bytes/key and one persisted replay attempt. None of these local checks establishes live voice adherence. The original call payload and transcript remain unchanged. The saved historical result explains the excluded fields and remains unreviewed. Its old facts were not silently remapped or marked successful. No further call was placed; live calling is disabled.

The completed operator recovery followed the [documented same-key, unchanged-body procedure](https://docs.heycall-e.com/calls#recover-after-a-restart-or-lost-response). Private transcripts and recordings remain excluded from Git.

Earlier calls established transcript persistence, a zero-fact unresolved result and an accurately extracted $1,000 amount. They also exposed repeated questioning and a spoken budget ceiling, reinforcing that transport success is not conversation quality.

## Deployment boundary

The September 13 release passed typechecking, 175 tests across 19 suites, all 45 evaluator expectations, the production build, formatting, and 17 browser workflows against an isolated local store. A 2 minute 18 second narrated video demonstrates the fictional workflow without CALL-E credentials or telephone calls. Desktop/mobile screenshots and representative video frames were inspected; the recording reported no page errors. Narration is generated speech. The upstream contribution passed `python3 scripts/validate_repository.py`.

[GitHub CI run 34779858009](https://github.com/ankitlade12/readycheck/actions/runs/34779858009) passed on Ubuntu with Node 24 for release commit **4fcfc8f**: clean dependency installation, all automated checks, five rehearsals and 17 browser workflows. [Upstream PR #570](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/570) is open; opening a contribution does not imply maintainer acceptance.

On September 13, Railway confirmed the workspace plan as **HOBBY** and built release **918659b** with the root Node 24 Dockerfile. Deployment **76b9730d-1df0-48b1-b0e6-d226a1a68022** reached `SUCCESS`. The public app is [readycheck-demo.up.railway.app](https://readycheck-demo.up.railway.app).

Hosted verification used fictional records and no CALL-E credentials:

- The desktop home page loaded without recorded JavaScript errors.
- A repair case loaded three sample responses, displayed quote/source context, resolved its price through a focused fictional follow-up, and saved a shortlist and human-recorded arrangement.
- Signup retained the guest case. Session cookies were Secure, HttpOnly and SameSite=Strict; the Connection UI reported live calling switched off.
- Railway restarted the service, with startup logs confirming the restart. The existing account and saved case/outcome remained available. A fresh browser sign-in, sign-out/sign-in cycle, export, and 390px mobile evidence view passed without recorded page errors or horizontal page overflow.

The service uses one instance and a 500 MB persistent volume at `/app/data`; ReadyCheck has a separate database filename. Existing volume contents were not deleted. A $5 compute-usage alert and $10 hard limit are configured. This is observed functional and restart verification, not a load test, long-term availability guarantee, or hosted backup/restore drill. No runtime memory measurement or direct disk-integrity check was obtained; Railway SSH requires a registered key.

Earlier Free-plan attempts were blocked by an expired trial, a new-project quota, and then a regional peak-hour deployment restriction. The Hobby deployment resolved the deployment blocker. The Render Blueprint still matches its published schema but has not been deployed.

An earlier Docker snapshot passed an isolated backup/restore drill with SQLite integrity checks. Hosted backup/restore, traffic capacity, ongoing usage monitoring, independent extraction accuracy, and live validation of policy 1.3.0 negotiation/screening behavior remain outstanding.

## Reproduce

Follow the [README verification commands](../README.md#verify). Live checks use the separately approved [live protocol](LIVE_TEST_PROTOCOL.md). Record the tested application revision when updating this file; keep private source evidence outside Git.
