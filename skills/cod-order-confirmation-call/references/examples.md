# Examples

## Safe

- A restaurant's WhatsApp bot captured a 16.00 USD cash-on-delivery order; the operator clicks **Confirm by phone** and the customer confirms items and address. Result: `disposition: confirmed`, `confirmed: yes` → the order moves to confirmed and a note lands in the chat thread.
- Auto-confirm is on with a 3-minute delay; the customer asks on the call to swap large fries for regular. Result: `disposition: changed`, `requested_changes: "regular fries instead of large"` → the order is left for a human to edit.
- The call reaches voicemail. Result: `disposition: voicemail` → nothing changes; the team calls back or messages on WhatsApp.
- Previewing the compiled brief and schema with `scripts/build_task.py` on `assets/sample-order.json` for a demo video, phone masked.

## Unsafe

- Building the brief from the chatbot's own "I added 2 shawarma" sentence instead of the stored order rows.
- Treating silence, `unknown` or a voicemail as a confirmation.
- Cancelling an order because the customer sounded unsure (`confirmed: unknown`).
- Calling a customer who opted out of messages because "a call is different".
- Retrying automatically after `no_answer` without a human deciding.
- Putting the CALL-E API key in a fixture, a screenshot or the intake JSON.
