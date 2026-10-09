# CALL-E integration status

The public application is a deterministic no-call demonstration. It needs no provider account and exposes no live-call control. The source candidate now also includes the reusable CALL-E backend components and their hermetic tests. Personal authentication/bootstrap, actual approval markers, protected cache paths, raw recordings and private execution history remain excluded.

`tools/calle-cli/guarded-calle-core.mjs` composes the pinned `@call-e/core` 0.2.3 with `guarded-mcp-fetch.mjs`. The CLI 0.3.7 remains pinned tooling; its login/cache-recovery policy is not used by this facade. The checked module hashes in `calle-runtime-pins.json` are copied from the existing development inventory; no package was migrated. The tests exercise the real Core bytes, synthetic temporary credentials and fake HTTP. They do not establish current-service compatibility.

## Included backend components

| Source | Responsibility |
| --- | --- |
| `src/integrations/calle-live-adapter.ts` | Prepare a plan, bind review approval to its exact fingerprint, start once, observe bounded status and preserve uncertain execution |
| `src/adapters/fixed-calle-mcp-transport.ts` | Typed plan/run/status methods, disabled-by-default policy and response classification |
| `tools/calle-cli/guarded-calle-core.mjs` and `guarded-mcp-fetch.mjs` | Real pinned Core composition with fixed endpoint and HTTP budgets; discovery, plan and run are single-use; at most three status reads bind to the same run |
| `src/integrations/calle-live-capability-vault.ts` | Hold opaque execution capability in backend memory, outside the public session view |
| `src/adapters/file-calle-run-checkpoint-store.ts` | Persist explicitly configured backend checkpoints so an interrupted execution cannot silently start again |
| `src/integrations/calle-live-evidence.ts` | Sanitize remote text before exposing an evidence view; this does not by itself approve a transcript for publication |
| `src/domain/workshop-outcome.ts` | Interpret the closed demo vocabulary and preserve unsupported dates; real conversation mapping remains to be qualified |

`CalleLiveAdapter` is the reusable phone-workflow implementation. The older development-only `CalleCallProvider` is a disabled planning prototype and is not presented as the completed runtime here.

To exercise the backend locally without calls, install the two pinned public packages with `npm run setup:calle`, then run `npm run check`. No operation executes on module import. A consumer must explicitly supply and qualify its own authentication boundary, enable the operation policy, review the exact planning request, then separately approve the returned execution plan. Never wire the capability-bearing Node modules into the browser.

The backend boundary fixes the MCP origin/path, refuses redirects, limits attempts, request and response bytes and elapsed time, propagates cancellation and never retries automatically. Read-only discovery is disabled by default and exposes only tools/list. An uncertain execution result remains uncertain; it does not trigger another phone call. Raw remote bodies may exist only as transient backend input before sanitization.

The status reader supports the schema discovered on September 13, 2026: execution state and activity remain outside the nested `result` containing business evidence. It rejects competing execution or evidence sources, sanitizes transcript lines separately, and treats `next_step.instruction` only as untrusted text. The hermetic rehearsal covers this shape through the pinned Core and durable checkpoint; a completed real call is still required to qualify actual statuses and workshop interpretation. Status reads are sequential, consume their slot even on failure, and stop after three in the same Core session. The adapter obtains their run identifier from its durable checkpoint; creating another session must never reset a live attempt's budget.

Authenticated MCP access and bounded tools/list discovery were observed on September 13, 2026. Local adaptation follows the observed schema. The remaining representative live sequence is an exact plan authorization, review of the returned plan, separate execution authorization, one call to a consenting recipient and bounded observation. Discovery is not counted as telephone evidence. Missing authentication is handled through the operator's normal interactive flow only when observed necessary. No credentials or actual phone numbers belong in Git, browser state or a public demo.

There is no supported live-start command in this preparation candidate. Supplying a token or setting an environment variable does not turn the mock UI into a live application. The private operator composition has been prepared and tested locally. A representative completed call, sanitized real evidence and live-result qualification are still missing. The personal launcher is excluded from this reusable contribution; no public live-start command is claimed. A fresh Core session cannot be used as a retry workaround; the operator composition must retain the existing execution gate and durable checkpoint and budget any status observations explicitly. This document does not authorize those operations or claim they succeeded.
