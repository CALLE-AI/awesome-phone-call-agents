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


## Second review pass (head 5f7e2ed)

**The webhook fails closed.** `CRC_WEBHOOK_TOKEN` is now required rather than
optional: with none configured the receiver answers 503 and stores nothing,
instead of accepting caller payloads from anyone who finds the URL. CALL-E
deliveries are unsigned, so the token is the only thing separating a real
delivery from a stranger.

**Redaction happens before persistence, not at render.** `store.save()` runs
every snapshot through `crc.sanitize` first, so phone numbers, card-shaped runs
and government-id-shaped runs never reach the disk, the structured result, or
anything the evidence pass derives from them. The compliance signal survives the
redaction: findings are computed *before* the digits are removed and recorded on
`metadata.pii`, so "the agent read a card number back" is still reported without
keeping the number. Redaction is idempotent, and a second pass merges rather
than overwrites those findings.

**The offline demo still works.** Making console auth mandatory would have left
the documented fixture quickstart returning 503, which the review rightly
flagged. When `CRC_CONSOLE_TOKEN` is unset the server now generates one per
process and prints it at startup — the model Jupyter uses. The console is never
anonymous and never ships a fixed default, and `uvicorn crc.app:app` still works
with no configuration at all.


## Third pass (head 26e75cb): contact details in every written form

The first sanitizer matched `\+\d{7,15}`, which is E.164 and nothing else. A
transcript says `+1 555 010 0123`, `(555) 010-0123` or `555.010.0777`, and an
email is a contact identifier too; none of those were caught.

Candidates are now found loosely -- any run of digits and separators -- and
classified by counting the digits in them: 7-15 is a phone and is masked,
13-19 is card-shaped and becomes `[redacted-card]`, `nnn-nn-nnnn` becomes
`[redacted-gov-id]`, and addresses become `[redacted-email]`.

The trap in doing that is that `2026-09-04T15:03:06Z` is also eight digits with
separators, and these snapshots are full of timestamps. Redacting them would
corrupt every `created_at` and break the timing analysis that the whole review
depends on. Datetimes, dates, clock times and decimals are therefore protected
before redaction runs and restored afterwards. A dotted phone number is not
mistaken for a decimal: a decimal may not touch another dot or digit on either
side, so `12.5` survives and `555.010.0123` does not.

`tests/test_security.py` covers seven written phone forms, emails, cards and
government ids, and asserts that six timestamp and time forms survive.
