# Public Demo Smoke Record — August 13, 2026

- Target: <https://fieldclose.dramaforge.icu/>
- Observation time: `2026-08-13T08:07:46Z`
- Scope: Read-only signed-out smoke test plus isolated local fake-provider flow
- Live calls placed: `0`
- Accounts created: `0`

## Deployed signed-out checks

The public URL loaded over HTTPS in two independent Chromium sessions. The page
title was `FieldClose`, the canonical URL remained on the expected domain, and
the visible home page included `Public demo · No phone call placed`.

Desktop observation:

- viewport width: `1280px`;
- document width: `1265px`;
- public navigation, fake-only label, fixed fictional work-order preview, and
  sign-in entry were present;
- the sign-in entry opened `/?auth=signin` and displayed the account dialog with
  `Public demo · fake only`.

Mobile observation:

- viewport: `375px × 812px`;
- document width: `375px`, with no horizontal overflow;
- compact navigation opened and exposed the sign-in and demo-workspace links;
- the sign-in link opened `/?auth=signin` and the account dialog remained
  readable at 375px;
- the fake-only label remained present in the mobile accessibility snapshot.

No credentials were entered and no account, case, approval, provider attempt,
or disposition was created against the deployed environment.

## Isolated fake-provider workflow check

The repository's intercepted-browser workflow was run at `375px × 812px`. It
covered:

1. the fixed fictional case form;
2. case creation;
3. exact-brief review and three approval attestations;
4. one approved fake simulation;
5. normalized result review;
6. human disposition;
7. closed FieldClose case state; and
8. append-only audit evidence.

The regression also confirmed that an empty mobile queue keeps `.rail-empty`
visible while the non-actionable right-side `.empty-workspace` is hidden. The
empty-state `Create the first case` action remains available. No CSS change was
required.

Command:

```text
pnpm test:e2e -- tests/e2e/closeout-workflow.spec.ts
```

Result: `8 passed`, including the protected-live fixture, which intercepts the
HTTP boundary and cannot place a phone call.

## Open evidence gates

This record does **not** complete the full deployed judge smoke test:

- no dedicated reviewer account was used, so the deployed authenticated path
  from case creation through audit was not exercised;
- the deployed server environment and provider-request logs were not available,
  so absence of CALL-E credentials and provider emissions was not independently
  inspected during this run;
- a direct command-line TLS/certificate probe failed at the current network
  transport layer even though both Chromium sessions completed HTTPS
  navigation, so certificate expiry monitoring is not verified;
- no recurring availability or certificate-expiry monitor is configured by
  this repository evidence;
- the deployed commit identifier was not exposed to the signed-out client and
  remains unverified.

W5 must remain open until a maintainer supplies a private reviewer account,
confirms the deployed build and environment boundary, runs the complete
authenticated golden path in a fresh browser profile, and records ongoing
availability and certificate monitoring.

## Evidence boundary for later follow-ups

The later sections combine browser-visible observations with
maintainer-reported private operational checks. The public URL, repository tree,
pull-request discussion, and visible CI result are independently reviewable.
Private accounts, server configuration, deployment artifacts, and internal
revision identifiers are not public provenance and must not be treated as such.

## August 24 browser follow-up

A direct in-app-browser follow-up rechecked the deployed signed-out experience
without submitting a form or creating an account.

- The desktop landing page exposed the public fake-only boundary with both
  `Public demo · No phone call placed` and `Public demo · fake only` copy.
- The account dialog exposed password and email-code sign-in methods.
- The deployed signup dialog required name, username, work email, and password.
  This differs from the newer repository UI, which derives the internal
  username and no longer asks the user for a separate username; the deployed
  smoke result therefore applies only to the deployment observed at that time.
- At `375px × 812px`, the signup dialog occupied the viewport, retained all
  fields and the submit action, and produced no horizontal overflow
  (`scrollWidth=375`, `clientWidth=375`).
- No email, password, verification code, account, case, provider request, or
  live call was created.

The authenticated golden path remains blocked on a dedicated reviewer account.
Current signup requires an inbox that can receive the one-time verification
code. The mailbox may be a dedicated test address or alias and does not need to
represent a real person, but a nonexistent address cannot complete the deployed
verification flow.

