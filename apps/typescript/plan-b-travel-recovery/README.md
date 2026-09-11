# PLAN B - Autonomous Travel Recovery

PLAN B is a CALL-E-powered travel recovery app. After a flight disruption, it calls test providers, evaluates each structured response against the traveler's arrival deadline and additional-cost limit, rejects invalid options, and displays a recovery plan only when every required field passes validation.

Public Safe Demo: https://call-e-your-code-is-calling.vercel.app

## Workflow

1. Extract the arrival deadline, maximum additional budget, and traveler priority.
2. Call Provider A through CALL-E.
3. Validate its structured result.
4. If the option is incomplete, late, or over budget, reject it and call Provider B.
5. Explain why the winning option satisfies the constraints.
6. Reveal the provider, arrival time, additional cost, and confirmation reference returned by CALL-E.

Live Mode requests this result contract:

```json
{
  "provider_name": "string",
  "viable": true,
  "arrival_time": "07:50",
  "extra_cost": 286,
  "decision_reason": "string",
  "confirmation_reference": "string"
}
```

The example workflow requires arrival before 09:00 and no more than $400 additional cost. PLAN B does not display a successful plan when required fields are missing or a constraint fails.

## Safe Demo: no calls

Safe Demo is the default public experience. It runs entirely in the browser, requires no credentials, places no phone calls, and uses a deterministic two-provider scenario. It exists both as a judge-friendly product walkthrough and as the app's no-call path.

```bash
npm install
npm run dev
```

Open http://localhost:3000 and select **Start Safe Demo**.

## Live CALL-E Mode

Copy `.env.example` to `.env.local` and provide private values:

```env
CALLE_API_KEY=your_private_key
ENABLE_LIVE_CALLS=true
LIVE_DEMO_ACCESS_CODE=your_team_only_code
```

Restart the server. Live Mode appears only when all three values are present. Starting a live run requires the private access code and two explicit E.164 test phone numbers from supported regions.

Every displayed Live Mode value comes from CALL-E's structured response. Live Mode never falls back to the Safe Demo result.

## Real-call validation

The outbound pipeline has been exercised against CALL-E's official testing hotline and consented test recipients. Route availability and result latency can vary during live tests. When a recipient is unreachable or no structured result arrives inside the bounded demo window, PLAN B records the attempt as unsuccessful and refuses to invent a recovery plan.

## Side effects and safety

- Safe Demo never creates a call.
- Live Mode creates at most two one-off outbound calls per new run.
- The UI clearly separates Safe Demo from Live Mode and requires an explicit click to start.
- Live calls disclose that the caller is an AI performing a hackathon test.
- The task tells the agent not to purchase a ticket.
- Phone input must be E.164 and match a configured supported region.
- Phone numbers are not included in application call logs; logs contain provider results, duration, decision, and CALL-E call ID.
- A run ID becomes part of the idempotency key to prevent duplicate provider calls when the same run is retried.
- There are no recurring jobs or hidden schedules.
- Before a live call begins, cancel by leaving Live Mode or not pressing the start button. After CALL-E accepts a call, use the provider's own call controls; this demo does not claim an in-app mid-call cancellation API.
- Do not use the demo for emergencies, medical, legal, financial, or other high-stakes decisions.
- Use only consented test numbers or published business test lines and follow applicable calling rules.

## Credential handling

`CALLE_API_KEY` and `LIVE_DEMO_ACCESS_CODE` are server-side environment variables. `.env.local` is ignored. Neither secret is embedded in client code or returned by the API.

## Failure behavior

- Unsupported destinations are rejected before any call is created.
- Missing or invalid access codes fail before any call is created.
- Incomplete structured results are shown as rejected or unreachable, never converted into a plan.
- Each provider result wait is bounded so the server returns a truthful JSON outcome before the hosting runtime limit.
- Hotel negotiation is not attempted or claimed in Live Mode.

## Verify

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm test
```

Tests build the Next.js app and verify the no-call experience, Live Mode protection, supported-region handling, deadline parsing, budget validation, and incomplete-result rejection. Tests require no CALL-E credentials and place no calls.

## Technology

- CALL-E SDK and Developer API
- Next.js, React, and TypeScript
- Tailwind CSS
- JSON Schema structured results
