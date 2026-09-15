# Community Review and Merge Policy

Policy version: 2026-09-11. This policy governs review severity and merge decisions,
including older PRs and automated reviews. It supersedes stricter historical review
comments. Apply it alongside AGENTS.md and CONTRIBUTING.md; do not turn optional
hardening or tooling labels into additional merge requirements.

## Merge gate

Merge a non-draft PR when GitHub reports it mergeable, proportionate validation
supports its documented workflow, and no current Must Fix remains. Should Fix and
Nice to Have findings do not block. Missing CI, an UNSTABLE label, unrelated existing
failures, limited coverage, and unavailable external infrastructure are not themselves
blockers. Explain validation limits; do not equate an untested path with a demonstrated
defect or assume an unverified critical safety boundary works.

## Contribution tiers

- **Community / Experimental / reference:** directly relevant to CALL-E or portable
  AI-agent phone-call workflows, runnable or honestly described as documentation or
  an external resource, with setup and material limitations. Executable examples
  default to fake, preview, or dry-run for consequential side effects.
- **Hackathon / live-capable demo:** additionally require explicit per-run operator
  intent, authorized valid E.164 destinations, masked user-facing/logged real phone
  numbers, and credentials restricted to approved secure origins. A local operator's
  explicit attestation that recipients authorized the calls is sufficient; do not
  require uploaded consent evidence, enterprise RBAC, or per-recipient approval
  infrastructure. Remote access to real calling or real private records requires
  basic authentication and authorization.
- **Production-ready:** apply production controls only to explicit production
  guarantees or an immediately reachable concrete harm. Authors may remove those
  claims or reduce scope instead of implementing a production platform.

Public read-only APIs and model/static-resource downloads are allowed in a default
demo. Calls, payments, recurring jobs, and consequential external mutations require
clear opt-in. A public demo reliably restricted to synthetic data and incapable of
calling or accessing real records does not need authentication.

After an ambiguous call submission, stop automatic redial and conflicting subsequent
side effects. Use a stable intent/dedupe key where supported. Perfect payload hashing,
WALs, outboxes, distributed locks, crash-proof checkpoints, and full reconciliation
are follow-ups unless a concrete automatic duplicate-call path exists.

Honest cancellation limitations are sufficient: explain when a submitted call cannot
be recalled and that closing a page need not stop it. Do not require production
cancellation infrastructure or claim cancellation succeeded without evidence.

Heuristic NLP and advisory results are acceptable when labeled experimental and not
used to automatically make consequential medical, legal, financial, employment, or
safety decisions. Sandbox-only high-stakes demos with real external mutations disabled
by default are acceptable. Limited language coverage, local state, and incomplete
production recovery are follow-ups.

## Privacy and history

Inspect the PR tree, diff, and content-bearing commits that would enter repository
history. Use relevant prior evidence; inspect linked public source/history when it
directly bears on the contribution. Do not redesign or certify an external application.

- Actual credentials, private third-party data, unauthorized recordings/transcripts,
  and real private test-call artifacts remain Must Fix. Remove them from the current
  contribution and affected merge history. Revoke/rotate exposed credentials; report
  public-default-branch exposure promptly and pursue practical history remediation.
- Do not classify every realistic-looking string or transcript/log/screenshot as a
  leak. Clearly synthetic, non-identifying examples and conversations are allowed.
  Prefer reserved example domains and phone ranges. An unambiguously synthetic
  non-reserved fixture in a no-call path is a mechanical Should Fix; it must never
  become a default live destination. Ambiguous examples can be replaced or clarified.
- An author intentionally publishing their own project contact is allowed when that
  intent is evident from context or their confirmation. Accidental personal details
  should be replaced; ordinary commit author metadata is not a finding. Do not infer
  consent for a third party.
- Old author contact details or synthetic fixtures excluded by a clean rewrite from
  the history being merged are not blocked solely because an old SHA still resolves
  through a hosting-provider cache. Platform purge/support confirmation is not a
  universal merge prerequisite. Record a follow-up proportionate to concrete risk.
  This exception does not waive actual secrets or third-party sensitive-data exposure.

Never quote exposed sensitive values in public review comments.

## Claims and validation

Require truthful scope and behavior. Demonstrably false safety, cancellation, financial
effect, or production-readiness claims block until corrected. Author-reported tests,
benchmarks, or private demonstrations may be labeled "author-reported; not independently
verified"; do not demand publication of private evidence. Neither a hosted deployment,
a video, a benchmark, nor live-call proof is required. Accept a smaller complete
contribution after removing unfinished features.

A small demo can pass with one reproducible fake/dry-run/manual verification path.
Do not require a new test suite or full integration environment. Run repository
validation on a clean source tree and focused checks relevant to the change. Ignore
untracked dependency/build directories when attributing validator failures. Never
use real credentials or place a call during review.

## Must Fix and bounded review

Only these conditions block:

- Unresolved material repository-rule violations, destructive/unrelated changes, or
  demonstrated breakage of the documented basic workflow.
- Live side effects by default, missing explicit intent, unauthorized/invalid live
  destinations, concrete duplicate-call paths, or automatic conflicting side effects
  after an ambiguous outcome.
- Actual sensitive-data/credential exposure under the privacy rules above, credentials
  sent to arbitrary/insecure origins, unauthenticated remote real-call/private-record
  access, or exploitable XSS.
- Consequential high-stakes automatic actions based on unbound/invalid results, or
  materially false claims that have not been corrected or appropriately qualified.

Reassess every old blocker under this policy. Explicitly withdraw or downgrade obsolete
or overstrict findings with a concise superseding note. Freeze the remaining acceptance
list after a complete review; add blockers later only for newly introduced issues or
newly discovered concrete P0/P1 risks, explaining why. Do not reopen a general audit
when the acceptance list is closed.

Maintainers may make small bounded fixes when edits are permitted: simple main
conflicts, placement, English wording, names, a few masked outputs, fictional fixtures,
or qualified claims. Validate and merge without another author round-trip. Do not
rewrite an application's architecture or public history as a mechanical cleanup.
