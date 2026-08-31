# Awesome Phone Call Agents

<div align="center">

**A community hub for reusable phone-call Agent Skills, runnable apps, workflow plugins, adapters, scheduler recipes, and safety patterns.**

Maintainers provide reference skills, runnable examples, templates, validation, and safety guidance so developers and workflow builders can quickly explore phone-call agent workflows.

[Community contributions](#community-contributions) · [Resources](#resource-list) · [CLI](#cli-reference) · [Templates](#templates) · [Roadmap](docs/roadmap.md) · [Contributing](#contributing) · [Discord](https://discord.gg/6AbXUzUV8w)

![Agent Skills](https://img.shields.io/badge/Agent%20Skills-phone--call-blue)
![CALL-E](https://img.shields.io/badge/CALL--E-one--off%20calls-black)
![Schedulers](https://img.shields.io/badge/Schedulers-host--owned-purple)
![Safety](https://img.shields.io/badge/Safety-explicit%20intent-green)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

</div>

## Community contributions

Awesome Phone Call Agents is an early community hub for developers and workflow builders creating reusable phone-call workflows for AI agents. CALL-E SDKs, provider APIs, authentication, call execution, and provider-side controls belong upstream with CALL-E itself. This repository focuses on the community artifacts around those primitives: Agent Skills, workflow plugins, user-facing apps, examples, templates, and safety patterns.

> [!NOTE]
> New here? Start with the [`call-reminder`](skills/call-reminder/) and [`google-form-callback`](skills/google-form-callback/) skills, use [`outbound-call-skill-creator`](skills/outbound-call-skill-creator/) when you need to generate a focused outbound workflow skill, try the [`python/batch-runner`](apps/python/batch-runner/) app, and read [`docs/roadmap.md`](docs/roadmap.md) for open community directions.

| Contribution area | Good examples | Where to contribute |
| --- | --- | --- |
| Agent Skills | Customer callbacks, appointment confirmation, lead qualification, order exception follow-up, service dispatch, incident escalation | `skills/` |
| Workflow Plugins | Dify tools, n8n nodes, Zapier actions, HubSpot workflow actions, Feishu/Lark automation nodes | `plugins/` |
| User-facing Apps | Call chat, call review console, call scheduler UI, customer callback app, business call workbench | `apps/` |

The community roadmap is a direction guide, not a fixed release plan. Small examples, platform notes, workflow sketches, templates, and focused demos are all useful.

> [!IMPORTANT]
> Phone-call workflows can create real-world side effects. Please keep examples explicit, easy to inspect, safe to try without a real call when possible, and clear about phone numbers, credentials, scheduling, cancellation, and result handling.

## Table of Contents

- [Community contributions](#community-contributions)
- [Why this repository exists](#why-this-repository-exists)
- [CLI reference](#cli-reference)
- [Templates](#templates)
- [Resource list](#resource-list)
- [Contributing](#contributing)
- [Community](#community)
- [License](#license)

## Why this repository exists

AI agents increasingly need to turn phone calls into reusable workflows: reminders, follow-ups, appointment coordination, provider-specific call adapters, scheduler integrations, and safety checks that other agents can install or adapt. Each entry should help an agent package, schedule, execute, or safely operate a real phone-call workflow — not act as a generic voice-agent product, telephony vendor directory, or call-center software list.

This repository focuses on three principles:

1. **Portability**: skills, apps, and adapters should be useful across agent hosts when possible.
2. **Provider separation**: the phone-call provider should place or create calls; the host scheduler should handle recurrence.
3. **Safety by default**: phone numbers, consent, credentials, and medical, legal, financial, or emergency boundaries must be handled explicitly.

## CLI reference

CALL-E CLI parameters and command flags are documented in [`cli-reference.md`](https://github.com/CALLE-AI/call-e-integrations/blob/main/packages/cli/docs/cli-reference.md).

## Templates

### Skill folder template

Use this Agent Skills folder pattern:

```text
skill-name/
├── SKILL.md
├── references/
├── scripts/
└── assets/
```

### App directory template

Use `apps/` for runnable tools and demo apps:

```text
apps/
├── python/
│   └── app-name/
└── typescript/
    └── app-name/
```

Every app that can place a call or create a recurring job must document setup, side effects, cancellation, credential handling, and dry-run or preview behavior.

### Plugin directory template

Use `plugins/` for no-code and low-code workflow-platform plugins:

```text
plugins/
└── plugin-name/
    ├── README.md
    ├── manifest-or-config-file
    └── examples/
```

Every plugin should document supported triggers or actions, required inputs, side effects, credential handling, dry-run or preview behavior, and cancellation or rollback behavior when it can create calls or recurring jobs.

### README list entry template

```markdown
- [Project Name](https://example.com) - One sentence explaining why this is useful for AI-agent phone-call workflows.
```

Keep descriptions short, specific, factual, and directly tied to packaging, scheduling, executing, or safely operating AI-agent phone-call tasks.

Good: `- [call-reminder](skills/call-reminder/) - Scheduler wrapper skill for recurring CALL-E phone-call reminders.`
Avoid: `- [call-reminder](skills/call-reminder/) - A great tool for calling people!` (marketing language, no indication of what it does or how it fits the AI-agent workflow)

## Resource list

This project is an awesome list for AI-agent phone-call workflows. Add resources only when they directly help agents package, schedule, execute, or safely operate phone-call tasks.

### Skills

- [`accesscall`](skills/accesscall/) - Phone-based accessibility intake for VPAT 2.4/Section 508 audits. Run `npm install` in `skills/accesscall/` before using `scripts/format-to-vpat.js`, or it fails with `Cannot find module 'jszip'`.
- [`candidate-availability-call`](skills/candidate-availability-call/) - Recruiting coordination skill that confirms candidate interview availability by phone, returns evidence-backed time windows, and leaves scheduling commitments to a human.
- [`call-reminder`](skills/call-reminder/) - Scheduler wrapper skill for recurring CALL-E phone-call reminders.
- [`callparity-claimkill`](skills/callparity-claimkill/) - ClaimKill (CallParity) compiles the next CALL-E call as a leak-scored refute of a quoted claim; pytest runs on fixtures with zero live calls.
- [`customer-onboarding-call`](skills/customer-onboarding-call/) - Welcome-call skill that turns a new signup into at most one conversation, a consent-gated structured result, and a CRM follow-up task, with evidence-backed dispositions, ordered outcome classification, per-attempt idempotency, and cancellable retries.
- [`deployment-approval-call`](skills/deployment-approval-call/) - Spoken, code-verified human approval before an agent or pipeline does something irreversible.
- [`voice-preflight`](skills/voice-preflight/) - Hear a call task spoken by your own text-to-speech provider before a real person does, then refuse a script whose critical line would not survive being spoken.
- [`dollar-consent-first-callback`](skills/dollar-consent-first-callback/) - Consent-first owner escalation after a local safety gate blocks an extreme-risk developer action; call results never grant destructive permission.
- [`forgerelay-supplier-clarification`](skills/forgerelay-supplier-clarification/) - Safe, approval-gated CALL-E workflow for collecting missing manufacturing RFQ details from authorized supplier contacts.
- [`human-context-handoff`](skills/human-context-handoff/) - Ask a verified human one bounded product, workflow, preference, or operations question, then resume an agent only from a durable structured result.
- [`google-form-callback`](skills/google-form-callback/) - Google Form response workflow for safe one-off callback calls with dry-runs, scheduling plans, and Sheets writeback. See the [workflow guide](docs/google-form-callback/).
- [`linecanary-monitor`](skills/linecanary-monitor/) - Synthetic monitoring for phone lines and deployed voice agents: scheduled test calls, structured assertions, baseline diffing, and CI gating via the linecanary app.
- [`mobilize`](skills/mobilize/) - Get a required number of confirmed responses from a consented pool within a deadline by dispatching parallel wave calls that stop the moment the need is met.
- [`outbound-call-skill-creator`](skills/outbound-call-skill-creator/) - Creator skill for generating focused outbound phone-call workflow skills from Google Forms, TikTok Ads, Notion, Airtable, local CSV files, or custom sources.
- [`metapelet-elder-checkin`](skills/metapelet-elder-checkin/) - Consent-based outbound wellbeing check-in for older adults using the MetaPelet non-medical companion persona; returns mood, topics, and repeat-call interest.
- [`standby`](skills/standby/) - Fill one open shift from a standby roster with a strictly sequential call cascade that stops at the first acceptance, so a single slot cannot be double-booked; handles no-answer retry passes, callbacks, quiet hours, a shift-start cutoff, and holds the cascade for human reconciliation when a call cannot be read.
- [`service-dispatch-call`](skills/service-dispatch-call/) - Service dispatch workflow that asks a vendor about availability, ETA, and cost, returns a schema-validated result, and routes any commitment to human approval.
- [`calle-script-advisor`](skills/calle-script-advisor/) - Drafts and lints CALL-E call task text and result schemas for clarity, safety, and extraction quality before a call is placed.
- [`research-gap-call-verifier`](skills/research-gap-call-verifier/) - Turns cited business research into an approval-gated no-call preview, then reconciles CALL-E-compatible results without mistaking voicemail, refusal, or failure for a verified fact.
- [`verify-by-phone`](skills/verify-by-phone/) - Single disclosed verification call that checks a directory listing against the published line, grounds every answer in a transcript span, and abstains instead of guessing when the call does not establish one.
- [`call-summarizer`](skills/call-summarizer/) - Post-call analysis skill that turns a completed CALL-E transcript into a masked, actionable brief with a one-line outcome, extracted action items with owners and due dates, caller sentiment, and a one-way caller fingerprint for de-duplicating repeat callers.
- [`ringer-consumer-tasks`](skills/ringer-consumer-tasks/) - Compose and safely place the dreaded consumer phone calls (bill negotiation, cancellation, refund, booking, quote comparison, inquiry) as CALL-E tasks with strict result schemas, dry-run-by-default previews, and human-in-the-loop decision authority.
- [`incident-escalation-call`](skills/incident-escalation-call/) - Walks an on-call escalation ladder one phone call at a time and records an acknowledgement only when an owner and an ETA are both quoted by words the recipient spoke, then re-reads the call over a second transport before the incident is reported as owned.
- [`partline-part-sourcing`](skills/partline-part-sourcing/) - Preview-first industrial replacement-part sourcing that calls approved suppliers for exact part identity, quantity and shipping cutoffs, then ranks evidence-backed matches and leaves purchase and alternate approval to a human.

### Apps

- [CallParity](https://github.com/ruddro-roy/callparity) - Two-call ops workbench for Party A claims, a Party B falsification CALL-E task, and a merged claim graph. Preview and fixture mode by default.
- [CallmeMaybe](https://github.com/jongan69/callmemaybe) - Shopify order-exception phone workflows that use CALL-E for carrier traces and consent-first customer callbacks, with a no-call fixture mode and merchant approval before every Shopify mutation.
- [Later, Me.](https://github.com/shirosenagi-design/later-me) - Windows CALL-E app for scheduling a real phone call to your future self, with a four-hour minimum, one pending reservation, and optional post-call Relationship Trace.
- [SchemaRelay](https://github.com/14188769700lbk-dev/schemarelay) - Consent-gated CALL-E owner interviews that turn data schema-change questions into human-review evidence packets, with a no-call dry run by default.
- [ShohojSheba Voice](https://shohojsheba-call-e-preview.redwan-rahman.workers.dev/judge) - Consent-gated healthcare staffing dispatch that uses structured CALL-E results to advance after a verified decline, pauses on acceptance, and keeps final assignment human-controlled.

Runnable demo apps live under [`apps/`](apps/). They are not a CALL-E SDK and do not define a supported application API.

| App | Language | Purpose |
| --- | --- | --- |
| [`apps/typescript/asyncfounders`](apps/typescript/asyncfounders/) | TypeScript | Callback-first persistent team memory: consented CALL-E interviews capture updates, brief unseen company deltas, and resolve open questions into evidence-linked typed memory. |
| [`apps/typescript/one-more-story`](apps/typescript/one-more-story/) | TypeScript | Consent-first oral-history call that discloses AI use, preserves the storyteller's correction, and creates no story until the corrected read-back is explicitly confirmed. |
| [`apps/web/callproof`](apps/web/callproof/) | Ruby / Python | Closed-loop CALL-E workflow that checks transcript evidence against an immutable call contract and routes policy exceptions to persisted AgentKit human review. |
| [`apps/typescript/evidence-grounded-callback`](apps/typescript/evidence-grounded-callback/) | TypeScript | Compiles owner-reviewed source evidence and positive callback consent into a masked CALL-E preview and separately gated MCP plan. |
| [`apps/typescript/kincall`](apps/typescript/kincall/) | TypeScript | Consent-first check-in and trusted-circle coordination: a stated request for help overrides the agent's own judgement, contacts are called one at a time until somebody commits, and the monitored person is called back with the outcome. |
| [`apps/typescript/revisit-zero`](apps/typescript/revisit-zero/) | TypeScript | Controlled meter-access recovery workbench with deterministic safety gates, exact call approval, one-recipient CALL-E execution, strict structured-result validation, and human-approved rebook export. |
| [`apps/typescript/verify-contact-claim`](apps/typescript/verify-contact-claim/) | TypeScript | Contact-claim verifier for a suspicious voicemail, text or missed call: dials only the number printed on the customer's own card, asks whether that contact was genuine and returns the words that came back with a hash-chained record. |
| [`apps/typescript/call-neuron`](apps/typescript/call-neuron/) | TypeScript | Functional consent-first scholarship outreach prototype with manual/file intake, identity-first disclosure, neutral voicemail, one-recipient CALL-E planning and confirmation, live status, human dispositions, and browser-local campaign data. |
| [`apps/typescript/hirecall`](apps/typescript/hirecall/) | TypeScript | Recruiter screening desk for internship and junior hiring: Excel batches, Gemini-written CALL-E scripts, sequential calls, post-call scoring, and a dry-run no-call path by default. |
| [`apps/typescript/callparity`](apps/typescript/callparity/) | TypeScript / Python | Catalog pointer to CallParity. ClaimKill in this repo compiles leak-scored refute plans from fixtures with zero live CALL-E calls. |
| [`apps/typescript/connected`](apps/typescript/connected/) | TypeScript | AI phone companion whose consented recurring conversations remember interests and family stories, revisit them naturally, and offer human-reviewed event reminders or community introductions. |
| [`apps/typescript/linecanary`](apps/typescript/linecanary/) | TypeScript | Synthetic monitoring and CI regression testing for business phone lines and voice agents: ownership-verified scheduled test calls, schema and timing assertions, baseline regression diffing, Slack alerts, and a GitHub Action. |
| [`apps/typescript/phone-approval-gate`](apps/typescript/phone-approval-gate/) | TypeScript | Phone-verified approval gate for irreversible automation, with a one-time spoken code, an escalation ladder, dual control and a verifiable approval record. |
| [`apps/typescript/voice-preflight`](apps/typescript/voice-preflight/) | TypeScript | Renders a call task through any text-to-speech API you already pay for so you hear it before the callee does, then refuses a script whose declared critical line has gone missing, whose voice cannot speak the recipient's language or whose measured audio overruns its budget. |
| [`apps/typescript/call-on-behalf`](apps/typescript/call-on-behalf/) | TypeScript | Delegated errand caller with a disclosure budget: says only the details the person authorized, commits only inside authorized windows, and returns the answers plus the transcript. |
| [`apps/typescript/lost-line-coordinator`](apps/typescript/lost-line-coordinator/) | TypeScript | Consent-first lost-property route coordinator with inspectable calls, locally validated feature evidence, adaptive early stopping, and privacy-minimized results. |
| [`apps/typescript/surplus-signal`](apps/typescript/surplus-signal/) | TypeScript | Consent-first surplus-food pickup confirmations with strict structured results and a redacted candidate manifest that still requires human dispatch approval. |
| [`apps/python/leash`](apps/python/leash/) | Python | Revokes an unattended agent's Google credential unless one call clears twelve conditions; silence, a machine answering, or a result that disagrees with its own transcript all end the lease. |
| [`apps/typescript/recallready`](apps/typescript/recallready/) | TypeScript | Consent-gated product-recall qualification calls grounded in official CPSC records, with masked destinations, single-use previews, structured remedies, and a no-call default. |
| [`apps/typescript/readyline`](apps/typescript/readyline/) | TypeScript | Event load-in coordinator that turns authorized CALL-E vendor results into deterministic access, dock, power, and deadline checks, with a no-call demo and human-approved follow-up. |
| [`apps/python/freshchain-resolver`](apps/python/freshchain-resolver/) | Python | Resolve delayed cold-chain receiving exceptions by phone and return a safe dispatch decision. |
| [`apps/python/incidentbridge`](apps/python/incidentbridge/) | Python | Consent-first vendor incident support coordinator with masked preview, durable duplicate-call protection, strict structured evidence, and human-owned recovery verification. |
| [`apps/python/hungrycall-cascade`](apps/python/hungrycall-cascade/) | Python | Sequential call cascade that stops at the first candidate meeting every must and boundary, with staged concessions treated as an authorisation and unknown outcomes halting the run. |
| [`apps/python/researchcall-survey`](apps/python/researchcall-survey/) | Python | Standardized survey runner with a reproducible seeded sample, locked ethics rules, raw answers kept beside their coded category, and completion measured against everyone drawn. |
| [`apps/python/ringedingeding`](apps/python/ringedingeding/) | Python | Multi-recipient response aggregator that keeps answered, refused and unreached apart, reports every share against those who answered, and never reads silence as consent. |
| [`apps/typescript/multi-party-scheduler`](apps/typescript/multi-party-scheduler/) | TypeScript | Two-phase appointment scheduling over phone calls: gather availability, confirm one time with everybody by voice, release everybody who confirmed when the commit fails and resume an interrupted run. |
| [`apps/python/callback-coordinator`](apps/python/callback-coordinator/) | Python | Consent-first callback triage and routing: one CALL-E call learns why a person needs a callback, classifies the outcome into a fail-closed disposition, and routes it to the right team. |
| [`apps/python/callback-window-coordinator`](apps/python/callback-window-coordinator/) | Python | Consent-first callback-window coordinator with masked preview, stable idempotency, and structured CALL-E results. |
| [`apps/python/partline`](apps/python/partline/) | Python | Dry-run-first industrial replacement-part sourcing that calls approved suppliers, checks exact matches against the original request and keeps purchases and alternate approval human-owned. |
| [`apps/python/webhook-result-receiver`](apps/python/webhook-result-receiver/) | Python | Durable at-least-once CALL-E terminal webhook ingestion with SQLite deduplication, conflict detection, and authenticated Calls API reconciliation. |
| [`apps/python/lead-follow-up-booking`](apps/python/lead-follow-up-booking/) | Python | Consent-first lead follow-up booking: a disclosed AI call offers only calendar-confirmed free slots and books a Google Calendar event only when the lead picks a time on the call. |
| [`apps/python/callflow-campaign-runner`](apps/python/callflow-campaign-runner/) | Python | CSV-driven outbound campaign runner that triages structured results into auto-closed, retry, and needs-human queues. |
| [`apps/python/mobilize`](apps/python/mobilize/) | Python | Parallel wave dispatch to a consented pool under a deadline: stops calling the moment enough people confirm, and scores how firm each "yes" actually is instead of trusting every stated agreement. Ships a 300-trial zero-cost evaluation harness with a measured accuracy result, a crash-safe ledger, and an MCP server. |
| [`apps/python/batch-runner`](apps/python/batch-runner/) | Python | JSONL batch runner using CALL-E CLI auth state, FastMCP, Rich output, and MCP tool-call metadata. |
| [`apps/python/broker-login-client`](apps/python/broker-login-client/) | Python | CALL-E brokered login client with local token cache and MCP HTTP calls. |
| [`apps/typescript/broker-login-client`](apps/typescript/broker-login-client/) | TypeScript | CALL-E brokered login client using `@call-e/core`. |
| [`apps/typescript/broker-login-client-standalone`](apps/typescript/broker-login-client-standalone/) | TypeScript | CALL-E brokered login client without a shared package dependency. |
| [`apps/python/oauth-login-client`](apps/python/oauth-login-client/) | Python | CALL-E OAuth login client for MCP Streamable HTTP. |
| [`apps/python/metapelet-checkin`](apps/python/metapelet-checkin/) | Python | Preview-first runner for one MetaPelet-style CALL-E check-in with structured post-call summary. |
| [`apps/typescript/oauth-login-client`](apps/typescript/oauth-login-client/) | TypeScript | CALL-E OAuth login client for MCP Streamable HTTP. |
| [`apps/typescript/vibehub-founder-relay`](apps/typescript/vibehub-founder-relay/) | TypeScript | Consent-first founder-match readiness call with masked preview, stable idempotency, and structured CALL-E results. |
| [`apps/typescript/openings`](apps/typescript/openings/) | TypeScript | Standing availability watch for care access: calls the healthcare providers actually listed in directories to verify who is real, who takes your plan, and who has an opening, then keeps watching on a decaying cadence until a slot opens. |
| [`apps/typescript/ringer`](apps/typescript/ringer/) | TypeScript | Consumer web app that turns dreaded phone tasks — bill negotiation, cancellations, bookings, refunds, and multi-business quote comparison — into consent-first, multilingual CALL-E workflows with strict per-call and per-recipient result schemas, human-in-the-loop decision authority, evidence-gated and denominator-honest outcomes, and a no-call demo mode by default. |
| [`apps/web/local-atlas`](apps/web/local-atlas/) | JavaScript / Node | Map-first local guide where one confirmed call becomes a dated, evidence-quoted fact every later visitor reuses: stored answers, opinion refusal, closed-business and calling-window checks all work to avoid placing a call at all, results keep their uncertainty and expire by outcome, and private results are written where the public list cannot read them. A comparison across two or three nearby places is one multi-recipient task, with each business answering for itself and the cross-call verdict marked as derived rather than quoted. |
| [`apps/typescript/dispatch-pulse`](apps/typescript/dispatch-pulse/) | TypeScript | Real-time logistics command center for automated pre-delivery recipient phone verification, estate gate code extraction, and live SSE event streaming. |
| [`apps/python/kept`](apps/python/kept/) | Python | Turns a payment promise made on a collections call into a validated financial record: eleven named rejection reasons stand between a spoken sentence and a ledger entry, vague amounts are refused, over-commitments are clamped to the invoice balance with the spoken figure kept beside them, and the promise is reconciled against the bank feed a week later so only the commitments that actually broke are called again. |

The default e2e tests use a local fake broker/OAuth/MCP server or dry-run paths, so they do not require real CALL-E credentials or browser login. Live verification is opt-in in each app README.

### Plugins

No-code and low-code workflow plugins live under [`plugins/`](plugins/). They are for workflow-platform nodes, actions, connectors, and recipes that help operators connect business events to phone-call agent workflows without writing a full app.

Plugins should be explicit about inputs, outbound call side effects, credential handling, preview or dry-run behavior, and how a workflow builder can disable or roll back the integration.

| Plugin | Platform | Purpose |
| --- | --- | --- |
| [`plugins/n8n-calle-api`](plugins/n8n-calle-api/) | n8n | Importable CALL-E API workflow template for one-by-one outbound calls, metadata round trips, call status signals, transcripts, summaries, and structured results. |
| [`plugins/n8n-nodes-calle`](plugins/n8n-nodes-calle/) | n8n | Documentation-only pointer to the standalone `@call-e/n8n-nodes-calle` community node package for native outbound-call nodes. |
| [`plugins/dify-template`](plugins/dify-template/) | Dify | Importable Dify workflow DSL template for a one-shot outbound call tool with dry-run preview, API health gating, and masked results. |
| [`plugins/hubspot-calle`](plugins/hubspot-calle/) | HubSpot | Static HubSpot Projects app for creating CALL-E call tasks from CRM records and workflow App Cards. |
| [`plugins/zapier-calle`](plugins/zapier-calle/) | Zapier | Zapier Platform CLI integration for outbound CALL-E calls with callback-based waiting, fail-closed dispositions, dry-run preview, and payload-derived idempotency keys. |

### Safety patterns

- [`Production workflow guide`](docs/production-workflows.md) - Application-owned state, stable idempotency, durable webhook processing, result verification, retry ownership, and privacy-minimized audit patterns for consequential phone workflows.
- [`Safety reference`](skills/call-reminder/references/safety.md) - Consent, E.164 phone-number handling, credential boundaries, cancellation, duplicate-job prevention, and medical reminder boundaries.
- [`Dispatch safety reference`](skills/service-dispatch-call/references/safety.md) - Purpose-bound authorization, third-party privacy on outbound calls, the commitment boundary between gathering an answer and accepting it, and retention limits on transcripts and spoken values.
- [`Ambiguous outcome handling`](skills/service-dispatch-call/references/ambiguous-outcomes.md) - Why an unknown call outcome is a state to reconcile rather than an error to retry, and how client timeouts cause duplicate calls.
- [`Idempotency reference`](skills/service-dispatch-call/references/idempotency.md) - Deriving call idempotency keys from the authorization rather than the attempt, reserving before dialling, and replay-safe webhook handling.
- [`Approval threat model`](apps/typescript/phone-approval-gate/docs/threat-model.md) - What a phone approval proves and does not prove, out-of-band secret handling, and why the phone network is a restricted verification channel.
- [`Disclosure budget`](apps/typescript/call-on-behalf/docs/privacy-budget.md) - Authorizing what a caller may say about a person, checking the script before the call and checking what was actually said after it.
- [`Contact-claim limits`](apps/typescript/verify-contact-claim/docs/limits.md) - Why an institution refusing to confirm a contact is the expected outcome, what a confirmed contact still does not prove and what has never been tested live.
- [`Line-ownership verification`](apps/typescript/linecanary/docs/compliance.md) - Why a monitoring tool must prove control of a line before calling it, greeting-token verification, attestation for client lines, and proportionate check frequency.
- [`Provider descriptors`](apps/typescript/voice-preflight/docs/providers.md) - How one HTTP client drives any text-to-speech API from a JSON file, where the audio sits in a response, plus the order in which a run refuses so a failure says what has already happened.
- [`Onboarding call safety`](skills/customer-onboarding-call/references/safety.md) - Consent and recording disclosure, refusal suppression, content boundaries for price and policy claims, working-hours limits, and honest not-reached reporting.
- [`International routing`](skills/customer-onboarding-call/references/international-routing.md) - Forwarding pattern for unsupported regions, distinguishing congestion from no-answer from unsupported destination, and handling providers that report failure then dial anyway.
- [`Calls not placed`](apps/web/local-atlas/docs/calls-not-placed.md) - Refusing before dialling: reusing a stored answer, rejecting questions a phone cannot answer, closed-business and calling-window checks, and defaulting to simulated when no access code is configured.
- [`Fact freshness`](apps/web/local-atlas/docs/fact-freshness.md) - Expiring a call result by outcome so failures are not cached as conclusions, keeping hedges and refusals distinct from answers, and defeating idempotent replay when a reader rechecks.
- [`Design principles`](docs/design-principles.md) - Repository-wide architecture principles for safe phone-call workflows.
- [`Fail-closed dispositions`](plugins/zapier-calle/docs/fail-closed-dispositions.md) - Classifying phone-call outcomes so ambiguity, low confidence, and unrecognized statuses route to a human instead of a success branch.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full contribution guide.

### Contribution workflow

1. Choose a scoped contribution: skill, app, provider adapter, scheduler recipe, automation pattern, safety pattern, or reference implementation.
2. Confirm it directly helps AI agents package phone-call workflows.
3. Use the templates above for skill folders, app directories, adapter records, or README entries.
4. Add setup, usage, side-effect, and cancellation notes.
5. Use fictional or masked phone numbers in samples.
6. Keep repository-facing content in English.
7. Follow [`docs/git-naming-conventions.md`](docs/git-naming-conventions.md) for branch names, commit messages, and pull request titles.
8. Run validation before opening a pull request.

```bash
python3 scripts/validate_repository.py
```

High-quality additions should include a short description, compatibility notes, safety notes for real-world side effects, setup or install instructions, tests, cancellation or rollback behavior for recurring workflows, and no secrets or personal data.

Out of scope:

- generic telephony vendor directories
- marketing-only pages
- call-center software lists without an AI-agent workflow
- tools that require unsafe credential handling
- resources that hide phone calls, recurring jobs, or external side effects from the user

## Community

- Discord: [https://discord.gg/6AbXUzUV8w](https://discord.gg/6AbXUzUV8w)

## License

MIT. See [`LICENSE`](LICENSE).
