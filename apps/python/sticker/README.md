# Sticker

**There is no sticker price on a prescription. Sticker calls the pharmacies and asks.**

## The problem

Pharmacies nationally paid about **43 cents** for thirty metformin tablets. That is not a
guess. It is the national average acquisition cost the federal government publishes every
week, surveyed from pharmacy invoices, and you can read it yourself:

```
CMS NADAC, METFORMIN HCL 500 MG TABLET: $0.01419 per each, effective 2026-08-19.
https://data.medicaid.gov/dataset/dfa2ab14-06c2-457a-9e36-5cb6d80f8d93
```

What *you* pay is a different number. It is different at every pharmacy, it changes, and
it is published nowhere. If you have insurance you rarely see it. If you are uninsured or
have not met a deductible, it is the only number that matters.

There is a structural reason it stays hidden. Pharmacy contracts with pharmacy benefit
managers commonly require the pharmacy to give the PBM its lowest price, so pharmacies
keep the posted cash price *above* their negotiated rates rather than competing on it
([USC Schaeffer Center, 2022](https://schaeffer.usc.edu/wp-content/uploads/2024/10/2022.05_US-Consumers-Overpay-for-Generic-Drugs.pdf)).
Price comparison sites mostly show discount-card prices at chains. Roughly 19,000
independent pharmacies sit largely outside that surface.

So the only reliable way to learn a cash price is to telephone the counter and ask. That
is not a workaround, it is the established method: researchers do exactly this, by hand.
A 2020 study in *Psychiatric Services* phoned **265 pharmacies over one month** and found
a 30-day supply of one generic antipsychotic ranging from **$29.99 to $1,345.00** in a
single metro area ([Kriz et al.](https://doi.org/10.1176/appi.ps.201900319)). A 2017
study phoned 528 pharmacies in Los Angeles County and found an average **$52 difference
inside a single ZIP code** ([Arora et al.](https://pubmed.ncbi.nlm.nih.gov/28817779/)).

Sticker runs that survey with a phone agent instead of a research team.

## What it does

Give it a drug and a ZIP code. It:

1. reads the **federal NPI registry** for licensed community pharmacies near that ZIP,
2. calls the ones you authorize and asks one question: the cash price, no insurance, for
   this quantity,
3. reads back a sorted price map, and
4. joins every price to **CMS NADAC**, so each row also shows the national average
   pharmacies paid for the same bottle.

NADAC is a benchmark, not an invoice. It is a national survey average, so the multiples
below are estimates of how far a price sits above what the drug generally costs to buy,
not a claim about what any one shop paid its wholesaler.

```
PHARMACY                          CITY                 PRICE  vs NADAC
----------------------------------------------------------------------
Lakeside Community Drug           Riverton             $9.40       22x
Cedar Street Pharmacy             Springfield         $12.99       30x
Northgate Drug                    Springfield         $18.50       43x
Union Square Pharmacy             Riverton           $147.25      342x

That is a 15.7x spread across the 4 pharmacies here that gave a price for
this quantity. Somewhere else in the same ZIP may be cheaper.
```

The markup column is the point. It is not our arithmetic about our own accuracy: it is a
price a pharmacist said out loud, divided by a number the Centers for Medicare & Medicaid
Services published that week. We authored neither.

## Quick start, no calls and no API key

```bash
pip install -e ".[dev]"
sticker survey --offline
```

That runs the whole pipeline against a local stand-in for the CALL-E API and places no
calls. Drop `--offline` to also fetch the real acquisition cost from CMS, still without
calling anyone.

The `[dev]` extra pulls in pytest and httpx's mock transport, which the test command below
needs. `pip install -e .` alone installs the app but not the test tooling.

Two more read-only commands:

```bash
sticker find --zip 10025          # licensed pharmacies near a ZIP. Never dials.
sticker cost --drug "atorvastatin" --strength "20 mg"   # the national average cost.
```

## Discovery never dials

`sticker find` reads a public registry. It does **not** feed the survey.

A public business listing is not permission to call it. To place live calls you copy the
numbers you actually want surveyed into an authorized destinations file, one per line, and
Sticker will dial nothing else. An absent or empty file authorizes **nothing**, not
everything.

```bash
sticker find --zip 10025 --out authorized_destinations.txt   # a candidate list
$EDITOR authorized_destinations.txt                          # you decide who gets called
```

## Live path, opt in

Four independent gates, because the side effect is a real telephone ringing in a real
pharmacy:

```bash
export CALLE_API_KEY="..."                 # 1. a credential
export STICKER_LIVE_CALLS_ENABLED=true     # 2. a separate switch
sticker survey \
  --drug "metformin hcl" --strength "500 mg" --quantity 30 \
  --zip 10025 \
  --live --confirm PLACE-REAL-CALLS \      # 3. an explicit token
  --authorized authorized_destinations.txt \  # 4. an exact-destination allowlist
  --max-calls 12
```

Having an API key in your environment does not make a normal run live. `sticker doctor`
checks that a key authenticates without spending a call.

## What the agent says

Its first word is only "Hello?", and then it waits. A pharmacy answers with its own name,
a hold message or a recorded menu, and the agent stays silent until that has finished and
the line is quiet. Only then does it say one sentence, which both discloses what it is and
asks the question:

> "Hi, I'm an AI assistant doing a price check. What's your cash price for 30 metformin
> 500 milligram tablets, no insurance?"

The disclosure comes before the question, every time, including after a transfer. CALL-E
does not announce itself and exposes no setting for it, so the disclosure exists only in
the task prose, which is why the test suite asserts on it.

The drug is said the way a pharmacist says it. The federal price file spells the salt form
and abbreviates the unit, and read aloud that becomes several seconds of noise before the
question lands, so the spoken sentence drops both while the lookup keeps CMS's spelling.

Everything else about a pharmacy line is steered from the same prose, because none of it is
an API parameter: a menu to work through with the keypad, a hold to wait out, a transfer to
re-introduce itself after, a voicemail box to hang up on without leaving a message, and an
automated system demanding a prescription number, which it cannot satisfy and so ends the
call rather than being routed to voicemail.

## Boundaries

Sticker asks a retail price question, the same one a walk-in customer asks all day. It is
not a medical tool and it is deliberately incapable of being one.

- It never names a patient, and there is no patient. It never asks for or supplies a
  prescription number, a date of birth, or insurance details.
- It never asks for clinical advice, never describes symptoms, and never suggests anyone
  start, stop, or change a medication.
- A refusal ends the call. It does not argue, ask twice, or offer to hold.
- **A price is not a recommendation.** The cheapest pharmacy may be the wrong pharmacy.
  Which drug to take, and whether to switch counters, is between a person and their
  prescriber and pharmacist.

## What counts as an answer

Three decisions, all of which make the headline number smaller and none of which are
adjustable:

- A price counts only if a dollar amount was **said aloud for the quantity asked about**.
  A quote for a different bottle size is reported separately and never rescaled, because
  ninety tablets are not three thirties.
- **A refusal stays in the denominator.** The share of pharmacies that will not price a
  drug by phone is a finding about price opacity, not a gap to quietly drop.
- A completed call is not an answered question. A voicemail box returns
  `status: completed` with `task_completed: true`, so the structured answer decides, never
  the status.

## Structured output

One `recipient_result_schema`, inside the subset CALL-E accepts (no `$ref`, `oneOf`,
`anyOf`, `allOf`, or union types, all of which come back `result_schema_invalid`).
Every uncertain field can answer `unknown`, because a schema with no way to say "I did not
find out" invites a fabricated answer.

| field | values |
| --- | --- |
| `answered_by` | `human` / `ivr` / `voicemail` / `unknown` |
| `quote_status` | `quoted` / `refused` / `not_stocked` / `unknown` |
| `cash_price_usd` | digits, or `unknown` |
| `quantity_quoted` | what the price actually covers |
| `requires_prescription_on_file` | `yes` / `no` / `unknown` |
| `is_generic`, `discount_program_mentioned` | `yes` / `no` / `unknown` |
| `notes` | one sentence in the staff member's words |

## Side effects, cancellation, credentials

- **Side effects.** In live mode, one outbound call per authorized number. Nothing is
  written to any third-party system. There are no recurring jobs and no scheduler: one run
  is one set of calls. No per-call price or call duration is quoted here, because neither
  is published anywhere this project can cite, and a figure invented for a README is worse
  than no figure.
- **Cancellation.** CALL-E exposes no cancel operation, so an in-flight call cannot be
  recalled. The controls are the ones before dialling: the allowlist, `--max-calls`, and
  the printed plan. Interrupting the process stops further calls but not the ones already
  placed.
- **Ambiguity halts.** A rejected request is a fact. A timeout is not, because the phone
  may already be ringing. Sticker stops the run and asks a person to reconcile rather than
  retrying, and idempotency keys are derived from request content so a restart reuses the
  key instead of dialling twice.
- **Credentials.** Read from `CALLE_API_KEY`, never logged, never written to a run file.
  The API origin is parsed and allowlisted before the key is attached to a header, and
  redirects are disabled so a cross-host 302 cannot carry it away.
- **Phone numbers** are masked to `+1******0142` in every report, log, and error message.

## Tests

```bash
python -m pytest tests -q
```

94 tests. No network, no credentials, no calls. The simulated CALL-E is an
`httpx.MockTransport` mounted underneath the real transport, so the request building,
idempotency header, polling loop, and error mapping under test are the same ones a live
run uses.

## Layout

```
sticker/safety.py        the refusals: E.164, masking, origin pinning, the allowlist
sticker/call_design.py   what the agent says, and the schema it must answer with
sticker/calle.py         the CALL-E transport
sticker/simulation.py    a local stand-in for the API, so the default path is free
sticker/pharmacies.py    the federal NPI registry
sticker/nadac.py         the federal acquisition cost
sticker/survey.py        orchestration
sticker/report.py        what counts, and the arithmetic
```

## How this differs from `pharmacy-stock-check`

That app answers **"who has it?"**. Sticker answers **"what will it cost me, and is that
a fair price?"**. Three concrete differences: it is US cash pricing rather than UK stock;
the unit of the result is a price distribution across a ZIP rather than a per-pharmacy
availability flag; and every price is joined to a federal acquisition cost, so you can tell
whether a number is high rather than only where it sits against the others. Running both
would be reasonable. They ask different questions.

## Limitations

- **Live verification is reported elsewhere.** The live path is implemented and gated, and
  what it has been run against is described in the project's submission materials rather
  than here, because this repository does not accept real-call artifacts.
- NADAC is a national average acquisition cost, not what a specific pharmacy paid on a
  specific day. It is the right order of magnitude and the wrong number for any single
  invoice.
- NADAC covers a drug by description. Unusual strengths, combination products, and most
  brand-only drugs will not resolve, and the report then shows prices without a markup
  column.
- The NPI registry lists licensed pharmacies, including some that have closed or moved.
  A survey therefore includes unreachable numbers, and they are reported as unreached
  rather than dropped.
- Prices are collected in one moment. Nothing here should be read as a standing price.
- **An account has a concurrent-call limit, and it is not documented or exposed.** Exceed
  it and `POST /v1/calls` answers `HTTP 429 account_concurrency_exceeded`. That answer is
  definite, so Sticker treats it as backpressure rather than a refusal: nothing was
  dialled, the pharmacy stays in the survey, and the run waits and tries that number again
  instead of dropping it. Because the cap cannot be read in advance, `--concurrency` is a
  ceiling on our side and the default stays low.
- **Turn-taking is not something the caller controls.** There is no parameter for it:
  `CreateCallRequest` has six fields and rejects unknown keys, so who speaks when is
  steered entirely from the task prose and not guaranteed by it. The call is written
  around that rather than against it, opening with a single word so that if the agent's
  first turn lands on top of the greeting it costs one word instead of the whole question.
