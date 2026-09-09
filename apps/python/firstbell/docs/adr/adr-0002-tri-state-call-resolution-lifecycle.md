# ADR-0002: Tri-State Call Resolution Lifecycle and Safeguarding Escalation Decoupling

## Status
Accepted

## Date
2026-09-07

## Context

### Problem Statement
Standard telephony dispatch platforms model call lifecycles through binary outcomes: either a call succeeds (connected, completed) or it fails (busy, no answer, disconnected). In educational attendance management, this binary framing creates severe safeguarding liabilities.
A call that successfully connects, conducts a thirty-second conversation, and concludes with the callee stating "I am driving, I cannot talk now" returns a completed call status. The structured payload returns all fields as "unknown". In a binary architecture, this call is marked as completed, auto-closing the absence record and stranding a child whose whereabouts remain unaccounted for.
Furthermore, when a guardian answers and reports a valid reason (such as illness) but states they were unaware the child was absent, the call yields a schema-valid response. However, this situation indicates a potential truant or missing child. Auto-closing this record because it satisfied the schema creates an unacceptable child safety failure.

### Constraints
- Telephony transport logic must remain strictly separated from educational safeguarding rules.
- The three-outcome resolution model must never collapse into binary success or failure.
- Safeguarding escalations must be traceable to explicit field evaluations, not opaque probabilistic model predictions.

### Requirements
- Model `Resolution` with explicit states: `RESOLVED`, `FAILED`, `UNDETERMINED`, and `SKIPPED`.
- Define an independent, orthogonal `Escalation` classification (`NONE`, `SAFEGUARDING`).
- Implement `_learned_nothing()` to catch schema-valid answers where all required fields are uninformative.
- Compute `needs_a_human` as a composite property evaluating both incomplete calls and safeguarding escalations.

## Decision

Firstbell implements a tri-state resolution lifecycle in [`dispatch.models.Resolution`](../../dispatch/models.py) decoupled from an orthogonal [`dispatch.models.Escalation`](../../dispatch/models.py) axis.
1. `Resolution.RESOLVED`: A schema-valid structured result was returned with informative data.
2. `Resolution.FAILED`: Telephony failed or the provider permanently rejected the request.
3. `Resolution.UNDETERMINED`: The call connected but yielded no structured result, failed JSON schema validation, timed out, or returned only uninformative placeholders.
4. `Escalation.SAFEGUARDING`: Raised whenever `parent_confirmed_aware` is anything other than an explicit, affirmative `yes`.
5. Human intervention requirement: `ItemResult.needs_a_human` evaluates `True` if resolution is `FAILED` or `UNDETERMINED`, or if escalation is `SAFEGUARDING`, or if `needs_another_channel` is flagged.

### Architecture Diagram

```text
CALL-E Response Payload
        |
        v
  [Status Check]
   |          |
   |-- Failed / Canceled ----------> Resolution.FAILED (needs_a_human=True)
   |
   +-- Completed
         |
         v
   [Structured Result Extracted?]
   |          |
   |-- No ----+--------------------> Resolution.UNDETERMINED (needs_a_human=True)
   |
   +-- Yes
         |
         v
   [Schema & Vacuity Validation]
   |          |
   |-- Schema Mismatch ------------> Resolution.UNDETERMINED (needs_a_human=True)
   |-- _learned_nothing() == True -> Resolution.UNDETERMINED (needs_a_human=True)
   |
   +-- Valid & Informative
         |
         v
   [Safeguarding Rule Evaluation]
   |          |
   |-- parent_confirmed_aware != "yes" -> Resolution.RESOLVED + Escalation.SAFEGUARDING
   |                                      (needs_a_human=True, 30-min callback clock)
   |
   +-- parent_confirmed_aware == "yes" -> Resolution.RESOLVED + Escalation.NONE
                                          (Auto-closed, desk work eliminated)
```

### Key Interfaces

