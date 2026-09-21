---
name: calle-developer
description: Build or debug application integrations with the CALL-E Developer API and TypeScript or Python SDKs, including call payloads, structured results, recovery and webhooks. Use for application code, not for operating calls through the calle CLI.
---

# CALL-E developer integration

Help the developer finish their application using the current official contract
and existing examples. Keep their language and framework; use direct HTTP when
there is no suitable SDK. This skill adds no API or documentation MCP service.

## Choose the integration and sources

For a new integration, read the [quickstart](https://docs.heycall-e.com/quickstart.md)
and the relevant part of the [SDK guide](https://docs.heycall-e.com/sdks.md).
Distinguish request-scoped [Calls](https://docs.heycall-e.com/calls.md) from running
a published [Goal](https://docs.heycall-e.com/goal-runs.md); do not mix their inputs
or identifiers. Use the [documentation index](https://docs.heycall-e.com/llms.txt)
to find additional topics, not to load the entire site.

Before writing or reviewing a request, inspect the relevant operation in the
[OpenAPI contract](https://docs.heycall-e.com/openapi/calle.openapi.yaml).
For SDK code, also inspect the installed package version and its public types or
source: [TypeScript](https://github.com/CALLE-AI/server-sdk-typescript) or
[Python](https://github.com/CALLE-AI/server-sdk-python). HTTP fields and SDK
arguments are not interchangeable. For payload reviews, inspect the SDK's
request-building code, including compatibility aliases and which arguments
become headers rather than JSON fields; a README alone does not establish that
mapping. The Calls idempotency key belongs in the `Idempotency-Key` header over
HTTP. Cite the source used and record the package
version when reporting verification. If sources are unavailable or conflict,
identify the specific unverified behavior rather than inventing fields.

Read [references/examples.md](references/examples.md) to choose an existing
starting point. Reuse it before creating another client, receiver or schema copy.
Read [references/safety.md](references/safety.md) before implementing or running
any live path.

## Build the requested flow

- Keep credentials on the backend. Start with a preview or offline check; a code
  request is not authorization to place calls. Preserve the user's existing
  scoped authorization when live testing is requested.
- Check recipient inputs and both result-schema fields against the chosen
  contract. Use supported schema features and represent uncertain answers.
  Check the [supported regions](https://docs.heycall-e.com/regions.md) before
  choosing destinations, regions or locales.
- Save the business intent, complete request and stable idempotency key before
  submission, then save the returned Call ID. When resuming, fetch that ID;
  do not create a replacement just because waiting failed. For a lost create
  response, follow the current [recovery and error guide](https://docs.heycall-e.com/errors.md)
  with the saved request/key and stop automatic redial while acceptance is unknown.
- Distinguish transport errors, API rejection, terminal call status and the
  business outcome. A completed call is not proof of a booking or other requested
  result. Validate the returned structured result; preserve null or unknown for
  review. Apply business-state changes once, including after a process restart.
- For webhooks, read the [current delivery and verification guide](https://docs.heycall-e.com/webhooks.md).
  Current event-ID matching is a consistency check, not sender authentication;
  do not invent a signing secret or signature header. Verify sensitive results
  through an authenticated API read and bind them to the saved call, workflow
  and recipient. Keep event receipts separate from completion of the business
  update so an acknowledged event does not hide unfinished work.

## Verify the result

Run the checks relevant to the code actually changed: request serialization,
schema/result handling, repeated delivery and recovery as applicable. Use the
host's existing tools and tests; this skill requires no particular test framework.
When authorized to validate the real-service flow, record the runtime/package
version, steps and observed outcome. Keep simulated branches and untested paths
distinct from live results. Do not call a generated integration verified merely
because it compiles or its mocked request passes.

Return the changed code or concrete integration guidance, source links, checks
performed and any remaining limitation. Keep raw credentials and private call
data out of the answer.
