# DockBrief

**A receiving-dock phone call, turned into a source-linked unloading checklist.**

Before sending a heavy pallet, a dispatcher needs more than “we accept deliveries.” DockBrief collects reported unloading equipment, staffing and doorway dimensions through one authorized CALL-E conversation, then compares those answers with the load specification. It highlights mismatches and keeps unanswered questions visible for a human reviewer.

> Experimental information-gathering tool. It does not approve dispatch or certify safe unloading. Reported equipment capacity and clearances require independent verification by qualified site personnel; the prototype cannot evaluate actual site conditions, load center, stability or the handling plan.

## A small, complete workflow

1. Specify the receiving contact, pallet gross weight in kilograms, external width and height in millimeters, and dock/ground unloading mode.
2. Preview the exact task without a key or network request.
3. Confirm one call to a recipient who has agreed to the test or inquiry.
4. Retrieve the same call after an interruption; do not automatically redial.
5. Read a checklist showing the load requirement, the reported fact, its supporting recipient quote and any mismatch or missing information.

The provider's `completed` status is not evidence that the site can receive the load. An unanswered field stays unresolved. Quotes from the calling agent do not establish a receiving-site fact. The report is advisory and never makes a dispatch decision.

## CALL-E integration

The application uses the published `@call-e/calle@0.7.0` TypeScript SDK. CALL-E handles the conversation and structured extraction; local code checks the returned evidence and compares explicit quantities. Calls are created through `client.calls.create`, and existing calls are retrieved through `client.calls.get`.

The request and its idempotency key are saved before the create request. A returned call ID is saved before further polling. When an HTTP response is lost, the CLI preserves the uncertain state rather than silently creating another intent. The operator can explicitly retry the original stored request with its original key. No provider-side idempotency retention period is assumed.

## Run locally

Use Node.js 22 or later. From this directory:

```sh
npm ci
npm test
npm run dockbrief -- preview examples/pallet.json
npm run dockbrief -- demo insufficient-forklift --out .dockbrief/blocked.json
```

Open `.dockbrief/blocked.html` to inspect the generated brief. The demo invokes the actual published SDK with an in-process synthetic transport; it makes no network request or telephone call. Use `fitting` and `incomplete` with distinct output paths to explore the other scenarios. Existing state is never silently overwritten.

For a live run, copy `examples/pallet.json` to a private local location and replace the fictional contact with one specifically authorized receiving contact. Never call the sample number. Set `CALLE_API_KEY` securely in the process environment, then:

```sh
npm run dockbrief -- preview /private/path/load.json
npm run dockbrief -- start /private/path/load.json --confirm-call --consent-note "The named receiver agreed to this one DockBrief test call." --out /private/path/run.json
npm run dockbrief -- resume /private/path/run.json
npm run dockbrief -- report /private/path/run.json --out /private/path/brief.html
```

`resume` performs one GET; repeat it at least five seconds apart while the call is in progress. The consent note is an operator attestation and must describe actual authorization, not a statement copied without checking. Closing the terminal does not cancel the provider call.

If creation returned no call ID, keep the original state and inspect the provider dashboard. Only when reconciliation is needed, `retry-create /private/path/run.json --confirm-call` explicitly resends the stored request with its existing key. Never recover by changing the output path or running `start` again. A stale `.lock` file is removable only after confirming its process has stopped; removal does not cancel a phone call.

The live path requires `CALLE_API_KEY` in the process environment, an authorized E.164 destination and a currently supported region/locale. This MVP accepts US/en-US, GB/en-GB, MX/es-MX, ES/es-ES and HN/es-HN. Coverage can change; [check CALL-E's region list](https://docs.heycall-e.com/regions). Evidence checks recognize a deliberately narrow set of explicit English and Spanish statements in kg and mm. The prompt requests clear read-back statements; approximate, qualified, conflicting or unrecognized wording stays unresolved. This is not general-purpose semantic verification.

## Side effects and privacy

- `preview`, fixture demos and tests do not contact anyone.
- Live creation places one outbound call. It can consume the CALL-E account's existing credits. No top-up, number purchase or subscription is implemented.
- There are no schedules, repeat-call campaigns, bookings, payments or promises on the recipient's behalf.
- A started call cannot be recalled by closing the terminal. This SDK version exposes no client cancellation method. Resume retrieves the existing call; it does not cancel it.
- The API key belongs only in the trusted local process environment. Do not put it in browser code, sample JSON, screenshots, logs or Git.
- Local live state contains the request and recipient transcript. Keep it private. Public demonstrations must redact phone numbers and use content the receiver has agreed may be published. Normal CLI/report contact displays must mask phone numbers.
- The tool does not control provider recording or retention. Its introductory prompt identifies the caller as an AI assistant and asks permission to proceed; do not describe this as disabling provider recording.

## Verification and current limits

The reproducible scenarios use synthetic conversations and are explicitly labeled as fixtures. They demonstrate application behavior, not customer deployment or a successful telephone connection. **No live telephone test has been completed for this contribution yet.** Live execution evidence, if obtained, must be documented separately with its date and exact scope.

This is a local hackathon prototype, not production dispatch software. It has no field measurements, equipment certification, logistics integration, customer trial, measured savings or demonstrated accuracy rate. Quoted language can still be ambiguous. A reviewer must inspect the original context and resolve unknowns.

## Related contributions

[DockSignal](https://github.com/CALLE-AI/awesome-phone-call-agents/tree/main/skills/logistics-exception) covers missed-window logistics exceptions; [DispatchPulse](https://github.com/CALLE-AI/awesome-phone-call-agents/tree/main/apps/typescript/dispatch-pulse) coordinates pre-delivery customer/rider verification; [SupplyLine](https://github.com/CALLE-AI/awesome-phone-call-agents/tree/main/apps/typescript/supplyline) sources freight quotes. DockBrief focuses on the physical receiving checklist before dispatch. These are comparisons of published scope, not claims that those projects are deficient.

Built with AI coding assistance and reviewed through automated tests and a separate code review. All examples are synthetic unless explicitly labeled otherwise.

License: MIT.
