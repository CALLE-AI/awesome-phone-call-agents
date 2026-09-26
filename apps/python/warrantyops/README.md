# warrantyops

**A legitimate submitted warranty claim is rejected, returned, unpaid or
stalled, and the portal and documented-code route have not produced an
actionable reason or next step. `warrantyops` places one authorized, disclosed
CALL-E call, obtains the counterparty-stated reason and next action, and
writes nothing back until a human approves it against an unchanged source
record.**

The interesting part is not the call. It is the set of refusals in front of
it (this case is not residual; the source already answers; the economics are
not the organization's to call about), the binding of every asserted value to
transcript evidence, and the gates behind it: a reference only survives its
own read-back exchange, and a write-back only happens on a version re-read
immediately before the mutation.

WarrantyOps does not adjudicate, resubmit, appeal, negotiate, settle, ship,
pay or accept credit. It asks one bounded question set and reports what was
said.

---

## The failure this is built around

An extraction model hears *"case four eight one seven one"* and returns
`CASE-48171` with high confidence. It heard `48178`. The result is
schema-valid, confidently scored, and false, and the first time anyone finds
out is when a correction is filed against somebody else's case.

Confidence cannot catch that, because confidence measures how sure the model
is about what it heard, not whether what it heard is what was meant. The only
thing that catches it is asking:

```text
Representative  "Your case reference is four eight one seven one."
Agent           "Just to confirm, that is case four-eight-one-seven-one, correct?"
Representative  "No, that last digit is an eight. Four eight one seven eight, that is correct."
```

So `confirmed_reference` is not populated by extraction. It is populated by
a state machine that requires a read-back, an affirmative and unhedged
answer, and that answer to bind to **the matching transcript exchange** — the
bounded representative utterance containing the candidate reference, plus the
agent's exact read-back, plus the representative's subsequent explicit
confirmation or correction. An affirmative sentence from elsewhere in the
call confirms nothing, and a result field or summary alone never confirms a
reference.

The same strictness applies to every stated value: an enum needs an evidence
quote found in a counterparty turn, free text must appear in a counterparty
turn verbatim enough to be found by containment, and anything that fails is
dropped with a named downgrade rather than reported.

## What it does

```text
source-claim envelope (validated snapshot at an immutable source_version)
  │
  ├─ residual necessity   refuses: ordinary routes not exhausted, or the
  │                       source already states the next step
  ├─ source version       refuses: the live record moved since the snapshot
  ├─ economics            refuses: the organization's own policy does not
  │                       pay for this call (supplied facts only, never an
  │                       estimate)
  ├─ authorization        refuses: no basis, wrong purpose, expired, not
  │                       allowlisted, not strict E.164
  │
  ├─ claim-version-bound idempotency key
  ├─ task built only from the disclosure allowlist, with AI disclosure
  ├─ attempt ledger: the key and a request fingerprint reserved atomically
  │   before the provider — an existing reservation in any state suppresses
  │   the call locally (`DUPLICATE_CALL_SUPPRESSED`, `IDEMPOTENCY_CONFLICT`,
  │   `ATTEMPT_LEDGER_UNAVAILABLE`)
  ├─ one CALL-E call through the provider seam (fake by default)
  │
  ├─ strict result contract, validated locally as well as server-side
  ├─ transport state kept separate from business outcome
  ├─ evidence binding: every asserted field traces to a counterparty turn
  ├─ reference confirmation bound to its own read-back exchange
  │
  ├─ human review packet (nothing mutates without an approved decision
  │   bound to the packet's review_id)
  │
  └─ write-back: source version re-read immediately before the mutation
      → receipt (semantically idempotent) or SOURCE_CHANGED / NOT_REVIEWED /
        NO_BUSINESS_RESULT
```

Each stage can refuse, and nothing later rescues an earlier refusal.

## Install and run

No dependencies are needed for the default path.

```bash
cd apps/python/warrantyops
python3 -m warrantyops --list
python3 -m warrantyops --scenario case_a_useful_resolution
python3 -m warrantyops --scenario case_a_useful_resolution --approve
```

That replays a synthetic scenario from `fixtures/` and places no calls.
Synthetic source state is created in memory from the fixture on every run —
there is no pre-seeded database anywhere. Without `--approve` the run stops
at the review packet and the write-back is withheld; `--approve` stands in
for the human decision in a local demo. Each invocation uses an in-memory
attempt ledger (the CLI only constructs the fake provider); pass
`--ledger-db /path/outside/the/repo.sqlite` to point the durable SQLite
ledger at an explicit user-state path, and a second invocation of the same
scenario is suppressed by the file instead of replaying.

The six scenarios:

| Scenario | What it proves |
| --- | --- |
| `case_a_useful_resolution` | a full residual call: stated status, reason, documents, deadline and a reference confirmed through its read-back exchange, then a receipt |
| `case_b_source_sufficient` | the source record already states the next step: refusal before the provider is ever invoked |
| `case_c_missing_documents` | the desk cannot state a status: `UNKNOWN` stays unknown, the requested documents are the actionable result |
| `case_d_corrected_reference` | a misheard reference caught by the read-back: only the corrected, confirmed value survives |
| `case_e_no_result` | a failed call: transport state and business state stay separate, nothing is written |
| `case_f_source_changed` | the source record moves before write-back: `SOURCE_CHANGED`, and no second call |

Run the tests:

```bash
python3 -m pip install pytest
python3 -m pytest
```

The quality gates are also collected in a Makefile. `make check` runs the
suite, the repository validator and the byte-identical proof-screen check;
`make judge` adds every scenario through the CLI, `git diff --check` and the
owner's hygiene audit (supplied by path, since it lives outside this
repository):

