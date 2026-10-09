# CALL-E live test runbook

## Preconditions

- Authorized phone number you own or have written permission to call
- Supported region/language per current CALL-E docs (demo set in policy: US/CA/GB/AU + en/es/fr)
- Server env:

```bash
CALLE_API_KEY=...          # server only
CALLE_LIVE_CALLS=true
CALLE_KILL_SWITCH=false
```

## Steps

1. Start with dry-run: leave `CALLE_LIVE_CALLS` unset and confirm UI shows **DRY-RUN**.
2. Run `pnpm test` and `pnpm check`.
3. Enable live flags on the **server process only**.
4. Prepare a workflow with a real authorized E.164 (do not commit the number).
5. Review masked recipient, region, language, and side effects.
6. Confirm once. Do not spam retries.
7. Verify structured result maps into follow-up next action.
8. Set `CALLE_KILL_SWITCH=true` and confirm live placement is blocked.

## Abort

- Kill switch on
- Cancel workflow via `trpc.calle.cancel` when status is still prepared/starting
- Revoke API key if credentials leak
