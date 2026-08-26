# Configuration and environment

## TOML policy

The shipped [`quotewake.toml`](../quotewake.toml) contains the following policy
shape and defaults:

```toml
[selection.initial_follow_up]
minimum_delay = "0s"
standard_delay = "0s"
due_soon_window = "0s"

[follow_up.retry]
max_attempts = 3
retry_delays = ["2d", "4d"]
retry_outcomes = ["call_back_later", "call_not_established", "no_answer", "busy"]
technical_failure_retry_delay = "30m"
completed_outcomes = ["interested"]

[call]
wait_timeout_seconds = 600
# Optional. The default prompt is used when this is omitted.
prompt = "Follow up quote {quote_name} with {contact_name} at {account_name}."

[logging]
directory = "logs"
format = "text"
level = "DEBUG"
max_bytes = 5242880
backup_count = 5
# Temporary, sensitive support diagnostics; enabled in this demo configuration.
raw_calle_api = true
```

`max_attempts` includes the first accepted call attempt, so
`retry_delays` must be an array of strict compact duration strings containing
exactly `max_attempts - 1` values. Durations use ordered integer `d`, `h`, `m`,
and `s` components, with each unit at most once (for example `1d2h30m15s`).
Configuration accepts `0s` where a zero delay is useful. The
`retry_outcomes` and `completed_outcomes` lists are validated against the
fixed policy vocabulary documented in the [outcomes section](../README.md#outcomes-retries-and-write-safety);
unsupported or alternate mappings are rejected rather than silently ignored. The
`[call].prompt` template may use only `{locale}`, `{region}`,
`{contact_name}`, `{account_name}`, `{quote_name}`, `{quote_total}`,
`{expiration_date}`, `{attempt_count}`, and `{quote_items}`. Fixed compliance
rules are appended to every rendered prompt. Relative log directories are
resolved from the application directory.

`call.wait_timeout_seconds` is the maximum time in seconds that the SDK polls
for a non-terminal CALL-E result; it does not delay a terminal response. For
example, a terminal provider `failed` result finishes as soon as CALL-E reports
it rather than using the full 600-second limit. QuoteWake
keeps the official synchronous
`create` + `wait_for_result` flow and uses a two-second polling interval.

The shipped configuration uses `DEBUG`. At that level, the console shows the
main completed Salesforce and CALL-E operations plus QuoteWake lifecycle
events, together with bounded provider-boundary metadata. Lines use the form
`timestamp [LEVEL] [Service] [event]: details`, with high-contrast service and
event colors on interactive terminals. `NO_COLOR` disables ANSI colors, and
rotating files never contain ANSI sequences. The internal run correlation ID
is retained on records but omitted from human-readable lines.

Set `logging.level = "DEBUG"` when detailed API boundaries are needed. DEBUG
events record only safe operational metadata:
Salesforce service/method/route, HTTP status, and elapsed time, plus CALL-E
operation phase, Quote ID, idempotency key, call ID, provider status, and
elapsed time. Query strings, SOQL, headers, request bodies, prompts,
recipients, phone numbers, and raw provider results are not included unless
the opt-in setting below is enabled. The CALL-E `wait_for_result` event is one
aggregate wait boundary because the SDK performs polling internally; QuoteWake
does not emit one log event per poll.

For temporary support investigations, set `logging.raw_calle_api = true` while
keeping `logging.level = "DEBUG"`. The shipped demo configuration intentionally
does this so the CALL-E boundary is visible during a demonstration. QuoteWake
then emits clearly labelled
`call_e_raw_request` and `call_e_raw_response` events for CALL-E create and
wait operations. These payloads are recursively sanitized: recipient values
under `phone`/`phones` are intentionally preserved for support, while
phone-like values in free text and all credentials are redacted. HTTP
`Authorization`, API-key, and header fields are never logged. However, raw
support logs can preserve recipient phone values and structured business data;
protect `logs/quotewake.log`, do not enable this setting in production unless
specifically required, and turn it off afterwards. The code default remains
`false` even though the checked-in demo TOML enables it.
