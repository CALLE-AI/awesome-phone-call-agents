# Scope and side effects

ZNAK CallOps is a service availability and price inquiry. Its local Python helper
only reads JSON and writes results to stdout. It has no network or booking path.
The live Agent Skills host or explicitly enabled SDK adapter can place one real
phone call through CALL-E and may consume provider credits. Installing the skill
or running its demo or adapter preview does not call. Read `sdk-dispatch.md` for
the adapter's opt-in flags and private receipt handling.

Before live dispatch, resolve purpose-specific user intent, the recipient's
authorization to receive this call, and a known E.164 destination. A local
operator's explicit attestation is sufficient; no uploaded consent file is needed.
Never infer authorization from a number appearing in an email or fixture. Never
use bundled fictional numbers as live defaults. Mask real numbers in summaries,
screenshots, and logs; send the actual destination only to the authorized provider.

The call brief must disclose that this is an AI assistant making an inquiry and
ask whether the recipient can continue. Stop politely on refusal. Ask for the
availability window, full quoted price with currency and qualifiers, and any
unresolved follow-up. Do not reserve, accept, negotiate, pay, cancel, or share
additional personal details. If the recipient requires a commitment, end the
inquiry and return it to the user. These are instructions to the host and provider,
not a proven enforcement layer inside the voice model.

Keep OAuth credentials and confirmation tokens in the host's credential system.
Never paste them into requests, repository files, examples, or videos. Store actual
transcripts only in the user's private task workspace with the intended retention
and access controls; this repository contains synthetic data only. Quotes may
contain personal data: do not publish a live evidence packet automatically.

No recurring schedules or automatic redials are created. For an interrupted call,
resume reads using the saved run ID. If dispatch might have succeeded but no run ID
was returned, stop for operator reconciliation; do not create another plan or call.
There is no documented general cancel tool in this MCP surface. Before dispatch,
abandoning the plan prevents this host from calling; after dispatch, closing the
client does not prove cancellation and a phone call cannot be undone.

Do not use this skill for emergency response or clinical, legal, or financial
advice. An ordinary service quote is informational; it grants no authority to spend
money or make a consequential decision. If an urgent or high-stakes request arises,
return it to an appropriate human without making advice or dispatch promises.
