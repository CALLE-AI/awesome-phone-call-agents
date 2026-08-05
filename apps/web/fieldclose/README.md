# FieldClose

> Turn "the technician is done" into "the job is actually closed."

FieldClose is a web application concept for small commercial HVAC contractors. It helps an owner-dispatcher or service coordinator turn completed work orders with missing customer confirmation into human-approved CALL-E phone workflows and structured follow-up actions.

## Project status

FieldClose has completed product definition, safety design, architecture,
technology selection, the durable PostgreSQL workflow through human-task
creation, credential and email-code authentication, authenticated workspaces,
the protected HTTP API, the responsive fake case-to-result browser experience,
the official CALL-E server-SDK adapter, authenticated bounded status refresh
with idempotent terminal-result processing, server-gated protected live approval
and asynchronous execution, the protected-workspace operator UI, allow-listed
protected-workspace provisioning with immutable administration evidence, and
the durable, role-gated human-disposition closure through its browser and audit
evidence.

The fake-only judge environment is deployed at
<https://fieldclose.dramaforge.icu/>. The repository does not yet contain
inspectable evidence that a separate protected staging environment is deployed,
isolated, and accessible through production authentication, or that CALL-E and
SMTP are configured in that environment. Those staging gates remain pending;
live calls remain paused. No authorized live CALL-E result, end-to-end deployed
authentication-email delivery, GitHub OAuth, or general role-management UI is
claimed yet.

## Competition focus

FieldClose is focused on **Most Practical Use Case**: turning one human-approved
HVAC after-service confirmation call into a trustworthy, structured, actionable
next step for a human operator. Its differentiators are approval-bound calling,
uncertainty-preserving results, one-attempt duplicate protection, an explicit
human decision boundary, ambiguous-creation reconciliation, and a safe fake-only
public experience. Product scope and UI information architecture are frozen for
submission.

## Problem

A commercial HVAC visit may be technically complete while the office still needs to confirm that the equipment is operating, identify unresolved issues, arrange a return window, or obtain missing administrative information. Small contractors often handle this work through repeated manual calls, which delays closeout and hides exceptions in voicemail or notes.

## Target user

The initial user is an owner-dispatcher or service coordinator at a small commercial HVAC contractor.

## Core workflow

```text
Completed work order
        |
        v
Dispatcher reviews the contact, purpose, and exact call brief
        |
        v
Dispatcher explicitly approves one CALL-E phone call
        |
        v
CALL-E returns a structured result
        |
        +--> Ready for human closeout review
        +--> Return visit requested
        +--> Human follow-up required
        +--> Contact unavailable or call failed
                    |
                    v
        Operator records the bounded disposition
                    |
                    v
        Task resolved and FieldClose case finalized
```

## MVP scope

- Create a closeout case from a completed work order.
- Review the authorized contact and missing closeout information.
- Preview and approve the exact purpose of one outbound call.
- Invoke CALL-E at runtime after explicit approval.
- Normalize the call outcome into a bounded result schema.
- Route uncertain, failed, or sensitive outcomes to a human exception queue.
- Let an authorized operator record the final bounded disposition and resolve the
  human task without mutating an external work-order system.
- Preserve a minimal audit history of approvals, attempts, and results.

## Non-goals

FieldClose does not diagnose HVAC equipment, quote prices, negotiate scope, approve additional work, authorize payments, promise service times, run marketing campaigns, or place unapproved batch calls.

## Safety model

Real phone calls are external side effects. The default development and test path must not place a live call. A live call requires an authorized contact, an explicit call brief, operator approval, valid E.164 input, an applicable calling window, duplicate-call protection, and clear AI disclosure. See [Safety and Operations](docs/safety-and-operations.md).

## Documentation

- [Product specification](docs/product-spec.md)
- [Call workflow](docs/call-workflow.md)
- [Architecture](docs/architecture.md)
- [Authentication and workspaces](docs/authentication-and-workspaces.md)
- [Fake provider and closeout workflow](docs/fake-provider-and-workflow.md)
- [Closeout workflow API](docs/workflow-api.md)
- [Web experience](docs/web-experience.md)
- [CALL-E integration](docs/call-e-integration.md)
- [Data contracts](docs/data-contracts.md)
- [Safety and operations](docs/safety-and-operations.md)
- [Testing and evaluation](docs/testing-and-evaluation.md)
- [Technology selection](docs/technology-selection.md)
- [Public fake-only deployment](docs/public-demo-deployment.md)
- [Hackathon submission plan](docs/hackathon-submission-plan.md)

## Selected technology

