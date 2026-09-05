# Locked Door

> A city PDF says the cooling center is open. This calls to check, cites the transcript for every fact, and says `unknown` rather than sending someone to a locked door.

Locked Door is a web application for keeping **emergency resource directories** (cooling centers, heat-relief shelters, warming centers, food sites) truthful. It ingests a published directory, decides which facts are worth spending a phone call on, verifies them by phone, and publishes a time-stamped, human-approved delta instead of silently overwriting the source.

The operational fact that matters in an emergency — *are you open right now, do you take pets, is the accessible entrance still on 3rd Street* — very often exists only behind a phone number. A search API cannot retrieve it. This is the policy layer around a call, not a voice bot.

## Safety and provenance: no real calls are placed

This is the most important thing to know before running it.

The call transport is an interface with two implementations:

| Implementation | State | Behaviour |
| --- | --- | --- |
| `CalleTelephonyAdapter` | **disabled** | Documents the real request shape. `placeCall()` **throws synchronously** if invoked. |
| `SimulatedFacility` | active | Deterministic, seeded conversations with ground-truth state per facility. |

`placeCall()` throws synchronously rather than returning a rejected promise, so an unawaited call cannot sail past the refusal and fail silently. On a boundary that must never be crossed quietly, "you only find out if you were listening" is not good enough.

The UI states that calls are simulated at all times. A full session makes **zero external network requests**; the only external URL in the tree is a string constant that is never fetched. There is no credential handling of any kind, because there is nothing to authenticate.

This is a dry-run-by-default app, as required by `CONTRIBUTING.md`.

## What it does

1. **Ingest** a realistic published directory — 64 facilities with the mess real ones have: 47 distinct hour formats, 109 missing verification timestamps, 5 facilities with no phone, 7 disconnected numbers, 4 duplicates.
2. **Rank by risk.** Every `(facility, field)` pair is scored on **harm if stale x probability of being stale x observability by phone**, with documented volatility priors per field type. A greedy submodular selection then picks **facilities**, not fields, under an explicit call budget, because one call verifies several fields at once.
3. **Call, within a budget**, with realistic outcomes: connected, IVR menu, voicemail, no answer, disconnected. Retry with backoff and a per-facility attempt cap.
4. **Extract with citations.** Every typed field (`open_now`, `hours`, `pet_policy`, `accessibility`, `intake_requirements`, `capacity_status`) must point at a span of the transcript. **If no span supports it, the value is `unknown`** — enforced in code, with the citation visible on hover.
5. **Route, do not guess.** Low-confidence or contradicted fields go to a review queue rather than to publication.
6. **Publish a delta.** A time-stamped changeset (field, old, new, evidence, confidence, `verified_at`) awaiting human approval, with full per-field history and freshness decay.

## Measured results

Because the simulator carries ground truth, the app measures itself. From a 25-call batch (`node tools/smoke.mjs 25`, identical numbers in browser and headless):

| Metric | Value |
| --- | --- |
| Precision | **94.4%** (67/71) |
| Recall | 44.7% (67/150) |
| Unknown rate | 52.7% |
| **False-publish rate** | **0.00%** (0/37) |
| Wrong values produced / held for review | 4 / 4 |
| Harm reduction vs oldest-first baseline | **49.31 vs 39.35 (+25.3%)** |
| Citation audit | **71/71 pass, 0 failures** |
| Batch wall time | 22.0 s |

The harm-reduction lift is *realized* against ground truth rather than planned, holds across budgets (+42.1% at budget 10, +32.4% at 15, +25.3% at 25), and correctly decays toward zero as the budget approaches the full directory.

The citation audit is deliberately independent: it re-slices each stored span out of its retained transcript and compares it to the stored quote, rather than reusing the engine's own gate.

## Honest limits

- **Recall is 44.7%.** Over half of attempted facts stay `unknown`, driven by unreachable lines, staff who genuinely do not know, and ambiguous speech. That is the designed trade, and nobody should read it as a good number in isolation.
- **The 0.00% false-publish rate is the rate at which the system publishes a wrong value on its own authority.** If a human blanket-approves all 34 review rows unread, it becomes 5.63%. Both figures are shown on screen, because `approveAll()` simulates exactly the rubber-stamping the review queue exists to prevent.
- `capacity_status` recall is 24% — the most volatile field and the least reliably answered, so it burns budget for little return.
- `open_now` precision is 84%, the weakest field: stale voicemail greetings get cited as evidence about today. They are correctly low-confidence and routed to review, but this is the softest part of the extractor.
- The extractor is **rule-based, not a model**: deterministic and auditable, but it misses phrasings outside its rules — which surfaces as `unknown`, never as a wrong answer.
- The directory is synthetic. The schema is realistic; the facilities are not. Do not drive anywhere based on it.

## Run it

Static files only. No build step, no CDN, no backend, no credentials.

```bash
cd apps/web/locked-door
python3 -m http.server 8810
# open http://127.0.0.1:8810/
```

Headless verification, which prints the same numbers as the browser:

```bash
node tools/smoke.mjs 25
```

## Layout

```
index.html          operator UI: call queue, live runner, review queue, evaluation
css/app.css
js/risk.js          harm x staleness x observability scoring
js/planner.js       greedy submodular selection under a call budget
js/transport.js     call transport interface: disabled real adapter + simulator
js/dialogue.js      seeded facility personas, IVR, voicemail, hedging
js/extract.js       typed extraction, citation enforcement, confidence
js/publish.js       delta store, per-field history, freshness decay
js/evaluate.js      precision/recall/unknown/false-publish, baseline comparison
js/main.js          UI wiring and window.__demo hooks
data/               synthetic directory + ground truth
tools/smoke.mjs     headless run, identical codepath
```

## Upstream project

Source repository: <https://github.com/rishabhcli/call-e-your-code-is-calling>
Demo video: <https://youtu.be/iI-PyPrgk58>

## License

MIT, matching this repository.
