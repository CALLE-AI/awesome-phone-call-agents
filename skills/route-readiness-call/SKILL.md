---
name: route-readiness-call
description: Calls the next customer on a delivery route through CALL-E shortly before the rider arrives, extracts a strict readiness result (ready now, extra minutes, later today, not today, landmark, cash ready), accepts it only when the customer's own words back it, and turns it into an earliest delivery time so the remaining stops can be re-ordered. One call in flight, each customer at most once a day, no redial.
license: MIT
---

# Route Readiness Call

Use this skill when a delivery rider is already on the route and an upcoming customer's readiness would change the order of the remaining stops. It is the reusable core of the RouteReady app in this repository (`apps/typescript/routeready`): which stop to call, the call task, the result schema, the evidence gate, and the rules that turn an answer into a routing constraint.

## When To Use

- A rider is on a multi-stop delivery or service route and the next stops are 6 to 45 minutes away
- The customer gave this phone number for contact about this delivery, and the operator is authorised to call about the order
- The output should be a verified readiness answer that a route optimiser or a dispatcher can act on

## When Not To Use

- Marketing, collections, surveys, or anything other than the delivery the customer is expecting
- Stops the rider will reach in under 6 minutes: a call takes about two minutes and the route cannot adapt in time
- A second call to the same customer on the same day, or a retry after an unclear or ambiguous call
- Emergency, medical, legal or financial conversations
- Destinations CALL-E does not currently accept (see `references/safety.md`)

## Required Inputs

- `run_id`, `stop_id`: stable identities; the idempotency key is `routeready:{run_id}:{stop_id}`
- `merchant`, `order_ref`
- `phone_e164`, `region` (ISO country code), `language`
- `eta_minutes`: minutes until the rider arrives, exactly as the customer will be told
- `cod_amount`: amount due at the door with its currency, or null when prepaid
- `authorization_confirmed`: the operator confirms the number was given for delivery contact

## Picking The Call

There is one line, so only one call may be in flight. Among stops not called today whose projected arrival is 6 to 45 minutes away, call the soonest. Skip the stop the rider is already driving to.

## Preflight

1. Validate the phone against `^\+[1-9]\d{6,14}$` and reject emergency numbers.
2. Before the first live call of a day, show the operator the masked number, the exact task text and the idempotency key.
3. Persist the idempotency key before calling CALL-E, and the returned call id immediately after.

## CALL-E Task Template

```text
You are an AI assistant calling on behalf of {merchant} about a parcel delivery. Say in your first sentence that you are an AI assistant calling about their delivery.
Speak {language}, slowly and clearly.
The rider expects to arrive with order {order_ref} in about {eta_minutes} minutes.
Ask: 1) whether they can receive the parcel when the rider arrives, and if not, how many extra minutes they need or whether later today works;
2) if they will not be there, whether a guard, neighbour or family member can receive it;
3) whether the cash payment of {cod_amount} will be ready;
4) a landmark near their door that helps the rider find it.
Do not ask for card, bank, password or identity details. Do not promise an exact delivery time. If it is a wrong number or voicemail, apologise and end the call.
Keep the call under 90 seconds, thank them, and end the call.
```

For prepaid orders, replace question 3 with `3) do not discuss payment, this order is prepaid;`.

Send `references/result-schema.json` as `recipient_result_schema` (`recipientResultSchema` in the TypeScript SDK).

## Evidence Gate

Accept an answer only when every condition holds; otherwise record it as unverified and change nothing:

1. The call status is `completed` and the recipient's number is the planned number.
2. The recipient result parses against the schema: every enum value allowed, every text field a string.
3. `reached_recipient` is `yes`.
4. `customer_quote` is not empty.
5. `readiness` is not `unknown`.
6. `completion_confidence.label` is `medium` or `high`.

Do not treat `task_completed` as evidence that the customer was reached. In testing, a call answered by an automated receptionist came back with `task_completed: true` and high confidence, and `reached_recipient: "no"`.

## Answer To Route Rules

| `readiness` | Routing constraint |
| --- | --- |
| `ready_now` | earliest delivery is now |
| `within_15_min` | earliest delivery is the told arrival plus 15 minutes, or `ready_clock_time` when given |
| `15_to_45_min` | earliest delivery is the told arrival plus 45 minutes, or `ready_clock_time` when given |
| `later_today` | take the stop off this loop; revisit after `ready_clock_time` when given |
| `not_today` | take the stop off today's route; rescheduling needs dispatcher approval |
| `unknown` | no change |

Then re-plan the remaining stops with these earliest times. The reference app tries every order of up to nine stops and minimises finish time plus twice any lateness against promised windows, with a small penalty per moved stop so the route never flips for a trivial gain.

## Cancellation And Idempotency

The CALL-E Calls API has no cancel endpoint: once created, a call rings and finishes. Keep one idempotency key per run and stop and reuse it on any retry of the same request, so a lost response never dials twice. Stopping a day stops new calls only. Nothing recurs; every day is started by an operator.

## Safety Notes

Read `references/safety.md` before placing a live call. Worked examples, including how the gate treats no answer and automated receptionists, are in `references/examples.md`.
