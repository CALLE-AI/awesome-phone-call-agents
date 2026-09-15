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
| [`apps/typescript/vouch`](apps/typescript/vouch/) | TypeScript / Next.js | Consent-scoped employment verification: no consent artifact, no dial. Requested vs permitted fields (California SB 1162 strips salary), third-party gatekeeper is a first-class disposition. Fixture replay by default. |
| [`apps/typescript/headcount`](apps/typescript/headcount/) | TypeScript / Next.js | CDC CASPER-style disaster household needs assessment: the unreached count is the product, voicemail is not a reach, unsupported fields strike through, and fail-closed cards go to a human. Fixture replay by default. |
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

- [`lesson-language-phone-practice`](skills/lesson-language-phone-practice/) - Consent-gated, lesson-derived phone rehearsal with a one-minute maximum, transcript-bound formative evidence, and no automatic redial.
- [`accesscall`](skills/accesscall/) - Phone-based accessibility intake for VPAT 2.4/Section 508 audits. Run `npm install` in `skills/accesscall/` before using `scripts/format-to-vpat.js`, or it fails with `Cannot find module 'jszip'`.
- [`accessible-outing-verifier`](skills/accessible-outing-verifier/) - Offline accessibility-planning fixture and proposed bounded CALL-E workflow; demonstrates advisory handling of qualified answers without making calls or certifying venue safety.
- [`appointment-confirm`](skills/appointment-confirm/) - Confirms one existing appointment by phone, captures yes/no plus time as structured JSON, and leaves calendar writes to a human.
- [`cod-order-confirmation-call`](skills/cod-order-confirmation-call/) - Prepares an authorized cash-on-delivery confirmation call from order rows with an advisory result schema; validation and status changes belong to the host or a human. Dry-run preview needs no credentials.
- [`candidate-availability-call`](skills/candidate-availability-call/) - Recruiting coordination skill that confirms candidate interview availability by phone, returns evidence-backed time windows, and leaves scheduling commitments to a human.
- [`call-reminder`](skills/call-reminder/) - Scheduler wrapper skill for recurring CALL-E phone-call reminders.
- [`childcare-availability-observer`](skills/childcare-availability-observer/) - Places one bounded CALL-E call to an authorized childcare provider to observe current availability for a stated age band and start window, preserving unknown on voicemail, no-answer, or refusal, without booking, enrolling, or paying.
- [`callparity-claimkill`](skills/callparity-claimkill/) - ClaimKill (CallParity) compiles the next CALL-E call as a leak-scored refute of a quoted claim; pytest runs on fixtures with zero live calls.

- [`customer-feedback-callback`](skills/customer-feedback-callback/) - Idempotent post-delivery CALL-E feedback call per order with a structured sentiment/missing-item result, no_answer/failed-only single retry, and a feedback/investigation/trend triage that recommends but never auto-applies an urgent business notification.
- [`carecall-intake`](skills/carecall-intake/) - Consent-aware practical-support check-ins that capture only explicit beneficiary needs and route unsafe, unsupported, or uncertain outcomes to human review.
- [`customer-onboarding-call`](skills/customer-onboarding-call/) - Welcome-call skill that turns a new signup into at most one conversation, a consent-gated structured result, and a CRM follow-up task, with evidence-backed dispositions, ordered outcome classification, per-attempt idempotency, and cancellable retries.
- [`deployment-approval-call`](skills/deployment-approval-call/) - Spoken, code-verified human approval before an agent or pipeline does something irreversible.
- [`emergency-dispatch-relay`](skills/emergency-dispatch-relay/) - Experimental, preview-first human-confirmed notification relay with an optional authorized exercise call and advisory unit-response output; not an autonomous emergency-dispatch system.
- [`emergency-dispatch-cascade`](skills/emergency-dispatch-cascade/) - Fills one urgent home-service job by ringing on-call technicians one at a time in priority order, stopping at the first acceptance, then places a single confirmation call to the customer with the assigned technician and ETA; refuses to run for life-threatening emergencies.
- [`holdline`](skills/holdline/) - Asks one question of many places by phone in a single dispatch and returns only the fields the transcript supports, flagging values a call reports for questions it never asked.
- [`voice-preflight`](skills/voice-preflight/) - Hear a call task spoken by your own text-to-speech provider before a real person does, then refuse a script whose critical line would not survive being spoken.
- [`dollar-consent-first-callback`](skills/dollar-consent-first-callback/) - Consent-first owner escalation after a local safety gate blocks an extreme-risk developer action; call results never grant destructive permission.
- [`email-task-call-proposal`](skills/email-task-call-proposal/) - Approval-gated channel selection for email, task, and calendar follow-ups, using CALL-E only for bounded phone-required appointment changes.
- [`forgerelay-supplier-clarification`](skills/forgerelay-supplier-clarification/) - Safe, approval-gated CALL-E workflow for collecting missing manufacturing RFQ details from authorized supplier contacts.
- [`human-context-handoff`](skills/human-context-handoff/) - Ask a verified human one bounded product, workflow, preference, or operations question, then resume an agent only from a durable structured result.
- [`holdfast`](skills/holdfast/) - Plan one approval-gated CALL-E call and check returned fields against callee-side transcript evidence. Includes a no-call parts-order walkthrough, saved evidence receipts, and review-only IVR route proposals. [Demo and testing guide](docs/holdfast/README.md).
- [`late-hold-triage`](skills/late-hold-triage/) - One CALL-E call to a guest who is already late; compares their spoken ETA to the remaining hold and returns KEEP_HOLD, RELEASE_NOW, or NEEDS_HUMAN without dialing the waitlist.
- [`language-bridge-call`](skills/language-bridge-call/) - Cross-language relay for CALL-E: one call to the recipient in their language, one call back to the requester in theirs, returning an agreed window or a fail-closed handoff.
- [`lead-qualification-call`](skills/lead-qualification-call/) - Qualifies a warm, consenting lead by phone with CALL-E, captures needs, budget, timing, decision authority, and interest as structured JSON, and routes dispositions to a human or CRM without cold outreach or unsolicited marketing.
- [`labline-critical-result`](skills/labline-critical-result/) - Safety-bounded CALL-E workflow for verified critical laboratory-result delivery with exact read-back, fail-closed disclosure rules, and human-owned clinical judgment.
- [`google-form-callback`](skills/google-form-callback/) - Google Form response workflow for safe one-off callback calls with dry-runs, scheduling plans, and Sheets writeback. See the [workflow guide](docs/google-form-callback/).
- [`ground-truth-gate`](skills/ground-truth-gate/) - Pre-call triage for a physical-world claim: decides whether a call is warranted at all from scope mismatch, evidence age, and cost of being wrong, answers provisionally, then gates the fact behind one disclosed call and releases it only on positive evidence.
- [`linecanary-monitor`](skills/linecanary-monitor/) - Synthetic monitoring for phone lines and deployed voice agents: scheduled test calls, structured assertions, baseline diffing, and CI gating via the linecanary app.
- [`mobilize`](skills/mobilize/) - Get a required number of confirmed responses from a consented pool within a deadline by dispatching parallel wave calls that stop the moment the need is met.
- [`outbound-call-skill-creator`](skills/outbound-call-skill-creator/) - Creator skill for generating focused outbound phone-call workflow skills from Google Forms, TikTok Ads, Notion, Airtable, local CSV files, or custom sources.
- [`holdfor-post-visit-followup`](skills/holdfor-post-visit-followup/) - Post-appointment check-in call for an older patient that books nothing: it returns five enumerated answers and one verbatim quote to a review queue, stops the call rather than answer anything clinical, and places a second call into the practice's own booking line only after a named human grants a bounded authority.
- [`metapelet-elder-checkin`](skills/metapelet-elder-checkin/) - Consent-based outbound wellbeing check-in for older adults using the MetaPelet non-medical companion persona; returns mood, topics, and repeat-call interest.
- [`standby`](skills/standby/) - Fill one open shift from a standby roster with a strictly sequential call cascade that stops at the first acceptance, so a single slot cannot be double-booked; handles no-answer retry passes, callbacks, quiet hours, a shift-start cutoff, and holds the cascade for human reconciliation when a call cannot be read.
- [`service-dispatch-call`](skills/service-dispatch-call/) - Service dispatch workflow that asks a vendor about availability, ETA, and cost, returns a schema-validated result, and routes any commitment to human approval.
- [`znak-callops`](skills/znak-callops/) - CALL-E service inquiry skill with an offline checker that preserves complete provider quotations, rejects unsupported evidence, and keeps conflicting statements and unknowns visible without booking.
- [`veyra-campaign-planner`](skills/veyra-campaign-planner/) - Turns a plain-language outbound process into an approval-ready Veyra campaign brief, reviews the generated workflow, and gates live dispatch behind an exact recipient preview.
- [`calle-script-advisor`](skills/calle-script-advisor/) - Drafts and lints CALL-E call task text and result schemas for clarity, safety, and extraction quality before a call is placed.
- [`calle-invoice-recovery`](skills/calle-invoice-recovery/) - Invoice-recovery conversation and safety reference with a no-call preview; live dispatch and human approval are host responsibilities. See the [operator guide](docs/calle-invoice-recovery/).
- [`bounty-screening-call`](skills/bounty-screening-call/) - Preview-first CALL-E workflow that verifies public technical-bounty reward, AI-use, eligibility, deadline, payout, and submission facts before a human decides whether to claim or submit.
- [`research-gap-call-verifier`](skills/research-gap-call-verifier/) - Turns cited business research into an approval-gated no-call preview, then reconciles CALL-E-compatible results without mistaking voicemail, refusal, or failure for a verified fact.
- [`scope-signal`](skills/scope-signal/) - Previews and reconciles one authorized CALL-E project-brief verification call, producing transcript-evidenced GO, CAUTION, or NO-GO guidance while leaving acceptance to a human.
- [`verify-by-phone`](skills/verify-by-phone/) - Single disclosed verification call that checks a directory listing against the published line, grounds every answer in a transcript span, and abstains instead of guessing when the call does not establish one.
- [`verity-verification-core`](skills/verity-verification-core/) - Gates a CALL-E phone task's `task_completed` claim behind an independent transcript read-back before any real-world action; catches a mid-sentence self-correction, voicemail, or a value the caller never confirmed, returns ALLOW or BLOCK plus the exact value to re-confirm on a second channel, and is deterministic, no-network, and fail-closed.
- [`call-state-reconciler`](skills/call-state-reconciler/) - Works out what actually happened to a call by reading the call task, its attempts and its event stream together, and names the field behind each conclusion. Covers the states where the platform's own signals disagree.
- [`call-summarizer`](skills/call-summarizer/) - Post-call analysis skill that turns a completed CALL-E transcript into a masked, actionable brief with a one-line outcome, extracted action items with owners and due dates, caller sentiment, and a one-way caller fingerprint for de-duplicating repeat callers.
- [`ringer-consumer-tasks`](skills/ringer-consumer-tasks/) - Compose and safely place the dreaded consumer phone calls (bill negotiation, cancellation, refund, booking, quote comparison, inquiry) as CALL-E tasks with strict result schemas, dry-run-by-default previews, and human-in-the-loop decision authority.
- [`exact-ref`](skills/exact-ref/) - Write-gate for an exact identifier captured by a CALL-E call: compares intended vs extracted character by character, names the provenance state, and stays blocked until a human types the value from a second channel; zero-dependency script, places no calls.
- [`incident-escalation-call`](skills/incident-escalation-call/) - Walks an on-call escalation ladder one phone call at a time and records an acknowledgement only when an owner and an ETA are both quoted by words the recipient spoke, then re-reads the call over a second transport before the incident is reported as owned.
- [`hifi-hotel-negotiator`](skills/hifi-hotel-negotiator/) - Autonomous voice AI agent skill for hotel procurement, direct-booking rate negotiation, and reservation confirmation over the phone using CALL-E.
- [`partline-part-sourcing`](skills/partline-part-sourcing/) - Preview-first industrial replacement-part sourcing that calls approved suppliers for exact part identity, quantity and shipping cutoffs, then ranks evidence-backed matches and leaves purchase and alternate approval to a human.