```bash
cd apps/python/warrantyops
make check PYTHON=/path/to/python3.9
make judge PYTHON=/path/to/python3.9 HYGIENE_AUDIT=/path/to/repo_hygiene_audit.py
```

## Judge-facing proof screen

One static, self-contained page makes the W-1042 before/after outcome
readable in twenty seconds, offline, with no credential and no way to
trigger a call:

```bash
cd apps/python/warrantyops
python3 -m warrantyops --proof-screen   # prints the path (deterministic regeneration)
# open proof/w1042-proof.html in any browser — plain file:// open, no server
```

The page is rendered from the checked-in sanitized fixture
`proof/w1042-proof.json` by `warrantyops/proof_screen.py`; regenerating is
byte-identical and pinned by tests. It shows the source claim (Maya /
NorthStar Equipment, W-1042, $800, BlueRock Machinery — labelled a
fictional demonstration case), the deterministic controls, CALL-E's runtime
responsibility with the exact masked call id `call_dMU…A-3Q` and the
consenting-role-player limitation beside it, the grounded outcome
(installation photograph; reference BR-4821 evidenced by the verbatim
counterparty quote "Br Hyphen, 4821."; claim status honestly UNKNOWN with
its trust note), and the human boundary with
`WRITE_BACK_WITHHELD_PENDING_HUMAN_REVIEW`. The single control — "Reveal
recorded result" — reveals the saved, sanitized runtime result locally and
never starts a live call; the page contains no fetch, no XHR and no
external resource, and links the checked-in public receipt
`proof/runtime-proof-receipt.public.json` relatively for offline reading.

## Adversarial evidence page

The page titled **"We tried to make it lie."** shows eighteen attacks on the
kernel — invented statuses, quotes from other calls, ambiguous confirmations,
stale envelopes, duplicate dials, fullwidth-digit numbers, prompt injection,
disclosure fishing — and for each one, what a confident extractor would have
written versus what WarrantyOps actually wrote. Every cell in the last two
columns is produced by *executing the real kernel* against synthetic input at
page-build time; nothing on the page is asserted from prose.

```bash
cd apps/python/warrantyops
python3 -m warrantyops --adversarial-page     # writes proof/adversarial.html
python3 -m warrantyops --verify-adversarial   # byte-identity + sha256, exit 0/1
# open proof/adversarial.html — offline, static, every row labelled Synthetic scenario
```

The renderer is deterministic (no clock, no randomness, no environment
reads), so `--verify-adversarial` is a real regression check in both `make
check` and `make judge`, the same discipline as the proof screen.

## Local review surface (loopback only)

