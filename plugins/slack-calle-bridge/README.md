# Slack CALL-E Bridge

A small Slack slash-command bridge for one-off, human-confirmed CALL-E phone work.

The default command is a **preview** and places no call. A Slack user must repeat the command with an explicit `run` prefix before the bridge sends one request to CALL-E. The result returned to Slack is intentionally narrow: masked phone, terminal status, structured outcome, and structured summary. Full transcripts and recording URLs are not posted back.

## Workflow

```text
Slack user
  -> /calle-call +12025550123 | confirm the service window
  -> preview only; no CALL-E request
  -> /calle-call run +12025550123 | confirm the service window
  -> signed request verified
  -> exactly one CALL-E task submitted with an idempotency key
  -> terminal structured result posted ephemerally to Slack
```

The example uses a fictional 555-01xx number.

## Requirements

- Python 3.11 or newer; no third-party Python packages
- a Slack app with a slash command pointing to `/slack/commands`
- `SLACK_SIGNING_SECRET` from that Slack app
- `CALLE_API_KEY` only when live `run` mode is needed
- a public HTTPS endpoint for Slack in a real deployment

## Slack app setup

Start from [`examples/slack-app-manifest.yaml`](examples/slack-app-manifest.yaml), replace the placeholder request URL with your deployed HTTPS origin, then install the app in the intended workspace.

Set environment variables without committing their values:

```bash
export SLACK_SIGNING_SECRET="..."
export CALLE_API_KEY="..."          # live run mode only
export HOST="0.0.0.0"               # use 127.0.0.1 for local-only use
export PORT="8787"
python bridge.py
```

`CALLE_BASE_URL` defaults to `https://api.heycall-e.com`. The bridge accepts another HTTPS base URL for compatible deployments. Plain HTTP is rejected except localhost when `CALLE_ALLOW_INSECURE_LOCALHOST=1` is deliberately set for tests.

Health probe:

```bash
curl http://127.0.0.1:8787/health
```

## Usage

Preview, which never places a call:

```text
/calle-call +12025550123 | confirm the maintenance window and ask for the ETA
```

Place exactly one call after reviewing the preview:

```text
/calle-call run +12025550123 | confirm the maintenance window and ask for the ETA
```

The live task instructs CALL-E to disclose that it is an AI, collect facts only, stop on refusal, and avoid purchases, secrets, legal or financial commitments, and medical/legal/financial/emergency advice.

## Outputs

Slack receives an ephemeral acknowledgement immediately. After CALL-E reaches a terminal state, the bridge posts another ephemeral message containing only:

- masked recipient phone number
- CALL-E terminal status
- structured outcome: `resolved`, `needs_human`, `declined`, or `unreached`
- structured summary

The bridge never returns a full transcript or recording URL to Slack.

## Idempotency and retries

The CALL-E `Idempotency-Key` is derived from Slack team, channel, user, trigger, recipient, and goal. A retry of the same Slack command reuses the same key, while a later intentional command receives a fresh trigger ID and can create a new call.

## Side effects and cancellation

- Preview mode has no external side effect.
- `run` may create exactly one outbound phone call.
- The bridge creates no recurring schedule.
- Stopping the bridge prevents new Slack commands but cannot retract a call CALL-E has already accepted.

## Credential and privacy boundaries

- Slack requests are accepted only when the HMAC signature is valid and the timestamp is within five minutes.
- `response_url` must use `https://hooks.slack.com` and is never logged.
- `SLACK_SIGNING_SECRET` and `CALLE_API_KEY` are environment variables only.
- Phone numbers are masked in bridge and Slack summaries.
- The request body is not logged.
- A recipient's refusal is a terminal outcome, not a reason to retry automatically.

## Local verification

Tests use an injected fake CALL-E transport, so they spend no calls and require no credential:

```bash
python -m unittest discover -s tests -v
```

Repository-level validation from the repository root:

```bash
python scripts/validate_repository.py
```

For live verification, start with a number you are authorized to call, run the preview first, and consume a live CALL-E call only after the Slack user explicitly repeats the command with `run`.
