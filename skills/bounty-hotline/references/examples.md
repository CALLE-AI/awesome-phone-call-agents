# Examples

## Safe

- A freelancer sets `HOTLINE_PHONE` and `HOTLINE_REGION` to their own number and region, runs the watcher from cron with `--yes`, and gets a single evening call when a fresh $300 bounty on a credible repo appears; the call reads repo, issue number, title, and amount, then ends, and the bounty is deduped only after CALL-E returns a `run_id`.
- An operator starts the daemon without `--yes` after a reboot: the feed is evaluated and logged, nothing dials, and the log records `live_refused` until a human passes `--yes` again.
- A mismatched number is caught before any call: `HOTLINE_PHONE="+447700900123"` with `HOTLINE_REGION="US"` fails the region-bound E.164 gate and exits without dialing.
- The feed lists ten bounty-labeled issues; nine fail the filters (stale, duplicate, sub-threshold farm spam, or unknown age), so the log records ten eval decisions and the phone stays silent.
- The skill is demonstrated end-to-end in a dry-run mode that plans and previews the narration for a fictional bounty (`acme-widgets`, issue #12, $200, `example.com`-style repo) without placing a call.

## Unsafe

- Calling a maintainer's personal number scraped from a bounty issue to "negotiate" the payout.
- Pointing `HOTLINE_PHONE` at a business switchboard, a looked-up number, or any number the operator does not own.
- Treating a planned call as a placed one: marking the bounty called when `calle call run` was refused, errored, or returned no `run_id` — this silently swallows real bounties forever.
- Retrying an uncertain run (`call_started: "unknown"`) by planning a fresh call instead of finishing it through `calle call recover`; this can ring the recipient twice for one issue.
- Leaving the daemon looping on a one-time configuration with no per-run confirmation, so it keeps dialing long after the operator stopped watching.
- Committing a real run's transcript, status JSON, or run ID to a repository or pasting them into a public issue.