After a synthetic scenario, the operator can read the same page the renderer
produces for the proof screen and decide on it in a browser:

```bash
cd apps/python/warrantyops
python3 -m warrantyops --serve-review case_a_useful_resolution
# prints http://127.0.0.1:<port>/review/<id> — Ctrl-C to stop
```

The service binds loopback only (any other host is refused at bind time),
serves the three decisions — Approve / Refuse / Return to digital — behind a
CSRF double-submit cookie plus a same-origin check, keeps the private
transcript jailed to a 0600 temp file behind a local-only link, appends every
decision to a hash-chained in-memory journal, and emits no CORS header.
Approve goes through the kernel's own write-back with its source re-read and
idempotent note; replaying the same approval yields the same note id and a
replayed flag. Zero real calls are possible from this surface: the provider
is the fixture-replaying fake.

## Evidence table, surface map, and why the phone

Three documents carry the public evidence story, and tests keep them honest:

- `docs/evidence-table.md` — every executed row with exactly one evidence
  class, one runnable command and one expected result; never-executed rows
  (R3–R9 recorded, R1b) appear only as named limitations. The statuses are
  mirrored from the machine-readable registry in `warrantyops/cassettes.py`,
  and the recorded-provider-cassette program behind them — deterministic
  scrubber, planted-leak export gate, cassette replay through the real
  adapter contract, FakeCalle divergence harness — is pinned by
  `tests/test_cassette_program.py`.
- `docs/platform-surface-map.md` — the CALL-E surface actually used (Calls
  API runtime, conditional probe-gated Goal path, webhook-hint/GET-truth,
  bounded supplied keypad, typed errors) with its vocabularies pinned to
  implementation constants by `tests/test_platform_surface_map.py`.
- `docs/why-the-phone.md` — verbatim public job-description and claim-policy
  quotes with source and date, the plain "not found in public sources"
  statement where no quoteable source exists, and the exhaustion-to-phone
  sequence. No market-size, frequency, productivity or recovered-money
  claim appears in it, and a test enforces that.

## Adapter contract, host surfaces, independent run

- `docs/adapter-contract.md` — the §6.2 boundary: what a system of record
  must supply in and receives out (the five named artifacts), the DMS/ERP
  sequence diagram labelled **planned**, and the integration cookbook's
  idempotency and source-version rules. Pinned against the code — Delivery
  fields, refusal vocabularies, the three MCP tool names — by
  `tests/test_phase6_docs.py`. No connector or partner is claimed.
- `warrantyops/claim_adapter.py` — the contract's in-memory and JSON-fixture
  implementations, plus `build_delivery`, which accepts only kernel outputs
  (`tests/test_claim_adapter.py`).
- `warrantyops/mcp_surface.py` — the §6.3 MCP surface: three tools only
  (assess claim, request authorized inquiry, review and write back),
  read-only/fake defaults, stdio JSONL binding, no SDK dependency, no path
  to a live provider (`tests/test_mcp_surface.py`).
- `proof/independent-run.md` — the fresh-clone reproduction procedure, the
  author-side artifact digests, and the honest statement that no third
  party has run it. The empty third-party record is part of the design.

## Judge-clean setup

From a fresh checkout, the entire setup is:

```bash
cd apps/python/warrantyops
python3 -m pytest              # needs pytest, nothing else
python3 -m warrantyops --list  # needs nothing at all
python3 -m warrantyops --scenario case_a_useful_resolution
```

There are no private files, no pre-seeded developer database and no hidden
setup: every input the workflow uses is a fixture in this directory, and
every number is from the reserved fictional 555-0100–0199 block. Fixture
call ids are `call_synthetic_*`; the runtime-proof pathway uses two
deterministic synthetic ids, `call_runtime_proof_synthetic_nonexistent_0000`
(zero-dial probe) and `call_runtime_proof_synthetic_000000111111` (tests);
and the checked-in
proof screen and public receipt display the one masked real call id
`call_dMU…A-3Q` — prefix and suffix only — as runtime evidence of the
recorded proof call. Source state is created in memory per run and never
persisted. Zero real calls are placed by anything in this repository: the
default provider cannot dial, and the live pathway requires environment
gates no checkout provides.

