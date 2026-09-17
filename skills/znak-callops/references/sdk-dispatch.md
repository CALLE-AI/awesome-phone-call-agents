# Optional executable CALL-E SDK path

This is an alternative to the host's MCP tools. Do not dispatch through both paths
for the same inquiry. Source: [official SDK documentation](https://docs.heycall-e.com/sdks),
`calle-ai==0.7.0`. The implementation calls `CalleClient.calls.create` with `task`,
`recipients`, `metadata`, and `idempotency_key`, and reads status with `calls.get`.
It uses the fixed official origin `https://api.heycall-e.com`, disables redirects
and environment proxies, and performs no automatic POST retry.

## Preview: no credentials or SDK required

From the repository root:

```bash
python3 skills/znak-callops/scripts/dispatch.py --request skills/znak-callops/assets/synthetic_request.json
```

Expected `mode: PREVIEW_NO_NETWORK`, with no phone call, receipt, provider client,
or network connection. A preview does not grant live-call authorization.

## Optional live setup

Requires Python 3.11+:

```bash
python3 -m pip install -r skills/znak-callops/scripts/requirements-live.txt
```

Provide your own CALL-E key through a secure local environment setting named
`CALLE_API_KEY`. Do not paste a key into this repository, chat, demo, or command
history. Store a request JSON and receipts in a private directory outside the
repository. The request contains nonempty `task_id`, `service`, and
`requested_window`. Use one stable task ID per logical inquiry.

After the operator has authorized this particular information-only call and the
recipient has consented, replace the uppercase placeholders in this command:

```bash
python3 skills/znak-callops/scripts/dispatch.py --request PRIVATE_REQUEST_JSON --phone AUTHORIZED_E164 --region PL --locale pl-PL --live --recipient-consent --receipt NEW_PRIVATE_RECEIPT_JSON
```

Supply the actual known recipient region and language; `PL / pl-PL` is an example,
not a routing guess. The explicit `--live` switch authorizes one real call and may
consume credits. The consent flag is the operator's attestation. Before running,
read [safety.md](safety.md) and review the generated goal using `prepare-goal`.

The destination is masked on stdout. The private receipt is created exclusively
with POSIX mode `0600`; on Windows protect its directory with your account's ACL.
The receipt records dispatch intent before the POST, a stable payload-derived
idempotency key, and the exact returned call ID when available. Keep this receipt
after success, failure, or ambiguity. Reusing its path blocks another dispatch.
Do not change the task ID or delete/change the receipt to force a retry.
The receipt may contain provider-returned private data; never commit or publish it.

## Resume status reads

```bash
python3 skills/znak-callops/scripts/dispatch.py --read-receipt PRIVATE_RECEIPT_JSON
```

This performs one GET using the saved call ID, updates the private receipt with
the raw response, and prints only status and ID. A completed status is not field
evidence. Normalize original transcript turns as described in
[call-e.md](call-e.md), then use the local `validate-result` helper.

If dispatch is ambiguous and no call ID was returned, inspect the provider account
before considering another attempt; this adapter does not redial. There is no
cancellation or recurring scheduler in this adapter. Closing the terminal does not
cancel a submitted call. Live provider behavior and real conversation quality are
not verified by the included tests.

## Local test scope

```bash
python3 -m unittest discover -s skills/znak-callops/scripts -p 'test_*.py'
```

The dispatch tests inject a fake provider, use reserved fictional destinations,
and make no phone calls. An optional test imports the actual installed SDK and
uses an in-memory HTTP transport to check its POST path and request payload;
without the SDK this one test is skipped. They check preview isolation, missing consent, one POST,
receipt reuse, an ambiguous response, and status reads without redial. The separate
quote tests cover evidence checking. A passing test is not a live-call receipt.
