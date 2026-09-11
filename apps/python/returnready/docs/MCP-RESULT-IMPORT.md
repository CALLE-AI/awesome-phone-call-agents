# Finished MCP result import

This is an offline adapter for an operator whose connected host has already completed an authorized CALL-E workflow. It does not fetch from a provider, place calls or validate the separate REST transport.

In Inspect the data, paste the finished object, supply the expected run ID and original observation timestamp, and explicitly review permission. Ready plans, wrong runs, multiple attempts, unsupported transcript formats and inconsistent receipts are rejected. Unknown permission, an explicit provider error, a blocked next step or a recognized refusal creates a hold without transcript or extracted return claims. No retry is requested.

A permitted import supports timestamped [HH:MM:SS] BOT/USER: text turns. Return fields are not inferred. Optional annotations need exact quotes and zero-based turn indices. Caller text cannot become recipient evidence. Reopening checks receipt consistency and recomputes freshness; it does not renew approval.

```sh
python mcp_import.py --input finished-mcp.json --policy policy.json --expected-run-id EXPECTED_RUN_ID --observed-at ORIGINAL_ISO_TIME --consent unknown --consent-basis "Permission has not been established." --output review-session.json
```

The CLI refuses to overwrite an output. Never commit operational inputs, transcripts, recordings, call metadata or generated artifacts. All repository scenarios, dates, durations and identifiers are invented for tests. Processing and publication permission are separate; the importer cannot control an active call or remove provider-side storage. An editable local receipt is not cryptographic provider authentication.
