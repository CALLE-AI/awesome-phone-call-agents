# Hackathon Implementation Route

This document is the implementation reference for turning Awesome Phone Call Agents into a functional CALL-E hackathon application.

## Challenge Context

CALL-E is a developer-first platform for building AI agents that make real phone calls and complete real-world tasks. Agents can plan a call, dial out, hold an adaptive conversation, and return structured results through the CALL-E SDK, API, or MCP.

The hackathon requires a deployed, functional application that uses CALL-E to solve a real business or project problem. A curated repository or awesome list is valuable, but is not sufficient by itself. The project therefore needs an executable application that demonstrates a complete phone-call workflow.

## Recommended Product Concept

Build **Appointment Recovery Agent**, delivered as the first executable workflow in the Awesome Phone Call Agents gallery.

Core promise:

> Recover missed or unconfirmed appointments through one safe, policy-constrained CALL-E conversation and return an actionable structured result.

The executable gallery remains the reusable architecture, not the primary product pitch. The hackathon application must lead with a specific real-world phone-work problem. This distinction is required because the official judging criteria explicitly favor a real, specific problem over a generic "AI that makes phone calls" concept.

The gallery-level promise is:

> Browse reusable phone-call workflows, inspect their safety contracts, configure one, preview it without a call, explicitly authorize one live run, and receive a structured result.

This preserves the repository's community-hub concept while producing a focused hackathon application.

The developer and business problems it addresses are:

- Missed or unconfirmed appointments cost service businesses time and revenue.
- Staff spend time repeatedly calling customers to recover or close appointments.
- A safe recovery call must stay inside business-approved scheduling boundaries.
- Silence, refusal, and no-answer must never be interpreted as agreement.
- The result must drive a clear operational next step rather than return only a transcript.
- Reusable phone-agent examples remain difficult to compare and safely test.

## Product Flow

The core experience is:

1. Choose a workflow.
2. Enter its business context.
3. Validate consent, authority, and the E.164 phone number.
4. Preview a masked call plan.
5. Explicitly authorize one outbound call.
6. Let CALL-E place and conduct the call.
7. Display live status while the call is running.
8. Return a structured outcome.
9. Recommend the next operational action.

## Initial Workflow Gallery

The MVP implements exactly one workflow. The gallery concept survives as framing, not as built UI.

### Appointment Recovery: The Only Built Workflow

Call a customer after a missed or unconfirmed appointment, confirm or reschedule it, and return the agreed time.

This is the product submitted to the hackathon. It is immediately understandable, measurable, and safer than medical, financial, emergency, or irreversible-action scenarios.

### The Gallery Story Without Dead UI

Do not build preview-only cards for unimplemented workflows. Non-operational cards cost build time and read as vaporware in a three-minute demo. Instead, the landing page states in copy that Appointment Recovery is the first of a family of reusable, safety-contracted phone workflows (lead qualification and service coordination are natural successors). Judges get the vision; the demo shows only working software.

## MVP Scope

### Required

- Appointment Recovery as the single MVP workflow, framed on the landing page as the first entry in a reusable workflow family.
- E.164 phone-number validation.
- Explicit consent or authority confirmation.
- Masked phone numbers in previews and summaries.
- Dry-run mode as the default.
- Explicit confirmation immediately before a real call.
- One-call execution through CALL-E.
- Live status or progress display.
- Structured output.
- A result screen that converts the call outcome into a concrete next action.
- Policy-constrained replacement windows that the agent may offer but not exceed.
- Distinct confirmed, reschedule-requested, declined, unreachable, failed, timed-out, and uncertain outcomes.
- Stable idempotency so retries and double-clicks do not create duplicate calls.
- Tests using a fake server or dry-run path.
- Strictly opt-in live verification.
- A deployed application URL.
- A rehearsed real-call demonstration.

Example structured result:

```json
{
  "outcome": "rescheduled",
  "confirmed_time": "2026-08-07T15:00:00+08:00",
  "customer_intent": "confirmed",
  "follow_up_required": false,
  "notes": "Customer requested SMS confirmation"
}
```

### Nice-to-Have, Not Required

- Safe reconciliation when call creation has an unknown outcome. Build this only if Day 1 integration testing shows the CALL-E API actually has ambiguous creation semantics; otherwise stable idempotency plus a clear failed state is enough, and judges will not see the difference.

### Explicitly Deferred

