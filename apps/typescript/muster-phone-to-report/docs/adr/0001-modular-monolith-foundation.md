# ADR 0001: Modular monolith application foundation

- Status: Accepted
- Date: 2026-08-04

## Context

Muster needs independently startable API, worker, and web applications while preserving the dependency direction `domain <- application <- infrastructure/interface adapters <- composition roots`. The repository must make boundary violations, raw queries, production console calls, and source-path shortcuts mechanically visible without pre-building later product behavior.

The predecessor provider, hardware, and evidence spikes remain `NO-GO`. A green foundation proves repository wiring only and cannot upgrade those evidence limitations.

## Decision

Use a transparent pnpm workspace with no task orchestrator:

- Pin Node.js 24.18.0 and pnpm 11.20.0 exactly.
- Use native ESM, TypeScript `NodeNext` project references for Node workspaces, and explicit `.js` extensions for relative production imports.
- Use Vite bundler resolution only in `apps/web`.
- Expose packages through explicit public `exports`; forbid cross-workspace `src` and `dist` shortcuts.
- Keep domain isolated; let application depend only on domain and client-safe contracts; bind concrete adapters only in API and worker composition roots. Keep the browser on the separate `apps/web -> packages/api-client` edge, with no direct dependency on application or contracts.
- Keep Prisma 7 and its generated types inside the PostgreSQL adapter when Phase 3 adds persistence.
- Keep pg-boss 12.27.0 behind an application-owned port when Phase 4 adds jobs.
- Preload structured logging and telemetry before API or worker runtime modules.
- Keep production health disabled by default until a reviewed internal access policy is explicitly composed.
- Run the same transparent `corepack pnpm verify:foundation` aggregate locally and in CI. CI installs the frozen dependency graph and pinned browser prerequisite, then invokes that aggregate exactly once.

Direct third-party dependencies are exact-pinned. pnpm enforces exact Node and package-manager engines, a 1,440-minute minimum release age, no-downgrade trust, lockfile revalidation, exotic-subdependency blocking, and deny-by-default dependency builds. No dependency lifecycle scripts were allowlisted in Phase 1. Phase 4 adds an exact lifecycle-script review map: Prisma's pinned engine and CLI setup scripts are allowed because clean-clone client generation requires them; optional `cpu-features`, `protobufjs`, and `ssh2` scripts are explicitly denied. New packages remain denied until this exact map and its policy test are deliberately reviewed together. GitHub Actions references use immutable full commit SHAs and read-only permissions.

## Consequences

The package graph is visible in workspace manifests, TypeScript references, ESLint, dependency-cruiser, and mutation-backed policy tests. Root scripts explicitly encode ordering and are easier to diagnose across Windows and Linux. Remote task caching is deferred until measurement justifies another graph.

The implemented foundation keeps product behavior out of the scaffold while proving the dependency graph through real PostgreSQL, pg-boss, HTTP, generated-client, and browser boundaries. Future product slices extend application-owned ports and bind adapters only in composition roots; they do not bypass the package graph.

## Rejected alternatives

- Turborepo or Nx as a second graph before build-time evidence exists.
- Framework-owned monorepo boundaries.
- Shared Prisma/vendor types or a generic service locator.
- Redis-backed jobs, raw SQL, or Prisma raw-query escape hatches.
- A public or side-effecting health endpoint.