## The gates in front of a call

| Gate | Refusal |
| --- | --- |
| Envelope is a complete, well-formed snapshot | named `EnvelopeRefusal` codes |
| Portal + documented-code (+ written follow-up) routes attempted | `ORDINARY_ROUTE_NOT_EXHAUSTED`, with the missing routes listed |
| Source does **not** already state the next step | `SOURCE_ALREADY_ANSWERS` |
| Live source version still matches the snapshot | `SOURCE_CHANGED` |
| Organization's economic policy covers the claim | `POLICY_NOT_FOUND`, `CLAIM_VALUE_UNKNOWN`, `CURRENCY_MISMATCH`, `BELOW_MINIMUM_VALUE`, `CLAIM_TOO_OLD` |
| Authorization record valid for this number and purpose | the named authorization refusal |
| Recipient is strict E.164 and allowlisted | `INVALID_E164`, `RECIPIENT_NOT_ALLOWLISTED` |
| Authorized recipient is the claim's counterparty number | `AUTHORIZED_RECIPIENT_MISMATCH` |
| Attempt ledger supplied, openable, and the key not yet reserved | `ATTEMPT_LEDGER_UNAVAILABLE`, `DUPLICATE_CALL_SUPPRESSED`, `IDEMPOTENCY_CONFLICT`, `LEDGER_NOT_DURABLE` |

The economic gate is a comparison of supplied facts against a supplied
organization policy (`EconomicPolicy`). No value, probability or ROI is ever
estimated, and a test pins the gate's signature so no estimation input can be
added silently. An unknown face value is a refusal unless the organization's
policy explicitly tolerates it — the organization decides what an
unknown-value claim is worth, not the software.

The disclosure allowlist is the same idea applied to what the call may say:
the task is built from `build_disclosure()` output only, so face value,
policy, remedy logs and authorization references have no route into the
conversation.

## Review and write-back

The review packet carries the terminal states, the strict business result,
the evidence quotes, the identifier decision and a masked recipient. A
write-back requires a `ReviewDecision` that is approved, names a reviewer,
carries a timezone-aware timestamp and is bound to the packet's `review_id`;
anything else is `NOT_REVIEWED`.

Immediately before the mutation the source version is re-read. An earlier
check passing is irrelevant; if the live version differs from the snapshot
the call was placed against, the result is `SOURCE_CHANGED` and nothing is
written. A call with no business result (`TRANSPORT_FAILED`,
`RESULT_UNAVAILABLE`, `BUSINESS_UNRESOLVED`) writes nothing.

The written note is bounded: the stated fields, the contract version and an
evidence pointer. Never the transcript, never a secret. Receipts are
semantically idempotent: the note id is a digest of the claim, the source
version, the idempotency key and the note content, so re-writing the same
reviewed result is the same write even when the timestamps differ.

## Dry run is the default, and live is not a flag

There is no `--live` switch, because a flag is the wrong place for a decision
that dials a stranger. The command line can only construct the fake provider.
A live run is assembled in code and every one of these must hold:

| Gate | Refusal |
| --- | --- |
| `CALLE_LIVE_CALLS_ENABLED=1` | `LIVE_NOT_ENABLED` |
| `CALLE_API_KEY` present | `MISSING_API_KEY` |
| `CALLE_BASE_URL` is the official CALL-E origin | `UNOFFICIAL_ORIGIN` |
| `WARRANTYOPS_ARTIFACT_DIR` set, and outside this repository | `ARTIFACT_DIR_MISSING`, `ARTIFACT_DIR_INSIDE_REPOSITORY` |
| A live authorization record for that number and purpose | the named authorization refusal |

Real transcripts and real call identifiers are not repository content, and a
`.gitignore` entry cannot guarantee that, so the directory they are written
to has to be somewhere the repository does not reach.

Live calling needs the CALL-E SDK, which is an optional extra pinned to the
version the adapter was verified against in source:

```bash
python3 -m pip install ".[live]"        # calle-ai==0.7.0
```

