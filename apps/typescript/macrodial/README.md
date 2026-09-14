# MacroDial

MacroDial turns a business description and customer workbook into reviewed business configuration, imported clients/appointments, and governed CALL-E outreach. CALL-E handles the phone conversation; MacroDial binds the playbook, limits authority, validates the returned outcome, and persists the resulting outreach state.

**[Open the deployed demo](https://macrodial.ra-fi.com)** · [Deployed workflow and configuration](DEPLOYED-WORKFLOW.md)

## What is included

This contribution is a **focused, no-call reference app**, not a standalone distribution of the full hosted product. It provides a browser review of a fictional veterinary playbook, its compiled CALL-E task/result schema, and an idempotent synthetic result-to-state transition that survives restart.

`src/bound-call-runtime.mjs` is the deployed MacroDial playbook-binding validator, task compiler, restrictive authority helper, and outcome resolver, copied without behavioral changes. The TypeScript server, synthetic scenario and local store are a small public demonstration wrapper. No private services or unpublished packages are required.

Auto Config, XLSX ingestion, PIN authentication, live dispatch and the full customer UI are **in the deployed product**, described in [DEPLOYED-WORKFLOW.md](DEPLOYED-WORKFLOW.md). They are not implemented by this reference. The synthetic result is not evidence of a live call.

## Run and test

Requires **Node.js 24 or newer** (native TypeScript execution) and npm. No dependencies, install step, environment variables, credentials or destination are required.

```sh
cd apps/typescript/macrodial
npm test
npm start
```

Open `http://127.0.0.1:4188` (use this exact loopback hostname).

1. Review the active, version-bound fictional veterinary playbook and its denied actions.
2. Expand the compiled task and structured-result schema.
3. Select **Simulate interest expressed** or **Simulate no answer**. Neither places a call.
4. Inspect the previous state, resulting state, synthetic outcome and timestamp.
5. Reload, stop with Ctrl+C, restart and verify the same state remains.
6. Repeat the same result: only one event remains. A different result is rejected for this completed run.

The store writes only synthetic state to `.local/demo-state.json`. For a new offline run, stop the app and delete **that file only**, then restart. Do not point this reference at production state. Run only one server process per state file; multi-process persistence is outside this example's boundary.

From the repository root, also run:

```sh
python3 scripts/validate_repository.py
```

Tests use temporary directories and loopback HTTP. They cover authority defaults, invalid/inactive/incompatible/version-mismatched playbooks, missing outcome mappings, unsupported results, concurrent replay, corrupt state, restart persistence, origin checks and absent live endpoints. No test invokes CALL-E or OpenAI.

## Preview, side effects and credentials

This local app is permanently **NO_CALL**, with engine OFF. It contains no provider transport, scheduler, recipient input or credential input. Setting provider environment variables does not enable calling. Preview reads do not mutate the store; selecting a simulation writes one synthetic event locally. It does not modify the deployed demo.

The local UI has no PIN because it has no private data or consequential external actions. It binds only to loopback, checks Host and mutation Origin, and is not intended to be reverse-proxied as an administration tool.

## Disable and cancel

Ctrl+C stops this reference. There are no calls or recurring jobs to cancel. Resetting its local synthetic state has no external effect.

In the **deployed product**, turn Outreach Engine **OFF** to stop automatic dispatch and retain the server live-call authorization lock. Engine OFF, closing the browser, or deleting a local record does **not** recall an already submitted provider call. No provider cancellation endpoint is implemented here; reconcile an accepted call through the provider before considering another attempt. See the [deployed safety and cancellation instructions](DEPLOYED-WORKFLOW.md#safety-disable-and-cancellation).

## Safety boundary

Live calling requires separate explicit operator intent for an authorized recipient, a validated E.164 destination, and an active compatible playbook. Do not use this example to infer consent or enable unattended calling. Never put destination values, keys, PINs, records or transcripts into this repository. Mask private data in any output. No medical, legal, financial, emergency or transactional authority is granted by the example. The veterinary scenario demonstrates configuration portability, not clinical decision-making.

## Files

| File | Purpose |
| --- | --- |
| `src/bound-call-runtime.mjs` | Deployed governance functions, no network or storage |
| `src/scenario.ts` | Fictional policy and masked task preview; no customer dataset |
| `src/store.ts` | Single-run synthetic persistence and replay protection |
| `src/server.ts` | Loopback-only browser/API server; no live transport |
| `public/` | Human-readable playbook, task/schema and result review |
| `test/app.test.ts` | Offline and loopback acceptance tests |
| `DEPLOYED-WORKFLOW.md` | Hosted product workflow, runtime integration and operational limits |

The repository license applies to this contribution. No rights to unrelated deployment files or customer data are conveyed.
