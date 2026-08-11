# Safety notes

The Callback Coordinator places real outbound phone calls. Follow these
boundaries.

## Consent

- Only call numbers you own or are explicitly authorized to call.
- Only run live execution for a callback the recipient actually requested. The
  intake **must** contain `"consent": true` recording explicit consent, and
  `--execute` additionally requires the separate `--confirm-consent` flag so a
  live call is never made accidentally. Missing or false consent is rejected at
  parse time and gates as `consent_not_recorded`.
- Phone validation is E.164 with first digit 1-9 after `+` (e.g. `+12025550123`);
  numbers like `+0...` are rejected to avoid ambiguous/invalid E.164.
- The call script discloses that the caller is AI and ends immediately on a
  wrong-person response or opt-out. It never offers to book a specific callback
  time – the result schema cannot return a time.

## Quiet hours and do-not-call

- The engine refuses to call during the intake's `quiet_hours` window, evaluated
  in the **recipient's** timezone.
- `do_not_call: true` prevents any call.
- `consent: false` or missing also prevents any call (fail-closed).
- These gates apply to both preview (reported, not enforced against a real call)
  and execute (enforced before the SDK creates a call).

## Credentials – trusted origin only

- `CALLE_API_KEY` is a server credential. Keep it in a secret manager or an
  environment variable. Never put it in request files, task text, exported
  examples, or source control.
- `CALLE_BASE_URL` and `--base-url` are **locked** to the trusted official
  HTTPS origin `https://api.heycall-e.com`. Any other host, http scheme,
  userinfo, or non-443 port is rejected **before** the bearer token is used,
  preventing credential exfiltration to arbitrary URLs. The default is
  `https://api.heycall-e.com`.

## Personal data

- Do not put names, account numbers, health details, legal matters, payment
  data, credentials, or other sensitive information in the intake file or task.
- Phone numbers are masked in previews, and phone-like text is removed from
  returned evidence, including formatted forms:
  `(202) 555-0123`, `202-555-0123`, `202.555.0123`, `202 555 0123`,
  `+1 (202) 555-0123`, `+44 20 7123 4567`, etc., plus contiguous E.164.
  The output deliberately excludes transcripts and provider evidence that may
  contain personal data.

## Boundaries

This engine is a routing/triage component. It does not book, cancel, purchase,
promise, or modify any service, and it returns routing decisions to the caller
rather than acting on them. The workflow is not for medical, legal, financial,
emergency, collections, political, or unsolicited marketing calls.

## Cancellation

- Keep `--execute` off (preview) unless you intend a live call.
- After a create succeeds, stopping the process stops only the result lookup; it
  does not cancel the outbound call. The CALL-E API used here does not provide a
  call-cancel action, so cancellation is only available before call creation.
- Remove or rotate the API key and delete the app to stop future runs.