**The SDK requires Python 3.11 or newer** (`calle-ai` 0.7.0 declares
`requires-python >=3.11`). The pure core of this application stays
compatible with Python 3.9 because the adapter imports the SDK lazily, only
at call time — so run the test suite anywhere, but assemble a live run on
3.11+:

```bash
python3.11 -m venv /path/outside/this/repo/warrantyops-live-venv
/path/outside/this/repo/warrantyops-live-venv/bin/python -m pip install "calle-ai==0.7.0"
```

The adapter (`warrantyops/providers/calle_client.py`) is written against
the installed SDK's own source, not prose: `CalleClient` is used as a
context manager with an explicit HTTP timeout; the key is read only from
`CALLE_API_KEY` and never appears in an error, diagnostic or log line;
`calls.create` and `calls.get` return plain dicts; the vendor call id is
extracted from the creation response, **persisted to the attempt ledger
immediately after creation and before the first status read** (a crash
in between leaves the correlation next to the durable reservation), and a
missing or malformed id fails clearly. Waiting is a bounded poll of the
verified `calls.get` — never the SDK's `wait_for_result`, which sleeps on
the real clock — with a configurable wall-clock deadline and injectable
clock/sleeper. A deadline, a failed status read or an unrecognized status
returns a non-terminal transport, which the workflow records as an
`UNKNOWN` attempt requiring human reconciliation. There is no retry of
`calls.create` anywhere, and no cancellation is attempted because CALL-E
documents none.

### The real-call path (Runtime Proof) — completed once; do not repeat it

The mandatory Runtime Proof Test uses **real CALL-E**. It has been executed
exactly once, as a controlled call to a consenting role-player with a
synthetic business record: transport `completed`, business result
`INFORMATION_OBTAINED`, `claim_status: UNKNOWN`, reference BR-4821 grounded
by the verbatim counterparty quote "Br Hyphen, 4821.", ledger `COMPLETED`,
write-back withheld pending human review, masked correlation id as recorded
in the public receipt. The checked-in evidence is
`proof/runtime-proof-receipt.public.json` and the proof screen below; the
private artifacts stay outside this repository. Recovery later re-read that
same call (`--recover-runtime-result`) and created zero additional calls.
This proves controlled runtime integration, not warranty-desk adoption, and
it is not permission for a second call. Re-running the procedure below
places a new call and needs fresh authorization and a new reason:

1. The product owner requests the CALL-E call allocation and places the API
   key only in the private environment (mode 600, outside this repository).
   Never paste credentials into chat, issues or public files.
2. Choose a destination the product owner owns, or a participant who
   explicitly consented to role-play the warranty desk. Never a real
   warranty desk until the conditional Field Acceptance Test has a
   legitimate partner, authority and a permitted number.
3. Use a synthetic business record (any fixture envelope). Record the
   authorization basis (`OWNED_NUMBER` or `TEST_RECIPIENT_CONSENT`), the
   purpose and the validity window before dialling.
4. Assemble `CalleCallProvider` in code with a `RuntimeConfig` that passes
   `live_call_refusals()` — live enabled, key present, official origin,
   artifact directory outside the repository — and a passing
   `authorize_call()` decision. Any missing gate raises instead of dialling.
5. Place exactly one call. Keep the transcript, raw response and the full
   call identifier in the private artifact directory. Public evidence may
   show only a masked call-id prefix/suffix.
6. Pass criteria: the call reached `completed`; the structured result
   validated locally; every asserted field grounded; any reference confirmed
   only through its read-back exchange; review and write-back behaved as
   depicted; the demo labels the counterparty as a consenting role-player
   and the data as synthetic.

The optional judge verification path is the same procedure from a fresh
checkout with a clean CALL-E account: run the synthetic suite above, then —
only with the product owner present and the allocation confirmed — execute
the Runtime Proof steps under the judge's observation. A fixture-only or
mocked-provider trace is never presented as a real CALL-E invocation.

## Runtime proof commands (controlled, three separate invocations)

Status: these commands produced the single recorded proof run described
above. `--recover-runtime-result` re-reads that existing call and never
dials; `--execute-live-call` would place a **new** call and must not be run
again without fresh authorization.

