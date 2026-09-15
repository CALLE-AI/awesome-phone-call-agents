# Submission review findings

Reviewed on 2026-09-10. This is a targeted review of four PR discussions and three app READMEs in the official repository, not an audit of every submission or an independent verification of their code. PR comments describe findings at particular revisions; later contributor reports are not proof that all issues are resolved.

## Findings from PR feedback

| Source | Reported finding | Application to Senior Phone AI |
|---|---|---|
| [PR 395: initial feedback](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/395#issuecomment-5600295399) | Review requested real endpoint authentication, exact destination authorization, restricted credential destinations, thorough masking and durable handling of uncertain dispatch. | Enforce these on the server. A spoken confirmation or public phrase cannot replace authentication. Bind consent to stored intent. |
| [PR 395: later privacy feedback](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/395#issuecomment-5611812355) | A new public demo introduced name/phone exposure; masking missed formatted and local numbers. | Review screenshots, videos, logs and history as well as code. Prefer number-free synthetic fixtures; validate any reserved examples before publication. |
| [PR 387: initial feedback](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/387#issuecomment-5594864415) | Review flagged unauthenticated routes, unsafe default execution, inconsistent environment names and provider output rendered as HTML. | Make clean setup reproducible and no-call by default. Render untrusted output as text. |
| [PR 387: retry feedback](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/387#issuecomment-5600295429) | An uncertain create result triggered another create; nested error/evidence paths could expose data. | Halt and reconcile uncertain calls. Redact nested payloads and errors before returning or logging them. |
| [PR 413: review](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/413#issuecomment-5611763625) | Feedback covered public logs, shell interpolation, destination authorization, sensitive fixtures, clinical claims and production-start failure. | Avoid shell-built provider calls. Verify production startup, protect every data route and describe only demonstrated capabilities. |
| [PR 383: review](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/383#issuecomment-5594864393) | Review reported obfuscated downloader/process-launching additions to unrelated configs, contribution mismatch and exposed clinical/contact data. | Inspect any borrowed code before running it. Keep the diff scoped and exclude unrelated configuration changes. Do not treat an open PR as approved code. |

## Patterns in existing official-repository apps

- [Clarity](https://github.com/CALLE-AI/awesome-phone-call-agents/blob/main/apps/typescript/clarity/README.md) is a useful Next.js reference for labeled synthetic replay, server-held destination consent, durable call reservations and reconciliation. Its documented single-operator, persistent-disk design does not suit our multi-user Supabase deployment unchanged. Closing a browser does not cancel an accepted call.
- [KinCall](https://github.com/CALLE-AI/awesome-phone-call-agents/blob/main/apps/typescript/kincall/README.md) separates model interpretation from deterministic action decisions. The checked-in artifact is a no-network decision-layer extract, not its full hosted application. Borrow the separation and honest outcome reporting; retain our explicit-request-only family outreach policy rather than adopting its escalation policy.
- [Webhook result receiver](https://github.com/CALLE-AI/awesome-phone-call-agents/blob/main/apps/python/webhook-result-receiver/README.md) documents unsigned notifications as prompts to retrieve authoritative state through authenticated API access. Event-ID equality is not authentication. Keep durable receipt handling separate from business intent. Verify the chosen MCP/provider contract before adopting a webhook path; our plan does not assume CALL-E inbound result webhooks.

## Decisions for our implementation

The following are project decisions inferred from the review, not newly asserted provider guarantees.

1. Use `apps/typescript/senior-phone-ai/`, following the runtime grouping in [CONTRIBUTING.md](https://github.com/CALLE-AI/awesome-phone-call-agents/blob/main/CONTRIBUTING.md). Keep long-form planning here under `docs/senior-phone-ai/`.
2. Protect exposed session-creation, call, SMS and data endpoints from the first technical spike. Full family authentication arrives later, but no public unauthenticated spike should spend credentials or reveal call data.
3. Store consent against the exact recipient, purpose and action. Changes invalidate approval. Use strict ASCII E.164 at the dispatch boundary; conversational input may be clarified before confirmation.
4. Restrict credential-bearing provider requests to verified service origins and reject redirects that could expose credentials. Keep fake endpoints isolated from real keys.
5. Persist business intent before dispatch and preserve it through crashes. Unknown dispatch halts further creates pending reconciliation, including requests from another session or worker.
6. Use schema-selected outputs, nested redaction and text rendering. Protect transcripts with authorization; never serve raw log directories.
7. Keep offline demonstrations explicitly synthetic. The live telephone search gate still requires actual external retrieval and a same-call spoken answer.
8. Review the complete PR diff, fixtures and public demo artifacts. Verify clean install, build and production start in addition to tests and repository validation. Keep product claims limited to demonstrated behavior.

These decisions are incorporated into SPA-001, SPA-002, SPA-004, SPA-005, SPA-010, SPA-013, SPA-014 and SPA-015 in the [tracker](README.md). No implementation ticket is complete as a result of this review.
