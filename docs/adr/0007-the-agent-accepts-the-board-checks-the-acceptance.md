# The agent accepts the offer, and the board checks the acceptance

Reception offers "Wednesday the 26th at ten past nine" and somebody has to answer while
she waits. CALL-E's surface is `--to-phone` and `--goal <text>`, then polling: there is
no callback during a call and no tool the agent can reach mid-sentence, so our code
cannot be consulted at the moment the answer is owed. The Booking Envelope therefore
travels into the call as English inside the goal text, and the model may accept inside
it.

Its acceptance is not the booking of record. When the call reaches a terminal state a
deterministic matcher re-reads the Offered Slot against the `release` row that
authorised the call. Inside the envelope, the item is booked. Outside it, the item
returns to the board flagged — and that flag says the agent accepted something it
should not have, which is a different sentence from "reception offered nothing".

This is ADR 0005 applied to the second call. The prompt exists for the receptionist:
it is what lets the agent answer at the speed of a human conversation. The scan exists
for the Practice: it is what makes "the agent only accepts inside the envelope" a
property of the system rather than a request made of a model. Upstream issue #181 —
`structured_result` contradicting its own transcript at high confidence — is why the
second reading is not redundant.

## Consequences

An acceptance the matcher rejects is worse than a refusal, because reception believes a
booking exists. The flagged item must therefore name the Offered Slot, so whoever rings
back knows what to cancel. Nothing is written to `appointment.followup_booked` on the
model's word alone.