The live runtime proof is a CLI pathway with three commands of increasing
consequence. None of them accepts the API key as an argument: it is read
only from `CALLE_API_KEY` (presence checked, value never printed), and the
consenting recipient only from `WARRANTYOPS_TEST_RECIPIENT_E164` (displayed
masked only). The durable ledger path must be explicit and outside this
repository. Run these from the Python 3.11+ live environment. The
`/path/outside/this/repo/...` segments in the examples are placeholders — any
location outside this repository works, on any operating system.

**1. Local preflight — zero network, zero calls, no reservation:**

```bash
cd apps/python/warrantyops
/path/outside/this/repo/warrantyops-live-venv/bin/python -m warrantyops --preflight \
  --ledger-db /path/outside/this/repo/warrantyops-runtime-attempts.sqlite \
  --confirm-consenting-recipient --confirm-phrase W1042-RUNTIME-PROOF
```

Checks Python 3.11+, SDK importability, both environment variables (key
presence only; recipient valid strict E.164), the live config gates, the
canonical W-1042 envelope, residual and economic gates, the
recipient-bound authorization, the consent confirmation, the ledger path,
and that no reservation for the derived key exists yet — inspected, never
reserved; only execution reserves.

**2. Zero-dial authentication probe — one `calls.get`, never `calls.create`:**

```bash
/path/outside/this/repo/warrantyops-live-venv/bin/python -m warrantyops --probe-auth
```

Reads one known-nonexistent synthetic call id; an authenticated 404 is the
success signal. Authentication, connection and unexpected-response errors
are reported as named refusals with no key material.

**3. One live runtime call — refuses before creation on any missing piece:**

```bash
/path/outside/this/repo/warrantyops-live-venv/bin/python -m warrantyops --execute-live-call \
  --ledger-db /path/outside/this/repo/warrantyops-runtime-attempts.sqlite \
  --confirm-consenting-recipient \
  --confirm-phrase W1042-RUNTIME-PROOF
```

Requires all of: `--execute-live-call`, `--confirm-consenting-recipient`,
`--confirm-phrase` exactly `W1042-RUNTIME-PROOF`, an explicit durable
`--ledger-db` outside the repository, valid private environment variables,
Python 3.11+ and the live provider. The run builds the canonical synthetic
envelope (Maya at NorthStar Equipment, fictional claim W-1042, $800,
returned with no reason), binds authorization to the private recipient,
passes every deterministic gate, reserves the ledger atomically, creates at
most one CALL-E call, persists the call id before polling, polls with a
wall-clock deadline, validates the structured result locally, prints the
review packet id — and withholds write-back. The receipt shows the masked
recipient, masked call id, transport state, business outcome, the extracted
missing requirement, the extracted reference, grounded evidence quotes and
the ledger state, ending `WRITE-BACK WITHHELD PENDING HUMAN REVIEW`. No
recipient, task, transcript or organization value is stored in the durable
ledger.

### Role-play script for the consenting recipient (BlueRock Machinery)

Everything in the call is fictional. The consenting recipient should:

