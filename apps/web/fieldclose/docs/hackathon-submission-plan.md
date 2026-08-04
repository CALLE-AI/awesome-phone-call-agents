# FieldClose Hackathon Submission Plan

## Status

- Objective: Compete for **Most Practical Use Case**
- Scope: Frozen to one human-approved commercial HVAC closeout call
- Last updated: 2026-08-04
- Current phase: Capture authorized live evidence and package the submission

## Submission thesis

FieldClose turns one approved after-service confirmation call into a
trustworthy, structured, actionable next step for a human operator. The
submission must show this as one continuous chain:

```text
Preset fictional work order
        -> exact brief and one-attempt approval
        -> CALL-E or clearly labeled fake execution
        -> uncertainty-preserving structured result
        -> operator records a bounded human disposition
        -> resolved task and final FieldClose case state
        -> audit and duplicate protection
```

The submission is not judged by feature count. Recording the final human
disposition completes the already-defined workflow; it is not a new product
workflow or an expansion of the UI information architecture.

## Current readiness snapshot

As of 2026-08-04:

- the workflow is implemented from case creation through normalized result,
  creation of a human next-action task, and role-gated final disposition;
- durable `HumanDisposition` persistence, the application service and API,
  route-appropriate operator control, task resolution, final case state, and
  redacted audit evidence are implemented;
- the deterministic fake path, protected live path, conservative result
  handling, duplicate protection, reconciliation, and audit behavior have
  automated coverage through final human disposition;
- the repository validation gate has passed locally across type-check, lint,
  unit tests, Drizzle schema validation, PostgreSQL integration tests,
  production build, and Playwright;
- the fake-only judge environment is deployed at
  <https://fieldclose.dramaforge.icu/> and retains its build-time no-call gate;
- the isolated protected staging environment is deployed with CALL-E and SMTP
  configuration while live calls remain paused by default;
- no authorized live CALL-E result, upstream pull request, or final
  three-minute video is claimed.

P0A and the two deployment steps in P0B are complete. Remaining work begins
with participant authorization and one controlled live evidence run, followed
by submission packaging. The only later product convenience is a preset
fictional work order for the demonstration; it must use the existing case
workflow and must not create a new stage.

## P0 — Complete the functional loop, then deploy

### P0A — Human-disposition closure

P0A was the deployment gate for the operator-owned final step. It is now
satisfied without adding scheduling, invoicing, diagnosis, pricing, or external
work-order mutation.

| Item | Status | Done when |
| --- | --- | --- |
| Freeze product scope and UI information architecture | Done | The product specification records the freeze and every proposed change passes the submission change filter |
| Define the bounded disposition contract | Done | The product, data, API, and UI documents agree on roles, outcomes, stale-write handling, task resolution, final state, and prohibited effects |
| Add durable disposition persistence | Done | Migration `0005` adds the bounded outcome record and enforces one final disposition per MVP case with valid case/task relationships |
| Implement the application service and API | Done | An owner/operator can atomically record one route-appropriate disposition; exact repeats are idempotent and stale or conflicting requests fail without mutation |
| Implement the operator disposition UI | Done | Result and exception views provide the permitted action, bounded note, submitted state, final case state, resolved task, and visible audit evidence |
| Add complete automated coverage | Done | Unit and PostgreSQL tests cover every outcome, permissions, route constraints, idempotency, stale state, audit redaction, and task/case atomicity; Playwright covers case creation through final human disposition |
| Pass formal validation after closure | Done | `pnpm validate` passes with 84 unit, 49 PostgreSQL integration, and 13 Playwright tests plus type-check, lint, migration validation, and production build |

Every P0A item now passes, so P0B deployment work may begin. No deployment should
be treated as a release candidate unless it preserves the validated functional
loop and its safety boundaries.

### P0B — Deployment and real evidence

| Item | Status | Done when |
| --- | --- | --- |
| Deploy a judge-accessible fake-only public version | Done | The stable HTTPS deployment documented in [Public Fake-Only Deployment](public-demo-deployment.md) contains no CALL-E credentials and preserves the fake-only build gate |
| Establish an isolated protected staging environment | Done | Staging uses separate data and secrets, access is allow-listed, and live calls remain paused until an exact operator-approved evidence run |
| Complete one authorized real CALL-E test | Blocked by participant authorization | One exact recipient, brief, timezone, and test window are approved; one call is accepted; one terminal result is retrieved; the operator records the disposition; and no duplicate call is created |
| Preserve a redacted live-evidence bundle | Pending live test | The bundle contains provider acceptance, redacted provider result, normalized result, recorded human disposition, final UI state, audit evidence, and duplicate check without private data |
| Stabilize the three-minute golden path | Pending rehearsal | The path uses a preset case, ends with a recorded disposition, completes within three minutes in three consecutive rehearsals, and labels every waiting-time edit accurately |

### P0 dependency order

Steps 1–7 are complete. P0B continues at participant authorization in step 8.

1. Add the human-disposition persistence contract and migration.
2. Implement the authorized, idempotent application service and HTTP route.
3. Add the route-appropriate operator UI and final audit state.
4. Complete unit, PostgreSQL integration, and browser coverage through the final
   human decision.
5. Run and preserve a clean `pnpm validate` result for the completed loop.
6. Deploy and smoke-test the permanently fake-only public project.
7. Create the separate protected staging project with live calls initially
   paused.
8. Obtain participant authorization for the exact fictional call brief and
   calling window.
9. Enable one approved attempt, run it once, record the human disposition, and
   disable further live creation after evidence is captured.
