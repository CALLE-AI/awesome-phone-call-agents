# Examples

All names and numbers are fictional.

## DIALTONE-aware voicebot, booking with a code

```text
OTHER : Thank you for calling Luigi's Trattoria. I'm Nova, the virtual reservations assistant.
CALLER: Hi, I'm an AI assistant calling on behalf of Jordan Lee. Dialtone one, code four seven two.
OTHER : Dialtone one acknowledged, code four seven two. Automated agent. Human review: no.
CALLER: Request: table booking. Party: 2. Time: Friday 7 PM. Name: Jordan Lee.
OTHER : Status: confirmed. Code: L T four four seven one. Human review: no.
```

- **Detection:** agent, via the handshake, with a nonce match.
- **Attestation:** `agent_asserted`. There is a verifiable code to re-check; it is not human-attested.

## Agreeable voicebot, booking without a code

```text
OTHER : Absolutely, that's confirmed for a table for two this Friday at 7 PM under Jordan Lee!
CALLER: Could you give me a confirmation code?
OTHER : No need, you're all set!
```

- **CALL-E report:** `task_completed: true`.
- **Attestation:** `refused`. A binding booking was confirmed only by an AI agent, which declined to give any written record.

## Human host

```text
OTHER : Luigi's, this is Marco.
CALLER: Hi, I'm an AI assistant calling on behalf of Jordan Lee. Dialtone one, code four seven two.
OTHER : Sorry, uh, dial tone what?
CALLER: That was just a signal for automated systems, you can ignore it. I'd like to book a table for two this Friday at 7 PM.
OTHER : Yep, I've got you down, Friday seven p.m., table for two.
```

- **Detection:** human. The host repeated the token without acknowledging it, and their speech shows disfluency and irregular timing.
- **Attestation:** `human_attested`.
