# RevisitZero submission readiness matrix

Last verified: 2026-08-16 (Australia/Melbourne)

## Release verdict

**PR-ready and submission-material-ready.** The fake-mode application and release checks pass. One participant-authorised controlled-live call completed at the provider; RevisitZero rejected its contradictory structured result as `MANUAL_REVIEW`, blocked export, and prevented a duplicate call. The corrective pass now uses one authoritative provider outcome, derives local opt-out state, binds explicit outcome rules into approval, and passes regression coverage. A successful golden-path live result is not claimed or required for the credential-free judged path. No retry, push, pull request, public upload, or Devpost submission was performed.

| Release gate | Status | Evidence |
| --- | --- | --- |
| Reproducible install | **Verified** | `npm ci` completed in the clean upstream-integrated copy. |
| Static/type check | **Verified** | `npm run check` exited 0. This standalone app uses TypeScript's strict check as its static gate and has no separate lint script. |
| Focused tests | **Verified** | `npm test`: 6 files, 71 tests passed. Adapter: 34/34; focused adapter + validation: 43/43; live authorization: 6/6. |
| Credential-free demo | **Verified** | `npm run demo`: exactly 3 cases, 1 fake call, 0 real side effects. |
| Production build | **Verified** | `npm run build`: server compilation and Vite 7.3.6 production bundle passed. |
| Production server/API | **Verified** | Built server returned HTTP 200 for `/` and `/api/health`; cases → preview → exact approval → fake result → export completed from the shared workflow. A repeated execution returned the same call/idempotency references with `duplicatePrevented: true`. |
| Browser workbench | **Verified** | In-app browser QA exercised exact approval, golden fake result, approved local export, body-corporate manual review, and safety blocking. |
| Dependency security | **Verified** | `npm audit --audit-level=high`: 0 vulnerabilities. |
| Upstream branch convention | **Verified** | `feat/revisit-zero-meter-access` passed `scripts/check_branch_name.py`. |
| Upstream repository validator | **Verified** | Fresh integrated checkout passed `python3 scripts/validate_repository.py`. |
| Controlled-live real call | **Partially verified; corrective action completed offline** | On 2026-08-16, one authorised call to a consenting test recipient completed at the provider. Exact approval, recipient/window guards, one-attempt execution, ledger duplicate prevention, fail-closed contradiction detection, `MANUAL_REVIEW`, and blocked export were observed. The result contained `OPT_OUT_OUTCOME_CONFLICT`; the corrected non-redundant provider contract and exact outcome instructions now pass regression tests. No successful golden-path live result is claimed. |
| Public PR, video, Devpost entry | **User only** | Publication was not authorized or performed. |

## Official deadline and source-of-truth risk

