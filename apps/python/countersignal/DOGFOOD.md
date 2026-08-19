# CounterSignal real-world validation: SmallBet permit-ops experiment

This is the pre-registration for the first real CounterSignal dogfood run. It exists so the result cannot be rewritten after hearing the calls.

## Study question

Do small and midsize US commercial contractors experience enough permit-status ambiguity to already spend recurring operator time on a manual workaround?

The purpose is **problem discovery**, not selling a permit service. The phone task must not quote a price, pitch automation, book a sales meeting, or convert a respondent into a lead score.

## Frozen protocol

Use [`smallbet-experiment.json`](smallbet-experiment.json) unchanged for the run. Its SHA-derived `protocol_hash` is the experiment version. If wording or thresholds change, create a new experiment ID rather than continuing the old denominator.

Target segment:

- US commercial/general contractors or permit-heavy specialty contractors;
- small or midsize operating teams rather than national enterprise headquarters;
- business appears to manage permit-dependent work directly;
- a published business number is available and reviewed before use.

Do not infer that a generic construction company belongs in the segment merely because it exists. The operator must review the company context first.

## Decision rule

- Minimum answered interviews: **8**.
- Provisional support threshold: **5 supporting** and **0 disconfirming**.
- Weaken threshold: **3 disconfirming** once the minimum answered denominator is reached.
- Refusal, voicemail, unreachable, low-confidence, ungrounded, or schema-invalid outcomes never enter the answered denominator.

A supporting interview means the respondent reports that the problem occurs and that an existing workaround/process is used. A disconfirming interview means the respondent directly says the problem does not occur, is immaterial, or the assumed workflow is wrong. Everything else is neutral.

This is an operational decision rule for one discovery experiment. It is not a prevalence estimate, confidence interval, total-addressable-market estimate, or product-market-fit claim.

## Recipient and consent rules

Each call is one reviewed business recipient. Do not auto-dial a scraped list. Use only a published business contact that is relevant to the study, respect applicable calling-hour and jurisdictional requirements, identify the caller as an AI research assistant, ask permission to continue, and end immediately on refusal or uncertainty.

Maintain an operator-side suppression list for any business that asks not to be contacted again. A refusal is a completed compliance outcome, not a failed conversion.

## What to measure

Record these directly rather than estimating them after the fact:

- reviewed candidate businesses;
- attempted calls;
- answered calls;
- interviews that continue after AI disclosure;
- refusals / voicemail / unreachable;
- supporting / disconfirming / neutral / invalid outcomes;
- number of transcript-grounded contradictions preserved;
- operator minutes spent preparing/reviewing each delegated call;
- for a small manual baseline, operator minutes required to conduct and summarize the same interview without delegation;
- whether the frozen experiment decision changes after each valid answered interview.

The primary product KPI is **operator minutes displaced per valid answered discovery interview**, with outcome-integrity metrics reported beside it. Do not turn a short call into a dollar ROI claim without observed labor-cost inputs.

## Stop conditions

Stop the experiment instead of spending the remaining call budget when any of the following occurs:

- an implementation or evidence-binding defect makes results unreliable;
- recipient sourcing is no longer clearly within the intended segment;
- a compliance/consent issue is discovered;
- the frozen rule reaches `hypothesis_weakened` and further calls would only be used to rescue the idea;
- enough evidence has been collected to move to a separately defined pilot-recruitment experiment.

Reaching `hypothesis_supported_under_rule` does not authorize a sales blast. It authorizes the next explicit experiment: ask a small number of qualified operators whether they will provide an authorized real permit case for a PermitDiff pilot.

## Judge evidence packet

After the run, publish a privacy-minimized aggregate containing the frozen experiment JSON/hash, counts by outcome bucket, decision sequence by interview number, measured operator-time methodology, failures/nonresponses, and a few redacted evidence excerpts where publication is permitted. Do not publish phone numbers, identities, full transcripts, or private recordings.
