# CALL-E published Goal contract

**Legacy adapter reference.** The current SiteWitness workspace uses CALL-E's Calls API and does not require publishing a Goal or setting `CALLE_GOAL_ID`. Follow [the current setup](../README.md) for the submitted demo. The contract below documents the older optional Goal Run adapter only.

Publish one CALL-E Goal for the SiteWitness demo and save its opaque Goal ID as the server-side `CALLE_GOAL_ID` secret/configuration value. Suggested title: **Phase I evidence gap interview**. The title is descriptive only; SiteWitness executes the stored ID.

## Required behavior

The Goal must identify itself as automated, identify the consulting firm and property, disclose transcription and EP review, disclaim environmental and legal conclusions, and ask permission to continue before substantive questions. It asks one question at a time, adapts based on the answer, distinguishes first-hand observation from hearsay and assumptions, preserves approximation and unknowns, captures knowledge/access limits, and stops for withdrawal or a human request.

The Goal's completion target is: produce an EP-review-ready factual record that resolves, bounds, or safely escalates one evidence gap without making an environmental conclusion.

## Input schema

Every value is a scalar string. Unknown keys, nested objects, arrays, and nulls are not accepted.

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["domain_type", "evidence_gap", "known_records", "property", "relevant_years", "respondent_role"],
  "properties": {
    "property": { "type": "string" },
    "domain_type": { "type": "string" },
    "relevant_years": { "type": "string" },
    "evidence_gap": { "type": "string" },
    "known_records": { "type": "string" },
    "respondent_role": { "type": "string" }
  }
}
```

## Result contract

The published result schema contains four scalar strings: `factual_statements`, `source_type`, `supporting_quotes`, and `uncertainty_notes`. SiteWitness normalizes that compact result into pending evidence, preserves its supporting quotation and uncertainty, and always requires human EP review.

The Goal outcome is an interview-completion classification only. It never changes the professional evidence-gap disposition; every returned statement remains pending until EP review.

## Branch policy

- Direct observation: establish years, location, role/access, and supporting records or witnesses.
- Drop-off/pickup observed: bound years and accessed areas before asking about machines, deliveries, drums, drains, or waste.
- Hearsay: identify the source and separate it from personal observation.
- Uncertainty: preserve estimates and ask for the basis and narrower range.
- No knowledge, decline, or human request: do not pressure; stop or escalate.

For the demo, `dry_cleaner_historical_use`, `gas_station_tank_history`, and `auto_repair_historical_use` are supported domain-pack values. The same published Goal receives different site variables and branch priorities.
