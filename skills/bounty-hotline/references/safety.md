# Safety

- The destination number is operator-owned config (`HOTLINE_PHONE`, E.164), never hardcoded; it is validated against `HOTLINE_REGION`'s country code and refuses unmapped region mappings unless explicitly overridden.
- Live dialing requires per-run operator confirmation (`--yes`); a one-time configuration never places calls on its own. `--dry-run` previews filter decisions without dialing.
- Consent is explicit: the skill calls the person who configured it, nobody else. Never call businesses, third parties, or numbers found in feed content.
- One call per bounty key, ever — and only after CALL-E confirms the call actually started (`run_id` returned). Refused or schema-drifted runs are logged as failures and retried later; `call_started: "unknown"` must not be retried with a new plan, it is finished through the documented `calle call recover` flow.
- Silence is the default: amount threshold, credibility grade (strict A/B), and known freshness must all pass, and every accept/reject decision is appended to the audit log (`hotline_log.jsonl`).
- Every run follows the documented plan → confirm-token → run flow through the official `calle` CLI; a non-zero CLI exit or refused run is a failure, never recorded as a placed call. Plan and confirmation tokens are never logged or committed.
- Report outcomes honestly: an unanswered or mis-routed call is a failure, not a success. Never fabricate transcript content or completion status.
- Keep call records out of version control: no run IDs, phone numbers, recordings, transcripts, or raw status payloads in commits, issues, or pull requests.