- [`call-the-parts`](skills/call-the-parts/) - Sit back and relax while your CALL-E agent skill calls spare parts shops for the used automotive part you need. See [testing instructions](skills/call-the-parts/TESTING.md).
- [`warranty-recovery`](skills/warranty-recovery/) - Resolves a residual post-submission warranty-claim exception the portal, documented code and written follow-up could not explain, with one authorized call that asks for the counterparty-stated status, reason, required correction and deadline, and promotes a claim, case or credit reference only after the representative confirmed a spoken read-back, so a misheard digit downgrades the result instead of filing a correction against somebody else's case.
- [`concord-policy-audit`](skills/concord-policy-audit/) - Calls the branches an operator owns, judges each spoken answer against a written policy rubric compiled into the CALL-E result schema, and returns a branch-level gap register that carries no field capable of identifying the person who answered.
- [`ledger-collections-call`](skills/ledger-collections-call/) - HITL outbound collections call from overdue JSON (E.164, integer minor units, region); CALL-E `create` + poll; structured promise out; dry-run default; never posts to unsupported regions (including YE)
- [`rdn-intake-referral`](skills/rdn-intake-referral/) - Consent-based outbound healthcare nutrition intake that collects structured information for RDN review and referral follow-up. See [`docs/rdn-intake-referral.md`](docs/rdn-intake-referral.md) for documentation and synthetic validation examples.

- [`trunkline-payer-call`](skills/trunkline-payer-call/) - Calls a health plan's provider-services line about a claim, disclosing only the patient identifiers that workflow needs and returning a closed-schema answer whose every field is backed by a quote checked against the call transcript; preview and check run offline with zero calls.
- [`recall-outreach`](skills/recall-outreach/) - Calls affected customers about a product recall using only organisation-approved wording, routes every unapproved question to a human, and reports call completion and recall resolution as separate measures so a completed call is never counted as a completed return.
- [`kol-ivr-route`](skills/kol-ivr-route/) - Verifies healthcare claim-status phone call results against the question asked, payer-side field evidence, destination identity, and an independent IVR route receipt before downstream use.
- [`is-it-accessible`](skills/is-it-accessible/) - Calls a venue with the accessibility questions that matter to one person (step count at the door, toilet on the same floor, hearing loop, guide dogs) and returns a per-need verdict backed by a direct quote; an unevidenced or hedged "yes" is recorded as unknown, never as a pass. Dry run by default, no dependencies until `--real`.
- [`pharmacy-cash-price`](skills/pharmacy-cash-price/) - Asks one retail pharmacy for a cash price with no insurance and returns a structured quote, a refusal, or an explicit unknown, with the disclosure and the medical boundary written into the call.
- [`logistics-exception`](skills/logistics-exception/) - Resolves a missed dock window by calling the driver and receiving dock concurrently with one strict CALL-E result schema, reconciling terminal results by event id and re-fetch, combining only reached-contact facts into a recovery card, and gating any dock-changing follow-up call behind explicit human approval.
- [`otherend-task-test`](skills/otherend-task-test/) - Rehearses a CALL-E task text and result schema against a programmable receptionist line the operator owns, reads the deterministic grade (manifest, self-report, fabrication, disclosure, confidence calibration), and turns each failing check into a task-text edit before the task reaches real people.

- [`muster`](skills/muster/) - Batch-audits a claimed directory by calling every listing with CALL-E and labeling each Present or Ghost with cited transcript evidence and a headline ghost-rate.
- [`route-readiness-call`](skills/route-readiness-call/) - Calls the next customer on a delivery route shortly before the rider arrives, accepts the readiness answer only when the customer's own words back it, and turns it into an earliest delivery time for re-ordering the remaining stops, with one call in flight and no redial.
- [`dispute-evidence-call`](skills/dispute-evidence-call/) - Places one disclosed phone call to a customer who disputed a card charge and uses the answers as chargeback evidence only when the transcript shows the customer said them; a reported no stops the filing, and nothing retries or redials on its own.
- [`landmark-navigation-assist`](skills/landmark-navigation-assist/) - Builds a CALL-E outbound task that guides a delivery driver through the last few hundred metres to a building using a reusable, landmark-based location config instead of GPS or postal text, with driver-confirmed, in-call-only escalation.
- [`positive-contact-call`](skills/positive-contact-call/) - Disclosed critical-notice call that confirms a live human acknowledged the message, treats voicemail as unconfirmed, and returns a fail-closed disposition for an escalation ladder.
- [`no-show-shield`](skills/no-show-shield/) - Calls every booking on a given day to confirm it, writes yes/reschedule/cancel outcomes back to the operator's calendar, and returns a short list of only the slots that still need a human.
- [`exception-resolution-calls`](skills/exception-resolution-calls/) - Resolves a blocked business workflow by phone (e.g. an overdue purchase-order acknowledgement), turning one CALL-E call task into per-recipient structured evidence and a deterministic state change. Gates any closing outcome on a self-reported `spoke_with` identity field, since an authorized phone number is not an authorized person, and differentiates escalation reasons instead of one generic needs-human flag; complements `exception-resolver`'s always-human-approval pattern by fully automating the unambiguous cases and escalating only what genuinely needs a person.
- [`supply-chain-supplier-status`](skills/supply-chain-supplier-status/) - Autonomous outbound phone calls to suppliers to verify purchase order fulfillment, capture delay causes, calculate financial risk, and sync procurement records.

- [`mission-replan-loop`](skills/mission-replan-loop/) - Turns a CALL-E result into mission evidence, checks it against operational constraints, and generates the next call when the current plan becomes impossible.
- [`pharmabridge-supply-finder`](skills/pharmabridge-supply-finder/) - Agent skill that finds a shortage medication or blood units by phone through a running PharmaBridge server: discover facilities, check the Shortage Pulse, dry-run the CALL-E brief, dispatch with consent gates, and report evidence-backed availability.

