# Claim adapter contract

§6.2 of the locked architecture: **the built artifact is an adapter contract plus
fixture/in-memory implementations — not a DMS/ERP connector.** The code lives in
`warrantyops/claim_adapter.py` (pinned by `tests/test_claim_adapter.py`); this
document is the contract, the planned integration sequence, and the cookbook a
real deployment would follow. No connector, partner, or production deployment
exists in this repository.

```text
Claim Adapter Contract — fixtures built now; DMS integration planned
in: claim_id, source_version, supplied money/policy, missing requirement,
    structured exhaustion manifest, recipient authorization class
out: terminal packet, review decision, provider receipt,
     idempotent note/status payload, audit reference
```

## The input side — `ClaimSnapshot`

| Contract says in | The built type carries |
| --- | --- |
| `claim_id`, `source_version` | `SourceClaim.source_claim_id`, `SourceClaim.source_version` |
| supplied money/policy | the validated envelope fields (face value, currency, policy id, documented code) |
| missing requirement | the residual-necessity manifest the RESIDUAL_NECESSITY gate re-checks |
| structured exhaustion manifest | the same: no call happens unless the manifest survives the gate |
| recipient authorization class | `ClaimSnapshot.authorization_class`, one of the four `AuthorizationBasis` values |

An adapter cannot smuggle in an unvalidated claim: the snapshot's `SourceClaim`
has already passed `validate_source_claim`, and an authorization class outside
the four-value vocabulary is a named refusal
(`AUTHORIZATION_CLASS_UNKNOWN:…`), never an invented consent basis.

## The output side — `Delivery`

Exactly the five contract artifacts: `terminal_packet`, `review_decision`,
`provider_receipt` (canonical JSON of the public receipt), `note_payload` (the
idempotent note, or `None` when the write was refused or withheld), and
`audit_reference`. A `Delivery` can be assembled **only** by
`build_delivery`, which accepts kernel outputs and has no parameter for a
provider, ledger, store, client, or config — a deployment cannot write back
through any path the kernel did not run.

## DMS/ERP sequence diagram — **planned**

The diagram below is a *plan* for a future integration. It is not a built
connector, it names no product, and nothing in this repository executes it.
Everything on the kernel side of the line is built and tested; the left column
is what a real system of record would one day supply.

```text
   System of record                Adapter                    Kernel
   (DMS/ERP — planned)       (contract — built)          (gates — built)
────────────────────────────────────────────────────────────────────────
    │                          │                            │
    │ 1. claim record + version│                            │
    │─────────────────────────>│ ClaimSnapshot (validated)  │
    │                          │──────> 2. seven gates: ENVELOPE,
    │                          │         RESIDUAL_NECESSITY, SOURCE_STATE,
    │ <── current_version ─────│         ECONOMICS, AUTHORIZATION,
    │    (re-read pre-dial)    │         DISCLOSURE, ATTEMPT_LEDGER
    │                          │──────> 3. one governed call
    │                          │         (provider seam; fake by default)
    │                          │<────── 4. review packet
    │                          │         (human decision required)
    │ <── current_version ─────│──────> 5. write_back:
    │    (re-read pre-mutation)│         source re-read, note identity
    │ <── idempotent note ─────│<────── 6. Delivery: the five artifacts
    │                          │         (recorded, never constructed)
```

Both version re-reads are the same seam, `current_version(platform, claim_id)`.
The pre-dial read feeds the SOURCE_STATE gate; the pre-mutation read happens
inside `write_back` and is the one that decides. Nothing between them is
cached.

## Integration cookbook

A real adapter implements the `ClaimAdapter` protocol — `load_claim`,
`current_version`, `deliver` — and inherits every rule below. None of them is
advisory; each has a named refusal behind it.

**Idempotency rules**

1. The call's idempotency key is derived, never generated: a digest of the
   namespace, the authorization record reference, the source platform, the
   claim id, **the source version**, the contract version and the recheck
   token. Same claim version, same key — a moved version is a new question.
2. The key and a fingerprint of the exact request are reserved **atomically
   before the provider is touched**. An existing reservation — whatever its
   state — places no call: same body is `DUPLICATE_CALL_SUPPRESSED`, a
   different body is `IDEMPOTENCY_CONFLICT`. Both are human decisions, never
   automatic retries.
3. The note id is a digest of the platform, claim id, source version,
   idempotency key and note content — minus the clock, so an honest re-write
   of the same reviewed result replays idempotently while any content change
   produces a new identity.
4. Two *different* approvals landing on one note identity is
   `REVIEW_CONFLICT`, not a confirmation.

**Source-version rules**

1. A version reader is mandatory. Supplying none refuses
   `SOURCE_RECHECK_UNAVAILABLE` — the run would rather stop than dial a
   stale envelope.
2. The current version is re-read before dialing (SOURCE_STATE gate) and
   again immediately before the mutation, inside `write_back`. Only the
   second read decides the write.
3. A moved version refuses `SOURCE_CHANGED` and **never re-dials
   automatically**. The new version is a new claim version: new key, new
   authorization check, new call.

**Delivery rules**

1. `deliver` receives a `Delivery` and records it; it never constructs one.
2. The note payload handed to the system of record is bounded: stated
   fields, contract version, evidence pointer. Never the transcript, never a
   secret, never an adjudication.
3. An adapter that cannot accept the delivery fails loudly and keeps the
   kernel's artifacts — losing a write is recoverable, inventing one is not.

**What an integrator must not do** — construct a provider call outside the
kernel, dial around the attempt ledger, write without a review bound to the
packet's id *and* body hash, or treat the vendor's idempotency replay as the
primary duplicate control (local suppression is; the vendor's guarantee is
unverified).

## The host surfaces (§6.3)

Three surfaces sit on this contract: the **CLI** (deterministic scenarios,
FakeCalle review, receipts, `make judge`), the **Skill**
(`skills/warranty-recovery/`), and the **MCP surface**
(`warrantyops/mcp_surface.py`) — three tools only: `assess_claim`,
`request_authorized_inquiry`, `review_and_write_back`. Defaults are
read-only/fake; the surface constructs no provider but the fake and exposes
no provider parameter of its own. An MCP host binds it over stdio JSONL
(`serve_stdio`) with no SDK dependency. **No Skill or MCP tool can bypass
the kernel** — there is no code path from either surface to a live call.

## Not built

A DMS/ERP integration is **planned, not built**.
No DMS/ERP connector exists here. There is no connector logo, no partner
claim, no production deployment claim, and no suggested built integration.
When a real adapter is written, it plugs into the boundary above and changes
no kernel rule.
