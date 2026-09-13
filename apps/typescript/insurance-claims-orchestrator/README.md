# insurance-claims-orchestrator

Two-call consent-first insurance claims intake orchestrator using CALL-E.

## Overview

This app orchestrates a two-call CALL-E workflow for insurance claims intake:

- **Call 1 — Loss Report:** Contacts the policyholder to collect structured incident details (description, date, damage estimate, policy number).
- **Call 2 — Coverage Verification:** Using Call 1 results, confirms policy status and coverage applicability.

Call 2 runs only when Call 1 reaches a completed outcome with valid policy confirmation. Both calls use explicit AI disclosure and fail-closed result schemas. Dry-run is the default.

The core reusable piece is `src/ClaimChain.ts` — a domain-agnostic orchestrator class that enforces dependency ordering, exit gates, and context passing between call steps.

## Quick Start

```bash
cd apps/typescript/insurance-claims-orchestrator
npm install
npm run dry-run
```

No API key needed. Runs the full two-call sequence against fixture data and prints results.

## Project Structure

```
apps/typescript/insurance-claims-orchestrator/
├── src/
│   ├── index.ts                  <- CLI entry point
│   ├── ClaimChain.ts             <- Core orchestrator class (reusable)
│   ├── call1-loss-report.ts      <- CALL-E task builder for Call 1
│   ├── call2-coverage-verify.ts  <- CALL-E task builder for Call 2
│   ├── poller.ts                 <- GET /v1/calls/{id} polling (live mode only)
│   └── types.ts                  <- Shared TypeScript interfaces
├── scripts/
│   ├── dry-run.ts                <- Full two-call simulation, no API key needed
│   ├── validate-schema.ts        <- Validates fixture JSON against schema
│   └── fixtures/                 <- Fictional example results (NANP reserved numbers)
├── tests/
│   ├── ClaimChain.test.ts        <- Unit tests for orchestrator logic
│   └── fixtures/                 <- Test fixture data
├── package.json
├── tsconfig.json
└── README.md
```

## Commands

| Command | Description |
|---|---|
| `npm run dry-run` | Simulate full workflow with fixture data, no calls placed |
| `npm run validate-schema` | Validate fixture JSON against schema.json |
| `npm test` | Run unit tests |
| `npm run check` | TypeScript type check |

## Live Mode

```bash
export CALLE_API_KEY=your_key_here
npx tsx src/index.ts --phone +1XXXXXXXXXX --live
```

Phone must be E.164 format. The number is masked in all output.

## The ClaimChain Pattern

`ClaimChain.ts` is the core architectural contribution — under 150 lines and fully domain-agnostic. To adapt it for a different domain:

1. Copy `ClaimChain.ts`
2. Write task builder functions (see `call1-loss-report.ts`)
3. Define result schemas in JSON Schema draft-07
4. Register steps with `chain.addStep()`
5. Keep `dryRun = true` in all demos

See `skills/insurance-claims-orchestrator/references/two-call-pattern.md` for full guidance.

## Safety

- Dry-run is the default — `--live` flag required for real calls
- AI disclosure mandatory at the start of both calls
- Phone numbers masked in all logs
- Ambiguous outcomes route to human review, never auto-retried
- No SSN, payment, or medical data ever collected

See `skills/insurance-claims-orchestrator/references/safety.md` for the full contract.
