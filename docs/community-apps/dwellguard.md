# DwellGuard integration notes

DwellGuard is a TypeScript/Next.js dispatch-coordination app for late freight arrivals. It uses CALL-E to collect a driver's workable arrival interval, carries that evidence into a dock-coordination call, and issues a driver handoff only when the dock commitment stays inside the dispatcher's pre-authorized limits.

- Source: [Syedsaadhhh/DwellGuard-AI](https://github.com/Syedsaadhhh/DwellGuard-AI)
- Runtime: Node.js 22–24, Next.js 14, TypeScript
- CALL-E integration: `@call-e/calle` SDK
- Call scope: at most two outbound CALL-E tasks per incident

## Workflow

1. An authenticated operator registers a delayed shipment and freezes the allowed arrival window, fee ceiling, and escalation boundaries.
2. DwellGuard places a disclosed CALL-E task to an operator-controlled driver number.
3. CALL-E returns a structured arrival interval, permission flag, and short evidence phrases.
4. Only when the driver's result passes deterministic checks does DwellGuard create the dock-coordination task.
5. The dock result is checked against the driver interval and fee ceiling.
6. A valid commitment produces a signed driver-handoff link; an unsupported time, excessive fee, incomplete result, or ambiguous outcome stops for human review.

CALL-E results are inputs to the app's decision rules, not automatic proof. The host verifies the returned structure and constraints before advancing the incident.

## Safe evaluation

The public `/demo` route is a deterministic, credential-free replay. It places no calls and uses fictional data. It demonstrates both:

- a positive driver-to-dock coordination path; and
- a fee-refusal path that escalates when the dock requests more than the operator authorized.

The authenticated shipment desk is the opt-in live path. It should only be used with numbers controlled by or explicitly consented to by the tester.

## Setup

```bash
npm install
npm run typecheck
npm test
npm run dev
```

Copy `.env.example` to the host's private environment and provide:

- `CALLE_API_KEY`
- `CALLE_BASE_URL=https://api.heycall-e.com`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPERATOR_SECRET`
- `NEXT_PUBLIC_APP_URL`

Do not commit real values. Phone numbers are entered at runtime and must use E.164 format.

## Side effects and limits

- Starting live coordination can place a real outbound phone call.
- A second call is created only after the driver evidence passes the host's checks.
- The app does not schedule recurring jobs or silently redial.
- An unresolved CALL-E outcome remains pending or escalates; it is not treated as success.
- The current demo does not cancel an already-created provider call because the CALL-E task API does not expose an in-flight cancellation operation.
- To stop before dialing, do not start coordination. To stop after the driver call, do not approve or advance the dock step.

## Credential handling

CALL-E and Supabase credentials remain server-side. Browser code receives neither the CALL-E key nor the Supabase service-role key. Operator access is protected by a server-issued session cookie; the shared operator secret belongs in private judge instructions, never in source control or public screenshots.

## Manual verification

1. Open `/demo`.
2. Run the positive flow and confirm the appointment pass is issued only after driver and dock evidence agree.
3. Open the generated driver handoff and acknowledge the appointment.
4. Run the fee-refusal flow and confirm the workflow stops for a dispatcher.
5. For an authorized live check, sign in to the shipment desk, register an incident with operator-controlled E.164 numbers, start coordination, and verify that the resulting CALL-E task identifiers and evidence appear in the incident timeline.
