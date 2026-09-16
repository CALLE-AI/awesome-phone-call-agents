# MISE — Don't let "we'll try" become "done"

> **CALL-E places the call. MISE decides when the call is enough.**

A supplier says "we'll try." Most automation treats that as progress.
MISE doesn't.

MISE is a phone-work recovery system for failed deliveries. When a critical
delivery fails, MISE calls the responsible supplier, extracts what they
actually committed to, and either advances the recovery — or keeps the board
blocked. Vague phone talk is not a commitment. A commitment is evidence.

---

## The non-obvious thesis

CALL-E can establish contact. **MISE establishes whether a phone interaction
produced enough evidence to authorize a workflow transition.**

The phone call is treated as an **authorization boundary**, not a log line:
conversation alone never moves the workflow. Only a verified commitment does —
a checkable structure (action, quantity, delivery window with a clock time)
spoken by the responsibility holder, extracted from the call.

```
phone claim → evidence evaluation → ACCEPTED / REJECTED → state transition permitted / blocked
```

This is what separates MISE from a CALL-E wrapper.

## Three layers, one spine

| Layer | Role |
| --- | --- |
| **CALL-E** | Phone execution — places the real call, returns transcript + structured result |
| **MISE** | Evidence-gated workflow authority — owns the four-state recovery board |
| **CONTRACTOR** | The reusable primitive — commitment verification, given any phone-derived claim |

### CORE — CONTRACTOR, the invention

A single reusable function distills the whole protocol:

```python
from contractor import verify_call

verdict = verify_call(state, transcript, structured, confidence)
if verdict["accepted"]:
    case.advance(verdict)          # board moves, evidence chain appends
else:
    # board stays blocked, with an audit reason
```

**The rule:** a state transition cannot occur without an accepted commitment.

## The proof is in the rejects

A smuggled-in hedge never advances the board. Here is the gate, verbatim:

| What the supplier (or agent) says | Verdict | Board |
| --- | --- | --- |
| "we'll try to get to it by 4:00 PM" | `SUPPLIER_HEDGED` | stays |
| "we can probably ship" | `DELIVERY_WINDOW_MISSING` | stays |
| "sometime tomorrow" | `UNSPECIFIED_DELIVERY_TIME` | stays |
| agent records: "delivery confirmed" | blocked — no transcript, no qualifying evidence | stays |
| "Yes, 4 units, ship today, arriving by 2:00 PM" | `ACCEPTED` | moves |

Reject codes are structured and every verdict is recorded on the evidence
chain: `NO_STATEMENT` · `SUPPLIER_HEDGED` · `DELIVERY_WINDOW_MISSING` ·
`UNSPECIFIED_DELIVERY_TIME` · `NO_EXPLICIT_COMMITMENT` · `LOW_CONFIDENCE`.

The Attack Lab proves the gate under adversarial pressure — **forge, replay,
widen quantity, drop a condition, rewrite history, premature fulfillment,
unconfirmed payment** — each attempt blocked with the exact reason in the
ledger. `we'll try` → blocked. `probably` → blocked. Agent says "confirmed" →
blocked. Explicit terms → accepted. That is the differentiator.

## The product: a recovery board that cannot be gamed

`DELIVERY FAILED → SUPPLIER CONTACT REQUIRED → COMMITMENT ACCEPTED → RECOVERY COMMITTED`

- **Engine reads the case, decides the one next phone action**, CALL-E performs it
- **Every transition is backed by call evidence** — exact statement, extracted
  commitment, delivery window, confidence, call ID, timestamp
- **The ledger is append-only and hash-linked** — the board becomes verifiable,
  not just claimed
- **MISE never declares delivery complete** — the final state is `COMMITMENT
  ACCEPTED`; delivery stays in the supplier's hands, monitored

## CALL-E, actually called at runtime

- **Live mode**: activates with `CALLE_BASE_URL`, `CALLE_API_KEY`, `CALLE_PHONE`
  via a tiny stdlib `.env` loader; the adapter converts the CALL-E result into
  the same structured commitment shape, so the identical gate runs on a real call
- **Simulation mode**: no credentials — the entire pipeline runs on a
  deterministic simulation, same protocol, same gate, same ledger, so the full
  stack is judgeable offline

## What's technically enforced (and tested)

- stdlib-only Python: HTTP server, SQLite, gate, ledger — one empty
  `requirements.txt`, everything runs on a standard CPython install including tests
- full unittest suite (state machine, attack corpus, mutation property harness,
  case-ledger integration) — all green locally, zero dependencies beyond CPython
- mutation harness: **5,000 mutated contracts, 0 violations**
- CONTRACTOR enforces a single confirmed path: `start_formation → clarify →
  confirm → commit` — no SDK function can manufacture a confirmation

## Try it in 60 seconds

```bash
git clone https://github.com/HillaryIkhais/MISE.git
cd MISE
python3 demo.py --db contractor.db   # recovery board, called and defended
python3 server.py --db contractor.db # dashboard at http://127.0.0.1:8080
```

Frontend: Next.js 16 (TypeScript, Tailwind CSS v4, GSAP, Three.js canvas).
Recovery board, evidence trail, calls history, and a Security Lab where four
adversarial scenarios are all blocked.

## Side effects & safety

- **Simulation**: no external side effects; transitions are local to the ledger
- **Live call**: one outbound call via CALL-E, then recorded on the append-only chain
- No recurring schedules, no repeat calls, no rollback — transitions are
  forward-only and tamper-evident