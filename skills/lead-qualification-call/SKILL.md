---
name: lead-qualification-call
description: Qualify a warm, consenting lead by phone with CALL-E, capture needs, budget, timing, decision authority, and interest as structured JSON, and route the disposition to a human or CRM without cold outreach.
license: MIT
---

# Lead Qualification Call

Use this skill when a sales or marketing team has **warm** inbound leads that have explicitly consented to a call and wants one disclosed CALL-E phone call to qualify them. The call collects needs, budget range, timeline, decision authority, and interest level, and returns a fail-closed structured JSON result with a disposition a human or CRM can act on.

This skill qualifies a lead. It does **not** sell, book, close, or write to a CRM. A human reviews the result and owns every next step, including any CRM update.

## When To Use

- Qualify leads from an opt-in form, callback request, or consent-gated campaign
- Collect needs, budget range, timeline, decision authority, and interest in one disclosed call
- Separate high-intent leads from low-intent ones with transcript-evidenced structured results
- Feed a disposition (qualified / needs_human / not_interested) to a human-run sales queue or CRM routing

## When Not To Use

- Cold outreach, scraped lists, unsolicited marketing, or SPAM-style dialing
- Medical, legal, financial, emergency, collections, or political calls
- Selling, closing, negotiating, or collecting payment on the call
- Calling a number the user did not provide and authorize
- Hidden retries, recurring schedules, or provider-side campaigns
- Writing to a CRM or booking a meeting before a human reviews the result

## Required Inputs

- `lead_id`: stable local identifier (3-64 chars of letters, digits, dot, dash, underscore)
- `campaign_id`: campaign or source-batch identifier for idempotency and routing
- `lead_source`: Google Form, website callback, ticket, partner, or other consent-gated source
- `to_phone_e164`: E.164, authorized
- `consent`: must be `true`
- `authorized_reason`: why this specific call is allowed
- `company_name`: business name disclosed on the call
- `product_offer`: what is being qualified (offer name or one-line description)
- `timezone`: IANA timezone for quiet-hours decisions
- `qualification_fields`: the subset of BANT fields the team wants, chosen from the schema contract

Optional: `locale`, `language`, `region`, `lead_first_name`, `notes` passed as call context.

## Preflight

1. Confirm the user authorized this one qualification call and that `consent` is `true`.
2. Confirm the phone is E.164 and came from the consent-gated lead record.
3. Confirm the lead is warm: the record has an explicit outreach basis or callback request. If the lead is cold or `do_not_call` is true, refuse.
4. Build the compiled task from the goal template below and review a masked preview before any CALL-E plan.

## Dry-Run Preview

Preview is the default. It performs **no network access and no call**. From the skill directory:

```bash
python3 -m json.tool assets/sample-lead.json
```

Review the compiled task, the result schema, the masked phone, and the idempotency key before touching CALL-E. All example numbers are reserved fictional numbers (see `references/examples.md`).

## CALL-E Goal Template

```text
You are an AI phone assistant calling on behalf of {company_name}.
Disclose immediately that you are AI and that this is one lead-qualification call.

Speak with {lead_first_name}. If you have the wrong person, apologise and end the call.

Purpose: understand whether {product_offer} fits this person's needs.
Do not sell, pitch, close, negotiate, collect payment, or give medical, legal, or financial advice.

Ask only the approved qualification questions:
- What problem or need is this person trying to solve?
- What budget range applies: under 1k, 1k to 5k, 5k to 20k, or above 20k? Mark not disclosed if they decline.
- What timeline applies: immediate, 1 to 3 months, 3 to 6 months, 6 months or more, or unknown?
- Are they the decision maker, or do they need to include someone else?
- How interested are they: high, medium, or low? Base this only on what they say, not on guessing.
- Would they like a human from the team to call back, and when?

Do not infer answers from silence. If the person declines to answer a question, record the value as unknown, not_disclosed, or low as appropriate. Never pressure, repeat an unanswered question aggressively, or invent an interest level. If the call is a voicemail, leave a short message and record disposition voicemail.
```

## Structured Result

```json
{
  "needs": "short text, empty if not disclosed",
  "budget_range": "under_1k | 1k_5k | 5k_20k | 20k_plus | not_disclosed",
  "timeline": "immediate | 1_3_months | 3_6_months | 6_months_plus | unknown",
  "is_decision_maker": true,
  "interest_level": "high | medium | low",
  "callback_requested": true,
  "disposition": "qualified | needs_human | not_interested | blocked_compliance | voicemail | no_answer | wrong_number"
}
```

A `qualified` result is an **interest signal, not a closed sale**. `needs_human`, `voicemail`, `no_answer`, and low-confidence answers all route to a human and are never auto-qualified. See `references/qualification-schema.md` for the full contract.

## Live Planning

Only after explicit user authorization and CALL-E authentication:

```bash
export CALLE_API_KEY="<server key>"
calle call plan --to-phone <E164_PHONE> --goal "<reviewed goal text>" --timezone <IANA> --language English --region <REGION>
```

`calle call plan` is planning, not execution. Do not start the call unless the user separately confirms. Read `references/calle-workflow.md` for the exact plan/run/status sequence, preflight, and idempotency handling.

## Cancellation And Idempotency

Idempotency key: `lead_qualification:{lead_id}:{campaign_id}`. If the user cancels before dial, do not execute. If a result is ambiguous, route to a human rather than calling again. Never automatically retry an error or unknown outcome; that would create a duplicate qualification call.

## Safety Notes

Read `references/safety.md` and `references/examples.md` before any live planning. Read `references/crm-routing.md` before routing a disposition, and `references/calle-workflow.md` before the live sequence. No CRM write and no meeting booking happens without a human review.