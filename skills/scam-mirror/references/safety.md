# Safety contract

Scam Mirror places real outbound phone calls when run with `--live`. Follow this
contract every time.

## Intent

- Only run for a user-initiated anti-fraud verification.
- No mass dialing, no untargeted number scanning, no institution pressure calls.
- Dry-run is the default; `--live` is an explicit, warning-gated opt-in.

## Phone numbers

- Use E.164 numbers.
- Mask real numbers in user-facing summaries and screenshots.
- Samples and fixtures use fictional `555-01xx` numbers, never real ones.
- The shipped `orgs.whitelist.json` contains placeholders; replace them with
  verified published lines before a live run.

## Data and privacy

- Collect no real names, ID numbers, bank cards, or SMS verification codes.
- Store no full recordings by default. Keep only the summary and content hash.
- Never expose `CALLE_API_KEY` or any credential in output, logs, or commits.

## Call behavior

- Suspect calls are as short as possible. Any request for a code, password, PIN,
  transfer, remote control, crypto, or secrecy ends the call immediately.
- The flies provide no real personal information.
- Official calls are polite, brief, and non-harassing.
- Rate-limit repeated calls to the same official line.

## Scheduling and duplication

- No hidden recurring schedules.
- Do not create duplicate jobs for the same case.
- Cancellation is the user stopping the CLI before `--live` is issued; live runs
  complete their two calls and do not redial automatically.

## Boundaries

- The output is advisory, not a legal conclusion. Any UI or copy must state this.
- Medical, legal, financial, and emergency content stays out of the fly scripts.

