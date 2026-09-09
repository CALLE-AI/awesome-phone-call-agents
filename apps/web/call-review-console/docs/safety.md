# Safety notes

- Read-only by construction: no call creation code exists in this app. The only network calls are `GET /v1/calls/{id}` and `GET /v1/calls/{id}/events`, both opt-in.
- Phone numbers are masked in every rendered view and in the task text; raw snapshots are stored on disk under `CRC_DATA_DIR` for audit and should be treated as personal data.
- The webhook receiver accepts terminal events only and validates the payload shape; deploy it behind a signature-checking proxy or a secret path.
- The deterministic checks are conservative: a field that cannot be matched is reported as *unknown*, not as supported.
- The verdict is advice for a human disposition, which is recorded separately with reviewer and time.


## Access control and input handling

Added after a security review of `24ae0749` (thanks to @Ray-56 on
CALLE-AI/awesome-phone-call-agents#320), which found four issues. All four are
covered by regressions in `tests/test_security.py`.

**Every data route requires a token.** `CRC_CONSOLE_TOKEN` must be set and
presented as `X-CRC-Console` (or `Authorization: Bearer`). With no token
configured the routes return 503 rather than serving openly, so a deployment
cannot leak by omission. `/api/ping` is the only unauthenticated route and
reports nothing but liveness. This matters most for `POST /api/fetch`, which
spends the CALL-E API key on whatever id it is handed.

**Call ids are validated before they reach a path or the browser.** Ids are
opaque tokens matching `^[A-Za-z0-9._-]{1,128}$` and may not start with a dot.
Ids arrive from unsigned webhook deliveries and from the URL, and previously
went straight into a filename, so `../` in an id wrote outside the data
directory. Validation happens at the route and again in `store`, and every
write additionally resolves and checks that it stays inside the data directory.

**The API key only goes to an allow-listed https origin.** `CALLE_BASE_URL` is
checked against `CALLE_ALLOWED_HOSTS` (default `api.heycall-e.com`) before any
bearer credential is attached, so a tampered or mistyped base URL cannot
exfiltrate the key, and plaintext http is refused.

**Masking is deep, and the front end escapes quotes.** Phone-shaped runs are
masked everywhere in the structure, including transcript turns and the
structured result, not only in `recipients` and `task`. The front-end escaper
previously covered `& < >` but not quotes, while ids were interpolated into
single-quoted JS strings inside `onclick` attributes, so an id such as
`x',alert(1),'` executed. Ids now travel in `data-` attributes read by one
delegated listener, no handler is built by string interpolation, and the
escaper covers `& < > " ' \``.
