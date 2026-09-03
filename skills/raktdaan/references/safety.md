# Safety

Every constraint here has a reason attached. A rule whose reason is not written
down gets relaxed by the next person who finds it inconvenient.

## Paid donation is illegal in India

Blood is a "Drug" under the Drugs & Cosmetics Act 1940, and India prohibits paid
donation. The call must never offer or imply compensation — not money, not
vouchers, not travel reimbursement, not gifts, not "we'll take care of you".

This is not only a legal constraint. Paid and replacement donors have measurably
higher transfusion-transmissible infection rates than voluntary donors, which is
why the prohibition exists. An incentive offered on a recall call recruits the
wrong donor.

## Never name a patient, never invoke death

Two reasons, and the second is the one people underestimate.

The legal one: a patient's condition is another person's health data. It is not
the donor's to receive, and disclosing it on an outbound call is a
purpose-limitation breach.

The practical one: coercion produces a yes that does not arrive. "Someone will
die tonight" gets agreement on the phone from a person who then does not come,
because the agreement was extracted rather than given. It also poisons the
register — a donor who felt manipulated stops answering, and the blood bank loses
them for every future shortage. Indian registers already show only ~49% of
donors contactable at all. The recall channel is a renewable resource being
mined.

The donor's decision has to be able to survive the call ending.

## No clinical claims

The skill decides whom to call. It never decides what a patient receives, and it
never tells a donor they are medically cleared.

Last recorded haemoglobin is used to order a call list. It is not a screening
result. Haemoglobin, blood pressure and TTI screening happen at the centre on a
fresh sample, and the call says so. A donor told on the phone that they are
eligible and then deferred at the chair is a donor who does not come back.

## Consent, and what it does not cover

The register comes from the blood bank's own records, and only donors who
consented to recall contact are in the callable pool. Consent under the DPDP Act
2023 and the DPDP Rules 2025 is purpose-limited: consent to be recalled for
donation is not consent to be contacted about anything else.

`opted_out` is checked **before** dialling, never after, and it outranks an
active shortage. An opt-out heard during a call is written back to the register
before the run continues.

## Phone numbers

The skill never sources, guesses, completes, repairs or reformats a phone number.
A number arrives from the consented register in E.164 or the donor is not called.
`_looks_like_e164` is a shape check that rejects; it does not fix.

Every number in the documentation and fixtures begins `+910000`. Indian mobile
numbers are ten digits beginning 6, 7, 8 or 9, so these cannot be dialled — the
safety property is checkable by looking at them.

No real transcript, real donor record, or real number appears anywhere in this
skill or its outputs.

## Quiet hours and calling conduct

Recall calls are service communication to a consenting register, not marketing,
but TRAI's TCCCPR framework and ordinary decency both apply: no calls inside
quiet hours, and a per-donor call budget so a register is not dialled until it
stops answering.

The anti-fatigue budget is a hard constraint, not a preference. It defaults to
one call per donor per 90 days regardless of whether they donated, and the run
report states how many donors it blocked.

## What the runner will not do

- Dial concurrently. One call in flight, enforced.
- Dispatch a new call after the need is met.
- Re-ring somebody who declined this request.
- Count an unclear answer as a unit.
- Continue past the call budget. It ends the run unfilled and says so.
- Silently skip a donor. A suppression is always reported with a reason code —
  a silent skip is indistinguishable from a bug.

## In-flight calls cannot be cancelled

CALL-E exposes no operation to cancel a call that has already been dispatched.
The design accommodates this rather than assuming a kill switch: because only one
call is ever in flight and the need is re-checked before each dispatch, the worst
case is a single call that was not strictly necessary. Batching or parallel waves
would turn that into an unbounded overshoot, which is the main reason this skill
does not batch.
