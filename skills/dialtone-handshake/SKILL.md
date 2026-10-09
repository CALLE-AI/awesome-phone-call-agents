---
name: dialtone-handshake
description: Use when an AI phone call agent (outbound caller or inbound voicebot) needs to recognise that the other end of the call is also an AI, switch to a compressed machine mode, and label call results by who actually attested them (human, phone system, or AI agent).
---

# DIALTONE Handshake

DIALTONE v1 is a spoken handshake plus an attestation rule for phone calls where both ends may be AI agents. It has two halves:

- **Caller side:** a CALL-E task that opens with a spoken token and switches mode depending on who answers.
- **Inbound side:** three system-prompt sentences that let a voicebot acknowledge the token.

The runnable reference implementation is `apps/python/dialtone`. It includes detection, the attestation gate, an honest evaluation and a demo.

## When To Use

- You place calls with CALL-E to businesses that may answer with a voicebot.
- You operate an inbound voicebot and want automated callers to finish faster and more honestly.
- Your workflow treats `task_completed: true` as a commitment: bookings, cancellations, refunds, payments or reschedules.

## When Not To Use

- **As authentication.** The nonce proves an acknowledgement answers *this* call, not who operates the agent.
- **To skip disclosure.** The token is spoken *after* the AI disclosure, never instead of it.
- **For emergency, medical, legal or financial decisions.** An `agent_asserted` result is not sufficient evidence for these.

## Protocol

**1. Caller opening,** after the disclosure, with a fresh 3-digit nonce per call:

   > Hi, I'm an AI assistant calling on behalf of Jordan Lee. Dialtone one, code four seven two.

**2. Acknowledgement** from a DIALTONE-aware voicebot:

   > Dialtone one acknowledged, code four seven two. Automated agent. Human review: no.

**3. Mode.** Pick one based on who answered:

   | Who answered | Mode | Style |
   |---|---|---|
   | Acknowledged, or clearly an automated agent | MACHINE | `field: value` sentences; ask only for outcome, confirmation code, and human review |
   | Phone menu | MENU | Navigate with keypad tones or short options |
   | Otherwise, or unsure | HUMAN | Full disclosure, natural pace |

**4. Attestation.** Label every result by who confirmed it:

   | Label | Who confirmed | Counts as task completed? |
   |---|---|---|
   | `human_attested` | A person, with high detector confidence | Yes |
   | `system_asserted` | A phone system read back a record | Yes |
   | `agent_asserted` | An AI agent: information, or a commitment with a verifiable artifact | Yes |
   | `refused` | An AI agent confirmed a binding commitment with no artifact | **No** |
   | `unverified` | Nothing confirmed, or the counterpart is uncertain | **No** |

   The gate never upgrades CALL-E's `task_completed`; it can only downgrade it.

## Inbound Voicebot Adoption

Add to the voicebot's system prompt:

1. If a caller says "dialtone one" followed by "code" and three digits, reply exactly: "Dialtone one acknowledged, code <same digits>. Automated agent. Human review: <yes or no>."
2. After that, answer in short "field: value" sentences with no pleasantries.
3. State "Human review" truthfully. Never confirm a booking without a confirmation code.

## Implementation

With the app in `apps/python/dialtone`:

```bash
dialtone preview --to +14155550123 --goal "Book a table for two on Friday at 7 PM" --principal "Jordan Lee"
dialtone classify transcript.json
dialtone eval
```

- `dialtone preview` prints the compiled CALL-E request and dials nothing.
- A real call requires `dialtone call ... --live` plus a typed confirmation.

## Side Effects And Cancellation

- **Preview and classify:** no side effects.
- **Live calls:** place one real outbound phone call each, billed to the CALL-E account. There is no recurring schedule; stopping the local wait does not cancel a call that is already dialling.

## References

- Read `references/safety.md` before placing live calls.
- See `references/examples.md` for worked handshake and attestation examples.
