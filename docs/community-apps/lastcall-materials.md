# LastCall Materials

LastCall Materials helps contractors, tradespeople, and reuse organizations find phone-only reuse capacity before a jobsite deadline turns useful building materials into waste.

- Public demo: [https://lastcall-materials.fly.dev/](https://lastcall-materials.fly.dev/)
- Devpost project: [https://devpost.com/software/lastcall-materials](https://devpost.com/software/lastcall-materials)
- Supported workflow examples: doors, wall panels, framing, fixtures, piping, and lumber
- Source repository: private during hackathon judging

## What the workflow does

An operator opens a material recovery case, reviews an approved reuse partner, and inspects a one-call permit. In live mode, one protected server action gives CALL-E a narrow capacity-check task: ask how many units the organization may accept, what preparation is required, and when pickup could happen.

CALL-E handles the adaptive phone conversation. The application then validates the returned evidence and applies deterministic quantity accounting. For example, a result that can accept two of ten items becomes two **candidates** and eight **unresolved** items. It does not become ten accepted items, and it does not become two recovered items.

Human review remains separate from physical-pickup verification. The verified-recovered count stays at zero until pickup is confirmed independently.

## Public demo and safe testing

The public Fly.io deployment is intentionally fixture-only and does not place a call. It is labeled **Public judge fixture — no call placed** and demonstrates the same result-validation and quantity-accounting path with deterministic evidence. The fixture path needs no phone number, CALL-E credential, or live contact.

The browser never receives a destination phone number or operator secret. Live calling is available only from an explicitly enabled protected environment.

## Live-call side effects

A live run can ring a real phone, speak with a person, and incur provider charges. The application requires all of these conditions before dispatch:

1. The live CALL-E provider is selected server-side.
2. Calling is explicitly enabled.
3. The destination is an approved contact stored outside the browser.
4. The operator has reviewed the case and one-call permit.
5. The protected action is invoked once for that case.

There is no recurring scheduler, hidden retry loop, bulk dialer, or browser-exposed phone number.

## Cancellation and duplicate-call controls

Before dispatch, the operator can leave the case without placing a call. After CALL-E accepts the one-shot task, the application polls that task rather than creating another one. Unknown, incomplete, unsafe, or unparseable results fail closed to human review and never become recovered inventory.

## Credentials and privacy

CALL-E credentials, the approved phone number, and live-call flags are server-only environment values. They are not embedded in client JavaScript, public fixture data, screenshots, logs, or returned API payloads. Public examples use masked or fictional contact details.

## Integration boundary

The integration is intentionally narrow:

```text
reviewed case + one-call permit
        -> protected server action
        -> CALL-E task
        -> transcript / summary / structured result
        -> deterministic validation and quantity accounting
        -> human approval
        -> separately verified pickup
```

CALL-E provides the conversation. LastCall Materials owns authorization, validation, accounting, evidence presentation, and the distinction between a candidate and a verified recovery.
