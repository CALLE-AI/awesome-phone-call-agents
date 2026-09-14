# PermitDiff live-validation protocol

PermitDiff should not manufacture a “real-world” demo by calling a municipality about a random third party's permit. A credible live pilot requires an applicant-side person or organization that is authorized to ask about the exact permit record being reconciled.

## Pilot eligibility

A real case is eligible only when all of the following are true:

- the pilot participant controls or is authorized to act for the permit/application;
- they provide or approve the exact public permit identifier and office destination;
- they confirm that using a phone call for this bounded status-reconciliation purpose is appropriate;
- the captured portal facts do not include unnecessary personal, credential, payment, or confidential project data;
- the jurisdiction/calling context permits the call and AI disclosure is made;
- the participant understands that phone evidence does not supersede the official municipal record.

If no authorized case is available, use the deterministic judge console and synthetic fixture. Do not weaken the authorization model merely to obtain a live-call badge.

## Three-state validation

The award evidence should demonstrate three distinct states.

### A. Fresh record → no call

Capture an authorized portal snapshot that is inside the configured freshness window and has no explicit conflicting source. PermitDiff must return `call_recommended=false`. This proves that the product is not a phone-polling bot and that CALL-E calls are spent only when the record needs reconciliation.

### B. Eligible call + grounded match

For a stale or explicitly conflicting snapshot, authorize one CALL-E call. The result must bind to the exact call ID, destination, jurisdiction, permit ID and snapshot hash. The office status and next-step evidence must be grounded in recipient-side transcript text. If the office-reported status matches the frozen portal value, PermitDiff returns `verified_match` while still requiring official-record authority for any consequential action.

### C. Eligible call + grounded discrepancy

When grounded office evidence differs from the frozen portal status, PermitDiff returns `discrepancy_detected`, shows the before/phone-reported values and evidence, and sets `requires_official_record_confirmation=true`. The system must not rewrite that state as “portal corrected,” “permit approved,” or another authoritative conclusion until the municipality's record or an authorized human process establishes it.

## Measured KPIs

For a real pilot, report only directly observed quantities:

- eligible cases evaluated;
- calls avoided by the freshness/no-conflict gate;
- calls placed;
- answered / refused / voicemail / unreachable / invalid results;
- grounded matches;
- grounded discrepancies surfaced;
- time from operator approval to evidence packet;
- operator review minutes;
- manual baseline minutes for comparable status follow-up, if actually measured;
- duplicate-call count;
- false-success count after official-record/human confirmation.

The critical safety KPIs are duplicate-call rate and false-authority/false-success rate; both should remain zero.

## Pilot acquisition via CounterSignal

CounterSignal's SmallBet permit-ops discovery run can identify operators who actually experience the problem. A respondent's discovery answer is **not** authorization for PermitDiff. Pilot recruitment is a separate step: obtain explicit agreement and an authorized case before any municipal call.

This separation is useful judging evidence: the projects may share a business domain while remaining substantially different systems. CounterSignal tests a market hypothesis through controlled research interviews; PermitDiff reconciles one authorized municipal record through an evidence-bound operational call.
