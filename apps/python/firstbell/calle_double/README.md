# calle_double

A CALL-E that dials nobody, written from the published API and checked against recorded
production responses.

It exists because the platform ships no sandbox, no dry-run flag and no test key. That was
verified by searching the OpenAPI specification, both SDKs, every guide and this
repository, and it is why the default run of
[`apps/python/firstbell`](../) needs no account and costs nothing.

If you are building on CALL-E, this is the part of that entry you can take.

## Two ways to mount it

Inside the process, on the SDK's own transport. The client under test is the shipped
`calle.CalleClient`, not a stand-in for it, so nothing about your call path changes:

```python
from calle_double import CalleDouble, build_transport
from calle_double.transport import BASE_URL

double = CalleDouble()
client = CalleClient(api_key="iams_test_anything", base_url=BASE_URL,
                     http_client=httpx.Client(transport=build_transport(double)))
```

As a real HTTP server, for anything that cannot be mounted in process: a client in another
language, a `curl` by hand, or an integration test that runs your application as a
subprocess.

```bash
python -m calle_double.server --port 8787
export CALLE_BASE_URL=http://127.0.0.1:8787
export CALLE_API_KEY=iams_test_anything
```

It listens on loopback and refuses any other interface unless you pass
`--i-know-this-is-open`. That is not a key check. It authorises any non-empty bearer token,
deliberately, because a double that demanded a real key would defeat the point of having
one, so the interface it listens on is the only thing keeping it private.

## What it answers

`POST /v1/calls`, `GET /v1/calls/{id}`, `GET /v1/calls`, `GET /v1/calls/{id}/events` and
`GET /v1/goals`. Idempotency keys, cursor pagination, regional number validation,
per-recipient attempt ledgers, structured-result schemas and the platform's own error codes
and status codes.

There is no cancel route, because production has none. A `POST` to
`/v1/calls/{id}/cancel` gets a 404 with `not_found`, which is what the real API gives you,
and it matters: the engine can cancel a call internally and refusing to expose that over
the wire is what stops a client being written against a brake that does not exist. Once a
call is accepted it runs to completion, and a concurrency cap is the only control you have.

Outcomes are yours to set. Answered, no answer, voicemail, a schema-valid result whose
every field says `unknown`, a platform failure whose accounts of itself disagree, a
timeout, a replay of a call already placed. That last group is the reason this is worth
having: those are the responses you cannot ask production for.

## Why you should believe it

`evidence/api-shape.json` records every key path and JSON type returned by the real API
across 11 recorded production responses, and the same for the double, and compares them.
Paths and type names only: no transcript text, no phone number, no provider call id and no
field value of any kind, so the record is publishable.

```bash
python tools/double_conformance.py --check
```

That reads the committed record and confirms the double still emits every path production
returned. It exits 0 on a clean checkout with nothing installed beyond the requirements,
because it compares against the record rather than against the recordings. Without
`--check` it re-derives the record from the call recordings, which are deliberately not
committed, and exits 3 saying it could not measure rather than reporting a pass.

`missing_in_double` is currently empty. It is a list rather than a boolean so that a future
edit narrowing the double names what it dropped.

## What is not true about it

- **It is not a simulator of a conversation.** It returns the shapes an API returns. What a
  parent actually says is not in here and cannot be.
- **The `goals` resource is a stub.** `GET /v1/goals` answers with an empty list so a
  client that enumerates goals does not crash. The conformance record does not cover it,
  because no recorded production response for it exists in this tree.
- **Webhook delivery is implemented and never triggered by the server.**
  `deliver_webhooks` POSTs to a URL taken from a request body, which is a server-side
  request forgery primitive, and nothing in the server calls it. If you wire it up, do not
  do so on a non-loopback bind.
- **It was written from the documentation, then corrected by real calls.** Two of its
  behaviours were wrong until twelve calls were placed against production: the extracted
  result sits at the task level and the per-recipient field is null, and a call already
  placed under the same idempotency key comes back as a replay. Both are in it now. Assume
  there are others nobody has hit yet.

## Tests

`tests/test_calle_double.py` and `tests/test_double_guards.py` in the parent app, run by
`python -m pytest`. The second one exists because a guard sweep found eleven guards inside
this package that no test noticed being deleted.
