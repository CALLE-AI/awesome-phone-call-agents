# Fictional Examples

All people and organizations are fictional. Human-facing numbers are masked.

## Verified GO

`assets/go-input.json` and `assets/go-result.json` contain a completed conversation in which the identified sole final decision-maker explicitly states every required fact, confirms an unconditionally funded deposit, and states no unresolved risks. Every evidence quote is one exact span from a callee turn. The deterministic result is `GO`; a human still decides whether to accept.

## Ambiguous CAUTION

`assets/caution-input.json` and `assets/caution-result.json` contain a completed conversation with verified identity and authority, but the budget currency, funding status, and acceptance criteria remain unknown. The deterministic result is `CAUTION`. The system must not fill gaps from assumptions or a provider summary.

## Refusal NO-GO

`assets/no-go-input.json` and `assets/no-go-result.json` contain a completed connection where the contact refuses verification. Empty or unsupported fields stay unresolved, and the deterministic result is `NO-GO`. Refusal authorizes neither a retry nor a different contact.

The same `NO-GO` result applies to voicemail, silence, declined, failed, busy, expired, canceled, or no-answer outcomes. None verifies the brief.