## August 24 authenticated judge follow-up

A dedicated judge mailbox completed public signup, one-time email verification,
and the authenticated desktop golden path against the maintainer-operated
deployment. The exact deployment revision is intentionally not cited because it
is not publicly accessible and therefore cannot serve as public provenance. The
mailbox address and generated account credential are private and are not
recorded in this public smoke file.

The observed workflow was:

1. create the per-user demo workspace;
2. restore and create the fixed `WO-DEMO-1042` fictional case;
3. review the exact brief, masked reserved-range contact, three permitted
   questions, AI disclosure, and hard authority boundaries;
4. complete all three fake-only attestations and approve one exact digest;
5. confirm `Provider fake`, `Live approved: no`, and `No phone call` before
   execution;
6. run the deterministic `Clear closeout` simulation;
7. review the normalized `operating as expected`, no unresolved issue, and no
   return-visit request result;
8. record the human `Accept closeout review` disposition; and
9. inspect the closed case and six append-only audit transitions covering case
   creation, approval, request, fake-provider acceptance, normalization, and
   human disposition.

The UI continued to display `Simulation environment`, `Simulated calls only`,
and the masked reserved-range number. Server-side verification found one
verified judge account, one fake-only demo workspace, zero live workspaces,
zero live attempts in both public and staging databases, and the durable live
kill switch paused. No CALL-E phone call was placed.

The signup attempt also exposed a deployment-configuration mismatch: the new
runtime correctly rejected database host aliases as non-loopback URLs without
`sslmode=verify-full`, even though both aliases resolved to `127.0.0.1` and
PostgreSQL listened only on loopback. The deployed environment files were
backed up and changed to use the literal `127.0.0.1` host while preserving each
database, role, and credential. Both public and staging authentication health
endpoints then returned `200`.

This completes the authenticated desktop golden-path evidence.

## August 24 judge-period monitoring follow-up

A daily Codex heartbeat named `fieldclose-judge-period-monitor` is configured to
run at 09:00 Asia/Shanghai through the judging-period cutoff at 17:00 SGT on
October 13, 2026. It notifies the maintainer only on a failed run and performs
read-only checks for:

- public HTTP `200` plus the fake-only/no-call marker;
- staging HTTP `401` without Basic Auth and `200` with the server-side credential
  handoff, without printing the credential;
- active public, staging, Caddy, and PostgreSQL services;
- TLS expiry for both hostnames, failing when fewer than 21 days remain; and
- the durable live kill switch remaining paused and the live-attempt count
  remaining zero in both databases.

The heartbeat is forbidden from remediation, sending email, or creating or
approving a phone call. Its initial baseline completed successfully: both web
status boundaries and the fake-only marker matched, all four services were
active, both live gates were paused with zero live attempts, and both TLS
certificates expired at `2026-11-01T23:59:59Z`, 69 days after the check.

## August 24 authenticated 375 px follow-up

The existing judge workspace was reused at a `375 px × 812 px` viewport for a
second fake-only golden path. Reusing the fixed `WO-DEMO-1042` reference first
exercised the workspace-scoped uniqueness guard: the server rejected the
duplicate case, the UI stated that no call was placed, and aggregate database
counts remained at one case, one contact, and six audit events.

The work-order reference was then changed to the explicitly synthetic
`WO-DEMO-1042-MOBILE`; all other fixed fictional fields remained unchanged. The
mobile flow completed exact-brief review, all three attestations, one fake
approval, deterministic clear-closeout execution, normalized result review,
human disposition, closed case state, and six append-only audit transitions.
The execution view displayed `Provider fake`, `Live approved: no`, and `No phone
call` before the simulation ran.

The final authenticated layout reported `innerWidth=375`, `clientWidth=360`,
and `scrollWidth=360`, so no horizontal overflow was present. Read-only server
verification then found two cases, two contacts, two attempts, two results, two
human dispositions, and twelve audit events in the public database. Public and
staging retained paused durable live gates and zero live attempts. No CALL-E
phone call was placed.

W5 remains open for a fresh-profile or incognito authenticated run and
confirmation after the judging period that the public demo remained available
through the cutoff.
