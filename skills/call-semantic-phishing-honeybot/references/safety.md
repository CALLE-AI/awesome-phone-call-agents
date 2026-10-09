# Safety & Compliance

1. **Testing Protocol Compliance**: All test examples and script executions MUST strictly use the `555-01xx` numbering block for the `caller_number`. The `HoneybotExtractor` will raise a `ValueError` if a real phone number is provided, adhering to repository PR #288 rules.
2. **IoC Handling safely**: Extracted URLs and wallets are hostile by definition. They should be logged and passed to threat intel feeds (e.g., AbuseIPDB), but NEVER automatically clicked or accessed by the agent's internal tools (e.g. no auto-browsing).
3. **No Retaliation**: The bot is designed to *stall* and *extract*, not to launch counter-attacks or insult the caller, which could violate Terms of Service of telephony providers.