- Preview-only cards for lead qualification and service coordination.
- A general-purpose agent builder.
- Marketplace accounts, ratings, or payments.
- Recurring scheduling.
- Bulk calling.
- CRM integrations.
- Multiple telephony providers.
- Transcript analytics.
- Complex user authentication.

These features should be considered only after the one-call workflow is reliable and deployed.

## Suggested Repository Location

This concept is a runnable app rather than only an installable skill.

```text
apps/
└── typescript/
    └── agent-gallery/
        ├── README.md
        ├── package.json
        ├── src/
        ├── test/
        └── examples/
```

Workflow definitions should remain data-driven so future workflows drop in as data, but the MVP ships only one:

```text
src/workflows/
└── appointment-recovery.ts
```

React and Vite are reasonable choices because the repository already contains a working example using that stack: `apps/typescript/call-neuron` uses React 19 and Vite. Copy its setup rather than scaffolding from scratch, but treat its host as one option rather than the answer. CALL-E credentials must remain in a server-side integration layer and must never be shipped to browser code.

## Key Technical Decisions

These two decisions must be made in the product specification, before any Phase 2 code. Leaving them open was the largest gap in the original version of this route.

### Integration Surface

CALL-E can be reached through its SDK, REST API, MCP, CLI, or SKILL. The app commits to one primary surface:

- **Primary: the CALL-E REST API or SDK, called from the server-side integration layer.** A deployed web app with server-held credentials matches this surface directly; the server creates the call, polls status, and relays results to the browser.
- **Day-1 experimentation: the `calle` CLI.** Use it to place the first throwaway call and inspect real status transitions and result payloads before writing app code.
- The repository's `apps/shared/fake-mcp-broker-server.mjs` is an MCP broker. Use it for offline tests only if the real integration also goes through MCP; if the app uses the REST API or SDK, build the fake against that same surface instead, so offline tests exercise the shape the app actually calls. Do not build the offline loop against a fake whose protocol differs from the live path.

Record the final choice and its rationale in one paragraph in the product specification.

### Deployment and Call State

- **Hosting:** Vercel Edge Functions as the server layer. Neither the hackathon rules nor this repository requires any particular host: the real constraints are a server-side runtime to hold the credential, since browser code must never see it, and free judge access to a working demo. Pick whichever host the team already has an account for, and keep the handlers on web-standard `Request` and `Response` so the choice stays reversible.
- **No database.** CALL-E is the system of record for call state. The server creates the call, returns the call ID to the browser, and exposes a status endpoint that relays CALL-E's own status. The browser polls that endpoint; no server process needs to outlive a request, which keeps serverless timeouts irrelevant even for multi-minute calls.
- **Idempotency without persistence:** the client generates a request key when the user confirms, the submit control disables immediately, and the server rejects a repeated key within the session and checks CALL-E's call list before creating. This satisfies the duplicate-call gate for a one-call MVP without introducing storage.
- Document in the README that no call data is stored server-side and that results live only in CALL-E and the user's browser session.

## Official Hackathon Alignment

The official challenge deadline is **September 14, 2026, at 11:45 PM Singapore time**.

The project must be a functional application that uses CALL-E's SDK, API, MCP, CLI, or SKILL to create an impactful business or project use case. CALL-E must be imported and called at runtime; a reference, mock-only implementation, or text-only demonstration is insufficient.

### Judging Criteria

The four criteria are equally weighted.

| Criterion | Implementation response |
| --- | --- |
| Real World Impact | Lead with missed and unconfirmed appointment recovery for a defined service-business operator, not the generic gallery. |
| Quality of the Idea | Combine constrained recovery negotiation, explicit uncertainty handling, safety contracts, and reusable workflow packaging. |
| Technical Implementation | Execute CALL-E at runtime, poll terminal status, prevent duplicates, and parse structured results. |
| Product Experience and Demo | Deliver one coherent preview-to-result journey and demonstrate it clearly in less than three minutes. |

Stage One is pass/fail based on whether the project fits the theme and reasonably applies CALL-E. Stage Two applies the four criteria above. The implementation must optimize for Stage Two rather than merely achieving eligibility.

### Required Submission Materials