- [Cold Chain Sentinel](https://github.com/piyushxlabs/cold-chain-sentinel) - Autonomous voice triage engine intercepting reefer temperature excursions via CALL-E in-cab driver calls.
- [`conversation-clarify`](skills/conversation-clarify/) - Detects a written reply that agrees without saying which option, or commits without saying when, then settles it with one bounded disclosed CALL-E phone call and writes the answer back into the thread bound to the recipient's own words, or refuses to answer at all.
### Apps


- [Rove](https://github.com/siaohue1188/rove) - Logistics workforce operations control tower that detects the gap between digitally assigned and physically secured workers, uses CALL-E to verify standby-worker availability and arrival feasibility, and applies deterministic recovery or human-escalation rules. [Live Demo](https://rove-iota-seven.vercel.app/)
- [AcreVoice](https://github.com/dj-DeepakJadhav/acrevoice-farmer-support) - Consent-first farmer-support workspace that turns a focused CALL-E callback into confirmed, reviewable evidence for an agricultural adviser; the local deterministic workflow is no-call by default.
- [Reachable](apps/python/reachable/) - Keeps a school's emergency contact list reachable and follows up patterns of unexplained absence by phone: a termly contact check finds the numbers that have quietly stopped working, and a register-triggered cascade calls contacts in the school's own order, flagging a dead number the moment an absence call hits it. Never names a child before identity is confirmed, never collects a number by voice, never writes to the register, and never calls a vulnerable-flagged pupil.
- [Completia](https://completia-calle.keljampa.workers.dev/) - Property-payment safety reminder that lets a buyer explicitly request one CALL-E call after saving an independently verified solicitor contact; it does not verify payment instructions, use bank details, or contact the solicitor.
- [SiteWitness](apps/typescript/sitewitness/) - Local site-history interview workspace that carries reviewed evidence gaps into individually approved CALL-E calls, with exact transcript quotations, human year review, and a no-call rehearsal mode.
- [Rebuttal Dispute Call](apps/python/rebuttal-dispute-call/) - One disclosed CALL-E call to a disputing customer, cross-examined against its transcript before it becomes chargeback evidence, with six scripted no-call scenarios and a live path gated by per-run consent, an allowlist and local calling hours.
- [Clinic Slot Assistant](apps/typescript/clinic-slot-assistant/) - Preview a consented appointment-availability call, review CALL-E results, and confirm a fictional booking; local simulation is the default.
- [Cura](apps/python/cura/) - Django clinical-trial adherence monitor that uses CALL-E for scheduled patient check-ins and adverse-event triage.
- [MacroDial](apps/typescript/macrodial/) - No-call playbook review app using MacroDial's deployed CALL-E task compiler and outcome-to-state resolver, with synthetic persistence and a hosted-product workflow guide.
- [DockBrief](apps/typescript/dockbrief/) - One authorized CALL-E receiving-dock call becomes an evidence-linked physical unloading checklist with reported mismatches and unresolved facts; offline synthetic examples are the default.
- [DueCall](https://github.com/omkz/duecall) - Autonomous accounts-receivable workflow that uses CALL-E to follow up on overdue invoices, turn phone conversations into structured payment outcomes, and schedule guarded retries with business-hours, duplicate-call, and human-handoff controls.
- [CommonLot](https://github.com/kirmada1509/call-e-commonlot/tree/codex/commonlot-hackathon-submission) - Organizer-controlled pooled purchasing workbench that structures CALL-E buyer and supplier conversations, defaults to simulation, recomputes feasibility after revisions, and keeps orders human-approved. [Demo](https://commonlot.duckdns.org/about)
- [BidPilot Voice](docs/bidpilot-voice.md) - External CALL-E procurement verification app with reviewed supplier questions, structured results, and a no-call preview.
- [Callstack](https://github.com/RolexAlexander/callstack) - External codebase-ingesting technical support agent that reads repository documentation/source and proposes a CALL-E support-call task. The author reports previews against two repositories and one owned-destination live test; broad correctness is not independently established. No-call preview is the default; a real call requires an explicit `--dispatch` flag after human review of the diagnosis and call task.
- [CallIQ](https://github.com/kk590/CallIQ) - Experimental offline sales-call workflow simulator for rehearsing lead qualification, objection handling, meeting booking, and local CRM updates; it does not place real calls or mutate a live CRM.
- [NemoTheFinder](https://github.com/proggyaa/CallEHackathon) - Reusable Call-E agent workflow built for hassle free rental apartment hunting.
- [ResolveCall](https://github.com/Arvindkumar006/RESOLVECALL) - Experimental external CALL-E operational-recovery reference for delivery-window conversations and transcript-derived policy checks; live calling has real side effects, and recovery, production-readiness, and cryptographic guarantees are not independently verified.
- [PartFinder AI](https://github.com/atsushiyago/partfinder-ai) - External Next.js local-parts demo with a no-call mock default, explicit CALL-E call initiation, server-side credentials, and transcript-backed inventory comparisons for operator review.
- [RELAY](https://github.com/eyadarshad/RELAY) - Experimental external business-operations demo with a sandbox default, supplier conversations via CALL-E, and threshold-based human approval for purchase-order commitments; not a production procurement guarantee.
- [Flight Disruption Agent](apps/typescript/flight-disruption-agent/) - Flight disruption desk for OTAs and airlines: prices every option across the airline, distributor, and OTA chain before dialing, has CALL-E offer those exact amounts to each affected passenger, and applies only clear, consented choices after the call; for passenger requests, CALL-E agrees the change with the passenger, then calls the airline desk to make it. Dry-run default and fictional data.
- [Kordy](https://github.com/vimzh/kordy) - External Next.js event-monitoring app that compiles plain-language triggers, filters connected-source events, and places contextual CALL-E calls after a trigger match or explicit demo invocation; Gmail replies require spoken approval, and dry-run tests intercept call transport.
- [Tokito](https://github.com/vimzh/tokito) - Built for small teams tired of chasing ignored Google Forms, Tokito uses CALL-E to conduct adaptive phone conversations, ask intelligent follow-ups, and turn honest responses into evidence-backed insights they can act on.
- [Kol](apps/typescript/kol/) - Evidence-gated healthcare claim-status calls with strict CALL-E structured results, independent route receipts, a fail-closed verifier, and a 640-case no-call adversarial evaluation.
- [Triage-Line](apps/typescript/triage-line/) - Orchestrates fan-out and dependency-chained CALL-E calls with result verification, consent policy, and language auto-retry; post-outage welfare checks triage residents and auto-escalate to a GP follow-up, with a mock no-call default.
- [late-hold-triage](apps/python/late-hold-triage/) - Dry-run board that decides whether to keep or release a late guest's held slot from one structured CALL-E result; live mode is one authorized call and never starts a waitlist cascade.
- [ReturnReady](apps/python/returnready/) - Local return-enquiry review workbench that compares recipient quotations and later corrections with written instructions, with no-call examples and explicit approval before CALL-E requests.
- [ActionBridge](https://actionbridge.vercel.app) - Human-controlled phone-work orchestration web app that turns a bounded goal into a reviewed CALL-E call plan, with explicit confirmation, status/events, structured results and evidence; the public demo is no-call by default.
- [AfterCare](apps/python/aftercare/) - Consent-aware post-discharge CALL-E follow-ups with protocol schemas, dry-run by default, risk scoring, and a clinic UI.
- [TeamLine](apps/typescript/teamline/) - Coach-authorized CALL-E workflow that gathers operational facts, pauses for a human decision, and communicates the approved outcome; sandbox/no-call mode is the default. [Demo](https://teamline-judge-console.netlify.app/teamline/demo) · [Video](https://youtu.be/2btXyqeA3Wg)
- [VINRelease](apps/typescript/vinrelease/) - Evidence-first dealership title exception workflow that binds each CALL-E call to an approved disclosure packet and advances only from strict structured results, with a two-call no-call replay by default.
- [Clarity](apps/typescript/clarity/) - Clarifies one ambiguous job-application claim through an adaptive CALL-E phone call, returning transcript-backed facts and unresolved questions, with a no-call replay default. [Demo video](https://www.youtube.com/watch?v=_eHWqBgilrI)
- [RelayGoal](apps/typescript/relaygoal/) - Asynchronous accessibility phone relay for Deaf, hard-of-hearing and speech-disabled users: type a goal, CALL-E makes the whole call, and every answer comes back bound to the verbatim transcript turn that proves it or honestly marked not confirmed, with a dry-run default and an explicit opt-in live path. [Live demo](https://call-e-2026.vercel.app)
- [HippoHomes](https://www.hippo-homes.com) - Apartment-hunting app that prepares user-approved CALL-E call briefs to verify listing availability, ask missing questions, and request viewing appointments while keeping the renter in control.
- [Fraud Ops Caller](apps/typescript/fraud-ops-caller/) - Pack-fired fraud-ops desk (KYC, evidence, collections, merchant) with stub dial by default, masked plan destinations, and live CALL-E gated by operator secret, pinned origin, and confirm phrase.
- [CallPermit](apps/typescript/callpermit/) - Bounded appointment calls where CALL-E handles the conversation, a Tethers-backed envelope decides permission before dispatch, and provider evidence is reconciled against the same authority; deterministic no-call mode by default.
- [OneReach service follow-up](apps/typescript/onereach-service-followup/) - Turns an authorized CALL-E service appointment conversation into a validated Operations handoff, with a no-call default and standalone public integration example.
- [Veyra](apps/web/veyra/) - Converts a plain-language outbound process into an editable, approval-gated CALL-E campaign with fake mode enabled by default.
- [CallePilot](https://github.com/legendstechgh/callepilot) - Mobile business call workbench that turns a reviewed business objective into an approval-gated CALL-E lead-qualification workflow with structured results and a clearly labeled demo mode.
- [CareLoop AI](apps/typescript/careloop-ai/) - Consent-gated post-consultation CALL-E follow-ups that preserve uncertain patient reports and route concerning outcomes to human clinical review, with a no-call default.
- [OpenLine Screening](apps/typescript/openline-screening/) - Recruiter console that places the first-round CALL-E screening call to each shortlisted candidate with a fixed disclosure-and-consent script, a three-pass prohibited-topic guard, and strict structured results; a person decides Interview or Reject, and the no-call fake mode runs the whole loop.
- [Sparbird](apps/typescript/sparbird/) - Rings your own phone, plays the person you have to win over, and quotes back the line that lost them, with a recorded no-call default.
- [Audition Agent](apps/python/audition-agent/) - Producer-reviewed CALL-E role-disclosure calls that collect performer interest, callback availability, and unanswered questions, with a no-call verification path.
- [SupplyCall AI](apps/web/supplycall-ai/) - Procurement exception recovery that uses CALL-E to confirm a missing PO with the supplier, then applies deterministic resolve/escalate rules, with Vitest no-call verification.
- [VoltX VoiceOps](apps/web/voltx-voiceops/) - Operator desk that turns battery-handler lead lists into CALL-E qualification calls, structured feedstock facts, heuristic scoring, and follow-up priority, with labeled simulation by default and fail-closed live dispatch.
- [DeskHelp](apps/web/deskhelp/) - Hands an office's weekly call list to CALL-E and reports what each call settled: fourteen workflows ready to switch on, approved wording only, every other question captured in the caller's own words and answered on the next call, promises kept as promises, and no answer stored unless the recipient's own words back it.
- [CallParity](https://github.com/ruddro-roy/callparity) - Two-call ops workbench for Party A claims, a Party B falsification CALL-E task, and a merged claim graph. Preview and fixture mode by default.
- [CallmeMaybe](https://github.com/jongan69/callmemaybe) - Shopify order-exception phone workflows that use CALL-E for carrier traces and consent-first customer callbacks, with a no-call fixture mode and merchant approval before every Shopify mutation.
- [Centre Remix](apps/web/centre-remix/) - SAMPLE Harbour Place leasing board with WebMCP tools and an honestly fake-only CALL-E-shaped wrap (`place_tenant_call`); public Netlify demo never dials; reserved SAMPLE phones only. [Live](https://ornate-pie-10561d.netlify.app)
- [GridGuard Voice Escalation Agent](https://github.com/draculess99/gridguard-voice-escalation-agent) - Approval-gated grid-risk escalation app using CALL-E with disclosed calls, two human confirmations, structured escalation packets, and a dry-run/no-call default. [Demo](https://gridguard-voice-escalation-agent-production.up.railway.app/)
- [HOLDLINE](https://github.com/Elioz404/HOLDLINE) - Evidence-gated batch phone enquiries with per-target verdicts checked against the transcript, a freshness ledger that skips repeat calls, and an MCP server with a no-account simulation mode. [Demo](https://holdline-j0ku.onrender.com)
- [GridGate](https://github.com/ashczar77/grid-gate) - Experimental local reference workbench for consent-gated emergency provider cascade simulations during Eskom load-shedding, featuring dry-run planning by default, early exit on fulfilled quotes, and CALL-E voice verification.
- [Later, Me.](https://github.com/shirosenagi-design/later-me) - Windows CALL-E app for scheduling a real phone call to your future self, with a four-hour minimum, one pending reservation, and optional post-call Relationship Trace.
- [MeasureBack](apps/python/measureback/) - CALL-E recipe interview that clarifies household measures, preserves quoted corrections and scales quantities in Python; authored examples run without a call.
- [Post-Discharge Check](docs/post-discharge-check/) - External, synthetic care-team interface simulation illustrating CALL-E check-in transcripts, advisory flags, and a local escalation inbox; not a clinical workflow implementation or verified live integration.
- [SchemaRelay](https://github.com/14188769700lbk-dev/schemarelay) - Consent-gated CALL-E owner interviews that turn data schema-change questions into human-review evidence packets, with a no-call dry run by default.
- [Callibrate](apps/python/callibrate/) - Record verification by phone: turns a stale directory entry into a Verification Contract, calls the authoritative source with CALL-E, and applies a change only when the transcript itself contains the provider stating it, the agent reading the whole value back, and the provider agreeing; everything else reaches a curator with the reason, in a hash-linked evidence ledger. No-call pilot line by default.
- [ShohojSheba Voice](https://shohojsheba-call-e-preview.redwan-rahman.workers.dev/judge) - Consent-gated healthcare staffing dispatch that uses structured CALL-E results to advance after a verified decline, pauses on acceptance, and keeps final assignment human-controlled.
- [Supply Chain Supplier Status Agent](https://github.com/mohSadiq90/call-e-hackathon) - Autonomous enterprise phone agent for supplier purchase order fulfillment verification, root cause delay capture, penalty estimation, and ERP dashboard sync with zero-credit mock simulation.

- [WristCall AI](https://github.com/Baklolman69/WristCallAI) - Wear OS smartwatch assistant that searches Google via SerpApi, synthesizes call intent with Groq AI 120B, and dispatches autonomous phone calls via CALL-E with 3-bullet voice summaries.
- [PharmaBridge](apps/typescript/pharmabridge/) - Finds shortage medicine or specific blood units by phone with parallel CALL-E calls to real pharmacies and blood banks, evidence-backed ranking, hold, transfer, and reservation follow-ups, a shared Shortage Pulse of verified answers, and a call ledger; simulation by default.
- [Ringdown](apps/python/ringdown/) - Runnable on-call escalation ladder that only counts a page as acknowledged when an owner and an ETA are each quoted from what the recipient said, seals every verdict in a hash-chained ledger that re-derives it offline, and dials nothing without an explicit confirmation phrase. [Demo video](https://youtu.be/cZg4hbkCVMA)

- [Churn-Rescue AI](https://github.com/NemesisDevX/Churn-Rescue-Agent) - Simulated retention-conversation prototype with a proposed CALL-E integration; the browser currently stands in for telephony, so no working CALL-E dialer, verified latency, or enterprise revenue outcome is claimed.
- [RescueGrid](https://github.com/utkarshml/rescuegrid) - Experimental scripted disaster-response simulation with a proposed CALL-E dispatch integration; shelter, capacity, status, and route outputs are demonstration data, not verified evacuation guidance or emergency infrastructure.
- [ScamShield](https://github.com/rimsha21-source/Scamshield-ui) - Experimental scripted anti-scam conversation simulator with fixed demonstration transcripts/scores and a placeholder CALL-E live adapter; it is not validated real-time fraud protection.
- [Threshold](https://call-e-attention-gate.cohyme.chatgpt.site) - Japanese-language missed-call review demo with a public no-call fixture path, field-level evidence, and fail-closed handling for an unresolved CALL-E execution attempt. See the [judge guide](docs/threshold/).
- [SafeOps](https://github.com/saikumar040060/safeops) - Experimental runtime authorization layer for CALL-E outcomes using policy checks and human approval; author-reported evidence covers one real outbound call controlling a seeded local demo refund and a blocked manipulated-transcript case, not a real payment refund or a production exactly-once guarantee. Evidence is not independently verified: [`submissions/calle.md`](https://github.com/saikumar040060/safeops/blob/main/submissions/calle.md).
- [OOO-Pilot](https://github.com/balajianbalagan/ooopilot) - Slack-based AI work proxy that places real CALL-E phone calls on an absent employee's behalf, verifies coworker claims against Jira before treating them as fact, and reports discrepancies in a return-to-work summary.

-  [VendorPulse](https://github.com/Eman2123/VendorPlus) - Autonomous CALL-E-powered vendor check-in tool that calls suppliers about order status, scores delivery risk, and escalates high-risk vendors for human review.

- [hivemind-closer](apps/python/hivemind-closer/) - Mock-first lead qualifier that folds one structured CALL-E result into a deterministic bargaining board with immediate graceful exit on opt-out and a code-enforced 20-call budget; dry-run preview by default.
- [Ringbolt](https://github.com/voyagi/ringbolt) - On-call line that phones a human when production breaks, holds a two-way conversation about the incident, and runs the authorized runbook fix only after verifying the spoken confirmation against the call transcript, with a no-call local stand-in by default. [Demo](https://ringbolt.taranity.com) · [Video](https://www.youtube.com/watch?v=EIm87clsks8)
Runnable demo apps live under [`apps/`](apps/). They are not a CALL-E SDK and do not define a supported application API.

- [Ringback](https://github.com/DrGitman/Ringback.git) - Callback-first front door for university admin offices: a reasoning agent reads the caller's question against their student record and curated institution documents, then either briefs one CALL-E call or routes the case to a named office without dialling. Third-party callers and requests needing a signature never reach a call. Mock transport with no calls by default.

| App | Language | Purpose |
| --- | --- | --- |
| [`apps/typescript/offhire`](apps/typescript/offhire/) | TypeScript / Node | Equipment off-rent verification with separate pickup evidence, a synthetic no-call demo, and explicit owned-phone roleplay through CALL-E with persisted idempotency and conservative transcript checks. |
| [`apps/typescript/readycheck`](apps/typescript/readycheck/) | TypeScript / Node | Requirement-based local-service inquiries with CALL-E, source-linked evidence review, focused follow-ups, explicit budget revisions and durable recovery; fictional no-call demo by default. |
| [`apps/python/rebuttal-dispute-call`](apps/python/rebuttal-dispute-call/) | Python | Merchant-side chargeback evidence call: one disclosed CALL-E call with a fixed script and a strict result schema, a yes used only when the customer's own words say yes, a no that stops the filing, and a masked evidence PDF; dry-run with six scripted scenarios by default, live only with per-run consent, an allowlist, local calling hours and one call per dispute. |
| [`apps/typescript/last-crate`](apps/typescript/last-crate/) | TypeScript / Node.js | Two-call surplus-bread handoff: verifies the donor offer, matches full-capacity collectors, and issues an expiring pickup ticket from a bounded commitment; no-call fixtures by default. |
| [`apps/typescript/wever-callback`](apps/typescript/wever-callback/) | TypeScript / Node.js | Consignment-boutique callback inbox with customer requests, approved CALL-E interviews, saved conversations and staff-confirmed next steps; local no-call mode by default. |
| [`apps/typescript/medroute`](apps/typescript/medroute/) | TypeScript | Consent-first pharmacy availability workbench with a safe demo mode, structured CALL-E results, and downloadable call transcripts. |
| [`apps/typescript/before-we-go`](apps/typescript/before-we-go/) | TypeScript / Node.js | Consent-gated restaurant enquiry callbacks grounded in a versioned fictional fact sheet, with transcript-linked customer needs, unresolved questions, and a reviewed staff handoff; synthetic no-call default. |
| [`apps/typescript/kol`](apps/typescript/kol/) | TypeScript / Node | Evidence-gated healthcare claim-status calls that require transcript-grounded fields, the intended payer department, the actual question, and an independent IVR route receipt; includes a 640-case no-call evaluation and explicit live CALL-E path. |
| [`apps/typescript/triage-line`](apps/typescript/triage-line/) | TypeScript / Node | Orchestrates fan-out and dependency-chained CALL-E calls with confidence/evidence verification, consent policy, and language auto-retry; welfare-check triage auto-escalates urgent cases to a GP follow-up call, with a mock no-call default and live/hybrid modes. |
| [`apps/python/rolloff-scope`](apps/python/rolloff-scope/) | Python | Compares a fixed dumpster scope using evidence-bound mandatory fees; excludes incomplete or contradictory quotes, with no-call fixtures by default. |
| [`apps/typescript/teamline`](apps/typescript/teamline/) | TypeScript / Node | Coach-authorized two-call workflow that gathers facility facts, requires a human decision, then communicates the approved change and captures structured family responses; sandbox/no-call mode is the default. |
| [`apps/web/veyra`](apps/web/veyra/) | TypeScript / Next.js / Python | Natural-language campaign builder with exact recipient review, operator-gated live dispatch, fail-closed reconciliation, and fake mode enabled by default. |
| [`apps/typescript/vinrelease`](apps/typescript/vinrelease/) | TypeScript | Evidence-first dealership title exception workflow with exact call approval, minimum disclosure, strict CALL-E results, conservative state transitions, and a deterministic two-call replay. |
| [`apps/typescript/clarity`](apps/typescript/clarity/) | TypeScript / Next.js | Clarifies one job-application claim with an adaptive CALL-E follow-up, structured results, timestamped transcript evidence, and a synthetic no-call replay. |
| [`apps/typescript/careloop-ai`](apps/typescript/careloop-ai/) | TypeScript / Next.js | Catalog and reproducibility guide for consent-gated post-consultation CALL-E follow-ups, strict patient-reported results, verified webhook reconciliation, and human clinical review, with a no-call default. |
| [`apps/typescript/openline-screening`](apps/typescript/openline-screening/) | TypeScript / Next.js | Catalog and setup guide for recruiter first-round screening calls: fixed AI disclosure and consent, prohibited-topic guard before and after each call, operator-gated one-click dial with a stored idempotency key, structured results for human review, and a fake CALL-E no-call mode. |
| [`apps/typescript/sparbird`](apps/typescript/sparbird/) | TypeScript / Next.js | Practice calls that ring only the caller's own phone, play the person they are about to face, and award a point only where a line of the transcript proves it; recorded no-call replay is the default. |
| [`apps/typescript/payoutproof`](apps/typescript/payoutproof/) | JavaScript / Node | Compiles a publicly sourced reward inquiry into one disclosed, approval-gated CALL-E payout-policy call; masks the number in previews and treats verbal answers as non-contractual until backed by written terms. |
| [`apps/typescript/creditcall`](apps/typescript/creditcall/) | JavaScript / Node | Human-approved invoice-exception call handoff with a no-call dry run, disclosed test calls, masked phone output, and duplicate-start protection. |
| [`apps/typescript/fraud-ops-caller`](apps/typescript/fraud-ops-caller/) | TypeScript / Next.js | Pack-fired fraud-ops desk: KYC, evidence, collections, and merchant intents with a stub dial by default, masked plan destinations, and live CALL-E gated by operator secret, pinned origin, and confirm phrase. |
| [`apps/typescript/changelock`](apps/typescript/changelock/) | TypeScript / Next.js | Accounts-payable fraud command center: verifies vendor payment-detail change requests by calling only the pre-existing trusted vendor-master contact, with masked destinations, content-bound idempotency, fail-closed result gates, a permanent held status, and a deterministic no-call replay default. |
| [`apps/typescript/callpermit`](apps/typescript/callpermit/) | TypeScript / Node | Bounded appointment calls where a Tethers-backed authority envelope decides permission before CALL-E dispatch, with deterministic reconciliation and a no-call default. |
| [`apps/typescript/sparescout`](apps/typescript/sparescout/) | TypeScript | Approval-gated multi-supplier vehicle-part sourcing with strict fitment schemas, durable evidence history, interruption-safe CALL-E monitoring, global market localization, and a no-call fixture default. |
| [`apps/typescript/asyncfounders`](apps/typescript/asyncfounders/) | TypeScript | Callback-first persistent team memory: consented CALL-E interviews capture updates, brief unseen company deltas, and resolve open questions into evidence-linked typed memory. |
| [`apps/typescript/one-more-story`](apps/typescript/one-more-story/) | TypeScript | Consent-first oral-history call that discloses AI use, preserves the storyteller's correction, and creates no story until the corrected read-back is explicitly confirmed. |
| [`apps/web/asheard`](apps/web/asheard/) | TypeScript / Next.js | Reads what actually happened to a call as three separate answers rather than one status word, shows the field behind every sentence, and ranks a batch by what costs something if ignored. |
| [`apps/web/callproof`](apps/web/callproof/) | Ruby / Python | Closed-loop CALL-E workflow that checks transcript evidence against an immutable call contract and routes policy exceptions to persisted AgentKit human review. |
| [`apps/web/centre-remix`](apps/web/centre-remix/) | JavaScript / Node | SAMPLE shopping-centre leasing board: humans and agents share one floor plan; `place_tenant_call` writes honestly fake-only CALL-E-shaped fixtures (public function never dials; reserved SAMPLE phones; masked responses). |
| [`apps/typescript/evidence-grounded-callback`](apps/typescript/evidence-grounded-callback/) | TypeScript | Compiles owner-reviewed source evidence and positive callback consent into a masked CALL-E preview and separately gated MCP plan. |
| [`apps/typescript/kincall`](apps/typescript/kincall/) | TypeScript | Consent-first check-in and trusted-circle coordination: a stated request for help overrides the agent's own judgement, contacts are called one at a time until somebody commits, and the monitored person is called back with the outcome. |
| [`apps/typescript/revisit-zero`](apps/typescript/revisit-zero/) | TypeScript | Controlled meter-access recovery workbench with deterministic safety gates, exact call approval, one-recipient CALL-E execution, strict structured-result validation, and human-approved rebook export. |
| [`apps/typescript/verify-contact-claim`](apps/typescript/verify-contact-claim/) | TypeScript | Contact-claim verifier for a suspicious voicemail, text or missed call: dials only the number printed on the customer's own card, asks whether that contact was genuine and returns the words that came back with a hash-chained record. |
| [`apps/typescript/call-neuron`](apps/typescript/call-neuron/) | TypeScript | Functional consent-first scholarship outreach prototype with manual/file intake, identity-first disclosure, neutral voicemail, one-recipient CALL-E planning and confirmation, live status, human dispositions, and browser-local campaign data. |
| [`apps/typescript/hirecall`](apps/typescript/hirecall/) | TypeScript | Recruiter screening desk for internship and junior hiring: Excel batches, Gemini-written CALL-E scripts, sequential calls, post-call scoring, and a dry-run no-call path by default. |
| [`apps/typescript/callparity`](apps/typescript/callparity/) | TypeScript / Python | Catalog pointer to CallParity. ClaimKill in this repo compiles leak-scored refute plans from fixtures with zero live CALL-E calls. |
| [`apps/typescript/callsuite`](apps/typescript/callsuite/) | TypeScript | Checks versioned CALL-E task instructions against required business disclosures, blocks unsafe changes, and provides a complete no-call judge demo with reviewed evidence. |
| [`apps/typescript/connected`](apps/typescript/connected/) | TypeScript | AI phone companion whose consented recurring conversations remember interests and family stories, revisit them naturally, and offer human-reviewed event reminders or community introductions. |
| [`apps/typescript/linecanary`](apps/typescript/linecanary/) | TypeScript | Synthetic monitoring and CI regression testing for business phone lines and voice agents: ownership-verified scheduled test calls, schema and timing assertions, baseline regression diffing, Slack alerts, and a GitHub Action. |
| [`apps/typescript/phone-approval-gate`](apps/typescript/phone-approval-gate/) | TypeScript | Phone-verified approval gate for irreversible automation, with a one-time spoken code, an escalation ladder, dual control and a verifiable approval record. |
| [`apps/typescript/voice-preflight`](apps/typescript/voice-preflight/) | TypeScript | Renders a call task through any text-to-speech API you already pay for so you hear it before the callee does, then refuses a script whose declared critical line has gone missing, whose voice cannot speak the recipient's language or whose measured audio overruns its budget. |
| [`apps/typescript/call-on-behalf`](apps/typescript/call-on-behalf/) | TypeScript | Delegated errand caller with a disclosure budget: says only the details the person authorized, commits only inside authorized windows, and returns the answers plus the transcript. |
| [`apps/typescript/lost-line-coordinator`](apps/typescript/lost-line-coordinator/) | TypeScript | Consent-first lost-property route coordinator with inspectable calls, locally validated feature evidence, adaptive early stopping, and privacy-minimized results. |
| [`apps/typescript/surplus-signal`](apps/typescript/surplus-signal/) | TypeScript | Consent-first surplus-food pickup confirmations with strict structured results and a redacted candidate manifest that still requires human dispatch approval. |
| [`apps/python/reachable`](apps/python/reachable/) | Python | Keeps a school's emergency contact list reachable and follows up patterns of unexplained absence by phone: a termly contact check finds the numbers that have quietly stopped working, and a register-triggered cascade calls contacts in the school's own order, flagging a dead number the moment an absence call hits it. Never names a child before identity is confirmed, never collects a number by voice, never writes to the register, and never calls a vulnerable-flagged pupil. |
| [`apps/typescript/capacityline`](apps/typescript/capacityline/) | TypeScript | Consent-first manufacturing supply recovery desk that calls approved backup suppliers, returns transcript-grounded quantity and delivery commitments, fails closed against buyer guardrails, and requires human approval before an RFQ handoff. |
| [`apps/typescript/procurepulse`](apps/typescript/procurepulse/) | TypeScript / Node | Urgent supplier quote race: identical CALL-E questions to authorized suppliers, one strict per-recipient result schema, unit-aware deterministic ranking that turns vague answers into needs-review instead of numbers, and human-gated internal approval and non-purchase hold calls; preview and loopback fake-server paths by default. |
| [`apps/python/accessline`](apps/python/accessline/) | Python | Consent-first venue accessibility verification with disclosed automation, three fixed factual questions, CALL-E REST polling, schema-valid structured results, uncertainty preservation, and a no-call mock CLI by default. |
| [`apps/python/aftercare`](apps/python/aftercare/) | Python | Consent-aware post-discharge CALL-E follow-ups with protocol schemas, dry-run by default, risk scoring, and a clinic UI. |
| [`apps/python/cura`](apps/python/cura/) | Python | Django clinical-trial adherence monitor that uses CALL-E for scheduled patient check-ins and adverse-event triage; dry-run and webhook simulation by default. |
| [`apps/python/appointment-confirm`](apps/python/appointment-confirm/) | Python | Consent-first appointment confirmation with a no-call preview, fixture mock, and one-shot CALL-E execute path that returns yes/no + time as fail-closed JSON. |
| [`apps/python/blood-bank-dispatch`](apps/python/blood-bank-dispatch/) | Python | Parallel blood-stock enquiry that dials every blood bank at once on CALL-E, extracts a strict availability schema with `unknown` preserved as an answer, and returns a shortlist for a human to act on. |
| [`apps/python/leash`](apps/python/leash/) | Python | Revokes an unattended agent's Google credential unless one call clears twelve conditions; silence, a machine answering, or a result that disagrees with its own transcript all end the lease. |
| [`apps/typescript/recallready`](apps/typescript/recallready/) | TypeScript | Consent-gated product-recall qualification calls grounded in official CPSC records, with masked destinations, single-use previews, structured remedies, and a no-call default. |
| [`apps/typescript/readyline`](apps/typescript/readyline/) | TypeScript | Event load-in coordinator that turns authorized CALL-E vendor results into deterministic access, dock, power, and deadline checks, with a no-call demo and human-approved follow-up. |
| [`apps/python/freshchain-resolver`](apps/python/freshchain-resolver/) | Python | Resolve delayed cold-chain receiving exceptions by phone and return a safe dispatch decision. |
| [`apps/python/incidentbridge`](apps/python/incidentbridge/) | Python | Consent-first vendor incident support coordinator with masked preview, durable duplicate-call protection, strict structured evidence, and human-owned recovery verification. |
| [`apps/python/hungrycall-cascade`](apps/python/hungrycall-cascade/) | Python | Sequential call cascade that stops at the first candidate meeting every must and boundary, with staged concessions treated as an authorisation and unknown outcomes halting the run. |
| [`apps/python/researchcall-survey`](apps/python/researchcall-survey/) | Python | Standardized survey runner with a reproducible seeded sample, locked ethics rules, raw answers kept beside their coded category, and completion measured against everyone drawn. |
| [`apps/python/ringedingeding`](apps/python/ringedingeding/) | Python | Multi-recipient response aggregator that keeps answered, refused and unreached apart, reports every share against those who answered, and never reads silence as consent. |
| [`apps/python/rehab-adherence-caller`](apps/python/rehab-adherence-caller/) | Python | Rehab course-adherence caller that decides from a patient's attendance trajectory whether to call and which call to make, keeps a volunteered symptom out of the automated path, and treats an unkept promise to return as its own outcome. |
| [`apps/typescript/multi-party-scheduler`](apps/typescript/multi-party-scheduler/) | TypeScript | Two-phase appointment scheduling over phone calls: gather availability, confirm one time with everybody by voice, release everybody who confirmed when the commit fails and resume an interrupted run. |
| [`apps/python/callback-coordinator`](apps/python/callback-coordinator/) | Python | Consent-first callback triage and routing: one CALL-E call learns why a person needs a callback, classifies the outcome into a fail-closed disposition, and routes it to the right team. |
| [`apps/python/callback-window-coordinator`](apps/python/callback-window-coordinator/) | Python | Consent-first callback-window coordinator with masked preview, stable idempotency, and structured CALL-E results. |
| [`apps/python/cloud-steward-incident-callback`](apps/python/cloud-steward-incident-callback/) | Python | Preview-first on-call incident notification that preserves Cloud Steward's separate approval boundary. |
| [`apps/python/partline`](apps/python/partline/) | Python | Dry-run-first industrial replacement-part sourcing that calls approved suppliers, checks exact matches against the original request and keeps purchases and alternate approval human-owned. |
| [`apps/python/concord`](apps/python/concord/) | Python | Preview-first branch policy auditing that rules on the value a call extracted rather than the transcript, treats unreached branches and hedged answers as unresolved, and reports on locations rather than staff. |
| [`apps/python/webhook-result-receiver`](apps/python/webhook-result-receiver/) | Python | Durable at-least-once CALL-E terminal webhook ingestion with SQLite deduplication, conflict detection, and authenticated Calls API reconciliation. |
| [`apps/python/lead-follow-up-booking`](apps/python/lead-follow-up-booking/) | Python | Consent-first lead follow-up booking: a disclosed AI call offers only calendar-confirmed free slots and books a Google Calendar event only when the lead picks a time on the call. |
| [`apps/python/callflow-campaign-runner`](apps/python/callflow-campaign-runner/) | Python | CSV-driven outbound campaign runner that triages structured results into auto-closed, retry, and needs-human queues. |
| [`apps/python/mobilize`](apps/python/mobilize/) | Python | Parallel wave dispatch to a consented pool under a deadline: stops calling the moment enough people confirm, and scores how firm each "yes" actually is instead of trusting every stated agreement. Ships a 300-trial zero-cost evaluation harness with a measured accuracy result, a crash-safe ledger, and an MCP server. |
| [`apps/python/callibrate`](apps/python/callibrate/) | Python | Verification Contracts turn a doubted record into one disclosed CALL-E call, a deterministic transcript reading grants or refuses the write, and every contract, run id, claim, verdict and diff lands in an append-only hash chain. No-call pilot line by default. |
| [`apps/python/batch-runner`](apps/python/batch-runner/) | Python | JSONL batch runner using CALL-E CLI auth state, FastMCP, Rich output, and MCP tool-call metadata. |
| [`apps/python/broker-login-client`](apps/python/broker-login-client/) | Python | CALL-E brokered login client with local token cache and MCP HTTP calls. |
| [`apps/typescript/broker-login-client`](apps/typescript/broker-login-client/) | TypeScript | CALL-E brokered login client using `@call-e/core`. |
| [`apps/typescript/broker-login-client-standalone`](apps/typescript/broker-login-client-standalone/) | TypeScript | CALL-E brokered login client without a shared package dependency. |
| [`apps/python/oauth-login-client`](apps/python/oauth-login-client/) | Python | CALL-E OAuth login client for MCP Streamable HTTP. |
| [`apps/python/metapelet-checkin`](apps/python/metapelet-checkin/) | Python | Preview-first runner for one MetaPelet-style CALL-E check-in with structured post-call summary. |
| [`apps/python/holdfor-board`](apps/python/holdfor-board/) | Python | Post-visit check-in calls to older patients that book nothing: each call returns five bounded answers and one verbatim sentence to a review queue, where a named person grants a bounded authority before a second call carries her own words to the practice's booking line. A reviewer may shorten what she said and never widen it, checked server-side on the exact substring; a red-flag phrase is scanned for deterministically as well as prompted against; and a refusal is filed as a refusal rather than a call to retry. Fake transcripts by default, so the whole board runs without dialling. |
| [`apps/typescript/oauth-login-client`](apps/typescript/oauth-login-client/) | TypeScript | CALL-E OAuth login client for MCP Streamable HTTP. |
| [`apps/typescript/vibehub-founder-relay`](apps/typescript/vibehub-founder-relay/) | TypeScript | Consent-first founder-match readiness call with masked preview, stable idempotency, and structured CALL-E results. |
| [`apps/typescript/openings`](apps/typescript/openings/) | TypeScript | Standing availability watch for care access: calls the healthcare providers actually listed in directories to verify who is real, who takes your plan, and who has an opening, then keeps watching on a decaying cadence until a slot opens. |
| [`apps/typescript/ringer`](apps/typescript/ringer/) | TypeScript | Consumer web app that turns dreaded phone tasks — bill negotiation, cancellations, bookings, refunds, and multi-business quote comparison — into consent-first, multilingual CALL-E workflows with strict per-call and per-recipient result schemas, human-in-the-loop decision authority, evidence-gated and denominator-honest outcomes, and a no-call demo mode by default. |
| [`apps/web/local-atlas`](apps/web/local-atlas/) | JavaScript / Node | Map-first local guide where one confirmed call becomes a dated, evidence-quoted fact every later visitor reuses: stored answers, opinion refusal, closed-business and calling-window checks all work to avoid placing a call at all, results keep their uncertainty and expire by outcome, and private results are written where the public list cannot read them. A comparison across two or three nearby places is one multi-recipient task, with each business answering for itself and the cross-call verdict marked as derived rather than quoted. |
| [`apps/typescript/dispatch-pulse`](apps/typescript/dispatch-pulse/) | TypeScript | Real-time logistics command center for automated pre-delivery recipient phone verification, estate gate code extraction, and live SSE event streaming. |
| [`apps/typescript/routeready`](apps/typescript/routeready/) | TypeScript | Call-ahead route re-sequencing: phones the next customers while the rider is still riding, gates each answer on the customer's own words, re-orders the remaining stops with an exact search, and shows the rider one instruction; simulated day and no-call tests by default, live calls behind an environment switch, a start token and a consent statement. |
| [`apps/typescript/sundials`](apps/typescript/sundials/) | TypeScript | Agentic toolchain (embeddable SDK, backend, and dashboard) that helps high-ticket businesses **call while the lead is warm**. Sundials use Goal-oriented CALL-E agents with web interaction context to boost lead conversion. |
| [`apps/python/kept`](apps/python/kept/) | Python | Turns a payment promise made on a collections call into a validated financial record: eleven named rejection reasons stand between a spoken sentence and a ledger entry, vague amounts are refused, over-commitments are clamped to the invoice balance with the spoken figure kept beside them, and the promise is reconciled against the bank feed a week later so only the commitments that actually broke are called again. |
| [`apps/python/agrovoice`](apps/python/agrovoice/) | Python | AI voice calls collecting structured cocoa harvest data from smallholder farmers via CALL-E's native result_schema extraction. |
| [`python/warrantyops`](apps/python/warrantyops/) | Python | Post-submission warranty-claim exception resolver whose most dangerous field is guarded by its own state machine: a claim, case or credit reference stays UNCONFIRMED until a read-back is performed, answered affirmatively, and that answer is found in the counterparty's own transcript turns, and extraction confidence is not an accepted input. Transport failure never becomes a claim status, a stale source version never receives a write-back, and the default path replays synthetic fixtures with zero calls. |
| [`apps/typescript/callsweep`](apps/typescript/callsweep/) | TypeScript | Calls many local businesses, haggles each one down toward your budget on the call, ranks their offers by the best overall deal (price, what's included, availability), and books the one you pick. Dry-run no-call path by default with fictional sample shops. |
| [`apps/typescript/arc-platform`](apps/typescript/arc-platform/) | TypeScript | Approval-gated radio and creator rate calls that read the quoted figure back digit by digit and record nothing as confirmed without a spoken yes; simulated by default when no API key is set, with duplicate-call protection and a masked, published call archive. |
| [`apps/python/casechaser`](apps/python/casechaser/) | Python | Chases an open claim, refund, repair, or delivery case to closure: every company promise becomes a dated, quoted commitment, broken ones climb a fixed escalation ladder, offers and denials stop at the customer, and a masked evidence pack is ready for the written complaint. Fixture mode by default. |
| [`apps/typescript/collex-ai`](apps/typescript/collex-ai/) | TypeScript | Lead follow-up call-agent that turns a lead into a RAG-personalized CALL-E task, then classifies CALL-E's structured call result into hot/warm/lost outcomes. Dry-run-by-default with fixture leads no database or real credentials needed to run. |
| [`apps/python/claimcall`](apps/python/claimcall/) | Python | Human-approved airline disruption resolution: identifies missing case facts, turns them into bounded CALL-E objectives, and converts the call into structured commitments, evidence, before/after case state, and the traveller's next action. Synthetic no-call mode by default. |
| [`apps/typescript/supplyline`](apps/typescript/supplyline/) | TypeScript | Multi-round freight-rate sourcing agent: sequential CALL-E quote calls to carriers, then a callback to the highest bidder to negotiate against the best competing quote, with a dry-run no-call mode by default. |
| [`apps/web/supplycall-ai`](apps/web/supplycall-ai/) | TypeScript / Next.js | Catalog pointer to SupplyCall AI. Procurement exception recovery: one CALL-E supplier confirmation call, deterministic resolve/escalate rules, shared-number-pool outbound, and Vitest no-call verification. |
| [`apps/web/voltx-voiceops`](apps/web/voltx-voiceops/) | TypeScript / Next.js | Catalog pointer to VoltX VoiceOps. Battery feedstock qualification desk: labeled SIMULATION by default, fail-closed live `CalleClient.calls.create`, structured facts, heuristic scoring, and a follow-up queue. |
| [`apps/typescript/verity-verification-core`](apps/typescript/verity-verification-core/) | TypeScript | Standalone dry-run gate for a CALL-E task's `task_completed` claim: re-reads the transcript with a deterministic grammar, checks the parsed value against what the action would write, requires an in-transcript confirmation and a fresh resource re-check, and returns ALLOW or BLOCK plus a value to re-confirm on a second channel. No calls placed by default; fail-closed. |
| [`apps/typescript/relaygoal`](apps/typescript/relaygoal/) | TypeScript / Next.js | Asynchronous accessibility phone relay for Deaf, hard-of-hearing and speech-disabled users: type a goal, CALL-E makes the whole call, and every answer on the result card is bound to the verbatim transcript turn that proves it or marked not confirmed; checks the agent's own AI disclosure, compares N places with verified-only recommendations, dry-run by default with an explicit double opt-in live path. |
| [`apps/python/reality-resolver`](apps/python/reality-resolver/) | Python | Decides whether a call is needed at all before placing one: four generic rules score the evidence for a decision-critical contradiction, a compliance gate applies only the rules that actually apply to the case's use case, and CALL-E's structured result is reconciled back against the original evidence so that voicemail, an IVR, or an unclear answer is escalated for human review rather than actioned as a cancellation. Two use cases ship on the same engine; fake-server dry run by default. |
| [`apps/typescript/navigator-outreach-safety-example`](apps/typescript/navigator-outreach-safety-example/) | TypeScript | Consent-first, fail-closed CALL-E companion demonstrating SDK import, permanent no-call safeguards, fictional mock behavior, and judge-facing evidence boundaries. Live outbound validation is not claimed. |
| [`apps/python/afterword`](apps/python/afterword/) | Python | Death notification to the institutions that have to be told: one call per institution captures the department, the documents, whether a certified copy is accepted and what happens to the direct debits, then returns a single printable pack. Contradictions against a prior call or the recorded policy are marked disputed with both sides kept rather than resolved, a refusal to speak to anybody but the executor is reported as a normal outcome, and the agent can close nothing, cancel nothing and accept nothing. Scripted no-call demo by default. |
| [`apps/python/muster`](apps/python/muster/) | Python | Proof-of-life attestation for pension and benefit schemes: a freshness challenge minted per call that a recording cannot answer, knowledge prompts a housemate should not know, and turn-timing analysis that catches somebody in the room feeding the answers. A relative vouching for the subject is never a pass, no grade ever concludes a death, and nothing it returns can stop a payment. Scripted no-call demo by default. |
| [`apps/python/trunkline`](apps/python/trunkline/) | Python | Calls a health plan's provider-services line about unpaid claims and absorbs the hold a biller cannot afford: claims are bundled so one queue wait covers several, hold is derived from transcript offsets rather than estimated, and every answer must be supported by a quote that is actually found in the transcript or its fields reset to `unknown` and it goes to a person. Patient identifiers live in a separate vault, each workflow may disclose only what it needs, transcripts are scrubbed before they are written, and `vault-check` walks every file to prove it. Fixture mode by default; live calls need a written, expiring, budgeted authorization for that exact number. |
| [`apps/typescript/recall-e`](apps/typescript/recall-e/) | TypeScript | Consent-gated, dry-run-by-default validation-therapy calls for memory care residents, grounded in a memory they know, with idempotency-protected dispatch, live transcript-grounded mood tracking, and multi-language call scripts. |
| [`apps/typescript/muster-phone-to-report`](apps/typescript/muster-phone-to-report/) | TypeScript | Turns synthetic greenhouse phone reports into evidence-backed readings with a review dashboard, credential-free scenario replay, and an opt-in CALL-E integration. |
| [`apps/python/sticker`](apps/python/sticker/) | Python | Finds out what a prescription actually costs in cash by calling licensed community pharmacies near a ZIP and asking one question, then prices every answer against the national average acquisition cost CMS publishes weekly, so a quote can be judged and not merely compared. Refusals stay in the denominator, a quote for a different bottle size is reported and never rescaled, and discovery never dials: live calls read an explicit per-destination allowlist. Simulated by default. |
| [`apps/python/otherend`](apps/python/otherend/) | Python | Task pre-flight for a CALL-E task: CALL-E dials a programmable line you own that answers as a receptionist with a chosen adversity profile, or as a scripted person for tasks that call people, then a deterministic grader scores what CALL-E reported (`task_completed`, `structured_result`, confidence, AI disclosure) against what the line actually said. Replays nine synthetic rows (in-process simulation, no calls) with no keys by default, including another entry's task text run verbatim; one real call per row only behind `--yes` and an allow-list. |
| [`apps/typescript/pharmabridge`](apps/typescript/pharmabridge/) | TypeScript / Next.js | Finds shortage medicine or specific blood units by phone: discovers real pharmacies and blood banks on a live map, dispatches parallel CALL-E calls with strict result schemas, ranks answers with verbatim evidence, secures holds and reservations, and records every call to a ledger; simulation by default, live calls gated by an operator code, signed numbers, consent, and a daily cap. |
| [`apps/python/dialtone`](apps/python/dialtone/) | Python | For calls where the other end is also an AI: a spoken handshake compiled into the CALL-E task, a human / IVR / agent detector with a published blind evaluation, and an attestation gate that refuses bookings two agents "confirmed" without any person or record behind them. |
| [`apps/python/pawpassage`](apps/python/pawpassage/) | Python | Approval-bound pet-journey evidence checks with an official SDK loopback demo, one-call intent tracking, and read-only recovery. |
| [`apps/typescript/continuum-call`](apps/typescript/continuum-call/) | TypeScript | Durable multi-call phone missions: a frozen intent plus a one-create reservation mean an unresolved or refused outcome blocks the next call instead of redialling, confirmed facts carry their source run into the next party's call, and a hash-chained Evidence Pack replays the mission and fails closed on tampering. Interactive mock is the default; live CALL-E is opt-in behind named operator gates. |
| [`apps/python/ringdown`](apps/python/ringdown/) | Python | On-call escalation that phones the pager holder one rung at a time and only counts a page as acknowledged when an owner and an ETA are each quoted by a span the recipient actually spoke. The call is placed over REST and re-read over MCP, because verifying through the channel that wrote proves nothing, and every verdict is sealed in a hash-chained ledger that re-derives it offline months later. Alert payloads arrive through a mapping file, so PagerDuty and Opsgenie cost no vendor code; a model can draft that file, and the deterministic loader decides whether the draft is admissible. Preview is the default and nothing dials without an explicit confirmation phrase. |
| [`apps/python/firstbell`](apps/python/firstbell/) | Python | Calls the families whose absence notification went unanswered, each in the language that family speaks ([evidence page](https://firstbell-evidence.vercel.app): every real call, every rule broken on purpose). Keeps a call that connected without producing a usable answer separate from one that did, so a null structured result reaches a person instead of a coverage percentage. Runs offline against a bundled CALL-E double by default, and a receipt says `live` only when the host it dialled was the real API. |
| [`apps/web/conversation-clarify`](apps/web/conversation-clarify/) | Chrome extension + Python | Reads the open Gmail thread, detects the reply that looks like an answer but is not, places one bounded CALL-E call to settle it, and drafts the outcome back into the thread behind an eight-check evidence gate; fixture mode by default, a four-command DEMO.md with real output, and a standalone demo page that needs no extension. |
| [`apps/python/bytelytic-clinic-os`](apps/python/bytelytic-clinic-os/) | Python | Autonomous healthcare clinic operating system for patient appointment confirmations, 2-hour no-show recovery, 30/60/90-day recalls, and insurance prior authorization payor IVR calls via CALL-E. |
- [VERIFY](https://github.com/DivineDomokuma10/verifyam) - Disclosed listing-verification app that calls the agent or landlord behind a rental ad and returns a schema-validated transcript-backed claim (Verified/Warning/Inconclusive) with transcript evidence and an optional mock mode. Verdicts represent transcript-supported assessments, not independent authority verification.
| [`apps/python/positive-contact`](apps/python/positive-contact/) | Python | PSPS Medical Baseline live-contact confirmation with a safe support loop: disclosed CALL-E calls, transcript-evidenced acknowledgement, retry and alternate-contact ladder, operator-approved identity-free supplier availability calls, field-visit work orders and denominator-honest reporting. Fixture mode by default. |

The default e2e tests use a local fake broker/OAuth/MCP server or dry-run paths, so they do not require real CALL-E credentials or browser login. Live verification is opt-in in each app README.
- [callhook](apps/go/callhook/) - Event-driven CALL-E calling platform: webhook in, structured outcome back, with goal-driven campaigns that early-stop, 19 doc-verified platform integrations, an MCP server, and a war-room UI in one zero-dependency Go binary. Dry-run by default. [Demo](https://callhook.onrender.com) · [Video](https://youtu.be/66siB3kIYMk)


### Community apps


- [DwellGuard](https://github.com/Syedsaadhhh/DwellGuard-AI) - Late-arrival dispatch coordination with CALL-E: a driver-verified arrival window feeds a bounded dock call, and only an in-policy commitment becomes a driver handoff. Includes a credential-free deterministic replay and fail-closed fee handling. See the [integration notes](docs/community-apps/dwellguard.md).
- [ContractorPilot](https://github.com/chaibi-mustapha/ContractorPilot) - Autonomous voice procurement copilot that calls suppliers and trade subs to negotiate pricing, verify stock, and turn jobsite walkthroughs into signed proposals.
- [Exception Broker](https://exception-broker-production.up.railway.app) - Execution-control app for CALL-E-acquired operational decisions, with exact review, controlled ALLOW/BLOCK/WAIT dispositions, and a deterministic no-call demo. See the [integration notes](docs/community-apps/exception-broker.md) and [demo video](https://youtu.be/Smw7aXyI0fI).

- [Openline](https://openlinecall.vercel.app/) - Human-approved service-availability verification app that turns a request into an inspectable CALL-E phone plan and returns evidence-backed next steps, with a no-call simulation path. ([repository](https://github.com/Datwebguy/openline))
- [Ashtrac Dispatch](https://github.com/Alikhan207/ashtrac-dispatch) - Autonomous emergency service dispatch agent that uses CALL-E to call service providers sequentially, adapts to declinations, and locks in the first confirmed ETA and price quote.
  
Externally hosted user-facing apps built on CALL-E. They live in their own repositories, so review their setup, credential handling, and call side effects before running them.


- [odo-sync](https://github.com/clinton-lynx/odo-sync) - Schedules vehicle service reminders via CALL-E phone calls 15, 10, and 5 days before service is due, recording structured booking and callback outcomes.
- [CallBridge Connect](https://github.com/Senseiglobal/callbridge-connect) - Consent-first creative-project check-ins using the CALL-E Python SDK, with no-call sample previews, explicit live dispatch, and a structured next-action brief for human review. See the [integration notes](docs/community-apps/callbridge-connect.md).
- [FrontDesk Phone Follow-Through](https://github.com/TayseerLaz/frontdesk-core) - Cash-on-delivery order confirmation calls inside a multi-tenant WhatsApp AI front desk: chat orders are confirmed by a CALL-E call briefed from the real order rows, results written back to the order and the inbox thread; dry-run default, verified-number override, per-tenant daily cap. See the [integration notes](docs/community-apps/frontdesk-phone-follow-through.md).
- [Care Call AI](https://github.com/NeoSPU/care-call-ai) - Practical-support outreach app for charities with approved CALL-E rounds, no-call preflight, operator gates, and reviewed request/order handoff. [Demo video](https://youtu.be/Hc2bWjTnKFQ) · [Integration notes](docs/community-apps/care-call-ai.md).
- [ProofMesh](https://github.com/fokrulanthro16-eng/proofmesh) - A consent-first CALL-E phone verification platform that turns supervised conversations into auditable, machine-readable facts with human approval, regional controls, and honest uncertainty handling. See the [integration notes](docs/community-apps/proofmesh.md).

- [PagerZero](https://pagerzero.pro) - Experimental SRE voice-approval demo using in-memory simulated infrastructure and a demo PIN, not production remediation or zero-trust authentication; use credential-free simulator mode, since configured CALL-E keys can enable real calls. See the [integration notes](docs/community-apps/pagerzero.md) and [GitHub](https://github.com/adamm285-dev/pagerzeropro).
- [Auto Property Manager](https://autopropertymanager.com) - Author-described hosted rental-management app using CALL-E for owner-alert and contractor-dispatch calls; its optional consent-gated rehearsal makes real calls to an operator-controlled destination, while read-only inspection requires no send. See the [integration notes](docs/community-apps/auto-property-manager.md).
- [RxScout](https://github.com/prkshverma09/RxScout) - Experimental pharmacy-availability simulation with optional CALL-E and SMS integrations; evaluate only in credential-free sandbox, and do not treat its live queue as unattended-safe or its extracted stock information as verified medical guidance. See the [integration notes](docs/community-apps/rxscout.md).
- [LastCall Materials](https://lastcall-materials.fly.dev/) - A deadline-first construction-material reuse workflow that uses one authorized CALL-E capacity call, converts partial quantities into evidence-backed candidates, and keeps approval and verified pickup human-controlled. The public demo is fixture-only. See the [integration notes](docs/community-apps/lastcall-materials.md).
- [DischargePulse](https://github.com/Temake/DischargePulse) - Hospital discharge placement agent that calls skilled nursing facility admissions lines through CALL-E, verifies each care requirement from a runtime result schema, re-plans when a facility contradicts its directory record, and stops at a human approval gate, with replay and scripted no-call modes. See the [integration notes](docs/community-apps/dischargepulse.md).

- [Off the Hook: The Memory Line](https://github.com/tivastreasures-ops/off-the-hook) - Operator-character message-taking line: CALL-E conducts an in-character disclosed-automation call (free tier) that can terminate on a physical rotary phone via SIP/ATA, with structured results rendered as a keepsake Message Slip; paid tier adds a custom ElevenLabs voice, Stripe billing, and email-keyed call balances. Live:[The Memory Line](https://off-the-hook.replit.app)


- [Khoj](https://github.com/manyamharshitha/KHOJ) - Consent-first CALL-E verification calls to Indian rental brokers that check rent, deposit and availability against the advert and keep the full transcript. See the [CALL-E integration notes](https://github.com/manyamharshitha/KHOJ#call-e-integration-notes).
- [Novyra](https://novyra-rgaa.onrender.com/) - External AI-powered lifestyle app with a CALL-E phone workflow for personalized user interactions.
- [Vera](https://github.com/shalynmonet/vera) - Strands-orchestrated wellness companion that places recurring CALL-E calls to seniors, evaluates outcomes with Amazon Bedrock against each resident's own escalation criteria, and alerts caregivers automatically when something needs attention.

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
| [`plugins/slack-calle-bridge`](plugins/slack-calle-bridge/) | Slack | Signed slash-command bridge for previewing and explicitly confirming one CALL-E phone task, with masked structured results and deterministic retry protection. |
| [`plugins/airtable-calle-certa`](plugins/airtable-calle-certa/) | Airtable | Consent-bound Verification of Employment from a table: the recipient result schema is derived from the base's own column definitions, consent is a per-row hash that a filled-down cell cannot forge, and the number supplied on the application is never dialed. |
| [`plugins/firstbell-absence-calls`](plugins/firstbell-absence-calls/) | n8n | Importable school-absence call wave that dials each family in that family's own language, keeps a call that connected without producing a usable answer separate from one that did, and ships with a dry run that places no calls and needs no API key. |
| [`plugins/google-sheets-callguardian`](plugins/google-sheets-callguardian/) | Google Sheets | Apps Script menu that gates CALL-E behind consent, call-window, do-not-call, and attempt-cap checks plus live in-call opt-out detection, with every decision written to a tamper-evident, hash-chained audit log — run directly from a spreadsheet. |

### Safety patterns

- [`CallSentinel design reference`](docs/call-sentinel/) - Documentation-only concept for advisory phone-call transcript anomaly scoring and a proposed MCP interface; no local application is included.
- [`Production workflow guide`](docs/production-workflows.md) - Application-owned state, stable idempotency, durable webhook processing, result verification, retry ownership, and privacy-minimized audit patterns for consequential phone workflows.
- [`Safety reference`](skills/call-reminder/references/safety.md) - Consent, E.164 phone-number handling, credential boundaries, cancellation, duplicate-job prevention, and medical reminder boundaries.
- [`Dispatch safety reference`](skills/service-dispatch-call/references/safety.md) - Purpose-bound authorization, third-party privacy on outbound calls, the commitment boundary between gathering an answer and accepting it, and retention limits on transcripts and spoken values.
- [`Ambiguous outcome handling`](skills/service-dispatch-call/references/ambiguous-outcomes.md) - Why an unknown call outcome is a state to reconcile rather than an error to retry, and how client timeouts cause duplicate calls.
- [`Idempotency reference`](skills/service-dispatch-call/references/idempotency.md) - Deriving call idempotency keys from the authorization rather than the attempt, reserving before dialling, and replay-safe webhook handling.
- [`Approval threat model`](apps/typescript/phone-approval-gate/docs/threat-model.md) - What a phone approval proves and does not prove, out-of-band secret handling, and why the phone network is a restricted verification channel.
- [`Accept live, verify after`](docs/adr/0007-the-agent-accepts-the-board-checks-the-acceptance.md) - Why an agent may accept an offer while a receptionist waits, and why what it accepted is then read again deterministically against the authorisation that allowed the call, so "only inside the envelope" is a property of the code rather than a request made of a model.
- [`Disclosure budget`](apps/typescript/call-on-behalf/docs/privacy-budget.md) - Authorizing what a caller may say about a person, checking the script before the call and checking what was actually said after it.
- [`Contact-claim limits`](apps/typescript/verify-contact-claim/docs/limits.md) - Why an institution refusing to confirm a contact is the expected outcome, what a confirmed contact still does not prove and what has never been tested live.
- [`Line-ownership verification`](apps/typescript/linecanary/docs/compliance.md) - Why a monitoring tool must prove control of a line before calling it, greeting-token verification, attestation for client lines, and proportionate check frequency.
- [`Provider descriptors`](apps/typescript/voice-preflight/docs/providers.md) - How one HTTP client drives any text-to-speech API from a JSON file, where the audio sits in a response, plus the order in which a run refuses so a failure says what has already happened.
- [`Onboarding call safety`](skills/customer-onboarding-call/references/safety.md) - Consent and recording disclosure, refusal suppression, content boundaries for price and policy claims, working-hours limits, and honest not-reached reporting.
- [`International routing`](skills/customer-onboarding-call/references/international-routing.md) - Forwarding pattern for unsupported regions, distinguishing congestion from no-answer from unsupported destination, and handling providers that report failure then dial anyway.
- [`Calls not placed`](apps/web/local-atlas/docs/calls-not-placed.md) - Refusing before dialling: reusing a stored answer, rejecting questions a phone cannot answer, closed-business and calling-window checks, and defaulting to simulated when no access code is configured.
- [`Fact freshness`](apps/web/local-atlas/docs/fact-freshness.md) - Expiring a call result by outcome so failures are not cached as conclusions, keeping hedges and refusals distinct from answers, and defeating idempotent replay when a reader rechecks.
- [`What a call can establish`](apps/python/muster/docs/what-a-call-can-establish.md) - Separating reachability from identity from the fact you wanted, why a third party vouching is never a pass, scoring challenges in code rather than asking the model to mark its own work, and the asymmetry rule for which error may be automatic.
- [`Design principles`](docs/design-principles.md) - Repository-wide architecture principles for safe phone-call workflows.
- [`Fail-closed dispositions`](plugins/zapier-calle/docs/fail-closed-dispositions.md) - Classifying phone-call outcomes so ambiguity, low confidence, and unrecognized statuses route to a human instead of a success branch.
- [`High-consequence identifier confirmation`](skills/warranty-recovery/references/identifier-confirmation.md) - Why extraction confidence cannot establish a claim, case or credit reference, and the read-back state machine that can: an affirmative answer grounded in the counterparty's own transcript turns, or no reference at all.
- [`CALL-E platform notes`](skills/warranty-recovery/references/calle-platform-notes.md) - What the Calls API guarantees and what it explicitly does not, including why `failure_code` must not drive retry or reporting, why there is no cancel operation, and what Goal Runs offer in exchange for moving the prompt and schema out of version control.
- [`Rehearse before you act`](docs/rehearse-before-you-act.md) - Why a structured result is a report to verify rather than a fact to act on: rehearsing a task against a scripted counterparty, putting world facts in the task, treating confidence as consistency rather than truth, and checking far-side values against the transcript turn they came from.
- [`Two agents agreeing is not a commitment`](apps/python/dialtone/docs/PROTOCOL.md) - DIALTONE v1: spoken agent-to-agent handshake, mode switch, and attestation labels that never upgrade `task_completed`.
- [`Proving a gate fires`](apps/python/firstbell/docs/proving-a-gate-fires.md) - Breaking each rule that decides who gets dialled, how many at once, and what counts as an answer, then recording which tests notice, because a test never observed to fail has not been shown to test anything.
- [`Receipt provenance`](apps/python/firstbell/docs/receipt-provenance.md) - Four rules that stop a run's own evidence overstating what happened: reserving "live" for the production hostname rather than a substring, printing the address beside the claim, marking per item whether this run placed the call or replayed it, and answering unknown when a clock disagrees.
- [`Locale is not only a hint`](apps/python/firstbell/docs/locale-is-not-only-a-hint.md) - Measured behaviour of the BCP 47 locale field across two languages on one code path, what it removes from a multilingual build, and the limits of a two-call sample.

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