10. Redact and review the evidence before using any part of it in the video or
   submission.
11. Rehearse the final golden path against the stable public deployment.

## P1 — Submission packaging

P1 makes the project reviewable and acceptable as an upstream contribution.

| Item | Status | Done when |
| --- | --- | --- |
| Package the contribution under `apps/web/fieldclose/` | Pending | The runnable app is placed in the upstream repository with only the files needed to install, run, test, and understand it |
| Complete the contribution README | Partial | The packaged README covers requirements, installation, fake/no-call default, credential handling, opt-in live side effects, cancellation limits, validation, and known limitations |
| Run upstream repository validation | Pending packaging | `python3 scripts/validate_repository.py` passes from the Awesome Phone Call Agents repository root |
| Open the upstream pull request | Pending validation | A scoped English PR is open, contains no secrets or private evidence, and links to the public fake-only demo where permitted |
| Add the PR URL to Devpost | Pending PR | The submitted Devpost project contains the final upstream PR URL |
| Finish the English Devpost About text | Pending | The copy leads with the practical HVAC closeout problem, explains the human boundary and six mechanisms, and makes only evidence-supported claims |

The packaging checklist follows the current
[Awesome Phone Call Agents contribution guide](https://github.com/CALLE-AI/awesome-phone-call-agents/blob/main/CONTRIBUTING.md):
runnable apps belong under `apps/<language-or-runtime>/<app-name>/`, must provide
setup and usage instructions, clear credential and side-effect handling, a
fake/dry-run/no-call default, opt-in live verification when relevant, and a test
or manual verification path.

## P2 — Demonstration and reviewer optimization

P2 improves comprehension without expanding the product.

| Item | Status | Done when |
| --- | --- | --- |
| Add a preset fictional work order | Pending | One action loads the existing golden-path fields, remains visibly fictional, and cannot select live mode or bypass approval |
| Limit the recorded UI to decision-critical fields | Pending video | The video shows the work-order reference, masked recipient, exact brief, approval, provider/result separation, and human next action |
| Edit CALL-E waiting time accurately | Pending video | Nonessential waiting is shortened in editing and the video explicitly states that elapsed time was edited; it never implies instant completion |
| Feature one memorable result | Pending evidence choice | The main story uses either a normal resolved report or one strong exception; other cases are mentioned, not toured |
| Show audit and duplicate protection in the final 10 seconds | Pending script | One repeated action demonstrates the original attempt is reused, followed by the relevant audit evidence |
| Capture domain or user feedback | Pending outreach | At least one consenting HVAC office, dispatcher, service manager, or adjacent domain reviewer provides a short, attributable or safely anonymized observation |

## Three-minute golden path

The target sequence is intentionally fixed:

| Time | Demonstration beat | Required proof |
| --- | --- | --- |
| 0:00–0:20 | State the administrative closeout problem | The visit can be technically complete while the office still lacks customer confirmation |
| 0:20–0:45 | Open the preset fictional work order | Only key case facts and the masked contact are shown |
| 0:45–1:15 | Review and approve one exact attempt | AI disclosure, question scope, authority boundary, calling window, and one-attempt approval are visible |
| 1:15–1:50 | Show execution and provider status | Fake execution is labeled `No phone call`; authorized live evidence is labeled accurately and any wait is edited transparently |
| 1:50–2:30 | Review the normalized result | Provider status, uncertainty-preserving fields, route, and human next action remain separate |
| 2:30–2:50 | Record the human disposition | The operator resolves the task and produces the final FieldClose state without performing the external handoff |
| 2:50–3:00 | Show audit and duplicate protection | Repeating the action creates no second attempt and the audit trail remains inspectable |

## Evidence matrix

| Submission claim | Minimum evidence | Public or private |
| --- | --- | --- |
| Anyone can evaluate the workflow safely | Stable fake-only URL plus judge smoke-test record | Public |
| A call cannot outrun operator approval | Reviewed brief, approval digest, and exact attempt audit | Public fake evidence; redacted live evidence |
| CALL-E ran for the submission | Provider acceptance and terminal result tied to one redacted attempt | Private source, redacted submission artifact |
| Uncertainty is preserved | One normalized unknown, ambiguous, refused, or unavailable field routed to a human | Public fake evidence or redacted live evidence |
| Duplicate calls are prevented | Repeated execution returns the same attempt and provider creation count remains one | Automated and demo evidence |
| Humans retain business authority | An operator records the final disposition, the task resolves, and no external work-order close or appointment confirmation occurs | Public and automated evidence |
| Ambiguous creation is safe | Resubmission freezes and one reconciliation task appears | Automated and public fake evidence |

## Final submission gate

Do not submit until all of the following are true:

- [ ] The final commit passes `pnpm validate`.
- [ ] An owner or operator can complete the workflow from result review through
  persisted disposition, resolved task, final case state, and audit history.
- [ ] The public fake-only URL passes the signed-out judge smoke test.
- [ ] The protected staging environment is isolated from the public project.
- [ ] One authorized live CALL-E attempt has redacted, inspectable evidence.
- [ ] The video completes the fixed golden path in three minutes.
- [ ] The upstream packaged app passes `scripts/validate_repository.py`.
- [ ] The upstream PR URL is present in Devpost.
- [ ] README and Devpost state fake defaults, credential handling, live side
  effects, verification, and known limitations.
- [ ] Screenshots, video, logs, fixtures, and commits contain no secrets or
  private phone data.
- [ ] At least one domain or user feedback note is included without overstating
  validation.