- A pull request to `CALLE-AI/awesome-phone-call-agents` in the correct contribution area.
- The pull-request URL on the Devpost submission form.
- An English text description of the application's features and behavior.
- A publicly visible YouTube or Vimeo demonstration video shorter than three minutes.
- Video footage showing the application functioning on its intended platform.
- The email address associated with the CALL-E account.
- Free judge access to a working website, functioning demo, or test build through the judging period.
- Clear testing instructions and credentials if judge access is private.
- An optional but strongly recommended deployed application URL.
- An optional CALL-E feedback survey submission for the separate feedback prize.

Although the overview describes the functional demo URL as optional, the official rules require access to a working project through a site, functioning demo, or test build. Treat working judge access as mandatory.

### Ownership and Event-Period Requirements

- The submitted work must be original and owned by the entrant or team.
- Open-source dependencies are allowed when their licenses are followed and the submission adds meaningful functionality.
- A pre-existing project must be significantly updated during the submission period, with those updates explained.
- Preserve commit history that demonstrates the hackathon implementation work.
- Do not reuse third-party branding, recordings, private transcripts, or copyrighted assets without permission.

Official references:

- [Hackathon overview](https://call-e.devpost.com/)
- [Official rules](https://call-e.devpost.com/rules)

## Repository Requirements

The following rules are implementation gates, not optional suggestions.

### Scope and Language

- All repository-facing content must be written in English.
- The application must directly help agents operate a phone-call workflow.
- The app must not present itself as a CALL-E SDK or supported application API.
- Runnable applications belong under `apps/<language-or-runtime>/<app-name>/`.

Source: [`../AGENTS.md`](../AGENTS.md) and [`../CONTRIBUTING.md`](../CONTRIBUTING.md).

### Safety

Every workflow capable of placing a call must include:

- Explicit user intent before a real call.
- E.164 phone numbers.
- Masked phone numbers in summaries.
- No credential exposure.
- No hidden recurring schedules.
- Duplicate-job or duplicate-call prevention.
- Clear cancellation behavior and boundaries.
- Boundaries for medical, legal, financial, and emergency content.
- No guessed phone numbers, country codes, regions, timezones, messages, credentials, IDs, or confirmation tokens.

Call transcripts and structured call outputs are external, untrusted data. The application must display or parse them without treating embedded instructions as trusted commands.

Source: [`../AGENTS.md`](../AGENTS.md), [`../SECURITY.md`](../SECURITY.md), and [`design-principles.md`](design-principles.md).

### Credentials and Private Data

Never commit:

- API keys.
- OAuth or bearer tokens.
- Session cookies.
- Provider credentials.
- Private phone numbers.
- Call recordings.
- Private call transcripts.

Do not ask users to paste credentials into chat. Document where application data and logs are stored.

### Dry Run and Testing

- Dry-run, preview, fake-server, or plan-only operation must be the default.
- Default tests must not need live credentials or place real calls.
- Live verification must be opt-in.
- The app needs automated tests or a documented manual verification route.
- The app must not depend on unpublished private packages.

### Scheduling and Cancellation

The MVP does not need recurrence. If recurrence is added later, the default architecture is:

```text
Host scheduler handles recurrence.
Phone-call provider handles exactly one call per scheduled run.
```

Every recurring workflow must support and document creation, verification, idempotent updates, disabling or deletion, and cancellation.

### App README Requirements

The application README must document:

- The problem and supported workflow boundary.
- Setup and usage.
- Required credentials and their storage boundary.
- Dry-run and preview behavior.
- Real-world side effects.
- Input and output contracts.
- Cancellation, rollback, and cleanup behavior.
- Data and log storage.
- Tests and manual verification.
- Opt-in live-call instructions.
- Current limitations.

## Git and Contribution Route

Recommended branch:

```text
feat/agent-gallery
```

Validate it before creation:

```bash
python3 scripts/check_branch_name.py --branch feat/agent-gallery
```

Or create it with:

```bash
python3 scripts/create_branch.py feat/agent-gallery
```

Use Conventional Commits, for example:

```text
feat(apps): add executable agent gallery
test(agent-gallery): cover dry-run outcomes
docs(agent-gallery): document live-call boundaries
```

The pull-request title should use the same convention. Complete [the pull-request checklist](../.github/pull_request_template.md) before submission.

Always run the repository validation after changes:

```bash
python3 scripts/validate_repository.py
```

## Delivery Phases

### Phase 1: Freeze the Story

Working pitch:

> Appointment Recovery Agent uses CALL-E to recover missed or unconfirmed appointments through one safe, adaptive phone conversation, then returns a structured disposition and next action. It is packaged as the first executable workflow in Awesome Phone Call Agents.

Definition of success:

- CALL-E completes one authorized call.
- The app classifies the outcome correctly.
- The app returns a useful next action.
- The entire experience can be understood and demonstrated in under three minutes.

Before implementation, define:

- Hero user's role.
- Specific service-business vertical and business trigger.
- Required inputs.
- Business-approved appointment windows and commitments the agent may make.
- Call goal and conversational boundaries.
- Structured result schema.
- Terminal outcomes.
- Follow-up actions.
- A measurable before-and-after claim that can be defended without invented data.

### Phase 2: De-Risk the Live Integration First — Done

Completed 2026-08-04. The findings are recorded in
[`agent-gallery/calle-api-observations.md`](agent-gallery/calle-api-observations.md), and
they corrected the integration surface from REST to MCP, exposed that
`task_completed` does not mean the business goal succeeded, and added the
`no_agreement` outcome. Doing this before the UI was the right call: the
`task_completed` trap would otherwise have shipped as a demo-day bug.

Telephony integration is the highest-risk component and must not wait until late in the schedule. Before building any app UI:

- Obtain working CALL-E credentials.
- Place one throwaway real call to your own phone using the `calle` CLI or a ~20-line script.
- Record the actual call-creation request shape, status transitions, polling behavior, latency, and structured-result payload.
- Assess call quality and how well the agent respects conversational constraints; adjust the workflow design now if the platform's strengths differ from assumptions.
- Freeze the integration surface decision (see Key Technical Decisions) based on what was observed.

Everything downstream is then built against observed reality rather than guesses, while there is still time to react.

### Phase 3: Build the Safe Offline Loop

With the real API shape known:

- Define the workflow schema.
- Build the landing page and configuration UI.
- Add E.164 validation and phone-number masking.
- Add authority and consent confirmation.
- Implement dry-run preview.
- Build or adapt a fake CALL-E server that matches the real integration surface observed in Phase 2.
- Test success, decline, no-answer, timeout, and malformed-result outcomes.

### Phase 4: Complete the CALL-E Integration

Implement in the app what Phase 2 proved in isolation:

- Authentication and credential boundaries.
- Call planning or creation.
- An explicit final confirmation gate.
- One-call execution.
- Polling until a terminal status.
- Structured-result parsing.
- Safe rendering of untrusted results and transcripts.
- Stable idempotency to prevent duplicate calls.

### Phase 5: Polish the Demonstration

The three-minute demonstration should:

1. State the missed-appointment problem and the operator who experiences it.
2. Open Appointment Recovery and note it is the first of a family of reusable, safety-contracted phone workflows.
3. Show the business-approved replacement windows.
4. Show a masked dry-run preview.
5. Explicitly approve one live call.
6. Show CALL-E conducting the conversation.
7. Show live progress without exposing sensitive data.
8. Display the structured outcome and recommended operational action.
9. Briefly show the reusable workflow definition and offline tests.

Demo-risk mitigations:

- The call recipient in every recording must be a consenting team member using their own number; the repository prohibits private recordings, and a stranger's voice cannot appear in the video.
- Record a successful live call as soon as the integration works (Day 5 at the latest) so a proven recording exists as fallback footage if the final live take fails.

### Phase 6: Prepare the Submission

Produce:

- A deployed application URL.
- The public GitHub repository.
- A two-to-three-minute demo video.
- An architecture diagram.
- A complete application README.
- Screenshots of preview, active-call, and result states.
- A precise explanation of which components use CALL-E.
- A feedback section describing integration friction and proposed CALL-E improvements.

## Suggested Seven-Day Schedule

| Day | Deliverable |
| --- | --- |
| 1 | Select target vertical; finalize pitch and input/output contract; obtain credentials and place one throwaway real CALL-E call; record observed API behavior and freeze the integration surface |
| 2 | Configuration form, preview, and safety gates, built against the observed API shape |
| 3 | Fake-server integration matching the real surface; structured result UI |
| 4 | Full CALL-E live integration in the app and terminal-state handling |
| 5 | Tests, edge cases, number masking, idempotency; record a successful live call as fallback demo footage |
| 6 | Deployment, README, screenshots, and demo rehearsal |
| 7 | Final live-call validation, video, and submission |

## Demo and Evaluation Checklist

Before recording or presenting:

- The deployed app loads without local setup.
- Dry run is visibly the default.
- No credential appears in browser code, logs, screenshots, or recordings.
- The preview masks the recipient number.
- The real call requires explicit final authorization.
- Double-clicking or retrying does not create duplicate calls.
- Progress handles long-running calls without appearing frozen.
- Success, refusal, no-answer, failure, timeout, and unknown outcomes are distinct.
- The result contains useful structured data rather than only a transcript.
- The next operational action is obvious.
- The opening thirty seconds identify a specific operator, loss, and recovery workflow.
- The demonstration shows CALL-E being called at runtime rather than only a mock.
- The complete video remains below three minutes.
- Tests pass without credentials or phone calls.
- Repository validation passes.

## Market Landscape and Differentiation

Appointment-setting voice agents already exist. The project must not claim that AI appointment calling is new.

### Direct and Adjacent Implementations

- [`askjohngeorge/ai-dialer`](https://github.com/askjohngeorge/ai-dialer) is a Vapi-based outbound appointment system with lead management, Cal.com scheduling, email follow-up, CSV import, real-time status, Supabase, and authentication. Its README describes it as a proof of concept.
- [`mjunaidca/appointment-agent`](https://github.com/mjunaidca/appointment-agent) combines LangGraph, Bland AI, Google Calendar, Gmail, proposed time slots, and confirmation calls.
- [`agent-next/call-use`](https://github.com/agent-next/call-use) is an open-source outbound call-control runtime with SDK, CLI, MCP, REST, IVR navigation, approvals, human takeover, E.164 validation, and structured outcomes. It competes at the infrastructure layer rather than as an appointment product.
- [Bland AI's appointment-booking guidance](https://docs.bland.ai/tutorials/appointment-booking) demonstrates that appointment workflows are an established commercial voice-agent use case.
- Vapi, Retell AI, Synthflow, and related platforms offer or market voice-agent use cases such as appointment setting, lead qualification, support, and outbound campaigns.

Also check inward, not only outward: this repository already contains many merged apps from other hackathon entrants. As of this writing none implements appointment recovery, but re-check `apps/` and open pull requests before finalizing the pitch, because a sibling submission with the same concept would undercut the differentiation more than any external competitor.

Searches also found small voice-agent marketplace prototypes. No established open-source implementation was identified that clearly combines the entire proposed sequence of workflow discovery, inspectable safety contract, masked dry run, explicit one-call approval, CALL-E execution, and structured operational result. This is a directional finding, not proof that no exact implementation exists.

### Required Differentiation

Do not compete on the broad claim of AI appointment scheduling. Differentiate through:

- **Recovery rather than ordinary booking:** begin from a missed, abandoned, or unconfirmed appointment.
- **Policy-constrained negotiation:** offer only business-approved replacement windows and commitments.
- **Truthful uncertainty:** keep refusal, silence, no-answer, timeout, and unknown creation outcomes separate.
- **Operational output:** return a disposition and next action, not merely a transcript.
- **Consent-first execution:** default to preview and require explicit authorization for one call.
- **Duplicate protection:** make retries safe through stable idempotency.
- **Reusable safety contract:** package the workflow so another developer can inspect and adapt it.

The best target is the **Most Practical Use Case** prize. Innovation should support practical value rather than broadening the MVP.

## Governance Gap

The repository currently has no `CODE_OF_CONDUCT.md`.

`AGENTS.md`, `CONTRIBUTING.md`, and `SECURITY.md` cover technical conduct, contribution safety, and vulnerability reporting, but there is no standalone policy for community behavior, reporting channels, or enforcement. Adding a recognized code of conduct would strengthen the community-hub position. It should be handled as a separate governance contribution rather than mixed into the hackathon application's implementation pull request.

## Current Baseline

At the time this route was written:

- The repository was on `main`, tracking `origin/main`.
- The working tree was clean.
- `python3 scripts/validate_repository.py` passed.

Re-run validation before relying on this baseline because the repository may have changed.

## Immediate Next Step

Write the one-page product specification for `apps/typescript/agent-gallery`, including the target service-business vertical, hero operator, Appointment Recovery trigger, permitted appointment windows, input schema, structured result schema, terminal outcomes, next actions, and screen flow. The specification must also record the two Key Technical Decisions: the chosen integration surface with rationale, and the deployment and call-state approach.

After the specification is accepted, the first code written is the Phase 2 throwaway call — one real CALL-E call to your own phone to observe actual API behavior — and only then is the application scaffolded and its dry-run path built against the observed shape.
