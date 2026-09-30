# Transparent Device Simulator Demo

The Simulator Lab is a demo/development-only cockpit for replaying six committed synthetic phone fixtures. Its reliable path is deterministic and offline: it does not start CALL-E, Twilio, or any external call.

Every visible result is labeled `SIMULATED`. The maximum compatibility statement is `simulator-tested`. This demo does not prove physical-device behavior, Sensaphone compatibility, native-alarm coexistence, verified repair, continuous monitoring, or production support. The [physical-device NO-GO boundary](../architecture/foundation-safety.md) remains authoritative until separately authorized hardware evidence exists.

## Build and open the demo

Use the repository-pinned Node 24.18.0 and pnpm 11.20.0 toolchain.

```powershell
corepack pnpm --filter @muster/web build:demo
node apps/web/node_modules/vite/bin/vite.js preview apps/web --outDir dist-demo --host 127.0.0.1 --port 4173 --strictPort
```

Open `http://127.0.0.1:4173/simulator.html`. The page must initially say **No external call will be placed**, show deterministic replay selected, and show the non-color `SIMULATED` badge near the title.

The ordinary production build remains separate:

```powershell
corepack pnpm --filter @muster/web build
```

Its `dist` artifact contains only the production `index.html` entry. The demo build uses `dist-demo` and `simulator.html`; production navigation and composition do not import or register the Simulator Lab.

The committed client-safe demo projection is reproducibly generated from the canonical scenario catalog by running every fixture through the deterministic observation use case. Regenerate it after a scenario or replay-contract change:

```powershell
corepack pnpm generate:simulator-demo
```

The generator writes `apps/web/src/generated/simulator-demo-projection.json`; a drift test compares it with a fresh replay-derived projection. Browser runtime code imports only the generated artifact and client-safe types from `@muster/api-client`, never server or testing packages.

## Pre-demo verification

Install frozen dependencies and the pinned Chromium browser once per clean checkout. The aggregate also requires a running Docker-compatible engine for its PostgreSQL-backed suites.

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm exec playwright install chromium
```

After any scenario, replay-contract, projection, or Simulator Lab change, regenerate the committed projection and run the five focused checks:

```powershell
corepack pnpm generate:simulator-demo
corepack pnpm exec vitest run apps/web/src/features/simulator/SimulatorScenarioPanel.test.tsx tools/architecture/simulator-demo-projection.test.ts tools/architecture/simulator-production-boundary.test.ts --config vitest.workspace.ts
```

The focused command verifies the accessible abnormal, ambiguous, and unknown results; projection drift and the browser-safe dependency boundary; and both a mutation-rejecting import-graph check and a fresh production-artifact scan. It must report 5/5 passing.

Run the two Simulator Lab browser journeys before a rehearsal:

```powershell
corepack pnpm exec playwright test tests/e2e/transparent-device-simulator-demo.spec.ts
```

Before demo handoff, run the repository aggregate. It regenerates and builds the packages and applications, runs the complete Vitest and Playwright suites, and checks formatting, lint, types, architecture, supply chain, Prisma, and diff hygiene.

```powershell
corepack pnpm verify:foundation
```

The Phase 4 handoff passed 195/195 aggregate tests under Node 24.18.0 and pnpm 11.20.0. It made no dependency change, provider call, external request, live smoke, or hardware/native-alarm claim. A different local toolchain is unsupported and may fail before the demo build starts.

## Five-shot deterministic rehearsal

Run these in order. Keep each result visible long enough to confirm the evidence and interpretation before replaying the next fixture.

1. **Normal synthetic report** — expect `Observation complete`, readings 71.5 °F and 68.0 °F, and `simulator-tested`.
2. **Abnormal synthetic report** — expect `Threshold exceeded`, readings 91.25 °F and 84.5 °F, and no hardware claim.
3. **Ambiguous synthetic report** — expect `Observation incomplete—no operational decision made`, contradictory Zone 1 values, and `Low confidence`; it must not say Healthy or Normal.
4. **No-answer synthetic report** — expect `No answer received`, no fabricated device evidence, and interpretation `Not run`.
5. **Recovery synthetic report** — expect `Recovery observed—human confirmation required`; it must not claim verified repair or automatic closure.

The truncated fixture is an additional fail-closed check: it must identify missing Zone 2 evidence and make no operational decision.

## Evidence checklist

- `SIMULATED` remains visible at the page, result, and evidence levels, with the accessible name `Simulated data—not physical hardware evidence`.
- Scenario ID, revision, run reference, and `simulator-tested` compatibility are visible text.
- Evidence appears before its derived interpretation on narrow screens.
- Each evidence segment shows its source span; the interpretation separately shows readings, expected-zone reconciliation, quality, confidence, adapter version, and extractor version.
- Abnormal and normal fixtures show different concrete values.
- Ambiguous, truncated, and no-answer outcomes never receive healthy/normal semantics.
- Every replay uses a new local run reference while preserving fixture ID and revision.
- Browser developer tools show no fetch, XHR, WebSocket, CALL-E, Twilio, or other external dispatch.

## Optional live smoke

Live smoke is unavailable in this demo composition and is not authorized by this runbook. Do not add credentials, phone numbers, secret values, editable targets, or a bypass to the Simulator Lab. A future live check requires a separate non-production host, explicit user authorization, reviewed secret references, an owned synthetic-only endpoint, all fail-closed preflight gates, and a one-call/no-retry budget. A blocked or omitted live check does not prevent the deterministic demo.