- Next.js 16 App Router on Node.js 24 LTS
- React 19 and strict TypeScript
- PostgreSQL with Drizzle ORM
- Zod runtime validation
- Official `@call-e/calle` server SDK
- Better Auth 1.6.25 with username/email credentials, email OTP, and optional GitHub OAuth
- Vitest and Playwright
- Current hackathon deployment: Aliyun ECS, Caddy, and PostgreSQL
- Supported managed-hosting target: Vercel and Neon PostgreSQL

The public demo uses only the deterministic fake provider and contains no
CALL-E credential. A separately verified protected staging environment is the
only place where an authorized live CALL-E test may be enabled.

## Local development

Requirements:

- Node.js 24 LTS
- pnpm 11.17.0 through Corepack
- Docker Desktop or another Docker-compatible engine for PostgreSQL integration tests
- PostgreSQL 17 for persistent local application data

Install dependencies and start the local application:

```bash
corepack enable
pnpm install
pnpm setup:local-demo
pnpm db:migrate
pnpm dev
```

`pnpm setup:local-demo` fills only missing local authentication and phone-protection secrets in the ignored `.env.local` file. It does not print secret values or enable live calls. Re-running it preserves existing non-empty settings.

`pnpm db:migrate` must complete before the application starts so every route
uses the current authentication and closeout schema, including the final human
disposition tables.

The application runs at `http://localhost:3000`. The automated browser suite uses an isolated `127.0.0.1:3100` server so it cannot reuse an unrelated local application.

Database commands:

```bash
pnpm db:generate
pnpm db:check
pnpm db:migrate
pnpm db:studio
```

Set `DATABASE_URL` before `pnpm db:migrate` or `pnpm db:studio`. When it is
omitted, Drizzle Kit targets
`postgresql://fieldclose:fieldclose@127.0.0.1:5432/fieldclose`. Every
non-loopback production URL must include `sslmode=verify-full`; the application
rejects `sslmode=require` because postgres.js does not verify the server
certificate in that mode. Integration tests create an isolated PostgreSQL 17
container and never use the development database.

Validation commands:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm db:check
pnpm test:integration
pnpm build
pnpm build:verify
pnpm test:e2e
pnpm validate
```

Local Playwright runs use the installed Google Chrome channel. CI should install the pinned browser revision with `pnpm exec playwright install --with-deps chromium` before running the browser suite.

`pnpm build` creates the normal production output. `pnpm build:verify` uses an ignored `.next-verify` directory, and `pnpm validate` selects it so validation can run while a development server remains open.

The Playwright server uses an ignored `.next-e2e` build directory, so it can run on port `3100` while the normal `.next` development server remains open. Both isolated runners restore the Next.js-generated TypeScript references after their child process exits. To reuse a known-good running server instead:

```powershell
$env:FIELDCLOSE_E2E_BASE_URL = "http://127.0.0.1:3000"
pnpm test:e2e
```

Review `.env.example` before creating a local environment file. Keep live calls disabled for normal development, and never commit real credentials or personal data.

FieldClose supports email or username plus password, passwordless email-code sign-in for an existing account, and optional GitHub login. New credential accounts must verify a six-digit email code before a session is created. In local development and tests, verification messages are printed only to the server console when no email provider is configured.

For deployed email delivery, configure exactly one provider. SMTP requires
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and `SMTP_FROM`.
Use `SMTP_USE_TLS=true` with `SMTP_USE_SSL=false` for a STARTTLS connection
such as port 587; use implicit SSL only when the provider requires it, commonly
on port 465. Alternatively, configure both `RESEND_API_KEY` and
`FIELDCLOSE_AUTH_EMAIL_FROM` with a sender on a verified domain. FieldClose
rejects partial, conflicting, or dual-provider email configuration.

For optional GitHub login, configure an OAuth application with
`/api/auth/callback/github` as its callback path and provide both GitHub
credentials. All deployed authentication modes require a high-entropy
`BETTER_AUTH_SECRET` of at least 32 characters.

## Demo and submission

The human-owned functional loop is complete: an authorized operator can persist
a bounded disposition, resolve or cancel the human task, produce the final
FieldClose case state, and audit the decision without mutating an external work
order. The fake-only judge environment is deployed; protected-staging
deployment, isolation, and production-authentication evidence remain pending.
Later gates include one authorized live CALL-E evidence set, a stable
three-minute golden path, and the upstream contribution under
`apps/web/fieldclose/`. See the
[Hackathon submission plan](docs/hackathon-submission-plan.md) for status and
acceptance gates. Submission-only drafts are kept under the local `submission/`
directory and are ignored by Git.

## License

MIT. See [LICENSE](LICENSE).