The official event is [CALL-E: Your Code Is Calling](https://call-e.devpost.com/), governed by the [Official Rules](https://call-e.devpost.com/rules).

The formal Rules say the Submission Period ends **September 14, 2026 at 11:45 am SGT**. Devpost's structured key-date value represents **11:45 pm SGT**, twelve hours later. Because the Rules say they prevail over inconsistent materials, use the earlier deadline:

- September 14, 2026 at 11:45 am SGT
- September 14, 2026 at 1:45 pm Australia/Melbourne (AEST)

Submit earlier unless the sponsor or Devpost provides authoritative written clarification.

## Hackathon and Devpost requirements

| Requirement | Status | Evidence or remaining participant action |
| --- | --- | --- |
| Functional application using CALL-E API/SDK, Skill, or MCP | **Implemented, adapter-tested, and live-boundary verified** | `@call-e/calle@0.2.2` is pinned and imported. Isolated tests verify one-recipient `client.calls.create` requests, the non-redundant provider result contract, stable idempotency/fingerprint metadata, completed structured results, and fail-closed quarantine of invalid or failed/cancelled Calls states. One real provider call completed; its contradictory structured result was quarantined rather than accepted, and the correction is regression-tested. |
| Installs and runs consistently as described | **Verified** | Clean install, check, tests, demo, production build, server/API smoke, and browser QA all passed. |
| New or significantly updated after July 23, 2026 | **User only** | Confirm **Newly created**. If the required explanation field appears, use “Not applicable—newly created during the submission period.” |
| Authorized third-party code/data/media | **Verified for repository** | Declared public packages and fictional fixtures only. Participant must separately inspect final video, music, images, and marks before publication. |
| Stage 1 theme and CALL-E integration | **Verified for implementation, adapter contract, and controlled-live boundary** | One focused phone-based exception-recovery workflow with a guarded official SDK adapter. The credential-free fake path and SDK mappings are verified. One live call completed at the provider and exercised fail-closed validation; its contradictory result was not accepted as a golden-path outcome. |
| Real World Impact | **Verified in materials** | Narrative identifies the costly failed-visit loop and a bounded, auditable recovery decision. |
| Quality of the Idea | **Verified in materials** | Deterministic safety gate, exact approval, one-call limit, strict closed result, and separate export approval are implemented and tested. |
| Technical Implementation | **Verified for fake flow, isolated adapter mappings, corrective contract, and live fail-closed boundary** | Official SDK import and guarded adapter invocation are implemented. The 32 adapter tests (41 with validation) verify request shape, the supported provider-schema subset, single-source contact outcome, derived local opt-out, exact outcome instructions, fingerprint/idempotency, completed recipient results, fail-closed failed/cancelled-state quarantine, exact-window/`NONE` handling, recipient binding, base URL, official API errors, and zero create retry without contacting CALL-E. Fake mode proves the full application flow without credentials. The authorised live test verified one provider attempt and duplicate prevention, then quarantined the conflict now covered by regression tests. |
| Product Experience & Demo | **Verified for build** | API-wired one-page, three-column workbench and a rehearsable 2:45 storyboard cover all three cases. Participant must record the video. |
| Public PR to `CALLE-AI/awesome-phone-call-agents` | **User only** | Open after participant authorization. Suggested title: `feat(apps): add RevisitZero meter-access recovery`. |
| Text description | **Verified** | `docs/devpost-submission.md`. |
| Public YouTube/Vimeo demo under 3 minutes | **User only** | `docs/demo-script.md` targets 2:45. Record, inspect, and upload publicly; judges need not watch beyond 3:00. |
| Testing access/instructions | **Verified** | README and Devpost draft provide credential-free commands and browser path. A hosted URL is optional. |
| CALL-E account email | **User only** | Enter only in Devpost; never add it to source, screenshots, logs, or documentation. |
| Submitter type, country, app status, eligibility/conflict attestations | **User only** | Participant supplies accurate identity and legal facts. |
| Primary use case | **Verified** | Exact official option: **Order / exception follow-up**. |
| One-sentence task | **Verified** | Draft matches the tested product boundary. |
| Optional hosted app URL | **Optional** | The official form does not require a website or ZIP. |
| Submit before deadline | **User only** | Use the earlier Rules cutoff above. |

## Upstream contribution requirements

| Requirement | Status | Evidence |
| --- | --- | --- |
| Correct path | **Verified** | `apps/typescript/revisit-zero/`. |
| English-only content | **Verified** | Source/docs inspection and upstream validator passed. |
| README setup/usage, modes, credentials, side effects, cancellation, limitations | **Verified** | App README covers each item. |
| Fake/no-call default | **Verified** | Fake transport is default; demo completed with 0 real side effects. |
| Server-side credentials | **Verified** | Secret is read only by the server; `.env.example` contains no key or real number. |
| Explicit side effects and rollback/cancellation | **Verified with provider limitation disclosed** | README states that live mode submits one task for one recipient/phone and never resubmits, ambiguity is reconciled without redial, and export is local only. The Calls API has no client cancellation operation. The authorised live test observed one completed provider attempt and no duplicate/redial. |
| Opt-in controlled-live instructions | **Verified** | All flags, exact test-recipient binding, current window, and explicit approval are documented. |
| Public packages only | **Verified** | Lockfile uses registry packages and no local-path or monorepo-protocol dependency; upstream validator passed. |
| Tests/manual verification | **Verified** | 63 automated tests across 5 files; adapter 32/32; focused adapter + validation 41/41; plus CLI and production/API verification. |
| Fictional/masked numbers | **Verified** | ACMA-reserved fictional mobile numbers in fixtures; API/UI/export mask recipients. |
| No secrets, private data, recordings, or transcripts | **Verified** | Final diff review found none. |
| Explicit intent, E.164 validation, duplicate prevention, risk boundaries | **Verified for local workflow and live guards** | Policy, preview, workflow tests, guarded adapter implementation, and README. Provider-status mappings are tracked separately below and are not inferred from static inspection. |
| Root README app row | **Verified** | Added in clean upstream change set. |
| `apps/README.md` app row | **Verified** | Added in clean upstream change set. |
| Branch and PR naming | **Verified** | Suggested branch checker passed; title follows Conventional Commits. |
| Repository validator | **Verified** | Integrated validator exited 0 with “Repository validation passed.” |
| Clean PR-ready diff | **Verified** | Scope is two upstream list rows plus the RevisitZero app; no dependency directory, build output, local export, environment file, credential, or real data. |

## Locked product and safety requirements

| Requirement | Status | Evidence |
| --- | --- | --- |
| Promise and single workflow | **Verified** | “One failed visit. One controlled call. One trustworthy rebook decision.” is implemented as gate → preview/approval → at-most-one call → validation → recommendation → export decision. |
| Stop at local export | **Verified** | No booking, CRM/retailer update, notification, or downstream mutation exists. |
| Exactly three fictional cases | **Verified** | IDs `MTR-2026-0042`, `MTR-2026-0043`, and `MTR-2026-0044` only. |
| Golden case ready | **Verified** | Gate/dog/obstruction/presence resolved, `THU_PM` selected, no code collected → `READY_FOR_REBOOK_REVIEW`. |
| Body-corporate case manual | **Verified** | External-party access → `MANUAL_REVIEW_REQUIRED` / `MANUAL_REVIEW`, transport count unchanged. |
| Suspected defect blocked | **Verified** | Technical/site defect → `AUTOMATION_BLOCKED` before approval or call. |
| All four pre-call decisions | **Verified** | Eligible, manual review, automation blocked, and closed window implemented and tested. |
| Protected-risk blocks | **Verified** | Technical/safety defect, hazardous material, vulnerability/life support, emergency/outage, billing/disconnection dispute, missing authorization, invalid E.164, and closed/expired window fail closed. |
| Exact content-bound approval | **Verified** | Case, recipient, objective, questions, windows, and guardrails are canonicalized and hashed; individual mutations invalidate approval. |
| Stable one-call idempotency | **Verified** | Key is stable per case; one-call ledger prevents a second call after edits/reapproval. Provider metadata must echo the approved-preview fingerprint. |
| Ambiguity handling | **Verified** | Ambiguous/rejected provider outcome is preserved for reconciliation and never automatically redialed. |
| Closed non-sensitive result | **Verified** | Exact-key schema excludes names, addresses, account numbers, codes, passwords, payment, medical data, photos, and narratives. Provider wire schema uses explicit supported types, no unions, and bounded string enums only. |
| Strict validation/contradiction detection | **Verified** | Provider `NONE` normalizes locally to `null`; unknown, malformed, extra-field, conflicting, inapplicable, or unapproved-window results cannot become ready. |
| All deterministic dispositions | **Verified** | Ready, not ready, manual review, do not contact, unreached, and automation blocked are implemented. `UNREACHED` is verified through explicit fake/domain outcomes, not inferred from live Calls failure strings. |
| Opt-out suppression | **Verified** | Valid opt-out produces `DO_NOT_CONTACT` and suppresses later automated contact. |
| Final audit view | **Verified** | Shared workflow data supplies source failure, validated result, reasons/unresolved fields, masked recipient, call ID, idempotency, approval, reconciliation, and export controls. |
| Human export decision | **Verified** | Reject returns no packet; approve requires a validated exact-approved run and yields `LOCAL_JSON_EXPORT_ONLY`. |
| One-page desktop UI only | **Verified** | Three columns, three case tabs, no login/admin/analytics/customer portal/additional pages. |
| Controlled official live runtime | **Implemented, adapter-tested, corrected, and partially live-verified** | Tests verify one-recipient SDK requests, `recipientResultSchema` using only the documented subset, one authoritative contact outcome with derived local opt-out, exact outcome instructions, exact phone binding, stable fingerprint/idempotency metadata, completed results, provider-wire mismatch rejection, fail-closed failed/cancelled-state quarantine, official API-error handling, and zero create retry. Secrets, flags, window, consent and approval gates are server-side. One authorised provider call completed; strict validation quarantined its contradictory result and blocked export. |
| Hard exclusions | **Verified** | No booking, production integration, bulk/multiple recipients, body-corporate outreach, code collection, upload, diagnosis, ML, analytics, SMS/email, multilingual/inbound calls, retry, SSO, or mobile app. |

## Acceptance test evidence

| Acceptance case | Status | Evidence |
| --- | --- | --- |
| Eligible case; blocked safety; missing authorization; expired window; invalid E.164 | **Verified** | `test/policy.test.ts`. |
| Hazardous material; vulnerability/life support; emergency/outage; billing/disconnection dispute | **Verified** | Table-driven protected-risk policy test. |
| Golden resolved blockers | **Verified** | Workflow test and demo produce `READY_FOR_REBOOK_REVIEW`. |
| Negative/unknown blockers | **Verified** | Decision/validation tests produce `NOT_READY` or `MANUAL_REVIEW`, never ready. |
| External access party | **Verified** | Policy and demo produce manual review with zero call. |
| Malformed, unknown-key, extra-field, contradictory result | **Verified** | Strict validation tests fail closed. |
| Opt-out suppression | **Verified** | Workflow test produces `DO_NOT_CONTACT` and blocks subsequent automated contact. |
| Duplicate prevention | **Verified** | Workflow test and API smoke prove one transport invocation and stable references. |
| Approval invalidation | **Verified** | Preview tests mutate case, recipient, objective, questions, windows, and guardrails independently. |
| Ambiguous outcome preservation | **Verified in workflow and isolated adapter tests** | Tests preserve rejection, conflict, timeout, missing-ID/result, every failed/cancelled Calls state, and candidate/unknown/mixed/contradictory failure strings for reconciliation, and prove zero create retry/redial. |
| Failed/cancelled Calls status handling | **Verified fail-closed in isolated adapter tests** | Calls `failureCode` is an unconstrained string with no documented unreachable values. Candidate strings `no_answer`, `declined`, `voicemail`, `busy`, and `expired`, plus unknown or mixed strings, become `AMBIGUOUS` reconciliation—never verified `UNREACHED`. |
| Provider wire-schema compatibility | **Verified in focused adapter and validation tests** | No `const` or union types; `schemaVersion` is a one-value string enum; `contactOutcome` is the only provider-facing contact/opt-out source; `selectedVisitWindowId` is the exact approved-window string enum plus `NONE`; local opt-out is derived; `NONE` normalizes to local `null`; unexpected fields and unapproved strings fail closed. |
| Live recipient and current-window controls | **Verified in guards, tests, and one controlled-live attempt** | Tests require the exact consenting recipient, approved request binding, official base URL, and a valid current window of at most four hours. One participant-authorised call passed these controls and completed at the provider; its structured result failed contradiction validation. |
| Export approve/reject | **Verified** | Workflow/API paths enforce separate human decision and local-only packet. |
| Exactly three demo cases, one fake call, no real side effects | **Verified** | `npm run demo` output. |
| Browser uses shared server/workflow | **Verified** | Browser and API QA traced cases → preview → approval → result → export; no fabricated browser result IDs or packet. |

## Submission deliverables

| Deliverable | Status | Location |
| --- | --- | --- |
| Runnable app, lockfile, README, environment example | **Verified** | App root. |
| Focused tests and fake demo | **Verified** | `test/` and `demo/`. |
| Devpost description and judging narrative | **Verified** | `docs/devpost-submission.md`. |
| Testing instructions | **Verified** | README and Devpost draft. |
| Architecture/screenshot plan | **Verified** | `docs/visual-plan.md`; release screenshot captured during browser QA. |
| Public-video-ready 2:40–2:50 storyboard | **Verified** | `docs/demo-script.md`. |
| Upstream list integration and PR-ready change set | **Verified** | Clean upstream copy and generated patch/package. |
| Public PR URL | **User only** | Not yet created. |
| Public video URL | **User only** | Not yet recorded/uploaded. |
| Submitted Devpost entry | **User only** | Not yet submitted. |

## Remaining participant-only steps

1. Read and accept the Official Rules; verify age, jurisdiction, country, and conflict eligibility; register on Devpost.
2. Enter the CALL-E-account email only in Devpost.
3. Review the recorded controlled-live outcome. The corrective pass is complete; optionally provide fresh explicit authorisation for one final golden-path live retest, but never reuse the previous approval or redial automatically.
4. Record the 2:45 fake-mode demo, inspect it for secrets/real data/unlicensed material, and upload it publicly to YouTube or Vimeo.
5. Authorize the fork/branch/commit/push/public PR and use the suggested branch/title.
6. Paste the public PR and video URLs into Devpost, complete identity/status fields accurately, and submit before the earlier Rules cutoff.

## Definition of done

A fresh reviewer can install, test, build, run the fake demo, and exercise all three shared-workflow UI cases without credentials; understand the controlled-live path, observed fail-closed evidence, corrective contract, and safety boundaries; and use the refreshed patch, archives, docs, and video script to publish the submission. This gate is met. Remaining actions require participant identity, optional fresh live-call authorisation, or publication authority.
