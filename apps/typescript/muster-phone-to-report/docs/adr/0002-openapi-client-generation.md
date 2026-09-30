# ADR 0002: Spec-first OpenAPI client generation

- Status: Accepted
- Date: 2026-08-04

## Context

The browser must consume a client-safe contract without importing NestJS, Fastify, Prisma, domain, or application types. Server-first decorators and handwritten browser DTOs would permit the transport implementation and client to drift independently.

## Decision

Use an OpenAPI 3.1, spec-first contract at `docs/api/openapi.yaml`. The exact-pinned `@hey-api/openapi-ts` Fetch generator writes only `packages/api-client/src/generated/`. The stable `@muster/api-client` public entry point is the browser's only server-facing workspace dependency; `apps/web` does not import application, contracts, or server packages directly.

The explicit generation command refreshes committed output. Verification independently generates into a clean temporary directory and compares it byte-for-byte with the selected committed output; the build compiles and bundles the stable client entry. Integration tests exercise that real client against the NestJS/Fastify endpoint. Ready, degraded, and standardized error responses are validated against the same specification.

## Consequences

Contract changes become explicit reviewable source changes followed by deterministic generated changes. The generator can be replaced later without changing server or web package ownership because the OpenAPI document and api-client entry point remain stable.

## Rejected alternatives

- NestJS code-first OpenAPI as the canonical source.
- Handwritten web transport types or direct server-package imports.
- Treating generated output as authoritative instead of derived from the specification.
