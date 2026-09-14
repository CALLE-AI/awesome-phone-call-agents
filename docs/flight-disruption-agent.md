# Flight Disruption Agent

A concept for an AI phone agent that handles flight reschedule and refund requests for online travel agencies (OTAs) and airlines, replacing the repetitive parts of work that is commonly outsourced to business process outsourcing (BPO) contact centers.

> [!NOTE]
> A runnable implementation lives in [`apps/typescript/flight-disruption-agent`](../apps/typescript/flight-disruption-agent/), with a dry-run default and fictional data. It implements Workflow A as one outbound call per passenger on a delayed or cancelled flight, with the disruption reported by an operator or pushed by the airline ops system through a signed webhook, and Workflow B as passenger → CALL-E → airline desk: a request from a channel or an operator is priced, CALL-E calls the passenger to agree the change, then calls the airline service desk to make it.

## Problem

Flight disruption handling is still largely manual. Many OTAs, and airlines selling directly, route reschedule, refund, booking failure, and complaint cases to human agents, often through outsourced BPO teams. Each case requires the agent to look up the booking, interpret fare rules from several parties, act in a B2B or global distribution system (GDS) portal, and sometimes phone the airline to finish the job.

Ticket distribution adds to the complexity. An OTA can source a ticket directly from an airline, but it can also go through a chain of middlemen:

```text
OTA -> distributor 1 -> distributor 2 -> airline
```

Every party in the chain can have its own reschedule charges and refund percentages, so the answer to "can I change this flight, and what will it cost?" is rarely obvious.

At the time of writing, we did not find an open-source phone-call agent workflow that covers this use case.

## Case types

| Case | Trigger | Who starts the contact | Example |
| --- | --- | --- | --- |
| Involuntary | The airline changes the flight, for example a delay, cancellation, or force majeure | Airline or OTA | A flight is delayed by four hours |
| Voluntary | The passenger wants to change the date or no longer wants to travel | Passenger | A passenger asks to move a flight to next week |

## Current process

### Involuntary changes

1. The airline or OTA sends an outbound message, for example SMS, about the delay.
2. Passengers react by contacting the airline or OTA for details and options, which produces a spike in contact volume.

### Voluntary reschedule and refund

1. The passenger decides to reschedule or request a refund.
2. The passenger contacts the airline or OTA customer service.
3. The agent checks:
   - whether the booking code (PNR) is eligible for a reschedule or refund
   - the airline, distributor, and OTA rules that decide the reschedule charge or refund percentage
4. The agent manually submits the reschedule or refund in the airline B2B platform or GDS.
5. If the submission succeeds, the agent issues a new booking code, reissues the ticket, and sends it to the passenger.
6. If the submission fails, the agent phones the airline customer service and asks for a forced reschedule.

The same team also handles failed bookings and general complaints.

## Proposed workflows

### Workflow A: Proactive involuntary disruption calls

Replace one-way SMS notifications with outbound AI calls.

1. A disruption event arrives from the airline or OTA system. In the implementation it is pushed to a signed webhook or pulled from the airline's event feed (`flight.delayed` or `flight.cancelled`, with an operational or force majeure cause). Each event id is processed once. A longer delay or a cancellation replaces a flight's earlier delay, and passengers who had kept the delayed flight are called again; an event that would make the disruption milder is held for a person.
2. The agent calls each affected passenger who has consented to phone contact.
3. The agent discloses that it is an AI, explains the change, and answers questions about the new schedule and available options.
4. The agent records the passenger's choice, such as accepting the new flight, rescheduling, or requesting a refund, as a structured result.
5. Cases the agent cannot resolve are handed to a human agent.

Passengers no longer have to wait on hold to find out what happened.

### Workflow B: Voluntary reschedule and refund handling (passenger → CALL-E → airline desk)

Replace the contact-center agent on both calls it makes today: the one with the passenger and the one with the airline.

1. The passenger's request arrives through an existing channel, such as chat, a web form, or the phone line.
2. The desk checks PNR eligibility and applies airline, distributor, and OTA rules to price every option.
3. CALL-E calls the passenger, offers those options with exact amounts, and gets an explicit yes to the one they choose.
4. CALL-E calls the airline service desk to make exactly that change, within the agreed cost.
5. The booking is updated with the airline's new booking code and ticket, or the approved refund, and the passenger is told.

In the implementation, the request arrives from the chat, web form, or phone line integration through a signed webhook (booking code plus last name), or an operator logs it. The passenger's consent is taken on the CALL-E call, not typed into a chat. Later updates are pushed back to that conversation. The airline desk call returns the new booking code and ticket number (or the approved refund and its reference) as a structured result, and only a confirmed, well-formed change within the agreed cost updates the booking.

## Fit with CALL-E

CALL-E places one-off outbound calls. Both workflows use it that way:

- Workflow A: calls to affected passengers
- Workflow B: the call to the passenger to agree the change, the call to the airline service desk to make it, and optionally a callback with the result

CALL-E places outbound calls only, so it cannot answer the passenger's inbound call. Workflow B takes the request through an existing channel and has CALL-E call the passenger back straight away.

CALL-E cannot call out to other systems during a call (its webhook fires only after the call ends), so the agent cannot check eligibility or fares while talking. The implementation therefore prices every option before dialing, puts the final options and amounts in the call task, asks CALL-E for a structured result, and applies the passenger's confirmed choice only after the call ends.

CALL-E currently refuses calls to Indonesian (+62) numbers, so a live demo has to use a number in a supported region.

## Safety considerations

- Disclose that the caller is an AI at the start of every call.
- Only call passengers who have consented to phone contact about their booking.
- Use E.164 phone numbers and mask them in summaries and logs.
- Never make a reschedule or refund change that incurs a charge without explicit passenger confirmation of the quoted amount.
- Do not read full payment details, passport numbers, or other sensitive data aloud.
- Deduplicate calls for the same PNR and disruption event.
- Escalate to a human agent when rules conflict, the passenger disputes the result, or the airline call fails.
- Provide a fake-server or dry-run path that does not place real calls or modify real bookings.

## Open questions

- How should a real B2B platform or GDS integration replace the fake booking system?
- How should an operator review and update per-party fare rules as contracts change?
- Which languages and regions are needed before this can run for Indonesian passengers?
