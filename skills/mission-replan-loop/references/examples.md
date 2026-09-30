# Examples

Five inputs and the output each must produce. They are the same fixtures as
`examples/*.yaml`, written out so the reasoning is readable; a change to one
without the other is a bug.

Each case exists for a distinction that is easy to collapse:

| | distinction |
|---|---|
| logistics recovery | a phone answer makes the current plan impossible |
| procurement recovery | the same loop, a different domain and constraint |
| field service recovery | the same loop again, with a time window |
| uncertain answer | a hedged answer is not a fact, and asks rather than decides |
| unsupported destination | the call never happened, so the target was not judged |


## A carrier cannot meet the warehouse cutoff

The answer is factual, confirmed, and fatal to the plan. The constraint decides; the skill does not weigh it up.

`examples/logistics-recovery.yaml`

```yaml
input:
  mission:
    objective: 'Protect Shipment #4821''s departure'
    deadline: '17:30'
  constraints:
  - key: pickup_time
    operator: lte
    value: '17:30'
    mandatory: true
  - key: capacity_ok
    operator: eq
    value: true
    mandatory: true
  strategy:
    id: strategy_01
    type: replacement_carrier
    target: Carrier B
  call_result:
    call_id: call_021
    target: Carrier B
    status: completed
    facts:
      available: true
      capacity_ok: true
      pickup_time: '18:00'
  available_targets:
  - Carrier C
  - Carrier D
  excluded_targets:
  - Carrier A
  - Carrier B
output:
  strategy_status: invalid
  evidence:
  - fact: pickup_time
    value: '18:00'
    source_call: call_021
    target: Carrier B
    confidence: high
    status: validated
  constraint_results:
  - constraint: pickup_time
    required: '17:30'
    observed: '18:00'
    status: violated
  replan:
    required: true
    reason: Carrier B cannot collect before the warehouse cutoff.
    previous_target: Carrier B
    proposed_strategy:
      type: alternative_target
      target: Carrier C
  next_operation:
    type: phone_call
    objective: Verify whether Carrier C satisfies the recovery constraints.
    required_information:
    - available
    - pickup_time
    - capacity_ok
```

## A supplier cannot deliver the full quantity in time

Same loop, different domain: nothing about the shape is logistics-specific.

`examples/procurement-recovery.yaml`

```yaml
input:
  mission:
    objective: Secure 5,000 units before the production cutoff
    deadline: '14:00'
  constraints:
  - key: quantity
    operator: gte
    value: 5000
    mandatory: true
  strategy:
    id: strategy_01
    type: single_supplier
    target: Supplier A
  call_result:
    call_id: call_112
    target: Supplier A
    status: completed
    facts:
      quantity: 2000
  available_targets:
  - Supplier B
  - Supplier C
output:
  strategy_status: invalid
  constraint_results:
  - constraint: quantity
    required: 5000
    observed: 2000
    status: violated
  replan:
    required: true
    reason: Supplier A covers 2,000 of the 5,000 units required.
    proposed_strategy:
      type: multi_supplier
      target: Supplier B
  next_operation:
    type: phone_call
    objective: Verify how many units Supplier B can cover.
    required_information:
    - quantity
    - delivery_time
```

## A technician cannot arrive inside the service window

A time window rather than a deadline, and the same verdict.

`examples/field-service-recovery.yaml`

```yaml
input:
  mission:
    objective: Restore critical equipment before 16:00
    deadline: '16:00'
  constraints:
  - key: available
    operator: eq
    value: true
    mandatory: true
  - key: arrival_time
    operator: lte
    value: '16:00'
    mandatory: true
  strategy:
    id: strategy_01
    type: assigned_technician
    target: Technician A
  call_result:
    call_id: call_204
    target: Technician A
    status: completed
    facts:
      available: false
      arrival_time: null
  available_targets:
  - Technician B
output:
  strategy_status: invalid
  evidence:
  - fact: available
    value: false
    source_call: call_204
    target: Technician A
    confidence: high
    status: validated
  constraint_results:
  - constraint: available
    required: true
    observed: false
    status: violated
  replan:
    required: true
    reason: Technician A confirmed they cannot attend today.
    proposed_strategy:
      type: alternate_technician
      target: Technician B
  next_operation:
    type: phone_call
    objective: Verify Technician B's availability and arrival time.
    required_information:
    - available
    - arrival_time
```

## A hedged answer

"Probably around five-thirty" is not a time. An uncertain fact cannot satisfy a hard constraint, and the reply is a clarification — never a decision.

`examples/uncertain-answer.yaml`

```yaml
input:
  mission:
    objective: 'Protect Shipment #4821''s departure'
    deadline: '17:30'
  constraints:
  - key: pickup_time
    operator: lte
    value: '17:30'
    mandatory: true
  strategy:
    id: strategy_01
    type: replacement_carrier
    target: Carrier B
  call_result:
    call_id: call_031
    target: Carrier B
    status: completed
    facts:
      pickup_time: '17:30'
      pickup_time_confirmed: false
output:
  strategy_status: uncertain
  evidence:
  - fact: pickup_time
    value: '17:30'
    source_call: call_031
    target: Carrier B
    confidence: low
    status: uncertain
  constraint_results:
  - constraint: pickup_time
    required: '17:30'
    observed: '17:30'
    status: uncertain
  replan:
    required: false
  next_operation:
    type: clarification
    objective: Ask Carrier B to confirm a firm pickup time.
    required_information:
    - pickup_time
```

## The call could not be placed at all

The one case where nothing is concluded about the target. Invalidating the strategy here, or moving down the candidate list, spends the budget on a configuration error and then reports it as a business outcome.

`examples/unsupported-destination.yaml`

```yaml
input:
  mission:
    objective: 'Protect Shipment #4821''s departure'
    deadline: '17:30'
  constraints:
  - key: pickup_time
    operator: lte
    value: '17:30'
    mandatory: true
  - key: capacity_ok
    operator: eq
    value: true
    mandatory: true
  strategy:
    id: strategy_02
    type: replacement_carrier
    target: Carrier C
  call_result:
    call_id: null
    target: Carrier C
    status: rejected
    failure_code: unsupported_destination
    failure_message: The provider does not place calls to this destination.
    facts: {}
  available_targets:
  - Carrier D
  excluded_targets:
  - Carrier A
  - Carrier B
output:
  strategy_status: uncertain
  failure_class: execution
  evidence: []
  constraint_results:
  - constraint: pickup_time
    required: '17:30'
    observed: null
    status: not_evaluated
  - constraint: capacity_ok
    required: true
    observed: null
    status: not_evaluated
  replan:
    required: false
    reason: The call was never placed. Carrier C has not been evaluated.
  escalate:
    required: true
    reason: Calling is unavailable for this destination — a human must fix the configuration.
```

## Running them

The fixtures are declarative: an input and the output the skill must produce.
They need no CALL-E credentials and place no calls, so they can be used as
regression cases in a host application's own test suite.

A host application can load each file, run its own implementation against
`input`, and compare with `output`. The fixtures are the contract: a change to
the skill that does not change them is safe, and one that does needs a reason.
