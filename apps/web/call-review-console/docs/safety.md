# Safety notes

- Read-only by construction: no call creation code exists in this app. The only network calls are `GET /v1/calls/{id}` and `GET /v1/calls/{id}/events`, both opt-in.
- Phone numbers are masked in every rendered view and in the task text; raw snapshots are stored on disk under `CRC_DATA_DIR` for audit and should be treated as personal data.
- The webhook receiver accepts terminal events only and validates the payload shape; deploy it behind a signature-checking proxy or a secret path.
- The deterministic checks are conservative: a field that cannot be matched is reported as *unknown*, not as supported.
- The verdict is advice for a human disposition, which is recorded separately with reviewer and time.
