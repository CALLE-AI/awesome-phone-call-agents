# Harvest Relay

**A cold room has failed. Which storage-and-transport handoff can still take the whole harvest?**

Harvest Relay checks cold-storage and refrigerated-transport answers together: capacity, requested temperature range, pickup time, receiving hours, deadline, quote freshness, and total cost. It explains every rejected pair and exports a proposal with its source facts for a coordinator to review.

[Interactive rehearsal](https://lvoliverrrr.github.io/harvest-relay/) · [Source](https://github.com/lvoliverrrr/harvest-relay) · [Design and limits](DESIGN.md)

For this repository copy, run the app commands from `apps/web/harvest-relay/`. The standalone source and hosted rehearsal are linked above.

The public app is a **synthetic, no-call rehearsal**. Its people, businesses, quantities, prices, conversations, and outcome are fictional. The repository also contains a callable Node adapter for the documented CALL-E REST API, plus an operator-reviewed result importer that feeds the same solver through the CLI. **No completed real phone call is claimed in this version.** Imported provider evidence stays separate from the browser's fictional scenario.

## Try the complete rehearsal

Use Node.js 20.6 or newer; Node 22 or newer is recommended. There are no package dependencies and no build step.

```bash
git clone https://github.com/lvoliverrrr/harvest-relay.git
cd harvest-relay
npm start
```

Open **http://127.0.0.1:8766**. No CALL-E account or credentials are needed.

1. Select **Run rehearsal** to replay five scripted conversations and evaluate all six transport/storage pairings.
2. Inspect Orchard's answer: the directory says 17:00, but its receiving team leaves at 14:00. Swift's 14:25 arrival misses that cutoff.
3. Review the surviving 900 kg proposal: **Swift Reefer → Riverside Fresh Hub, $310, 14:25 handoff, 35 minutes before the 15:00 deadline**.
4. Change the load to **650 kg**. The local van now fits the full lot; the best proposal becomes **Local Co-op Van → Orchard, $190, 13:45**.
5. Restore 900 kg and change the deadline to **14:00**, or mark Riverside unavailable. The app returns **no compatible handoff** and explains why.
6. Review the source facts, tick the acknowledgment, and download the JSON proposal. Changing the brief clears the acknowledgment.

The export includes the effective lot, overrides, all evaluated pairs, selected pair, simulated source conversations, and review/export timestamps. It explicitly records `provenance: synthetic-rehearsal`, `calls_placed: 0`, and `bookings_made: 0`.

For the same solver without a browser:

```bash
npm run demo
```

## Why this problem

A spare cold room is useful only if a suitable vehicle can reach it before receiving closes. A cheap quote or a successful phone conversation does not establish that the complete handoff works.

The [2022 UNEP and FAO report, *Sustainable Food Cold Chains*](https://www.unep.org/resources/report/sustainable-food-cold-chains-opportunities-challenges-and-way-forward) identifies inadequate refrigeration as a major contributor to food loss; it cites a loss equivalent to 12% of total food production in **2017**. That is context for the problem, not an estimate of this project's impact. Harvest Relay has no measured waste reduction, customers, operational deployments, or field trials to report.

This prototype tests a narrower idea: make independently collected operational answers composable and inspectable before a person commits to a handoff.

## What is implemented

| Surface | Behavior | Evidence boundary |
| --- | --- | --- |
| Public/static browser | Replays fixtures, recomputes constraints, shows every pair, exports reviewed JSON | All conversations and provider facts are synthetic |
| Pure solver | Exhaustively evaluates storage × carrier pairs, with no split loads | Checks supplied facts; does not verify a real facility, journey, or food condition |
| Local request preview | Builds the actual adapter request and per-recipient result schema | No network request and no phone call |
| CALL-E CLI | Read-only connection check, explicit call creation, status and event reads | API transport is implemented; tests use injected fake transport |
| Runtime records | Durable operation reservation, accepted CallTask ID, status/event snapshots | Private local records; not public evidence of a completed call |
| Reviewed result ingestion | Validates completed CallTask JSON, strips fixture quotes, retains source records, then evaluates the reviewed scenario | Local JSON imports are not independently authenticated; the browser remains synthetic |

The browser's **Check local adapter** button checks the local server and asks it to generate a request preview. It does **not** authenticate with CALL-E or place a call. The static hosted version explains how to start the local companion.

## CALL-E integration

The adapter in [`src/calle.mjs`](src/calle.mjs) uses Node's built-in `fetch` against `https://api.heycall-e.com`. It follows the [official Calls API](https://docs.heycall-e.com/calls); no unofficial telephony service or browser credential is used.

| CLI command | Provider operation | Places a call? |
| --- | --- | --- |
| `demo` | None | No |
| `preview` | None; locally constructs a request | No |
| `check` | `GET /v1/goals?limit=1` | No |
| `call … --confirm` | `POST /v1/calls` | Yes, if accepted |
| `status` | `GET /v1/calls/{id}` | No |
| `events` | `GET /v1/calls/{id}/events` | No |
| `ingest … --reviewed` | None; validates and saves an operator-reviewed result | No |
| `solve --scenario …` | None; reconstructs reviewed facts and runs the shared evaluator | No |

### Preview without credentials

This example uses a reserved fictional phone number and must remain a preview:

```bash
node src/cli.mjs preview \
  --type storage --provider orchard \
  --phone +12025550123 --region US --locale en-US
```

Use `--type carrier --provider swift` for the transport template. Other fixture provider IDs are `riverside`, `hillcrest`, and `local`. Preview and call also accept `--scenario runtime/context.json` for explicit operator-supplied context. CLI display output masks E.164 phone numbers; private requests and snapshots retain the exact destination. The displayed preview is redacted and should not be reused as a provider request. Keep private snapshots out of recordings and repository files.

### Configure a private local environment

```bash
cp .env.example .env
```

Edit `.env` locally. Set `CALLE_API_KEY` to the complete CALL-E API key and `CALLE_ALLOWED_PHONES` to the exact E.164 destination or comma-separated destinations authorized for a test. Credentials stay outside browser files. The project does not load `.env` automatically; use Node's `--env-file` flag:

```bash
node --env-file=.env src/cli.mjs check
```

This checks API access and saves a read-only snapshot. It does not verify available calling credit, language support, or a successful telephone connection. Check the [official supported regions and languages](https://github.com/CALLE-AI/call-e-integrations#supported-regions-and-languages) before choosing a destination. Optional `--region` and `--locale` are hints, not proof of carrier support.

### One explicitly authorized role-play call

Set the shell variable `HARVEST_TEST_PHONE` to an owned or consenting participant's complete E.164 number already present in `CALLE_ALLOWED_PHONES`. Use a new, non-sensitive operation ID for the single intended call:

```bash
node --env-file=.env src/cli.mjs call \
  --type storage --provider orchard \
  --phone "$HARVEST_TEST_PHONE" \
  --operation-id storage-pilot-001 --confirm
```

This is the only CLI command that creates a call. It requires an API key, the exact allowlisted destination, and `--confirm`. The bundled scenario causes the prompt to disclose that the lot and provider labels are fictional and ask the recipient to role-play. The agent asks for willingness to continue and stops on refusal. No storage, transport, or payment is authorized.

The actual request carries a `recipient_result_schema`. It asks for availability, capacity, temperature bounds, price, quote expiry, service date, timezone, evidence, and either receiving hours or pickup/route times. Only `availability` and `evidence` are required; unconfirmed numbers must be omitted, not replaced with zero. A provider result of `unknown`, missing fields, or `null` is not a successful handoff.

Metadata identifies `app`, `scenario_id`, `provider_type`, `provider_id`, `source_provenance`, and `booking_authorized: false`. The template asks for a spoken read-back of critical facts; the current adapter does not independently verify that read-back against transcript spans.

### Read and reconcile the original operation

```bash
node --env-file=.env src/cli.mjs status --operation-id storage-pilot-001
node --env-file=.env src/cli.mjs status --id CALL_TASK_ID
node --env-file=.env src/cli.mjs events --id CALL_TASK_ID --limit 50
node --env-file=.env src/cli.mjs events --id CALL_TASK_ID --limit 50 --cursor NEXT_CURSOR
```

Replace `CALL_TASK_ID` with the ID returned by call creation, not a dashboard provider-call ID. `status` and `events` each perform one read; there is no background polling or recurring scheduler. Event pages beyond the returned page require the supplied cursor.

Before a create request, the adapter exclusively reserves the operation in `runtime/` and persists the reviewed request and idempotency key. After acceptance, it stores the CallTask ID. Reusing an operation ID is refused. A timeout or interrupted response can mean acceptance is unknown; reconcile the original reservation and provider state instead of creating a replacement operation. This prevents local duplicate submissions for the same operation, not every possible duplicate at a telephony provider.

Runtime files use private file permissions and are ignored by Git. They can contain phone numbers, requests, transcripts, and provider responses. CLI display output masks E.164 numbers, but other conversation content can still be private. Publish only deliberately reviewed, redacted evidence.

### Import reviewed responses and solve the handoff

The CLI closes the loop from provider results to the shared evaluator. Begin with an operator-created `runtime/context.json` containing an explicit `service_date` (`YYYY-MM-DD`), IANA `timezone`, same-day `now_min`, complete lot facts, and storage/carrier identity lists matching the original request. The importer does not infer dates or fill in missing lot requirements. Use this same context with `preview` and `call` when collecting the responses.

`--file` takes the **raw completed CallTask JSON**, such as the file written under `runtime/snapshots/` by `status`. It does not take the CLI's outer console wrapper. After checking the original recipient transcript and every extracted fact, import each provider into a new private snapshot:

```bash
node src/cli.mjs ingest \
  --file runtime/storage-call.json --type storage --provider riverside \
  --scenario runtime/context.json --output runtime/reviewed-1.json --reviewed

node src/cli.mjs ingest \
  --file runtime/carrier-call.json --type carrier --provider swift \
  --scenario runtime/reviewed-1.json --output runtime/reviewed-2.json --reviewed

node src/cli.mjs solve --scenario runtime/reviewed-2.json
```

These commands need no API key and make no network request. The importer requires a completed task and recipient, original attempt evidence and metadata identifying the selected provider, schema-valid facts, and explicitly matching service date/timezone. An affirmative quote needs all critical numeric fields plus a completed attempt with a recipient transcript. Unknown or declined availability remains ineligible; missing routes stay unknown.

The first import removes all inherited fixture quotes. Unimported providers remain unknown. Each later import and `solve` reconstructs reviewed facts from retained original `source_call` JSON, so edited derived prices cannot silently replace source values. The shared evaluator still rejects stale quotes, capacity/temperature mismatches, late handoffs, and excessive cost.

TEST or synthetic-source payloads keep a test/rehearsal label and cannot be mixed with operator-supplied evidence. Other imports are labeled **operator-reviewed JSON**, not authenticated-live evidence: local import cannot independently establish a file's server origin. `--reviewed` asserts human review of the transcript and applicability to the stated lot; it is not automatic semantic verification. Outputs must be new `.json` files inside `runtime/` and cannot overwrite earlier snapshots. All service times must remain within one local day.

### Side effects and cancellation

This workflow gathers storage and transport facts only. It does not provide medical or legal advice, authorize financial transactions, assess food safety, or dispatch emergency services.

The local web server binds to `127.0.0.1:8766` by default and has no HTTP call-creation endpoint. Starting the app, replaying fixtures, previewing a request, or downloading a proposal does not dial anyone.

An accepted CLI `call` can ring the authorized destination and consume provider credit. The project provides no booking action, payment action, call-cancellation command, or provider cancellation endpoint. Stopping Node does not cancel an accepted remote call. No recurring job is created; unknown or interrupted operations are left for reconciliation rather than automatically redialed.

## Verification

```bash
npm test
npm run check
npm run demo
```

The Node test suite covers the six-pair scenario, changed loads/deadlines, unknown values, quote validity, full-load capacity, temperature containment, receiving-time waits, inclusive cutoffs, cent-accurate budgets, deterministic tie-breaking, input immutability, API request shape, credential handling, durable reservations, duplicate calls, timeouts, status/events reads, and the local HTTP boundary. Import tests cover a full storage → carrier → solve CLI flow, context/metadata checks, removal of fixture facts, source reconstruction, private outputs, and separation of test evidence. The API tests inject fake transport and place no real calls. Syntax checks do not claim full browser accessibility or real carrier performance.

See [DESIGN.md](DESIGN.md) for the data model, solver contract, and remaining integration work.

## Credits and license

Created by **Oliver**, China Agricultural University, with AI-assisted research, implementation, and testing. This is an independent student project, not an institutional service or endorsement.

Original contribution code and bundled fictional fixtures are under the [MIT license](LICENSE). References used for protocol understanding and scope comparison:

- [CALL-E Calls documentation](https://docs.heycall-e.com/calls) and [official integrations](https://github.com/CALLE-AI/call-e-integrations).
- [Awesome Phone Call Agents](https://github.com/CALLE-AI/awesome-phone-call-agents), including the documented scope of [FreshChain Resolver](https://github.com/CALLE-AI/awesome-phone-call-agents/tree/main/apps/python/freshchain-resolver), [SurplusSignal](https://github.com/CALLE-AI/awesome-phone-call-agents/tree/main/apps/typescript/surplus-signal), and [Surplus Switchboard](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/368). They informed differentiation; their application source is not included in this project.
- UNEP and FAO, 2022, *Sustainable Food Cold Chains: Opportunities, Challenges and the Way Forward*, [DOI: 10.4060/cc0923en](https://doi.org/10.4060/cc0923en).
- The page requests [DM Sans](https://github.com/google/fonts/tree/main/ofl/dmsans) and [Instrument Serif](https://github.com/google/fonts/tree/main/ofl/instrumentserif) through Google Fonts. These external fonts retain their own licenses; local fallback fonts keep the rehearsal usable if the font service is unavailable.
