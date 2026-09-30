# Safety

## Who may be called

- Only contacts the operator supplied with an authorization note: driver numbers provided by the carrier, carrier dispatch desks, and the consignee's receiving line.
- Every number must be E.164. Emergency-number patterns (911, 112, 999, 000, 110, 119 and similar, with or without a country code) are rejected before any request is built.
- Include contacts explicitly. An excluded contact is never dialled even if a number is on file.

## Disclosure

- The first sentence of every call states that the caller is an AI assistant acting on behalf of the named organisation.
- The assistant confirms it is speaking to the intended role (driver, dispatch, receiving) before asking questions. Wrong person or voicemail: say a human will follow up and end the call.

## What the assistant may never do

- Claim the contact agreed to anything they did not explicitly say.
- Book, confirm, move, cancel, or price a dock appointment on a fact-finding call.
- Agree to fees, penalties, or contract terms on any call. On the follow-up it may only record them.
- Ask for payment details, identity numbers, or personal data beyond the shipment facts.
- Give routing or driving instructions to the driver.
- Invent an exact time from a vague estimate.

## Human gates

1. Authorization confirmation before the fact-finding wave, stored with the operator's name and the confirmation text.
2. Explicit approval, in a dialog that shows the recipient and the goal, before any follow-up that can change the appointment. The approver and time are stored on the call task and on the recovery action.
3. Manual actions (notify dispatcher, resolve a conflict, brief the driver, close the incident) are never automated.

## Data handling

- The CALL-E API key lives only in server environment variables.
- Phone numbers are masked in the incident room, recovery card, decision log, and Markdown summary.
- Webhooks are untrusted input: validate the shape, require the event id header to match the body, deduplicate by event id, and fetch the call with the server key before applying anything.
- Failed, canceled, unknown, and validation-failed results are displayed as such and never promoted to facts.

## Cancellation

The Calls API has no cancel operation. Keep the wave to the contacts confirmed in the plan. If the situation resolves mid-call, let the calls finish and mark the incident closed; do not create further calls.
