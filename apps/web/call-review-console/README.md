# Call review console

Read how a phone call ended, and see which field said so.

CALL-E reports the end of a call through three entry points and they do not agree with each other. MCP has a status for `VOICEMAIL` and one for `BUSY`. Goal Runs has neither. The Calls API has a `failure_code` with no published enum, and the errors guide says not to branch on it. Same call, three vocabularies.

This reads a payload from any of the three and gives back three separate answers:

- endstate, how the call ended
- taskOutcome, whether the job got done
- resultState, whether usable data came back

They stay separate on purpose. A call can end perfectly and fail its task. A task can be met while the result comes back empty. Collapse them into one status and you lose the ability to say which of the three went wrong.

Every answer carries where it came from. `quoted` means the source said it outright. `derived` means it was worked out from other fields, and the note says how. `absent` means the source cannot express that fact at all, so the answer is `unknown` and stays that way.

`absent` is the one doing the work. A mapping that cannot say "this surface does not carry that fact" will invent the fact.

## It cannot place a call

Not a promise, a shape. There are two things the app can do with a CALL-E key: check that the key works, and read one call by id. The endpoint that dials a phone is not reachable from any route in here.

The key check reads a call id that cannot exist and treats the 404 as proof the key was accepted. Nothing is created.

## Three ways in

**Paste a payload.** No key, no account, nothing stored. This is the default path and it needs no credentials at all, so you can see the whole thing working before deciding whether to trust it with anything.

**Paste a key** and it fetches the call itself. The key travels in a header, is used for one request, and is written nowhere. No database, no cookie, no log line. It goes when you close the tab.

**Copy a webhook URL** into whatever already sends webhooks. Zapier, n8n, Make, or CALL-E. Nothing to install.

Everything arriving through the webhook door is marked unsigned. CALL-E webhooks carry no signature and no shared secret, which is [issue #91](https://github.com/CALLE-AI/call-e-integrations/issues/91), and it is not something a receiver can work around. Anybody who learns the URL can post something that looks identical to the real thing. So those events are treated as a claim about a call rather than a reading of one, and they all want a person, even the ones where all three answers are stated facts and they agree.

## Running it

```bash
npm install
npm test        # 56 tests, no network, no credentials
npm run dev
```

Open http://localhost:3000 and press one of the four samples. They are synthetic: each reproduces a payload shape that testing turned up, with every value written for the file.

Only the webhook door needs anything in the environment:

```bash
cp .env.example .env.local
```

`KV_REST_API_URL` and `KV_REST_API_TOKEN` from any Upstash Redis, or the `UPSTASH_REDIS_REST_` equivalents. Without them the webhook endpoint answers 503 and the page says there is nowhere to put events, rather than accepting them and dropping them quietly.

An inbox is one Redis list. Fifty events, expiring after a day. That expiry is the reason for the shape: nothing accumulates and there is no cleanup job to write and then forget to run. The inbox id is thirty two random hex characters and it is the only thing between an inbox and the internet, so treat the URL as a secret. Nothing else is stored anywhere. The review queue lives in your own browser.

## The shapes it handles

Each fixture reproduces a payload shape and every value in it is written for the file.

A call task can report the task complete while nothing establishes a person was ever on the line. A structured result can arrive on a call that never reached a conversation, matching the requested schema with the fields that would have held speech left empty. `failure_message` does not separate one failure from another, and the attempt-level `failure_code` that does is inference rather than a stated fact. A terminal status can arrive before the result is attached, so the same call read at two moments can come back with two different result states.

`docs/what-a-surface-can-tell-you.md` goes through each of those and what to do about it.

## What each surface can say

`/matrix` renders this, and it is computed by running the mappers on the request rather than written down. A mapping that loses an ending changes that page without anybody editing it.

```
ending            calls-api   goal-runs           mcp
answered_human    app         derived             yes
answered_machine  app         -> no_answer        yes
no_answer         derived     yes                 yes
busy              derived     -> provider_failed  yes
declined          no          yes                 yes
provider_failed   no          yes                 yes
canceled          yes         yes                 yes
expired           no          no                  yes
```

`app` means it only works if your own result schema declared the field. `derived` means inference, never a stated fact. `-> x` means the surface reports that ending as a different one.

The two rows worth sitting with are `no_answer` and `busy`. MCP states both. Goal Runs states one and calls the other a provider fault. The Calls API can reach both, but only through that nested attempt code. Pick the wrong surface and a busy line becomes an outage.

## What it does not do

The roadmap entry for this slot also mentions recordings and follow-up status. Neither is here. This is the part before both of those: working out what actually happened, and being honest about which parts of that are guesses.

Only `408` and `486` are read from the attempt code, because those are the only two that have been watched happen. The rest of the SIP numbering is not decoded from what the numbers look like they ought to mean. A code nobody has seen returns `unknown` and says so.

## Layout

```
src/app/         the console
src/lib/         the payload renderer, the browser queue, the webhook inbox
fixtures/        synthetic payloads, one per interesting case
test/            56 tests, no network, no credentials
```

The reading itself is not in here. It comes from [`asheard`](https://www.npmjs.com/package/asheard) on npm, MIT, no framework and no dependencies, published from CI with provenance so the tarball traces back to a public commit. Source at [cnpierrepapi/asheard](https://github.com/cnpierrepapi/asheard).

The tests in `test/` run against that package rather than a local copy, so they check the thing this app actually imports.

MIT.
