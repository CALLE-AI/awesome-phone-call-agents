# Examples

Synthetic calls, modelled on the runnable fixtures in
`apps/python/warrantyops/fixtures/`. Every number is from the reserved
fictional 555-0100 to 555-0199 block, every name is invented, and no example
here came from a real call.

## A. The returned claim the portal would not explain

Recipient `+1 202 555 0142`. The portal repeats code R-114, the code sheet
does not cover this assembly, two emails went unanswered. The desk states
the status, the reason, the document they need, a deadline, and confirms a
case reference through its own read-back.

```text
user  "I have it here. It is showing returned in our system. The labour line has no operating-hours reading attached."
user  "Send a photograph of the hour meter with the reading visible and we can rework the claim."
user  "Yes, thirty days from today for the resubmission."
user  "It is case nine zero two one zero."
bot   "Just to confirm, that is case nine zero two one zero, correct?"
user  "Correct, case nine zero two one zero."
```

```json
{
  "claim_status": "STATED_RETURNED",
  "stated_reason": "The labour line has no operating-hours reading attached.",
  "required_documents": ["photograph of the hour meter with the reading visible"],
  "stated_deadline": "thirty days from today for the resubmission",
  "confirmed_reference": {"value": "CASE-90210", "kind": "CASE", "corrected": false}
}
```

`INFORMATION_OBTAINED`. Every asserted field traces to a turn above.

## B. No status may be invented

Recipient `+1 202 555 0118`. The desk cannot see the claim in the payment
queue.

```text
user  "I cannot see this claim in the payment queue. It may be sitting in document review."
user  "Send a copy of the installation invoice and a photograph of the data plate, then it can go to review."
```

```json
{
  "claim_status": "UNKNOWN",
  "required_documents": ["copy of the installation invoice", "photograph of the data plate"]
}
```

"It may be sitting in document review" is a guess about a record they could
not see. The status stays `UNKNOWN`; the documents are the actionable
result. This is the case a summariser turns into a confident status and a
contract with an explicit `UNKNOWN` gets right.

## C. The read-back earns its keep

Recipient `+1 202 555 0163`. The reference is said once, quickly, and heard
wrong.

```text
user  "Correct the serial and resubmit. Your case reference is four eight one seven one."
bot   "Just to confirm, that is case four eight one one seven, correct?"
user  "No, that last digit is an eight. Four eight one seven eight, that is correct."
```

```json
{
  "claim_status": "STATED_REJECTED",
  "stated_next_action": "Correct the serial and resubmit.",
  "confirmed_reference": {"value": "CASE-48178", "kind": "CASE", "corrected": true}
}
```

The value first heard was `CASE-48171`. It is kept beside the confirmed one
and marked as corrected. Without the read-back, this call would have
produced a schema-valid, confidently extracted, factually wrong reference,
and the correction would have been filed against somebody else's case.

The `bot` line is not decoration. The confirmation binds to it, and to
nothing else in the call: an affirmative sentence from an earlier exchange
does not confirm this number. See `identifier-confirmation.md`.

## D. The call that never completed

Recipient `+1 202 555 0134`. The call fails or is cut off before any
terminal result.

```json
{
  "claim_status": "UNKNOWN"
}
```

Terminal state `TRANSPORT_FAILED`, no business result, nothing written back.
No transport state may be read as a claim decision.

## The gates have their own examples

Two more fixtures are not call shapes at all: a source record that already
states the next step is refused before the provider is invoked
(`SOURCE_ALREADY_ANSWERS`), and a source record that moves between the call
and the write-back refuses the mutation (`SOURCE_CHANGED`) with no second
call. See `apps/python/warrantyops/README.md` for the six runnable scenarios.
