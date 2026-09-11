# Examples

Phone numbers below come from the NANP-reserved fictional range `+1 202 555 01xx`. No example here comes from a real call; they illustrate the shapes the skill consumes and produces.

## 1. Create request (driver, fact-finding)

```json
{
  "task": "You are an AI assistant calling on behalf of Northwind Freight Operations. ...",
  "recipients": [{ "phones": ["+12025550100"], "locale": "en-US", "region": "US" }],
  "recipient_result_schema": { "$comment": "see result-schema.json" },
  "metadata": {
    "app": "docksignal",
    "incident_id": "DS-1042",
    "shipment_ref": "SHP-88214",
    "contact_id": "DS-1042:driver",
    "contact_role": "driver",
    "task_id": "DS-1042:DS-1042:driver:fact_finding",
    "kind": "fact_finding"
  },
  "webhook_url": "https://docksignal.example.com/api/webhooks/calle"
}
```

Header: `Idempotency-Key: docksignal:DS-1042:DS-1042:driver:fact_finding:v1`

## 2. Recipient result that becomes facts

```json
{
  "contact_role": "driver",
  "reached": "yes",
  "shipment_recognized": "yes",
  "current_status": "Stuck at Tuas Checkpoint, customs queue",
  "revised_eta": "16:40",
  "can_accept": "unknown",
  "blocker": "Customs inspection queue",
  "next_action": "Will call when 30 minutes out",
  "certainty": "high"
}
```

Facts produced: current location (verified), revised ETA 16:40 (verified, parsed), blocker (verified). `can_accept` is unresolved and ignored for a driver.

## 3. Recipient result that produces no facts

```json
{
  "contact_role": "unknown",
  "reached": "no",
  "shipment_recognized": "unknown",
  "current_status": "",
  "revised_eta": "",
  "can_accept": "unknown",
  "blocker": "",
  "next_action": "",
  "certainty": "unknown"
}
```

Listed under *unresolved sources* as "Contact not reached (reached = no)".

## 4. Dock result with a cutoff

```json
{
  "contact_role": "receiving_dock",
  "reached": "yes",
  "shipment_recognized": "yes",
  "current_status": "Slot released, dock open until 16:00",
  "revised_eta": "16:00",
  "can_accept": "conditional",
  "blocker": "No receiving after 16:00 without manager approval",
  "next_action": "Call the receiving manager for anything later",
  "certainty": "high"
}
```

Combined with example 2: ETA 16:40 is 40 minutes after the dock-stated cutoff 16:00 → branch `window_missed` → suggested action `request_dock_exception` (follow-up call, requires approval) plus `notify_dispatcher` (manual).

## 5. Conflict

Driver says `"revised_eta": "16:40"`, dispatcher says `"revised_eta": "5:30 pm"`. The revised-ETA fact is **conflicted** with both sources listed, the branch is `eta_conflicted`, the only action is `resolve_eta_conflict`, and confidence is `low`. Nothing is compared against the cutoff.

## 6. Vague ETA

Driver says `"revised_eta": "later this afternoon, maybe an hour"`. The value is stored as text, flagged "not an exact clock time", the branch is `eta_unresolved`, and the action is `obtain_exact_eta`. The skill never converts it to a time.

## 7. Follow-up result after approval

```json
{
  "contact_role": "receiving_dock",
  "reached": "yes",
  "shipment_recognized": "yes",
  "current_status": "Manager approved a late receive",
  "revised_eta": "16:45",
  "can_accept": "conditional",
  "blocker": "Door 3 only, paperwork ready on arrival",
  "next_action": "Receiving manager will wait at door 3",
  "certainty": "high"
}
```

Branch `exception_granted`; the recovery card records the window 16:45 with its condition and the operator briefs the driver. The window is still tentative until the operator confirms it.

## 8. Offline validation

```bash
node scripts/validate-result.mjs assets/sample-result-driver.json
node scripts/validate-result.mjs assets/sample-result-vague.json
```

Prints the resolved/unresolved status of every field and exits non-zero for a payload that violates the schema (extra field, missing field, bad enum).
