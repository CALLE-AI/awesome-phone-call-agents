# Public Fake-Only Deployment

- Status: Deployed at <https://fieldclose.dramaforge.icu/>
- Audience: Maintainers and hackathon reviewers
- Target: A judge-accessible FieldClose deployment that cannot place a phone call

The URL and its browser-visible fake-only behavior can be reviewed directly.
Server configuration and deployment operations are maintainer-reported private
observations; this document does not cite an inaccessible revision as public
source, build, or validation provenance.

## Deployment boundary

The maintainer reports that the P0A human-disposition workflow passed unit,
PostgreSQL integration, browser, and full local validation. Those private logs
are not public provenance; the pull request exposes the repository-level check.
The P0B release must preserve that closure and demonstrate the complete case
lifecycle, not stop at a displayed recommendation.

The public deployment is a standalone Next.js application backed by its own
PostgreSQL database. It supports password, email-code, and account-registration
flows, but every workspace is permanently constrained to the deterministic fake
provider. The current hackathon deployment runs on Aliyun ECS behind Caddy;
Vercel and Neon remain the portable managed-hosting path documented below.

The public project must never share CALL-E credentials or a database with a
protected live-call environment.

```text
Judge browser
    |
    v
Aliyun ECS public environment -- Caddy HTTPS -- PostgreSQL
    |
    +-- Resend or SMTP authentication email
    |
    +-- no CALL-E credential, no protected workspace operator
```

## Build-time safety gate

The public deployment uses `pnpm build:public-demo`. Before Next.js builds, the command runs
`scripts/verify-public-demo-environment.mjs` and rejects the deployment unless:

- `FIELDCLOSE_DEMO_MODE` is exactly `true`;
- `FIELDCLOSE_LIVE_CALLS_ENABLED` is exactly `false`;
- `CALL_E_API_KEY` is absent;
- `FIELDCLOSE_PROTECTED_OPERATOR_EMAILS` is empty;
- the database is remote PostgreSQL rather than a loopback database;
- the canonical application and Better Auth URLs use the same HTTPS origin;
- authentication, field-encryption, and lookup secrets are present;
- the field-encryption and lookup keys are different base64-encoded 32-byte keys;
- exactly one deployed authentication-email provider is complete.

The database constraints add an independent boundary: a demo workspace cannot
select the CALL-E provider or enable live calls.

## Recommended services

- Application: Vercel, using the repository's Node.js 24 engine and `vercel.json`
- Database: Neon PostgreSQL, with a dedicated project or branch for the public demo
- Authentication email: Resend HTTPS delivery or one complete SMTP configuration

Use a pooled Neon connection string for the Vercel application. Keep the direct
connection string outside Vercel and use it only from a trusted maintainer
terminal for migrations. The public database must contain fictional data only.

## Required production environment

| Variable | Public-demo value |
| --- | --- |
| `DATABASE_URL` | Remote pooled PostgreSQL URL with `sslmode=verify-full` |
| `BETTER_AUTH_SECRET` | At least 32 high-entropy characters |
| `BETTER_AUTH_URL` | Canonical HTTPS deployment origin |
| `FIELDCLOSE_PUBLIC_BASE_URL` | Same canonical HTTPS deployment origin |
| `FIELDCLOSE_DATA_KEY` | Base64-encoded 32-byte key |
| `FIELDCLOSE_LOOKUP_KEY` | A different base64-encoded 32-byte key |
| `FIELDCLOSE_PHONE_KEY_VERSION` | For example, `public-demo-v1` |
| `FIELDCLOSE_DEMO_MODE` | `true` |
| `FIELDCLOSE_LIVE_CALLS_ENABLED` | `false` |
| `FIELDCLOSE_PROTECTED_OPERATOR_EMAILS` | Empty or unset |
| `CALL_E_API_KEY` | Unset in every public-project environment |

Configure exactly one email option:

- Resend: `RESEND_API_KEY` and `FIELDCLOSE_AUTH_EMAIL_FROM`; or
- SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and
  `SMTP_FROM`, plus the correct TLS/SSL flags.

GitHub OAuth is not needed for the judge flow and should remain unconfigured.

## Alternative Vercel and Neon provisioning sequence

1. Create a dedicated Neon project or database branch in the same broad region as
   the selected Vercel function region.
2. From a trusted Node.js 24 terminal, set `DATABASE_URL` to the direct Neon URL
   with `sslmode=verify-full` and run `pnpm db:migrate` once. Do not substitute
   `sslmode=require`; postgres.js disables certificate verification in that mode.
3. Create a Vercel project from the FieldClose repository and keep the project
   root at the repository root.
4. Set the production environment variables listed above. Do not copy a local
   `.env.local` file into Vercel.
5. Set both canonical URL variables to the stable production URL, including
   `https://` and no path.
6. Deploy from a clean, validated commit. The configured build command will stop
   if the public boundary is unsafe.
7. Register and verify a dedicated reviewer account through the deployed email
   path. Put its credentials only in private Devpost testing instructions.

Do not run migrations in the Vercel build command. Preview builds and repeated
production deploys must not make schema changes automatically.

## Preview deployment policy

Better Auth trusts the canonical production origin. Random Vercel preview URLs
should not be advertised as working authentication environments. Use the stable
production deployment for judging, or create a separately configured preview
project with its own database and exact URL.

Never add CALL-E credentials to Preview, Development, or Production scopes of the
public Vercel project.

## Judge smoke test

Run this test in a signed-out desktop browser after every production deployment:

1. Open the public home page and confirm that it is labeled fake-only.
2. Create and verify an account through the deployed email provider.
3. Sign in and open the isolated demo workspace.
4. Create a fictional HVAC closeout case.
5. Review the exact brief and approve one fake attempt.
6. Run `resolved_clear` and confirm a normalized recommendation appears.
7. Record `closeout_accepted`, confirm the task resolves, and verify that the
   FieldClose case—not an external work order—moves to `closed`.
8. Run an exception fixture such as `wrong_person`, record the permitted human
   handoff, and confirm its final state.
9. Open the case audit history and confirm both dispositions are present and no
   private phone number appears.
10. Sign out and confirm that protected workspace URLs no longer expose data.
11. Confirm in Vercel that no CALL-E credential exists and no provider request was
    emitted.

## Rollback and data reset

- Roll back the Vercel deployment through the Vercel deployment history.
- Restore or recreate the dedicated Neon branch if demo data must be reset.
- Rotate `BETTER_AUTH_SECRET` only with the understanding that existing sessions
  will be invalidated.
- Rotating either phone-protection key requires an explicit data-migration plan;
  do not replace those keys while encrypted demo records still need to be read.

## External configuration still required

The repository can prepare and verify the deployment, but a maintainer must
provide or authorize:

- the Vercel account/team and desired project slug;
- the Neon project and pooled/direct connection URLs;
- the canonical production URL or custom domain;
- one authentication-email provider and verified sender;
- a private reviewer mailbox or final reviewer account.

Do not send secrets through repository files, commits, screenshots, or public
chat. Enter them directly in the selected service's secret manager.

## References

- [Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-json)
- [Vercel build configuration](https://vercel.com/docs/builds/configure-a-build)
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)

## Latest smoke evidence

The August 13, 2026 signed-out desktop and 375px public checks, isolated mobile
fake-provider regression, and remaining authenticated-deployment gaps are
recorded in
[Public Demo Smoke Record](public-demo-smoke-2026-08-13.md).
