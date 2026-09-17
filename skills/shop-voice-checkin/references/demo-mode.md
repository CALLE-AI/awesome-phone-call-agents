# Demo mode

This skill and the reference app are designed for **demo-first** hackathon submission.

## Default behavior

- **No live call** unless the user explicitly opts in with live SDK flags (Rajput R5).
- **Fixtures** under `apps/python/shop-voice-manager/fixtures/` simulate completed CALL-E results.
- **Masked phone** `+2348000000000` in all committed samples.

## When to use demo mode

- Local development without CALL-E credits
- CI and repository validation
- Hackathon video recording (use transcript fixture as call clip)
- Collaborator onboarding before live auth

## When to use live mode

- One short call clip for the video (optional)
- End-to-end validation with real structured extraction (A10 live variant)

Requires `CALLE_API_KEY`, explicit consent, and `references/safety.md` review.

## Demo commands

```bash
cd apps/python/shop-voice-manager
python client.py --request example_request.json --weekly-summary
```

## Do not

- Commit API keys or real retailer phone numbers
- Mark fixture results as live production data
- Place live calls in CI
