# `awesome-phone-call-agents` Pull-Request Material

Status: pull-request-ready repository-local draft only. Do not publish or open a pull request without separate authorization. Current contribution guidance was refreshed from the official repository on 2026-08-19 and must be rechecked before the PR.

## Proposed entry

**Muster — Evidence-backed greenhouse phone observation**

Muster demonstrates how a fleet operator can turn a synthetic four-zone greenhouse phone report into durable, inspectable evidence. A dedicated non-production host uses one-use authorization, an at-most-one CALL-E dispatch, bounded transcript custody, and transcript-before-interpretation presentation. Deterministic replay is the dependable judging path, and every result is visibly `SIMULATED`.

README entry format for the current awesome list:

```text
- [Muster](<PUBLIC_PROJECT_URL>) - Turns simulated greenhouse phone reports into durable, transcript-first operational evidence with an opt-in CALL-E path.
```

Suggested supporting links at PR time: public repository or runnable project, public under-three-minute demo video, and Devpost project page. These links are intentionally absent until separately authorized publication creates them.

## Technical proof summary

- PostgreSQL establishes operation identity before pg-boss or provider work.
- Authorization is scenario/revision/target bound, one-use, zero-retry, and DTMF-forbidden.
- Provider facts and retained evidence precede derivation; recovery keeps exact predecessor lineage.
- Production API, worker, and web artifacts exclude simulator-host/CALL-E composition.
- Deterministic replay is network-free and never represented as live.
- One separately authorized non-production `synthetic-normal` run completed through CALL-E and the owned Twilio boundary: exactly one dispatch, signed voice/canary/status callbacks, zero DTMF, admissible evidence, four grounded readings, one matching completed call, and verified cleanup. This is synthetic-lifecycle evidence, not physical-device or production-readiness evidence.

### Independent anti-stub proof

The disposable integration test injects materially distinct normal and abnormal provider reports through separate one-use local runtimes. A test-owned oracle, unavailable to production derivation, verifies distinct transcript tokens and Zone 2 readings/statuses. This proves the composed path is input-sensitive without claiming an external CALL-E outcome.

## Current contribution-guide fit

The official contribution guide accepts either a runnable application under `apps/<runtime>/<name>` or an awesome-list README entry. The proposed integration is the README entry above unless a later authorized review chooses to package a standalone runnable example. In either form, the contribution must be English, identify provider/host and side effects, document setup, mask numbers, contain no secrets/private phones/personal data, default to dry-run/fake/no-call behavior, make live verification opt-in, and include tests or manual verification.

## PR checklist

- [ ] Re-read the target repository's current contribution guide and README entry schema.
- [ ] Confirm project, demo-video, and Devpost links are public and stable.
- [ ] Preserve `SIMULATED` and the hardware/production compatibility ceiling.
- [ ] State provider/host, side effects, setup, fake/no-call default, and opt-in live verification.
- [ ] Include no phone value, credential, permit, provider ID, transcript, provider payload, or personal data.
- [ ] Run the repository's required `python3 scripts/validate_repository.py` and any targeted application checks.
- [ ] Use exactly one factual sentence in the awesome-list entry.
- [ ] Obtain separate authorization to fork, push, or open the pull request.
- [ ] Copy the resulting PR URL into the Devpost submission only after the PR is open and public.

## Provenance

Prepared from authored synthetic fixture contracts, the public architecture contracts, and the official `awesome-phone-call-agents` contribution guide. This draft does not contain provider recordings, raw transcripts, private task history, credentials, or a submitted contribution URL. Current formatting and contribution rules require one final re-verification immediately before an authorized PR. The intended contribution area is User-facing Apps; use a descriptive TypeScript app name such as `muster-greenhouse` to distinguish unrelated projects with similar names.
