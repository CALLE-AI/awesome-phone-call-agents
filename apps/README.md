# Apps

Use this directory for runnable phone-call workflow apps, including focused demo apps for MCP, CLI, scheduler, or host integration patterns.

Apps should directly help AI agents schedule, monitor, administer, or safely operate phone-call workflows. This includes focused integration apps for MCP, CLI, scheduler, and host patterns. They are not CALL-E SDKs or supported product APIs.

Use [`../plugins/`](../plugins/) for no-code and low-code workflow-platform nodes, actions, connectors, templates, or recipes.

Current apps:

| App | Language | Purpose |
| --- | --- | --- |
| [`typescript/asyncfounders`](typescript/asyncfounders/) | TypeScript | Callback-first persistent team memory: consented CALL-E interviews capture updates, brief unseen company deltas, and resolve open questions into evidence-linked typed memory. |
| [`web/fieldclose`](web/fieldclose/) | TypeScript / Next.js | Human-approved commercial HVAC closeout workflow with a fake-only public path, durable recipient suppression, one-attempt duplicate protection, structured CALL-E results, and explicit human disposition. |
| [`typescript/kincall`](typescript/kincall/) | TypeScript | Consent-first check-in and trusted-circle coordination: a stated request for help overrides the agent's own judgement, contacts are called one at a time until somebody commits, and the monitored person is called back with the outcome. |
| [`typescript/revisit-zero`](typescript/revisit-zero/) | TypeScript | Controlled meter-access recovery workbench with deterministic safety gates, exact call approval, one-recipient CALL-E execution, strict structured-result validation, and human-approved rebook export. |
| [`typescript/verify-contact-claim`](typescript/verify-contact-claim/) | TypeScript | Contact-claim verifier for a suspicious voicemail, text or missed call: dials only the number printed on the customer's own card, asks whether that contact was genuine and returns the words that came back with a hash-chained record. |
| [`typescript/call-neuron`](typescript/call-neuron/) | TypeScript | Functional consent-first scholarship outreach prototype with manual/file intake, identity-first disclosure, neutral voicemail, one-recipient CALL-E planning and confirmation, live status, human dispositions, and browser-local campaign data. |
| [`typescript/hirecall`](typescript/hirecall/) | TypeScript | Recruiter screening desk for internship and junior hiring: Excel batches, Gemini-written CALL-E scripts, sequential calls, post-call scoring, and a dry-run no-call path by default. |
| [`typescript/phone-approval-gate`](typescript/phone-approval-gate/) | TypeScript | Phone-verified approval gate for irreversible automation, with a one-time spoken code, an escalation ladder, dual control and a verifiable approval record. |
| [`typescript/voice-preflight`](typescript/voice-preflight/) | TypeScript | Renders a call task through any text-to-speech API you already pay for so you hear it before the callee does, then refuses a script whose declared critical line has gone missing, whose voice cannot speak the recipient's language or whose measured audio overruns its budget. |
| [`typescript/call-on-behalf`](typescript/call-on-behalf/) | TypeScript | Delegated errand caller with a disclosure budget: says only the details the person authorized, commits only inside authorized windows, and returns the answers plus the transcript. |
| [`python/leash`](python/leash/) | Python | Revokes an unattended agent's Google credential unless one call clears twelve conditions; silence, a machine answering, or a result that disagrees with its own transcript all end the lease. |
| [`python/hungrycall-cascade`](python/hungrycall-cascade/) | Python | Sequential call cascade that stops at the first candidate meeting every must and boundary, with staged concessions treated as an authorisation and unknown outcomes halting the run. |
| [`python/researchcall-survey`](python/researchcall-survey/) | Python | Standardized survey runner with a reproducible seeded sample, locked ethics rules, raw answers kept beside their coded category, and completion measured against everyone drawn. |
| [`python/ringedingeding`](python/ringedingeding/) | Python | Multi-recipient response aggregator that keeps answered, refused and unreached apart, reports every share against those who answered, and never reads silence as consent. |
| [`typescript/multi-party-scheduler`](typescript/multi-party-scheduler/) | TypeScript | Two-phase appointment scheduling over phone calls: gather availability, confirm one time with everybody by voice, release everybody who confirmed when the commit fails and resume an interrupted run. |
| [`python/callback-coordinator`](python/callback-coordinator/) | Python | Consent-first callback triage and routing: one CALL-E call learns why a person needs a callback, classifies the outcome into a fail-closed disposition, and routes it to the right team. |
| [`python/callback-window-coordinator`](python/callback-window-coordinator/) | Python | Consent-first callback-window coordinator with masked preview, stable idempotency, and structured CALL-E results. |
| [`python/callback-scam-screener`](python/callback-scam-screener/) | Python | Screens a callback-scam phone number from a suspicious email by having CALL-E dial it first, transparently as an AI, and score the transcript against a scam-signal checklist — preview-by-default, a dev/test dial allowlist, one screening call per number, and configurable daily call/LLM-spend caps, all enforced in code. |
| [`python/webhook-result-receiver`](python/webhook-result-receiver/) | Python | Durable at-least-once CALL-E terminal webhook ingestion with SQLite deduplication, conflict detection, and authenticated Calls API reconciliation. |
| [`python/mobilize`](python/mobilize/) | Python | Parallel wave dispatch to a consented pool under a deadline: stops calling the moment enough people confirm, and scores how firm each "yes" actually is instead of trusting every stated agreement. Ships a 300-trial zero-cost evaluation harness with a measured accuracy result, a crash-safe ledger, and an MCP server. |
| [`python/batch-runner`](python/batch-runner/) | Python | JSONL batch runner using CALL-E CLI auth state, FastMCP, Rich output, and MCP tool-call metadata. |
| [`python/broker-login-client`](python/broker-login-client/) | Python | CALL-E brokered login client with local token cache and MCP HTTP calls. |
| [`typescript/broker-login-client`](typescript/broker-login-client/) | TypeScript | CALL-E brokered login client using `@call-e/core`. |
| [`typescript/broker-login-client-standalone`](typescript/broker-login-client-standalone/) | TypeScript | CALL-E brokered login client without a shared package dependency. |
| [`python/oauth-login-client`](python/oauth-login-client/) | Python | CALL-E OAuth login client for MCP Streamable HTTP. |
| [`typescript/oauth-login-client`](typescript/oauth-login-client/) | TypeScript | CALL-E OAuth login client for MCP Streamable HTTP. |
| [`typescript/vibehub-founder-relay`](typescript/vibehub-founder-relay/) | TypeScript | Consent-first founder-match readiness call with masked preview, stable idempotency, and structured CALL-E results. |
| [`typescript/openings`](typescript/openings/) | TypeScript | Standing availability watch for care access: calls the healthcare providers actually listed in directories to verify who is real, who takes your plan, and who has an opening, then keeps watching on a decaying cadence until a slot opens. |
| [`typescript/ringer`](typescript/ringer/) | TypeScript | Consumer web app that turns dreaded phone tasks — bill negotiation, cancellations, bookings, refunds, and multi-business quote comparison — into consent-first, multilingual CALL-E workflows with strict per-call and per-recipient result schemas, human-in-the-loop decision authority, evidence-gated and denominator-honest outcomes, and a no-call demo mode by default. |
| [`web/local-atlas`](web/local-atlas/) | JavaScript / Node | Map-first local guide where one confirmed call becomes a dated, evidence-quoted fact every later visitor reuses: stored answers, opinion refusal, closed-business and calling-window checks all work to avoid placing a call at all, results keep their uncertainty and expire by outcome, and private results are written where the public list cannot read them. A comparison across two or three nearby places is one multi-recipient task, with each business answering for itself and the cross-call verdict marked as derived rather than quoted. |
| [`python/ringdown`](python/ringdown/) | Python | On-call escalation agent that phones the pager holder one rung at a time, treats a call as acknowledged only when an owner and an ETA are each quoted by a span the recipient spoke, re-reads its own call over a second transport, and seals every verdict in a hash-chained ledger that re-derives the verdict on replay. |
| [`python/kept`](python/kept/) | Python | Turns a payment promise made on a collections call into a validated financial record: eleven named rejection reasons stand between a spoken sentence and a ledger entry, vague amounts are refused, over-commitments are clamped to the invoice balance with the spoken figure kept beside them, and the promise is reconciled against the bank feed a week later so only the commitments that actually broke are called again. |

Suggested grouping:

```text
apps/
├── python/
│   └── app-name/
├── typescript/
│   └── app-name/
├── web/
│   └── app-name/
└── shared/
```

Every app should include its own README with setup, usage, side effects, credential handling, dry-run or preview behavior, and cancellation or rollback instructions when it can create calls or recurring jobs.
