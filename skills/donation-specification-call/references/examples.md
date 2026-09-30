# Examples

All organisations, records, and phone numbers below are fictional.

## Example 1: Preview Only

The matching engine finds that school-supply kits cannot be assembled because the age range and packed status are unknown. The operator runs:

```bash
python3 scripts/preview_specification_call.py
```

The script prints the masked recipient, purpose, exact questions, schema keys, and idempotency key. It ends with:

```text
NO CALL WAS PLACED
side_effect: none
```

## Example 2: Generic Fixture Reconciliation

Run:

```bash
python3 scripts/preview_specification_call.py --result assets/example-result.json
```

The fixture reports an age range for `ITEM-SCHOOL-01`, confirms that `BOX-SCHOOL-04` is packed, and provides direct supporting quotes. The reconciliation output labels both values `donor_reported` and sends them to human review. It does not claim that the goods were inspected or allocated.

## Example 3: Clothing Size

A recipient request accepts only labelled child sizes S and M. The donor's intake form says only “assorted raincoats.” An authorised call asks which sizes are actually labelled. The answer `child-m` is accepted only when that enum value exists in the raincoat category schema and the transcript contains a supporting quote.

## Example 4: Furniture Dimensions

A desk cannot be allocated because the recipient doorway has a hard width constraint. The contact reports a width of 110 cm. The host accepts the claim only if `width` was asked, `cm` is an allowed unit, and 110 is within the configured range. It remains `donor_reported`; the call does not certify measurement accuracy.

## Example 5: Unasked Attribute Is Rejected

The call asked only about packing. The structured result also contains `quantity: 200`. Even if the number appears plausible, it is rejected because that subject/attribute pair was not in the approved question set.

## Example 6: Conflict

An intake form lists 20 units. The later call reports 12. The workflow stores a conflict with both sources and their timestamps. It does not silently replace 20 with 12 or rerun allocation as though the conflict were resolved.

## Example 7: Voicemail Or Wrong Person

Voicemail, an answering service, or a person who cannot confirm the authorised role produces no accepted claims. A cooperative response is not enough; the intended contact and role must both be confirmed.

## Example 8: Unknown Outcome, No Redial

The CALL-E create request times out after call intent was persisted:

```text
outcome: outcome_unknown
A call may already have been placed.
next_step: reconcile the stored provider id or reuse the idempotency key
do_not_redial: true
```

## Example 9: Refusal

The warehouse coordinator says they do not want to continue. The call stops, records `refusal`, applies no attributes, and does not move automatically to another phone number.