```python
class Resolution(str, Enum):
    RESOLVED = "resolved"
    FAILED = "failed"
    UNDETERMINED = "undetermined"
    SKIPPED = "skipped"

    @property
    def needs_a_human(self) -> bool:
        return self in (Resolution.UNDETERMINED, Resolution.FAILED)

class Escalation(str, Enum):
    NONE = "none"
    SAFEGUARDING = "safeguarding"

@dataclass
class ItemResult:
    item: WorkItem
    resolution: Resolution
    escalation: Escalation = Escalation.NONE
    needs_another_channel: bool = False

    @property
    def needs_a_human(self) -> bool:
        return (self.resolution.needs_a_human
                or self.escalation is not Escalation.NONE
                or self.needs_another_channel)
```

## Alternatives Considered

### Alternative 1: Binary Status (Connected vs Failed)
- **Description**: Treat any completed conversation as resolved, updating the student record automatically.
- **Pros**: Matches traditional interactive voice response systems; maximizes reported automation rates.
- **Cons**: Silently marks uncommunicative calls as resolved; loses children in safeguarding crises.
- **Rejection Reason**: Unacceptable legal and operational liability for public education agencies.

### Alternative 2: Fourth Resolution State (ESCALATED)
- **Description**: Add `ESCALATED` directly into the `Resolution` enum.
- **Pros**: Single enum field on results.
- **Cons**: Conflates technical call completion with operational urgency; downstream callers counting `resolved` drop escalated items or treat them as failed calls.
- **Rejection Reason**: Technical resolution and clinical or legal urgency are separate concerns. Decoupling them preserves both dimensions without data loss.

### Alternative 3: Autonomous LLM Discretion for Escalation
- **Description**: Ask the generative model to decide whether to alert staff based on conversational tone.
- **Pros**: Flexible interpretation of nuanced parent statements.
- **Cons**: Nondeterministic; prone to hallucinations; cannot be audited or proven in regulatory inquiries.
- **Rejection Reason**: Safeguarding requires deterministic code gates. The model extracts structured tokens; deterministic Python code decides whether a case auto-closes.

## Consequences

### Positive
- Defensible child safety: No student record closes without explicit guardian confirmation.
- Transparent workload accounting: The triage queue separates non-contacts from urgent safeguarding callbacks.
- Honest economic modelling: Net-new escalations are explicitly deducted from headline resolution and cost-savings figures.

### Negative
- Increases the length of the morning human callback queue by refusing to auto-close ambiguous cases.
- Requires school attendance staff to work a prioritized queue rather than receiving a binary completed report.

### Risks
- High escalation volumes if parents misunderstand the awareness question. Mitigation: Script phrasing is tested for clarity across multiple supported locales.

## Performance Implications
- **CPU**: Negligible in-memory string checks and enum evaluations.
- **Memory**: One small dataclass per result, not measured.
- **Load Time**: Zero additional dependencies.
- **Network**: Zero external requests required for resolution and escalation classification.

## Migration Plan
The tri-state resolution engine is fully implemented in [`dispatch/models.py`](../../dispatch/models.py) and verified by [`dispatch/scheduler.py`](../../dispatch/scheduler.py). All output queues and receipts reflect the three-bucket division.

## Validation Criteria
- Schema-valid results with all required fields set to "unknown" evaluate to `Resolution.UNDETERMINED`.
- Schema-valid results where `parent_confirmed_aware` is "no" or "unknown" evaluate to `Resolution.RESOLVED` with `Escalation.SAFEGUARDING`.
- Only records with `Resolution.RESOLVED` and `Escalation.NONE` decrement the manual triage backlog.

## Related Decisions
- [ADR-0001](adr-0001-native-calle-sdk-integration.md): Native CALL-E Server SDK Integration
- [ADR-0003](adr-0003-controlled-wave-concurrency-and-hybrid-reconciliation.md): Controlled Wave Concurrency
