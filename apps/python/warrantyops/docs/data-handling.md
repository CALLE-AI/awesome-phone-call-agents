# Data handling: what is stored, where, for how long, and what is public

The boundary this package enforces is simple enough to state in one line:
**the repository holds synthetic data only; everything real lives outside
it, mode 0600, and expires.**

## Storage classes

| Class | Location | Mode | Content |
|---|---|---|---|
| Public code and docs | this repository | version control | Synthetic scenario data only: fictional claim W-1042, the reserved 555-01xx fictional numbers, `call_synthetic_*` ids |
| Attempt ledger | operator-chosen path, must be outside the repository | SQLite file | Idempotency key, request fingerprint, state (`RESERVED`/`COMPLETED`/`UNKNOWN`), timestamps, vendor call id — **no** phone number, claim identity, task text, transcript or organization (pinned by `test_no_sensitive_field_ever_reaches_the_durable_ledger`) |
| Private runtime receipts | `WARRANTYOPS_ARTIFACT_DIR`, outside the repository | directory 0700, files 0600, atomic writes | The sanitized receipt: masked recipient, masked call id, states, deduplicated requirements, grounded quote evidence. No API key, no full recipient, no full call id, no agent turns (pinned by `test_the_receipt_filename_and_body_carry_no_secrets`, `test_the_receipt_file_mode_is_0600`) |
| Public receipts / proof screen | this repository | version control | Sanitized and evidence-labelled; never transcripts |

The in-repo machine check for the first row is
`tests/test_repo_hygiene.py` (reserved fictional numbers only, no
credential-shaped strings, every call id labelled synthetic); the
whole-repository and git-history sweep runs owner-side outside the
repository, because a check that ships in the thing it checks is not much
of a check.

## Retention and deletion

- **TTL:** private receipts carry a 90-day retention floor
  (`DEFAULT_RETENTION_DAYS`). Nothing runs on a timer — the operator runs
  `python -m warrantyops --purge-artifacts` from `docs/runbook.md` §4, with
  `--retention-days` to override.
- **What purge deletes:** only the two files this package can write (the
  receipt and its orphaned atomic-write temporary), only past the retention
  window. An operator's other material in the directory is never touched
  (`test_purge_deletes_only_expired_owned_files_and_never_the_ledger`).
- **What purge never touches:** the attempt ledger. Deletion removes private
  evidence; it never rewrites history — a purged run's reservation still
  suppresses redials, and historical claims stay exactly as recorded.
- **Recipient deletion requests** follow `docs/runbook.md` §2: stop, audit,
  disclose, delete the private artifacts involved.

## Public boundary

Nothing that leaves this repository may contain:

- the API key or any credential-shaped value (hygiene test, planted-key
  patterns);
- an unmasked recipient number (receipts mask; every printed surface masks);
- an unmasked vendor call id (`mask_call_id`);
- a transcript (receipts carry grounded quote spans only — the evidence,
  never the conversation);
- agent-side turns (our own words are never evidence).

Every public field carries exactly one evidence class — **Recorded CALL-E
result**, **Synthetic scenario**, or **Fictional case data** — one marker
per rendered instance, so a reader always knows which kind of fact they are
looking at.

## The loopback review surface

`python -m warrantyops --serve-review` writes one file during a session and
deletes it when the server stops:

| Item | Location | Lifetime | Content |
|---|---|---|---|
| Jailed transcript | a 0700 temp directory, file mode 0600 | the lifetime of the server process | The call transcript, served only behind `/transcript/{review_id}` on loopback, only for the id registered with it; a traversal-shaped id is a 404 |
| Decision journal | in memory only | the lifetime of the server process | Principal, timestamp, packet hash, decision, write-back — hash-chained; the chain head appears in the decision receipt |

Neither item is ever written into the repository. The page the operator
reads is rendered in memory from the same deterministic renderer as the
static proof page, and the transcript link is local-only: the service never
binds a non-loopback host, emits no CORS header, and answers no method
beyond GET and POST.

## Webhook position

There is no webhook ingestion. Outcomes are read (`calls.get`), never
accepted from a push; see `SECURITY.md` (webhook spoofing row).