1. Answer the telephone.
2. Listen for the AI disclosure ("You are an AI assistant calling for
   NorthStar Equipment").
3. Confirm the fictional claim W-1042 is on screen ("I have it here").
4. Say that an **installation photograph is required** to rework the claim.
5. State the reference **BR-4821** clearly, and confirm it when read back.
6. Give no real personal or business information — no real names, numbers,
   accounts or addresses.
7. End the call.

Expected receipt if this script is ever re-run under fresh authorization:
`claim_status` as actually stated, missing requirement naming the
installation photograph, and a case reference normalized from BR-4821. The
recorded run of this script returned `claim_status: UNKNOWN` — the
role-player stated the requirement and the reference but never stated a
status in words that could ground one — which is why the recorded receipt
honestly carries `UNKNOWN` with terminal state `INFORMATION_OBTAINED`.

## Durable sanitized receipt and existing-call recovery

Both execution and recovery atomically write one sanitized receipt to
`$WARRANTYOPS_ARTIFACT_DIR/runtime-proof-receipt.json` — written through a
dot-prefixed temporary in the same directory and `os.replace`d into place,
final mode `0600`. The filename and body carry no phone number, call id,
API key or complete transcript: the recipient and call id are masked, the
reference appears with both a display form (e.g. `BR-4821`, when
reconstructable) and its normalized comparison form (`BR4821`), and the
body ends `WRITE_BACK_WITHHELD_PENDING_HUMAN_REVIEW`. A receipt that cannot
be written after a call completed is reported as an explicit
`evidence_persistence: FAILED` — call creation is never retried.

Reference evidence is grounded deterministically and conservatively. A
`DIRECT_COUNTERPARTY_QUOTE` requires the candidate's complete digit
sequence inside one counterparty utterance — digit fragments separated by
sentence punctuation ("44. 821.") stay fragments and never merge — and
every letter of the candidate must itself have been spoken, by a
counterparty utterance or by the bot read-back of that reference's own
exchange; characters are never inferred from the extracted candidate. When
direct grounding fails, a bot read-back that deterministically contains the
complete reference, followed immediately by an unambiguous counterparty
confirmation, is classified `CONFIRMED_BY_READBACK` with both turns
preserved — a bare `"Yes."` is never displayed alone. When neither method
grounds the complete reference it is retained only as an unconfirmed
candidate needing human review, and the authoritative write-back note
cannot contain it. Equivalent missing-requirement phrasings ("requires an
installation photograph" / "installation photograph") are collapsed to one
concise display entry while every supporting evidence quote is kept.

**Recovery re-reads the call that already happened** — one
`client.calls.get` against the call id the durable ledger stored, never
`calls.create`, never a second dial, and the ledger reservation is left
untouched:

```bash
cd apps/python/warrantyops
/path/outside/this/repo/warrantyops-live-venv/bin/python -m warrantyops --recover-runtime-result \
  --ledger-db /path/outside/this/repo/warrantyops-runtime-attempts.sqlite
```

It refuses (`NO_CALL_ID_TO_RECOVER`) when the reservation holds no stored
call id, re-validates the existing structured result against the local
schema, re-derives the grounded outcome from the stored transcript, and
rewrites the corrected sanitized receipt.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `CALLE_API_KEY` | unset | Server-side only. Never written to a repository file. |
| `CALLE_BASE_URL` | `https://api.heycall-e.com` | Refused unless it is an official CALL-E origin. |
| `CALLE_LIVE_CALLS_ENABLED` | unset | `1` opts in to live calling. Anything else is a dry run. |
| `CALLE_IDEMPOTENCY_NAMESPACE` | `warrantyops` | Prefix on derived keys. |
| `WARRANTYOPS_ARTIFACT_DIR` | unset | Where a live run may write. Must be outside this repository. |

## Side effects, duplicates and cancellation

One call per authorized claim version. No recurring schedule, no batches, no
retry ladder, no second leg, no discovery of numbers the workflow was not
given.

Duplicate-call suppression is **local and primary**: immediately before the
provider is invoked, the claim-version-bound idempotency key and a
fingerprint of the exact request are reserved atomically in an attempt
ledger (`warrantyops/ledger.py`). Only a reservation this run created may
reach the provider. An existing reservation in any state — `RESERVED`,
`COMPLETED`, `UNKNOWN` — suppresses the call with
`DUPLICATE_CALL_SUPPRESSED` (same fingerprint) or `IDEMPOTENCY_CONFLICT`
(different body). An unavailable ledger fails closed with
`ATTEMPT_LEDGER_UNAVAILABLE`: no reservation, no call. The ledger stores
only the key, the fingerprint, a state, timestamps and — once creation
succeeds — the vendor's call id for reconciliation. Never a phone number,
transcript, claim text or credential.

The ledger is durable SQLite at an explicit user-state path (refused inside
this repository); the in-memory ledger is allowed only next to the fake
provider, which cannot dial anything. A provider that can reach a real
network refuses to run without a durable ledger (`LEDGER_NOT_DURABLE`).

An attempt whose outcome could not be determined — the provider raised, or
returned before a terminal state — is marked `UNKNOWN` and **never retried
automatically**. Whether that call happened is reconciled by a human against
the vendor's records; a new attempt needs a new source version and therefore
a new key. A crash after reservation leaves the committed row behind, which
is exactly what suppresses the retry.

The deterministic idempotency key is still derived from the authorization
record, the source claim, the source version and the contract version, and
still sent to CALL-E on the one permitted request. That is **verified
defence in depth**: the official Calls API documentation (checked
2026-09-04) and the SDK's `calls.create` source confirm that reusing the
same key with the same request returns the original call instead of
creating a duplicate. The same-key-with-different-body behaviour is *not*
stated on the current documentation page, so it remains UNKNOWN; the local
ledger — which suppresses both cases by fingerprint comparison — stays the
primary control, and nothing here depends on the vendor behaviour.

The CALL-E documentation states the Calls API exposes no operation to cancel
a call once created, so the cancellation story is entirely in front of it:
the gates refuse before anything is sent. Afterwards there is nothing to
withdraw.

## Phone numbers

Every number in this directory comes from the reserved fictional 555-0100 to
555-0199 block. Every number in output is masked. `tests/test_repo_hygiene.py`
fails the suite if either stops being true.

## Tests, and what they do and do not prove

The former scaffold carried 80 tests against the pre-decision coverage/RMA
hero. That suite is gone with its contract and proves nothing about this
one. The current suite covers, per module:

- `test_identifiers.py` — the read-back confirmation state machine and its
  attacks, carried over unchanged from the scaffold because the machinery is
  identical;
- `test_envelope.py`, `test_pre_call.py` — the snapshot contract, residual
  necessity, organization-owned economics (with the no-estimation signature
  pin), the disclosure allowlist and the version re-read;
- `test_outcome.py` — transport/business separation, grounding and downgrade
  behaviour, the three distinguishable not-established states;
- `test_review_writeback.py` — the review gate, semantic idempotency,
  `SOURCE_CHANGED` on the immediate re-read;
- `test_attempt_ledger.py` — local duplicate suppression: one shared ledger
  gives exactly one provider interaction, a SQLite restart still suppresses,
  conflicts and uncertain attempts are named refusals, nothing sensitive is
  stored;
- `test_calle_adapter.py` — the live adapter against mocked SDK 0.7.0
  shapes: creation/persistence ordering, bounded polling, terminal and
  uncertain outcomes, safe diagnostics, single creation, lifecycle;
- `test_workflow_guards.py` — the workflow honours the mandatory gates:
  missing version reader, destination mismatch, one interaction per run;
- `test_scenarios.py` — the six fixtures end to end, zero calls, and the CLI
  surface;
- `test_dry_run.py`, `test_repo_hygiene.py` — zero-network proof, live-call
  gates and repository hygiene.

Everything here runs against hand-written synthetic transcripts and a fake
provider, and the suite itself places zero calls. Real runtime behaviour is
established by the single controlled Runtime Proof call recorded above and
its public receipt — not by these tests.

## Layout

```text
warrantyops/
├── envelope.py       the source-claim snapshot and its named refusals
├── gates.py          residual necessity, economics, version re-read
├── disclosure.py     the allowlist a call task may speak from
├── contract.py       the v1 extraction schema and the asserted result
├── evidence.py       transcript grounding for stated values
├── identifiers.py    ABSENT / UNCONFIRMED / CONFIRMED, bound to the exchange
├── outcome.py        transport state and business state, kept apart
├── validation.py     the documented JSON Schema subset, re-checked locally
├── authorization.py  who may be called, for what, until when
├── idempotency.py    claim-version-bound keys, not attempt keys
├── ledger.py         the local attempt ledger: primary duplicate-call control
├── config.py         dry run by default; the gates a live call must pass
├── source.py         the version-read seam (synthetic in-memory store)
├── review.py         the human review packet and the bound decision
├── writeback.py      deterministic idempotent write-back, SOURCE_CHANGED
├── workflow.py       the order the stages run in
├── cli.py            scenario replay; review withheld without --approve
└── providers/        fake (default) and CALL-E
```

`PHASE0_HANDOFF.md` in this directory is the historical record of the
pre-decision scaffold; its domain contract (coverage/RMA/resolution) is
superseded by the v1 contract here. The portable skill and the reasoning
behind each control live in `skills/warranty-recovery/`.
