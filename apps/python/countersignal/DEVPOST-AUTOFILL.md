# CounterSignal — Devpost autofill

Use these values for the CALL-E submission form.

- Submitter Type: Individual
- Country of residence/incorporation: Hong Kong
- Organization name: leave blank
- App status: Newly created
- If pre-existing, explain updates: Not applicable — CounterSignal was newly created during the submission period.
- Functional demo URL: https://countersignal.vercel.app
- Project submission pull request URL: https://github.com/CALLE-AI/awesome-phone-call-agents/pull/198
- Email associated with CALL-E account: contact@example.com
- Primary use case: Other
- One-sentence real-world task: Runs consented customer-discovery phone interviews under a frozen protocol and turns transcript-grounded supporting and contradictory evidence into an auditable experiment decision.
- Eligible Age: confirmed true by submitter
- Country eligibility: confirmed true by submitter
- Conflict of interest: confirmed true by submitter
- Demo video URL: TODO — public YouTube or Vimeo, about 3 minutes

## Testing instructions
1. Clone branch `agent/countersignal` and enter `apps/python/countersignal`.
2. Use Python 3.11+.
3. Run `python -m pytest -q`.
4. Run `python countersignal.py --experiment example-experiment.json --recipient example-recipient.json`; preview is default and creates no call.
5. Open the public deterministic judge console: https://countersignal.vercel.app
6. Add voicemail and verify answered denominator remains 8; then add three contradictions and verify the frozen rule reaches `hypothesis_weakened`.
7. Live execution must use an explicitly permitted reviewed recipient and the documented allowlist/live gates.
